import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/app_config.dart';
import '../models/app_user.dart';

class PeerSignal {
  const PeerSignal({required this.fromSocketId, required this.payload});

  final String fromSocketId;
  final Map<String, dynamic> payload;
}

class SignalingService {
  io.Socket? _socket;
  String? _roomId;
  int? _databaseRoomId;

  final _events = StreamController<String>.broadcast();
  final _peers = StreamController<List<Map<String, dynamic>>>.broadcast();
  final _userJoined = StreamController<Map<String, dynamic>>.broadcast();
  final _userLeft = StreamController<Map<String, dynamic>>.broadcast();
  final _offers = StreamController<PeerSignal>.broadcast();
  final _answers = StreamController<PeerSignal>.broadcast();
  final _iceCandidates = StreamController<PeerSignal>.broadcast();
  final _mediaStates = StreamController<Map<String, dynamic>>.broadcast();
  final _chatMessages = StreamController<Map<String, dynamic>>.broadcast();
  final _signalErrors = StreamController<Map<String, dynamic>>.broadcast();

  Stream<String> get events => _events.stream;
  Stream<List<Map<String, dynamic>>> get peers => _peers.stream;
  Stream<Map<String, dynamic>> get userJoined => _userJoined.stream;
  Stream<Map<String, dynamic>> get userLeft => _userLeft.stream;
  Stream<PeerSignal> get offers => _offers.stream;
  Stream<PeerSignal> get answers => _answers.stream;
  Stream<PeerSignal> get iceCandidates => _iceCandidates.stream;
  Stream<Map<String, dynamic>> get mediaStates => _mediaStates.stream;
  Stream<Map<String, dynamic>> get chatMessages => _chatMessages.stream;
  Stream<Map<String, dynamic>> get signalErrors => _signalErrors.stream;

  String? get socketId => _socket?.id;
  String? get roomId => _roomId;
  int? get databaseRoomId => _databaseRoomId;
  bool get connected => _socket?.connected ?? false;

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
      final data = _mapPayload(payload);
      _userJoined.add(data);
      _events.add('Peer joined: ${_peerName(data)}');
    });
    socket.on('user-left', (payload) {
      final data = _mapPayload(payload);
      _userLeft.add(data);
      _events.add('Peer left: ${_peerName(data)}');
    });
    socket.on('webrtc-offer', (payload) {
      final signal = _peerSignal(payload, 'offer');
      if (signal != null) _offers.add(signal);
    });
    socket.on('webrtc-answer', (payload) {
      final signal = _peerSignal(payload, 'answer');
      if (signal != null) _answers.add(signal);
    });
    socket.on('webrtc-ice-candidate', (payload) {
      final signal = _peerSignal(payload, 'candidate');
      if (signal != null) _iceCandidates.add(signal);
    });
    socket.on('peer-signal-error', (payload) {
      final data = _mapPayload(payload);
      _signalErrors.add(data);
      _events.add(data['message']?.toString() ?? 'Peer signal failed.');
    });
    socket.on('media-state-change', (payload) {
      final data = _mapPayload(payload);
      _mediaStates.add(data);
      _events.add('Peer media updated: ${_peerName(data)}');
    });
    socket.on('chat-message', (payload) {
      final data = _mapPayload(payload);
      _chatMessages.add(data);
    });
    socket.on('chat-message-edited', (payload) {
      final data = _mapPayload(payload);
      data['event'] = 'edited';
      _chatMessages.add(data);
    });
    socket.on('chat-message-deleted', (payload) {
      final data = _mapPayload(payload);
      data['event'] = 'deleted';
      _chatMessages.add(data);
    });
    socket.on('chat-message-unsent', (payload) {
      final data = _mapPayload(payload);
      data['event'] = 'unsent';
      _chatMessages.add(data);
    });
    socket.on('room-session-replaced', (_) {
      _events.add('This room session was opened on another device.');
      leaveRoom();
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
    _roomId = signalingRoom;
    _databaseRoomId = databaseRoomId;

    final data = await _emitWithAck('join-room', {
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
    }, timeout: const Duration(seconds: 8));

    _handlePeersPayload('Joined room', data);
    return data;
  }

  Future<Map<String, dynamic>> refreshPeers() async {
    final room = _roomId;
    if (room == null || room.isEmpty) {
      throw StateError('Signaling room is not joined.');
    }

    final data = await _emitWithAck('room-peers', {
      'roomId': room,
    }, timeout: const Duration(seconds: 5));
    _handlePeersPayload('Peer refresh', data);
    return data;
  }

  Future<void> sendOffer({
    required String targetSocketId,
    required Map<String, dynamic> offer,
  }) async {
    await _emitWithAck('webrtc-offer', {
      'targetSocketId': targetSocketId,
      'offer': offer,
    }, timeout: const Duration(seconds: 6));
  }

  Future<void> sendAnswer({
    required String targetSocketId,
    required Map<String, dynamic> answer,
  }) async {
    await _emitWithAck('webrtc-answer', {
      'targetSocketId': targetSocketId,
      'answer': answer,
    }, timeout: const Duration(seconds: 6));
  }

  void sendIceCandidate({
    required String targetSocketId,
    required Map<String, dynamic> candidate,
  }) {
    final socket = _requireSocket();
    socket.emit('webrtc-ice-candidate', {
      'targetSocketId': targetSocketId,
      'candidate': candidate,
    });
  }

  Future<void> emitMediaState({
    required bool micEnabled,
    required bool cameraEnabled,
    bool screenShared = false,
    String? rtcMode,
  }) async {
    final room = _roomId;
    if (room == null || room.isEmpty) {
      throw StateError('Signaling room is not joined.');
    }

    await _emitWithAck('media-state-change', {
      'roomId': room,
      'rtcMode': ?rtcMode,
      'micEnabled': micEnabled,
      'cameraEnabled': cameraEnabled,
      'screenShared': screenShared,
    }, timeout: const Duration(seconds: 4));
  }

  Future<void> broadcastChatMessage(Map<String, dynamic> message) async {
    final room = _roomId;
    if (room == null || room.isEmpty) return;

    await _emitWithAck('chat-message', {
      'roomId': room,
      'message': message,
    }, timeout: const Duration(seconds: 4));
  }

  void leaveRoom() {
    _socket?.emit('leave-room');
    _roomId = null;
    _databaseRoomId = null;
  }

  void dispose() {
    leaveRoom();
    _socket?.dispose();
    _socket = null;
    _events.close();
    _peers.close();
    _userJoined.close();
    _userLeft.close();
    _offers.close();
    _answers.close();
    _iceCandidates.close();
    _mediaStates.close();
    _chatMessages.close();
    _signalErrors.close();
  }

  void _handlePeersPayload(String label, Object? payload) {
    if (payload is! Map) {
      _events.add(label);
      return;
    }
    final data = Map<String, dynamic>.from(payload);
    final users = data['users'];
    final peers = users is List
        ? users
              .whereType<Map>()
              .map((user) => Map<String, dynamic>.from(user))
              .toList()
        : <Map<String, dynamic>>[];
    _peers.add(peers);
    _events.add('$label: ${data['roomId'] ?? ''}');
  }

  io.Socket _requireSocket() {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      throw StateError('Signaling socket is not connected.');
    }
    return socket;
  }

  Future<Map<String, dynamic>> _emitWithAck(
    String event,
    Map<String, dynamic> payload, {
    required Duration timeout,
  }) {
    final socket = _requireSocket();
    final completer = Completer<Map<String, dynamic>>();
    Timer? timer;

    void completeError(Object error) {
      if (completer.isCompleted) return;
      timer?.cancel();
      completer.completeError(error);
    }

    timer = Timer(timeout, () {
      completeError('$event timed out.');
    });

    socket.emitWithAck(
      event,
      payload,
      ack: (response) {
        if (completer.isCompleted) return;
        timer?.cancel();
        if (response is Map) {
          final data = Map<String, dynamic>.from(response);
          if (data['ok'] == true) {
            completer.complete(data);
          } else {
            completer.completeError(
              data['message']?.toString() ?? '$event failed.',
            );
          }
          return;
        }
        completer.completeError('Unexpected $event response.');
      },
    );

    return completer.future;
  }

  Map<String, dynamic> _mapPayload(Object? payload) {
    if (payload is Map) return Map<String, dynamic>.from(payload);
    return <String, dynamic>{};
  }

  PeerSignal? _peerSignal(Object? payload, String payloadKey) {
    final data = _mapPayload(payload);
    final fromSocketId = data['fromSocketId']?.toString() ?? '';
    final signalPayload = data[payloadKey];
    if (fromSocketId.isEmpty || signalPayload is! Map) return null;
    return PeerSignal(
      fromSocketId: fromSocketId,
      payload: Map<String, dynamic>.from(signalPayload),
    );
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
