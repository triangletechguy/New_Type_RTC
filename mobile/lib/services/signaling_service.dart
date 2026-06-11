import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/app_config.dart';
import '../models/app_user.dart';

class SignalingService {
  io.Socket? _socket;

  final _events = StreamController<String>.broadcast();
  final _peers = StreamController<List<Map<String, dynamic>>>.broadcast();

  Stream<String> get events => _events.stream;
  Stream<List<Map<String, dynamic>>> get peers => _peers.stream;

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
    socket.on(
      'user-joined',
      (payload) => _events.add('Peer joined: ${_peerName(payload)}'),
    );
    socket.on(
      'user-left',
      (payload) => _events.add('Peer left: ${_peerName(payload)}'),
    );
    socket.on('webrtc-offer', (_) => _events.add('Received WebRTC offer.'));
    socket.on('webrtc-answer', (_) => _events.add('Received WebRTC answer.'));
    socket.on(
      'webrtc-ice-candidate',
      (_) => _events.add('Received ICE candidate.'),
    );

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

  void leaveRoom() {
    _socket?.emit('leave-room');
  }

  void dispose() {
    leaveRoom();
    _socket?.dispose();
    _socket = null;
    _events.close();
    _peers.close();
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
