import 'dart:async';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'signaling_service.dart';

class RtcConnectionService {
  final _events = StreamController<String>.broadcast();
  final _remoteStreams = StreamController<Map<String, MediaStream>>.broadcast();
  final _peerStates = StreamController<Map<String, String>>.broadcast();

  Stream<String> get events => _events.stream;
  Stream<Map<String, MediaStream>> get remoteStreams => _remoteStreams.stream;
  Stream<Map<String, String>> get peerStates => _peerStates.stream;

  final Map<String, RTCPeerConnection> _peerConnections = {};
  final Map<String, MediaStream> _remoteStreamsBySocket = {};
  final Map<String, String> _peerStatesBySocket = {};
  final Map<String, List<RTCIceCandidate>> _pendingCandidates = {};
  final Map<String, bool> _makingOffers = {};
  final Set<String> _ignoredOffers = {};
  final List<StreamSubscription<dynamic>> _signalingSubscriptions = [];

  SignalingService? _signaling;
  MediaStream? _localStream;
  String? _localSocketId;
  String _rtcMode = 'video';
  List<Map<String, dynamic>> _iceServers = const [];
  String _iceTransportPolicy = 'all';

  Future<void> start({
    required SignalingService signaling,
    required MediaStream localStream,
    required String rtcMode,
    required List<Map<String, dynamic>> iceServers,
    required String iceTransportPolicy,
    String? localSocketId,
  }) async {
    await closeAll();
    await _cancelSignalingSubscriptions();

    _signaling = signaling;
    _localStream = localStream;
    _rtcMode = rtcMode == 'audio' ? 'audio' : 'video';
    _iceServers = iceServers;
    _iceTransportPolicy = iceTransportPolicy == 'relay' ? 'relay' : 'all';
    _localSocketId = localSocketId;

    _signalingSubscriptions.addAll([
      signaling.userJoined.listen((peer) {
        final socketId = peer['socketId']?.toString() ?? '';
        if (_shouldIgnorePeer(socketId)) return;
        _events.add('Negotiating with ${_shortSocket(socketId)}...');
        unawaited(createOffer(socketId));
      }),
      signaling.userLeft.listen((peer) {
        final socketId = peer['socketId']?.toString() ?? '';
        if (socketId.isEmpty) return;
        unawaited(closePeer(socketId));
      }),
      signaling.offers.listen((signal) {
        if (_shouldIgnorePeer(signal.fromSocketId)) return;
        unawaited(handleOffer(signal.fromSocketId, signal.payload));
      }),
      signaling.answers.listen((signal) {
        if (_shouldIgnorePeer(signal.fromSocketId)) return;
        unawaited(handleAnswer(signal.fromSocketId, signal.payload));
      }),
      signaling.iceCandidates.listen((signal) {
        if (_shouldIgnorePeer(signal.fromSocketId)) return;
        unawaited(handleIceCandidate(signal.fromSocketId, signal.payload));
      }),
      signaling.signalErrors.listen((payload) {
        final targetSocketId = payload['targetSocketId']?.toString() ?? '';
        if (targetSocketId.isNotEmpty) unawaited(closePeer(targetSocketId));
      }),
    ]);
  }

  void setLocalSocketId(String? socketId) {
    if (socketId == null || socketId.isEmpty) return;
    _localSocketId = socketId;
  }

  Future<void> negotiateExistingPeers(List<Map<String, dynamic>> peers) async {
    for (final peer in peers) {
      final socketId = peer['socketId']?.toString() ?? '';
      if (_shouldIgnorePeer(socketId)) continue;
      await createOffer(socketId);
    }
  }

  Future<bool> createOffer(String remoteSocketId) async {
    if (_shouldIgnorePeer(remoteSocketId)) return false;

    final peerConnection = await _createPeerConnection(remoteSocketId);
    if (peerConnection.signalingState !=
        RTCSignalingState.RTCSignalingStateStable) {
      return false;
    }

    _makingOffers[remoteSocketId] = true;
    _setPeerState(remoteSocketId, 'negotiating');

    try {
      final offer = await peerConnection.createOffer({
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': _rtcMode == 'video',
      });
      await peerConnection.setLocalDescription(offer);
      await _signaling?.sendOffer(
        targetSocketId: remoteSocketId,
        offer: _descriptionToMap(offer),
      );
      return true;
    } catch (error) {
      _events.add('Offer failed for ${_shortSocket(remoteSocketId)}: $error');
      rethrow;
    } finally {
      _makingOffers[remoteSocketId] = false;
    }
  }

  Future<bool> handleOffer(
    String fromSocketId,
    Map<String, dynamic> offer,
  ) async {
    if (_shouldIgnorePeer(fromSocketId)) return false;

    var peerConnection = await _createPeerConnection(fromSocketId);
    final offerCollision =
        peerConnection.signalingState !=
            RTCSignalingState.RTCSignalingStateStable ||
        (_makingOffers[fromSocketId] ?? false);
    final ignoreOffer = !_isPolitePeer(fromSocketId) && offerCollision;

    if (ignoreOffer) {
      _ignoredOffers.add(fromSocketId);
      _setPeerState(fromSocketId, 'glare');
      return false;
    }

    _ignoredOffers.remove(fromSocketId);

    if (offerCollision &&
        peerConnection.signalingState !=
            RTCSignalingState.RTCSignalingStateStable) {
      final rolledBack = await _rollback(peerConnection);
      if (!rolledBack &&
          peerConnection.signalingState !=
              RTCSignalingState.RTCSignalingStateStable) {
        await closePeer(fromSocketId);
        peerConnection = await _createPeerConnection(fromSocketId);
      }
    }

    await peerConnection.setRemoteDescription(_descriptionFromMap(offer));
    await _flushPendingCandidates(fromSocketId);

    final answer = await peerConnection.createAnswer({
      'offerToReceiveAudio': true,
      'offerToReceiveVideo': _rtcMode == 'video',
    });
    await peerConnection.setLocalDescription(answer);
    await _signaling?.sendAnswer(
      targetSocketId: fromSocketId,
      answer: _descriptionToMap(answer),
    );
    _setPeerState(fromSocketId, 'answering');
    return true;
  }

  Future<void> handleAnswer(
    String fromSocketId,
    Map<String, dynamic> answer,
  ) async {
    final peerConnection = _peerConnections[fromSocketId];
    if (peerConnection == null) return;
    if (peerConnection.signalingState !=
        RTCSignalingState.RTCSignalingStateHaveLocalOffer) {
      return;
    }

    await peerConnection.setRemoteDescription(_descriptionFromMap(answer));
    await _flushPendingCandidates(fromSocketId);
  }

  Future<void> handleIceCandidate(
    String fromSocketId,
    Map<String, dynamic> candidate,
  ) async {
    if (_ignoredOffers.contains(fromSocketId)) return;

    final iceCandidate = _candidateFromMap(candidate);
    final peerConnection = _peerConnections[fromSocketId];
    final remoteDescription = await peerConnection?.getRemoteDescription();

    if (peerConnection == null || remoteDescription == null) {
      _pendingCandidates.putIfAbsent(fromSocketId, () => []).add(iceCandidate);
      return;
    }

    await peerConnection.addCandidate(iceCandidate);
  }

  Future<void> setAudioEnabled(bool enabled) async {
    final stream = _localStream;
    if (stream == null) return;
    for (final track in stream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  Future<void> setVideoEnabled(bool enabled) async {
    final stream = _localStream;
    if (stream == null) return;
    for (final track in stream.getVideoTracks()) {
      track.enabled = enabled;
    }
  }

  Future<void> addLocalTrack(MediaStreamTrack track) async {
    final stream = _localStream;
    if (stream == null) return;

    if (!_streamHasTrack(stream, track)) {
      await stream.addTrack(track);
    }

    for (final entry in _peerConnections.entries) {
      await entry.value.addTrack(track, stream);
      await createOffer(entry.key);
    }
  }

  Future<void> closePeer(String remoteSocketId) async {
    final peerConnection = _peerConnections.remove(remoteSocketId);
    _pendingCandidates.remove(remoteSocketId);
    _makingOffers.remove(remoteSocketId);
    _ignoredOffers.remove(remoteSocketId);
    _peerStatesBySocket.remove(remoteSocketId);
    _emitPeerStates();

    if (peerConnection != null) {
      await peerConnection.close().catchError((_) {});
      await peerConnection.dispose().catchError((_) {});
    }

    final stream = _remoteStreamsBySocket.remove(remoteSocketId);
    await stream?.dispose().catchError((_) {});
    _emitRemoteStreams();
  }

  Future<void> closeAll() async {
    final socketIds = List<String>.from(_peerConnections.keys);
    for (final socketId in socketIds) {
      await closePeer(socketId);
    }
  }

  Future<void> dispose() async {
    await _cancelSignalingSubscriptions();
    await closeAll();
    await _events.close();
    await _remoteStreams.close();
    await _peerStates.close();
  }

  Future<RTCPeerConnection> _createPeerConnection(String remoteSocketId) async {
    final existing = _peerConnections[remoteSocketId];
    if (existing != null) return existing;

    final peerConnection = await createPeerConnection({
      'iceServers': _iceServers.isNotEmpty
          ? _iceServers
          : [
              {'urls': 'stun:stun.l.google.com:19302'},
            ],
      'iceTransportPolicy': _iceTransportPolicy,
      'iceCandidatePoolSize': 4,
    });

    final stream = _localStream;
    if (stream != null) {
      for (final track in stream.getTracks()) {
        if (_rtcMode == 'audio' && track.kind == 'video') continue;
        await peerConnection.addTrack(track, stream);
      }
    }

    peerConnection.onIceCandidate = (candidate) {
      final candidateValue = candidate.candidate;
      if (candidateValue == null || candidateValue.isEmpty) return;
      _signaling?.sendIceCandidate(
        targetSocketId: remoteSocketId,
        candidate: _candidateToMap(candidate),
      );
    };

    peerConnection.onTrack = (event) {
      unawaited(_addRemoteTrack(remoteSocketId, event));
    };

    peerConnection.onAddStream = (remoteStream) {
      _remoteStreamsBySocket[remoteSocketId] = remoteStream;
      _emitRemoteStreams();
      _setPeerState(remoteSocketId, 'connected');
    };

    peerConnection.onRemoveStream = (_) {
      _remoteStreamsBySocket.remove(remoteSocketId);
      _emitRemoteStreams();
    };

    peerConnection.onConnectionState = (state) {
      _setPeerState(remoteSocketId, _connectionStateLabel(state));
    };

    peerConnection.onIceConnectionState = (state) {
      final label = _iceStateLabel(state);
      if (label != 'new') _setPeerState(remoteSocketId, label);
    };

    _peerConnections[remoteSocketId] = peerConnection;
    _setPeerState(remoteSocketId, 'new');
    return peerConnection;
  }

  Future<void> _addRemoteTrack(
    String remoteSocketId,
    RTCTrackEvent event,
  ) async {
    var stream = event.streams.isNotEmpty
        ? event.streams.first
        : _remoteStreamsBySocket[remoteSocketId];

    stream ??= await createLocalMediaStream('remote-$remoteSocketId');

    final track = event.track;
    if (!_streamHasTrack(stream, track)) {
      await stream.addTrack(track);
    }

    _remoteStreamsBySocket[remoteSocketId] = stream;
    _emitRemoteStreams();
    _setPeerState(remoteSocketId, 'connected');
  }

  Future<void> _flushPendingCandidates(String remoteSocketId) async {
    final peerConnection = _peerConnections[remoteSocketId];
    final candidates = _pendingCandidates.remove(remoteSocketId) ?? const [];
    if (peerConnection == null || candidates.isEmpty) return;

    for (final candidate in candidates) {
      await peerConnection.addCandidate(candidate);
    }
  }

  Future<bool> _rollback(RTCPeerConnection peerConnection) async {
    try {
      await peerConnection.setLocalDescription(
        RTCSessionDescription('', 'rollback'),
      );
      return true;
    } catch (_) {
      // Some native WebRTC builds do not support explicit rollback. The
      // subsequent remote description still succeeds for the common stable path.
      return false;
    }
  }

  Future<void> _cancelSignalingSubscriptions() async {
    for (final subscription in _signalingSubscriptions) {
      await subscription.cancel();
    }
    _signalingSubscriptions.clear();
  }

  bool _isPolitePeer(String remoteSocketId) {
    final localSocketId = _localSocketId;
    if (localSocketId == null || localSocketId.isEmpty) return true;
    return localSocketId.compareTo(remoteSocketId) > 0;
  }

  bool _shouldIgnorePeer(String socketId) {
    if (socketId.isEmpty) return true;
    return _localSocketId != null && socketId == _localSocketId;
  }

  bool _streamHasTrack(MediaStream stream, MediaStreamTrack track) {
    final trackId = track.id;
    if (trackId == null || trackId.isEmpty) return false;
    return stream.getTracks().any((candidate) => candidate.id == trackId);
  }

  RTCSessionDescription _descriptionFromMap(Map<String, dynamic> map) {
    return RTCSessionDescription(
      map['sdp']?.toString(),
      map['type']?.toString(),
    );
  }

  Map<String, dynamic> _descriptionToMap(RTCSessionDescription description) {
    return {'sdp': description.sdp, 'type': description.type};
  }

  RTCIceCandidate _candidateFromMap(Map<String, dynamic> map) {
    return RTCIceCandidate(
      map['candidate']?.toString(),
      map['sdpMid']?.toString(),
      _asInt(map['sdpMLineIndex']),
    );
  }

  Map<String, dynamic> _candidateToMap(RTCIceCandidate candidate) {
    return {
      'candidate': candidate.candidate,
      'sdpMid': candidate.sdpMid,
      'sdpMLineIndex': candidate.sdpMLineIndex,
    };
  }

  int? _asInt(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '');
  }

  void _setPeerState(String remoteSocketId, String state) {
    _peerStatesBySocket[remoteSocketId] = state;
    _emitPeerStates();
  }

  void _emitPeerStates() {
    _peerStates.add(Map<String, String>.unmodifiable(_peerStatesBySocket));
  }

  void _emitRemoteStreams() {
    _remoteStreams.add(
      Map<String, MediaStream>.unmodifiable(_remoteStreamsBySocket),
    );
  }

  String _connectionStateLabel(RTCPeerConnectionState? state) {
    switch (state) {
      case RTCPeerConnectionState.RTCPeerConnectionStateConnected:
        return 'connected';
      case RTCPeerConnectionState.RTCPeerConnectionStateConnecting:
        return 'connecting';
      case RTCPeerConnectionState.RTCPeerConnectionStateDisconnected:
        return 'disconnected';
      case RTCPeerConnectionState.RTCPeerConnectionStateFailed:
        return 'failed';
      case RTCPeerConnectionState.RTCPeerConnectionStateClosed:
        return 'closed';
      case RTCPeerConnectionState.RTCPeerConnectionStateNew:
      case null:
        return 'new';
    }
  }

  String _iceStateLabel(RTCIceConnectionState? state) {
    switch (state) {
      case RTCIceConnectionState.RTCIceConnectionStateConnected:
        return 'connected';
      case RTCIceConnectionState.RTCIceConnectionStateCompleted:
        return 'completed';
      case RTCIceConnectionState.RTCIceConnectionStateChecking:
        return 'checking';
      case RTCIceConnectionState.RTCIceConnectionStateDisconnected:
        return 'disconnected';
      case RTCIceConnectionState.RTCIceConnectionStateFailed:
        return 'failed';
      case RTCIceConnectionState.RTCIceConnectionStateClosed:
        return 'closed';
      case RTCIceConnectionState.RTCIceConnectionStateCount:
      case RTCIceConnectionState.RTCIceConnectionStateNew:
      case null:
        return 'new';
    }
  }

  String _shortSocket(String socketId) {
    return socketId.length <= 6 ? socketId : socketId.substring(0, 6);
  }
}
