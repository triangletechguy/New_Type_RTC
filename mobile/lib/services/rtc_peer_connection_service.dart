import 'dart:async';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'signaling_service.dart';

class RtcRemoteStream {
  const RtcRemoteStream({required this.socketId, required this.stream});

  final String socketId;
  final MediaStream? stream;
}

class RtcPeerStateSnapshot {
  const RtcPeerStateSnapshot({required this.socketId, required this.state});

  final String socketId;
  final String state;
}

abstract class RtcPeerCoordinator {
  Stream<RtcRemoteStream> get remoteStreams;
  Stream<RtcPeerStateSnapshot> get peerStates;

  Future<void> attachSignaling(SignalingService signaling);

  Future<void> setLocalStream(MediaStream? stream, {required bool video});

  Future<void> syncPeers(List<Map<String, dynamic>> peers);

  Future<void> closeAll();

  Future<void> dispose();
}

class RtcPeerConnectionService implements RtcPeerCoordinator {
  final _remoteStreams = StreamController<RtcRemoteStream>.broadcast();
  final _peerStates = StreamController<RtcPeerStateSnapshot>.broadcast();
  final _peers = <String, _PeerConnectionHandle>{};
  final _pendingCandidates = <String, List<RTCIceCandidate>>{};
  final _subscriptions = <StreamSubscription<Object?>>[];

  SignalingService? _signaling;
  MediaStream? _localStream;
  bool _video = false;
  bool _disposed = false;

  @override
  Stream<RtcRemoteStream> get remoteStreams => _remoteStreams.stream;

  @override
  Stream<RtcPeerStateSnapshot> get peerStates => _peerStates.stream;

  @override
  Future<void> attachSignaling(SignalingService signaling) async {
    if (identical(_signaling, signaling)) return;
    await _cancelSubscriptions();
    _signaling = signaling;
    _subscriptions
      ..add(signaling.offers.listen((event) => _handleOffer(event)))
      ..add(signaling.answers.listen((event) => _handleAnswer(event)))
      ..add(signaling.iceCandidates.listen((event) => _handleIce(event)))
      ..add(
        signaling.peerSignalErrors.listen((event) {
          final target = event.targetSocketId;
          if (target == null) return;
          _emitPeerState(target, event.message);
        }),
      )
      ..add(
        signaling.sessionReplaced.listen((_) {
          unawaited(closeAll());
        }),
      );
  }

  @override
  Future<void> setLocalStream(
    MediaStream? stream, {
    required bool video,
  }) async {
    _localStream = stream;
    _video = video;
    for (final peer in _peers.values) {
      await _syncLocalTracks(peer);
      if (_shouldInitiate(peer.socketId)) {
        unawaited(_makeOffer(peer, force: true));
      }
    }
  }

  @override
  Future<void> syncPeers(List<Map<String, dynamic>> peers) async {
    final nextSocketIds = peers
        .map((peer) => peer['socketId']?.toString())
        .whereType<String>()
        .where((socketId) => socketId.isNotEmpty)
        .toSet();

    final staleSocketIds = _peers.keys
        .where((socketId) => !nextSocketIds.contains(socketId))
        .toList();
    for (final socketId in staleSocketIds) {
      await _closePeer(socketId);
    }

    for (final socketId in nextSocketIds) {
      final peer = await _ensurePeer(socketId);
      if (_shouldInitiate(socketId)) {
        unawaited(_makeOffer(peer));
      }
    }
  }

  @override
  Future<void> closeAll() async {
    final socketIds = _peers.keys.toList();
    for (final socketId in socketIds) {
      await _closePeer(socketId);
    }
    _pendingCandidates.clear();
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _cancelSubscriptions();
    await closeAll();
    await _remoteStreams.close();
    await _peerStates.close();
  }

  Future<_PeerConnectionHandle> _ensurePeer(String socketId) async {
    final existing = _peers[socketId];
    if (existing != null) return existing;

    final pc = await createPeerConnection(_configuration, _constraints);
    final peer = _PeerConnectionHandle(socketId: socketId, pc: pc);
    _peers[socketId] = peer;

    pc.onIceCandidate = (candidate) {
      if (candidate.candidate == null || candidate.candidate!.isEmpty) return;
      final signaling = _signaling;
      if (signaling == null) return;
      unawaited(
        signaling
            .emitWebRtcIceCandidate(
              targetSocketId: socketId,
              candidate: candidate,
            )
            .catchError((Object error) {
              _emitPeerState(socketId, 'ICE send failed');
              return <String, dynamic>{};
            }),
      );
    };
    pc.onTrack = (event) {
      if (event.streams.isEmpty) return;
      _remoteStreams.add(
        RtcRemoteStream(socketId: socketId, stream: event.streams.first),
      );
    };
    pc.onAddStream = (stream) {
      _remoteStreams.add(RtcRemoteStream(socketId: socketId, stream: stream));
    };
    pc.onRemoveStream = (_) {
      _remoteStreams.add(RtcRemoteStream(socketId: socketId, stream: null));
    };
    pc.onConnectionState = (state) {
      _emitPeerState(socketId, _stateLabel(state));
    };
    pc.onIceConnectionState = (state) {
      _emitPeerState(socketId, _stateLabel(state));
    };

    await _syncLocalTracks(peer);
    _emitPeerState(socketId, 'New peer');
    return peer;
  }

  Future<void> _syncLocalTracks(_PeerConnectionHandle peer) async {
    final stream = _localStream;
    final senders = await peer.pc.getSenders();
    if (stream == null) {
      for (final sender in senders) {
        await sender.replaceTrack(null);
      }
      return;
    }

    for (final track in stream.getTracks()) {
      final existingSender = _senderForKind(senders, track.kind);
      if (existingSender == null) {
        await peer.pc.addTrack(track, stream);
      } else if (existingSender.track?.id != track.id) {
        await existingSender.replaceTrack(track);
      }
    }

    if (!_video) {
      for (final sender in senders) {
        if (sender.track?.kind == 'video') {
          await sender.replaceTrack(null);
        }
      }
    }
  }

  RTCRtpSender? _senderForKind(List<RTCRtpSender> senders, String? kind) {
    if (kind == null) return null;
    for (final sender in senders) {
      if (sender.track?.kind == kind) return sender;
    }
    return null;
  }

  Future<void> _makeOffer(
    _PeerConnectionHandle peer, {
    bool force = false,
  }) async {
    if (peer.makingOffer) return;
    final signaling = _signaling;
    if (signaling == null) return;

    final state = await peer.pc.getSignalingState();
    final localDescription = await peer.pc.getLocalDescription();
    final stable =
        state == null || state == RTCSignalingState.RTCSignalingStateStable;
    if (!stable) return;
    if (!force && peer.sentInitialOffer && localDescription != null) return;

    peer.makingOffer = true;
    try {
      await _syncLocalTracks(peer);
      final offer = await peer.pc.createOffer(_offerConstraints);
      await peer.pc.setLocalDescription(offer);
      await signaling.emitWebRtcOffer(
        targetSocketId: peer.socketId,
        offer: offer,
      );
      peer.sentInitialOffer = true;
      _emitPeerState(peer.socketId, 'Offer sent');
    } catch (error) {
      _emitPeerState(peer.socketId, 'Offer failed');
    } finally {
      peer.makingOffer = false;
    }
  }

  Future<void> _handleOffer(WebRtcOfferSignal signal) async {
    final signaling = _signaling;
    if (signaling == null) return;
    final peer = await _ensurePeer(signal.fromSocketId);
    try {
      await _syncLocalTracks(peer);
      await peer.pc.setRemoteDescription(signal.offer);
      await _flushPendingCandidates(signal.fromSocketId);
      final answer = await peer.pc.createAnswer(_offerConstraints);
      await peer.pc.setLocalDescription(answer);
      await signaling.emitWebRtcAnswer(
        targetSocketId: signal.fromSocketId,
        answer: answer,
      );
      _emitPeerState(signal.fromSocketId, 'Answer sent');
    } catch (error) {
      _emitPeerState(signal.fromSocketId, 'Offer handling failed');
    }
  }

  Future<void> _handleAnswer(WebRtcAnswerSignal signal) async {
    final peer = _peers[signal.fromSocketId];
    if (peer == null) return;
    try {
      await peer.pc.setRemoteDescription(signal.answer);
      await _flushPendingCandidates(signal.fromSocketId);
      _emitPeerState(signal.fromSocketId, 'Connected');
    } catch (error) {
      _emitPeerState(signal.fromSocketId, 'Answer handling failed');
    }
  }

  Future<void> _handleIce(WebRtcIceCandidateSignal signal) async {
    final peer = await _ensurePeer(signal.fromSocketId);
    final remoteDescription = await peer.pc.getRemoteDescription();
    if (remoteDescription == null) {
      _pendingCandidates
          .putIfAbsent(signal.fromSocketId, () => <RTCIceCandidate>[])
          .add(signal.candidate);
      return;
    }

    try {
      await peer.pc.addCandidate(signal.candidate);
    } catch (error) {
      _emitPeerState(signal.fromSocketId, 'ICE add failed');
    }
  }

  Future<void> _flushPendingCandidates(String socketId) async {
    final peer = _peers[socketId];
    final candidates = _pendingCandidates.remove(socketId);
    if (peer == null || candidates == null) return;
    for (final candidate in candidates) {
      await peer.pc.addCandidate(candidate);
    }
  }

  Future<void> _closePeer(String socketId) async {
    final peer = _peers.remove(socketId);
    if (peer == null) return;
    _pendingCandidates.remove(socketId);
    try {
      await peer.pc.close();
    } catch (_) {
      // The platform may already have closed this connection.
    }
    try {
      await peer.pc.dispose();
    } catch (_) {
      // Dispose should be best effort during room leave.
    }
    _remoteStreams.add(RtcRemoteStream(socketId: socketId, stream: null));
    _emitPeerState(socketId, 'Closed');
  }

  bool _shouldInitiate(String remoteSocketId) {
    final localSocketId = _signaling?.socketId;
    if (localSocketId == null || localSocketId.isEmpty) return true;
    return localSocketId.compareTo(remoteSocketId) > 0;
  }

  void _emitPeerState(String socketId, String state) {
    if (_peerStates.isClosed) return;
    _peerStates.add(RtcPeerStateSnapshot(socketId: socketId, state: state));
  }

  Future<void> _cancelSubscriptions() async {
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    _subscriptions.clear();
  }

  String _stateLabel(Object state) {
    final value = state.toString();
    final tail = value.contains('.') ? value.split('.').last : value;
    return tail
        .replaceFirst('RTCPeerConnectionState', '')
        .replaceFirst('RTCIceConnectionState', '')
        .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (match) {
          return '${match.group(1)} ${match.group(2)}';
        })
        .trim();
  }

  static const _configuration = {
    'iceServers': [
      {'urls': 'stun:stun.l.google.com:19302'},
    ],
    'iceCandidatePoolSize': 4,
  };

  static const _constraints = {
    'mandatory': {},
    'optional': [
      {'DtlsSrtpKeyAgreement': true},
    ],
  };

  static const _offerConstraints = {
    'mandatory': {'OfferToReceiveAudio': true, 'OfferToReceiveVideo': true},
    'optional': [],
  };
}

class _PeerConnectionHandle {
  _PeerConnectionHandle({required this.socketId, required this.pc});

  final String socketId;
  final RTCPeerConnection pc;
  bool makingOffer = false;
  bool sentInitialOffer = false;
}
