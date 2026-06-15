import 'dart:async';

import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/app_config.dart';
import '../models/app_user.dart';

class WebRtcOfferSignal {
  const WebRtcOfferSignal({required this.fromSocketId, required this.offer});

  final String fromSocketId;
  final RTCSessionDescription offer;
}

class WebRtcAnswerSignal {
  const WebRtcAnswerSignal({required this.fromSocketId, required this.answer});

  final String fromSocketId;
  final RTCSessionDescription answer;
}

class WebRtcIceCandidateSignal {
  const WebRtcIceCandidateSignal({
    required this.fromSocketId,
    required this.candidate,
  });

  final String fromSocketId;
  final RTCIceCandidate candidate;
}

class PeerSignalError {
  const PeerSignalError({
    required this.message,
    this.eventName,
    this.targetSocketId,
  });

  final String message;
  final String? eventName;
  final String? targetSocketId;
}

class SignalingService {
  io.Socket? _socket;
  String? _activeSignalingRoom;
  List<Map<String, dynamic>> _currentPeers = const [];

  final _events = StreamController<String>.broadcast();
  final _peers = StreamController<List<Map<String, dynamic>>>.broadcast();
  final _offers = StreamController<WebRtcOfferSignal>.broadcast();
  final _answers = StreamController<WebRtcAnswerSignal>.broadcast();
  final _iceCandidates = StreamController<WebRtcIceCandidateSignal>.broadcast();
  final _peerSignalErrors = StreamController<PeerSignalError>.broadcast();
  final _sessionReplaced = StreamController<String>.broadcast();
  final _roomMessages = StreamController<Map<String, dynamic>>.broadcast();
  final _roomMessageDeleted = StreamController<int>.broadcast();
  final _moderationActions = StreamController<Map<String, dynamic>>.broadcast();
  final _roomControlsUpdates =
      StreamController<Map<String, dynamic>>.broadcast();
  final _stageJoinRequests = StreamController<Map<String, dynamic>>.broadcast();
  final _stageJoinRequestCancellations =
      StreamController<Map<String, dynamic>>.broadcast();
  final _stagePermissionUpdates =
      StreamController<Map<String, dynamic>>.broadcast();

  Stream<String> get events => _events.stream;
  Stream<List<Map<String, dynamic>>> get peers => _peers.stream;
  Stream<WebRtcOfferSignal> get offers => _offers.stream;
  Stream<WebRtcAnswerSignal> get answers => _answers.stream;
  Stream<WebRtcIceCandidateSignal> get iceCandidates => _iceCandidates.stream;
  Stream<PeerSignalError> get peerSignalErrors => _peerSignalErrors.stream;
  Stream<String> get sessionReplaced => _sessionReplaced.stream;
  Stream<Map<String, dynamic>> get roomMessages => _roomMessages.stream;
  Stream<int> get roomMessageDeleted => _roomMessageDeleted.stream;
  Stream<Map<String, dynamic>> get moderationActions =>
      _moderationActions.stream;
  Stream<Map<String, dynamic>> get roomControlsUpdates =>
      _roomControlsUpdates.stream;
  Stream<Map<String, dynamic>> get stageJoinRequests =>
      _stageJoinRequests.stream;
  Stream<Map<String, dynamic>> get stageJoinRequestCancellations =>
      _stageJoinRequestCancellations.stream;
  Stream<Map<String, dynamic>> get stagePermissionUpdates =>
      _stagePermissionUpdates.stream;

  String? get socketId => _socket?.id;

  Future<void> connect() async {
    if (_socket?.connected ?? false) return;

    final socket = io.io(
      AppConfig.signalingUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .disableAutoConnect()
          .setReconnectionAttempts(double.infinity)
          .setReconnectionDelay(800)
          .setReconnectionDelayMax(5000)
          .build(),
    );

    _socket = socket;
    final connected = Completer<void>();

    socket.onConnect((_) {
      _events.add('Connected as ${socket.id}');
      if (!connected.isCompleted) connected.complete();
    });
    socket.onConnectError((error) {
      _events.add('Signaling error: $error');
      if (!connected.isCompleted) {
        connected.completeError(error ?? 'Connect error');
      }
    });
    socket.onDisconnect((reason) => _events.add('Disconnected: $reason'));
    socket.on(
      'existing-users',
      (payload) => _handlePeersPayload('Existing peers', payload),
    );
    socket.on('user-joined', (payload) {
      _upsertPeer(payload);
      _events.add('Peer joined: ${_peerName(payload)}');
    });
    socket.on('user-left', (payload) {
      _removePeer(payload);
      _events.add('Peer left: ${_peerName(payload)}');
    });
    socket.on('media-state-change', (payload) {
      _upsertPeer(payload);
      _events.add('Peer media changed: ${_peerName(payload)}');
    });
    socket.on('webrtc-offer', _handleOfferPayload);
    socket.on('webrtc-answer', _handleAnswerPayload);
    socket.on('webrtc-ice-candidate', _handleIceCandidatePayload);
    socket.on('peer-signal-error', _handlePeerSignalErrorPayload);
    socket.on('chat-message', _handleChatMessagePayload);
    socket.on('chat-message-unsent', _handleChatMessageDeletedPayload);
    socket.on('chat-message-deleted', _handleChatMessageDeletedPayload);
    socket.on('moderation-action', _handleModerationActionPayload);
    socket.on('room-controls-updated', _handleRoomControlsUpdatedPayload);
    socket.on('room-roles-updated', _handleRoomControlsUpdatedPayload);
    socket.on('stage-join-request-received', _handleStageJoinRequestPayload);
    socket.on(
      'stage-join-request-cancelled',
      _handleStageJoinRequestCancellationPayload,
    );
    socket.on('stage-permission-updated', _handleStagePermissionPayload);
    socket.on('room-session-replaced', (payload) {
      final roomId = payload is Map ? payload['roomId']?.toString() : null;
      final replacedRoom = roomId ?? _activeSignalingRoom ?? 'room';
      _events.add('Room session replaced: $replacedRoom');
      _sessionReplaced.add(replacedRoom);
      _activeSignalingRoom = null;
      _setPeers(const []);
    });

    socket.connect();
    return connected.future.timeout(const Duration(seconds: 12));
  }

  Future<Map<String, dynamic>> joinRoom({
    required String signalingRoom,
    required int databaseRoomId,
    required AppUser user,
    required bool video,
    required bool micEnabled,
    required bool cameraEnabled,
  }) async {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      throw StateError('Signaling socket is not connected.');
    }

    final completer = Completer<Map<String, dynamic>>();
    socket.emitWithAck(
      'join-room',
      {
        'roomId': signalingRoom,
        'databaseRoomId': databaseRoomId,
        'userId': user.id,
        'userName': user.name,
        'userGender': user.gender,
        'userAvatarUrl': user.avatarUrl,
        'rtcMode': video ? 'video' : 'audio',
        'micEnabled': micEnabled,
        'cameraEnabled': video && cameraEnabled,
        'screenShared': false,
      },
      ack: (response) {
        if (response is Map) {
          final data = Map<String, dynamic>.from(response);
          if (data['ok'] == true) {
            _activeSignalingRoom = signalingRoom;
            _handlePeersPayload('Joined room', data);
            completer.complete(data);
          } else {
            completer.completeError(
              data['message']?.toString() ?? 'Join failed.',
            );
          }
          return;
        }
        completer.completeError('Unexpected signaling response.');
      },
    );

    return completer.future.timeout(const Duration(seconds: 8));
  }

  Future<Map<String, dynamic>> emitMediaState({
    required bool video,
    required bool micEnabled,
    required bool cameraEnabled,
    bool screenShared = false,
  }) async {
    final socket = _socket;
    final signalingRoom = _activeSignalingRoom;
    if (socket == null || !socket.connected || signalingRoom == null) {
      throw StateError('Signaling socket is not connected.');
    }

    final completer = Completer<Map<String, dynamic>>();
    socket.emitWithAck(
      'media-state-change',
      {
        'roomId': signalingRoom,
        'rtcMode': video ? 'video' : 'audio',
        'micEnabled': micEnabled,
        'cameraEnabled': video && cameraEnabled,
        'screenShared': screenShared,
      },
      ack: (response) {
        if (response is Map) {
          final data = Map<String, dynamic>.from(response);
          if (data['ok'] == true) {
            completer.complete(data);
          } else {
            completer.completeError(
              data['message']?.toString() ?? 'Media state signaling failed.',
            );
          }
          return;
        }
        completer.completeError('Unexpected signaling response.');
      },
    );

    return completer.future.timeout(const Duration(seconds: 3));
  }

  Future<Map<String, dynamic>> emitWebRtcOffer({
    required String targetSocketId,
    required RTCSessionDescription offer,
  }) {
    return _emitPeerSignal(
      'webrtc-offer',
      targetSocketId: targetSocketId,
      payloadKey: 'offer',
      payload: offer.toMap(),
    );
  }

  Future<Map<String, dynamic>> emitWebRtcAnswer({
    required String targetSocketId,
    required RTCSessionDescription answer,
  }) {
    return _emitPeerSignal(
      'webrtc-answer',
      targetSocketId: targetSocketId,
      payloadKey: 'answer',
      payload: answer.toMap(),
    );
  }

  Future<Map<String, dynamic>> emitWebRtcIceCandidate({
    required String targetSocketId,
    required RTCIceCandidate candidate,
  }) {
    return _emitPeerSignal(
      'webrtc-ice-candidate',
      targetSocketId: targetSocketId,
      payloadKey: 'candidate',
      payload: candidate.toMap(),
      timeout: const Duration(seconds: 2),
    );
  }

  Future<Map<String, dynamic>> emitChatMessage({
    required Map<String, dynamic> message,
  }) async {
    final messageId = _intValue(message['id']);
    final signalingRoom = _activeSignalingRoom;
    final socket = _socket;
    if (messageId == null) {
      throw StateError('Cannot broadcast a chat message without an id.');
    }
    if (socket == null || !socket.connected || signalingRoom == null) {
      throw StateError('Signaling socket is not connected.');
    }

    final completer = Completer<Map<String, dynamic>>();
    socket.emitWithAck(
      'chat-message',
      {
        'roomId': signalingRoom,
        'message': {'id': messageId},
      },
      ack: (response) {
        if (response is Map) {
          final data = Map<String, dynamic>.from(response);
          if (data['ok'] == true) {
            completer.complete(data);
          } else {
            completer.completeError(
              data['message']?.toString() ?? 'Chat broadcast failed.',
            );
          }
          return;
        }
        completer.completeError('Unexpected signaling response.');
      },
    );

    return completer.future.timeout(const Duration(seconds: 8));
  }

  Future<List<Map<String, dynamic>>> requestPeers() async {
    final socket = _socket;
    final signalingRoom = _activeSignalingRoom;
    if (socket == null || !socket.connected || signalingRoom == null) {
      return _currentPeers;
    }

    final completer = Completer<List<Map<String, dynamic>>>();
    socket.emitWithAck(
      'room-peers',
      {'roomId': signalingRoom},
      ack: (response) {
        if (response is Map) {
          final data = Map<String, dynamic>.from(response);
          if (data['ok'] == true) {
            final peers = _peersFromPayload(data);
            _setPeers(peers);
            completer.complete(peers);
          } else {
            completer.completeError(
              data['message']?.toString() ?? 'Peer refresh failed.',
            );
          }
          return;
        }
        completer.completeError('Unexpected peer response.');
      },
    );

    return completer.future.timeout(const Duration(seconds: 5));
  }

  void leaveRoom() {
    _socket?.emit('leave-room');
    _activeSignalingRoom = null;
    _setPeers(const []);
  }

  void dispose() {
    leaveRoom();
    _socket?.dispose();
    _socket = null;
    _events.close();
    _peers.close();
    _offers.close();
    _answers.close();
    _iceCandidates.close();
    _peerSignalErrors.close();
    _sessionReplaced.close();
    _roomMessages.close();
    _roomMessageDeleted.close();
    _moderationActions.close();
    _roomControlsUpdates.close();
    _stageJoinRequests.close();
    _stageJoinRequestCancellations.close();
    _stagePermissionUpdates.close();
  }

  Future<Map<String, dynamic>> _emitPeerSignal(
    String eventName, {
    required String targetSocketId,
    required String payloadKey,
    required Object? payload,
    Duration timeout = const Duration(seconds: 5),
  }) async {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      throw StateError('Signaling socket is not connected.');
    }

    final completer = Completer<Map<String, dynamic>>();
    socket.emitWithAck(
      eventName,
      {'targetSocketId': targetSocketId, payloadKey: payload},
      ack: (response) {
        if (response is Map) {
          final data = Map<String, dynamic>.from(response);
          if (data['ok'] == true) {
            completer.complete(data);
          } else {
            completer.completeError(
              data['message']?.toString() ?? '$eventName failed.',
            );
          }
          return;
        }
        completer.completeError('Unexpected signaling response.');
      },
    );

    return completer.future.timeout(timeout);
  }

  void _handleOfferPayload(Object? payload) {
    final data = _payloadMap(payload);
    final fromSocketId = data?['fromSocketId']?.toString();
    final offer = _sessionDescription(data?['offer']);
    if (fromSocketId == null || offer == null) {
      _events.add('Received invalid WebRTC offer.');
      return;
    }
    _events.add('Received WebRTC offer from $fromSocketId.');
    _offers.add(WebRtcOfferSignal(fromSocketId: fromSocketId, offer: offer));
  }

  void _handleAnswerPayload(Object? payload) {
    final data = _payloadMap(payload);
    final fromSocketId = data?['fromSocketId']?.toString();
    final answer = _sessionDescription(data?['answer']);
    if (fromSocketId == null || answer == null) {
      _events.add('Received invalid WebRTC answer.');
      return;
    }
    _events.add('Received WebRTC answer from $fromSocketId.');
    _answers.add(
      WebRtcAnswerSignal(fromSocketId: fromSocketId, answer: answer),
    );
  }

  void _handleIceCandidatePayload(Object? payload) {
    final data = _payloadMap(payload);
    final fromSocketId = data?['fromSocketId']?.toString();
    final candidate = _iceCandidate(data?['candidate']);
    if (fromSocketId == null || candidate == null) {
      _events.add('Received invalid ICE candidate.');
      return;
    }
    _iceCandidates.add(
      WebRtcIceCandidateSignal(
        fromSocketId: fromSocketId,
        candidate: candidate,
      ),
    );
  }

  void _handlePeerSignalErrorPayload(Object? payload) {
    final data = _payloadMap(payload);
    final error = PeerSignalError(
      eventName: data?['eventName']?.toString(),
      targetSocketId: data?['targetSocketId']?.toString(),
      message: data?['message']?.toString() ?? 'Peer signal failed.',
    );
    _events.add('Peer signal error: ${error.message}');
    _peerSignalErrors.add(error);
  }

  void _handleChatMessagePayload(Object? payload) {
    final data = _payloadMap(payload);
    final rawMessage = data?['message'];
    if (rawMessage is! Map) {
      _events.add('Received invalid chat message.');
      return;
    }
    final message = Map<String, dynamic>.from(rawMessage);
    _roomMessages.add(message);
    final sender = message['sender_name']?.toString();
    _events.add('Chat message${sender == null ? '' : ' from $sender'}');
  }

  void _handleChatMessageDeletedPayload(Object? payload) {
    final data = _payloadMap(payload);
    final messageId = _intValue(data?['messageId'] ?? data?['message_id']);
    if (messageId == null) {
      _events.add('Received invalid chat delete event.');
      return;
    }
    _roomMessageDeleted.add(messageId);
    _events.add('Chat message removed: $messageId');
  }

  void _handleModerationActionPayload(Object? payload) {
    final data = _payloadMap(payload);
    if (data == null) {
      _events.add('Received invalid moderation action.');
      return;
    }
    _moderationActions.add(data);
    final action = data['action']?.toString() ?? 'moderation';
    _events.add('Moderation action: $action');
  }

  void _handleRoomControlsUpdatedPayload(Object? payload) {
    final data = _payloadMap(payload);
    final controls = data?['controls'];
    if (controls is! Map) {
      _events.add('Received invalid room controls update.');
      return;
    }
    _roomControlsUpdates.add(Map<String, dynamic>.from(controls));
    _events.add('Room controls updated.');
  }

  void _handleStageJoinRequestPayload(Object? payload) {
    final data = _payloadMap(payload);
    final request = data?['request'];
    if (request is! Map) {
      _events.add('Received invalid stage request.');
      return;
    }
    _stageJoinRequests.add(Map<String, dynamic>.from(request));
    _events.add('Stage request received.');
  }

  void _handleStageJoinRequestCancellationPayload(Object? payload) {
    final data = _payloadMap(payload);
    if (data == null) {
      _events.add('Received invalid stage request cancellation.');
      return;
    }
    _stageJoinRequestCancellations.add(data);
    _events.add('Stage request cancelled.');
  }

  void _handleStagePermissionPayload(Object? payload) {
    final data = _payloadMap(payload);
    if (data == null) {
      _events.add('Received invalid stage permission update.');
      return;
    }
    final controls = data['controls'];
    if (controls is Map) {
      _roomControlsUpdates.add(Map<String, dynamic>.from(controls));
    }
    _stagePermissionUpdates.add(data);
    _events.add('Stage permission updated.');
  }

  Map<String, dynamic>? _payloadMap(Object? payload) {
    return payload is Map ? Map<String, dynamic>.from(payload) : null;
  }

  RTCSessionDescription? _sessionDescription(Object? payload) {
    if (payload is! Map) return null;
    final data = Map<String, dynamic>.from(payload);
    final sdp = data['sdp']?.toString();
    final type = data['type']?.toString();
    if (sdp == null || type == null) return null;
    return RTCSessionDescription(sdp, type);
  }

  RTCIceCandidate? _iceCandidate(Object? payload) {
    if (payload is! Map) return null;
    final data = Map<String, dynamic>.from(payload);
    final candidate = data['candidate']?.toString();
    if (candidate == null || candidate.isEmpty) return null;
    final rawLineIndex = data['sdpMLineIndex'];
    final sdpMLineIndex = rawLineIndex is int
        ? rawLineIndex
        : int.tryParse(rawLineIndex?.toString() ?? '');
    return RTCIceCandidate(
      candidate,
      data['sdpMid']?.toString(),
      sdpMLineIndex,
    );
  }

  void _handlePeersPayload(String label, Object? payload) {
    if (payload is! Map) {
      _events.add(label);
      return;
    }
    final data = Map<String, dynamic>.from(payload);
    _setPeers(_peersFromPayload(data));
    _events.add('$label: ${data['roomId'] ?? ''}');
  }

  List<Map<String, dynamic>> _peersFromPayload(Map<String, dynamic> data) {
    final users = data['users'];
    return users is List
        ? users
              .whereType<Map>()
              .map((user) => Map<String, dynamic>.from(user))
              .toList()
        : <Map<String, dynamic>>[];
  }

  void _setPeers(List<Map<String, dynamic>> peers) {
    _currentPeers = peers;
    _peers.add(List.unmodifiable(peers));
  }

  void _upsertPeer(Object? payload) {
    if (payload is! Map) return;
    final peer = Map<String, dynamic>.from(payload);
    final socketId = peer['socketId']?.toString();
    final userId = peer['userId']?.toString();
    final next = [..._currentPeers];
    final index = next.indexWhere((current) {
      final currentSocketId = current['socketId']?.toString();
      final currentUserId = current['userId']?.toString();
      return (socketId != null && socketId == currentSocketId) ||
          (userId != null && userId == currentUserId);
    });
    if (index >= 0) {
      next[index] = {...next[index], ...peer};
    } else {
      next.add(peer);
    }
    _setPeers(next);
  }

  void _removePeer(Object? payload) {
    if (payload is! Map) return;
    final peer = Map<String, dynamic>.from(payload);
    final socketId = peer['socketId']?.toString();
    final userId = peer['userId']?.toString();
    final next = _currentPeers.where((current) {
      final currentSocketId = current['socketId']?.toString();
      final currentUserId = current['userId']?.toString();
      if (socketId != null && socketId == currentSocketId) return false;
      if (userId != null && userId == currentUserId) return false;
      return true;
    }).toList();
    _setPeers(next);
  }

  String _peerName(Object? payload) {
    if (payload is Map) {
      return (payload['userName'] ??
              payload['userId'] ??
              payload['socketId'] ??
              'peer')
          .toString();
    }
    return 'peer';
  }
}

int? _intValue(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '');
}
