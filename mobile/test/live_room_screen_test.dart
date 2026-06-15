import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:rtc_enterprise_mobile/models/app_user.dart';
import 'package:rtc_enterprise_mobile/models/room.dart';
import 'package:rtc_enterprise_mobile/screens/live_room_screen.dart';
import 'package:rtc_enterprise_mobile/services/api_client.dart';
import 'package:rtc_enterprise_mobile/services/rtc_media_service.dart';
import 'package:rtc_enterprise_mobile/services/rtc_peer_connection_service.dart';
import 'package:rtc_enterprise_mobile/services/signaling_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('live room joins with password, syncs media, and leaves', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeLiveApi();
    final media = _FakeMediaService();
    final signaling = _FakeSignalingService();
    final peers = _FakePeerCoordinator();

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: LiveRoomScreen(
          api: api,
          user: _user,
          room: _passwordRoom,
          mediaService: media,
          peerCoordinator: peers,
          signalingService: signaling,
          enableLocalPreview: false,
          autoConnect: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Password Room'), findsWidgets);
    expect(find.text('Connect RTC'), findsNothing);
    expect(
      find.text('Enter the room password before joining.'),
      findsOneWidget,
    );
    expect(api.joinPasswords, isEmpty);

    await tester.ensureVisible(_textFieldByLabel('Room password'));
    await tester.enterText(_textFieldByLabel('Room password'), '2468');
    await tester.ensureVisible(find.text('Join room'));
    await tester.tap(find.text('Join room'));
    await tester.pumpAndSettle();

    expect(api.joinPasswords.single, '2468');
    expect(media.permissionRequests.single, isTrue);
    expect(signaling.joinedRooms.single, 'tenant-1-room-77');
    expect(peers.attachedSignaling, isTrue);
    expect(peers.localStreamVideos, contains(isTrue));
    expect(
      peers.syncedPeerSocketIds.any(
        (socketIds) => socketIds.length == 1 && socketIds.single == 'remote-1',
      ),
      isTrue,
    );
    expect(find.text('Leave'), findsWidgets);
    expect(find.text('Remote Viewer'), findsWidgets);

    await tester.ensureVisible(find.text('Mic on'));
    await tester.tap(find.text('Mic on'));
    await tester.pumpAndSettle();

    expect(api.mediaStates.single['micEnabled'], isFalse);
    expect(signaling.mediaStates.single['micEnabled'], isFalse);
    expect(find.text('Mic off'), findsWidgets);

    await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Chat'));
    await tester.tap(find.widgetWithText(OutlinedButton, 'Chat'));
    await tester.pumpAndSettle();

    expect(api.messageLoadCalls, greaterThanOrEqualTo(1));
    expect(find.text('Seeded hello'), findsWidgets);

    await tester.enterText(_textFieldByHint('Message this room'), 'Hi mobile');
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();

    expect(api.sentMessages.single['message_body'], 'Hi mobile');
    expect(signaling.broadcastMessages.single['id'], 501);
    expect(find.text('Hi mobile'), findsWidgets);

    await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Ops'));
    await tester.tap(find.widgetWithText(OutlinedButton, 'Ops'));
    await tester.pumpAndSettle();

    expect(api.controlsLoadCalls, greaterThanOrEqualTo(1));
    expect(find.text('Remote Viewer'), findsWidgets);

    final muteButton = find.widgetWithText(OutlinedButton, 'Mute').first;
    await tester.ensureVisible(muteButton);
    await tester.tap(muteButton);
    await tester.pumpAndSettle();

    expect(api.moderationCalls.single['roomId'], 77);
    expect(api.moderationCalls.single['userId'], 101);
    expect(api.moderationCalls.single['action'], 'mute_mic');
    expect(find.text('Remote Viewer muted.'), findsOneWidget);

    await tester.ensureVisible(find.text('Leave'));
    await tester.tap(find.text('Leave'));
    await tester.pumpAndSettle();

    expect(api.leaveCalls, 1);
    expect(signaling.left, isTrue);
    expect(peers.closeCalls, 1);
    expect(find.text('Left room successfully'), findsWidgets);
  });
}

Finder _textFieldByLabel(String label) {
  return find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label,
    description: 'TextField with label "$label"',
  );
}

Finder _textFieldByHint(String hint) {
  return find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.hintText == hint,
    description: 'TextField with hint "$hint"',
  );
}

const _user = AppUser(
  id: 99,
  name: 'Taylor Tester',
  email: 'taylor@example.com',
  gender: 'female',
);

final _passwordRoom = Room.fromJson({
  'id': 77,
  'tenant_id': 1,
  'tenant_name': 'RTC Enterprise',
  'owner_id': 99,
  'owner_name': 'Taylor Tester',
  'owner_region': 'United States',
  'name': 'Password Room',
  'description': 'A locked room for native live-room tests.',
  'room_type': 'group_video',
  'privacy_type': 'password',
  'is_password_protected': true,
  'max_mic_count': 4,
  'active_participants': 1,
  'chat_enabled': true,
  'gift_enabled': true,
  'screen_share_enabled': true,
  'ai_security_enabled': true,
  'status': 'active',
});

class _FakeLiveApi extends ApiClient {
  _FakeLiveApi()
    : super(
        sessionStore: _MemorySessionStore(),
        dioClient: Dio(BaseOptions(baseUrl: 'https://rtc.test/api')),
      );

  final List<String> joinPasswords = [];
  final List<Map<String, Object>> mediaStates = [];
  final List<Map<String, Object>> sentMessages = [];
  final List<Map<String, Object>> moderationCalls = [];
  int messageLoadCalls = 0;
  int controlsLoadCalls = 0;
  int leaveCalls = 0;

  @override
  Future<Map<String, dynamic>> joinRoom(
    int roomId, {
    required bool video,
    bool micEnabled = true,
    bool cameraEnabled = true,
    String password = '',
  }) async {
    joinPasswords.add(password);
    return {
      'rtc': {
        'signaling_room': 'tenant-1-room-$roomId',
        'mic_enabled': micEnabled,
        'camera_enabled': video && cameraEnabled,
      },
    };
  }

  @override
  Future<Map<String, dynamic>> updateRoomMediaState(
    int roomId, {
    required bool micEnabled,
    required bool cameraEnabled,
    bool screenShared = false,
  }) async {
    mediaStates.add({
      'roomId': roomId,
      'micEnabled': micEnabled,
      'cameraEnabled': cameraEnabled,
      'screenShared': screenShared,
    });
    return {
      'rtc': {
        'mic_enabled': micEnabled,
        'camera_enabled': cameraEnabled,
        'screen_shared': screenShared,
      },
    };
  }

  @override
  Future<Map<String, dynamic>> leaveRoom(int roomId) async {
    leaveCalls += 1;
    return {
      'left': true,
      'message': 'Left room successfully',
      'usage_logged': true,
    };
  }

  @override
  Future<List<Map<String, dynamic>>> roomMessages(
    int roomId, {
    int limit = 50,
    int? afterId,
  }) async {
    messageLoadCalls += 1;
    return [
      {
        'id': 401,
        'room_id': roomId,
        'sender_id': 100,
        'sender_name': 'Host Tester',
        'message_type': 'text',
        'message_body': 'Seeded hello',
      },
    ];
  }

  @override
  Future<Map<String, dynamic>> sendRoomMessage(
    int roomId, {
    required String body,
    String messageType = 'text',
    String mediaUrl = '',
  }) async {
    sentMessages.add({
      'roomId': roomId,
      'message_body': body,
      'message_type': messageType,
      'media_url': mediaUrl,
    });
    return {
      'message': 'Message sent successfully',
      'realtime_broadcasted': false,
      'chat_message': {
        'id': 501,
        'room_id': roomId,
        'sender_id': _user.id,
        'sender_name': _user.name,
        'message_type': messageType,
        'message_body': body,
        'media_url': mediaUrl,
      },
    };
  }

  @override
  Future<Map<String, dynamic>> roomControls(int roomId) async {
    controlsLoadCalls += 1;
    return _controls();
  }

  @override
  Future<Map<String, dynamic>> moderateRoomParticipant(
    int roomId,
    int userId, {
    required String action,
    String banType = 'temporary',
    int durationMinutes = 60,
    String reason = 'Room moderation',
  }) async {
    moderationCalls.add({
      'roomId': roomId,
      'userId': userId,
      'action': action,
      'banType': banType,
      'durationMinutes': durationMinutes,
      'reason': reason,
    });
    return {
      'message': 'Moderation action applied.',
      'action': action,
      'target_user_id': userId,
      'controls': _controls(remoteMicOn: action != 'mute_mic'),
    };
  }

  Map<String, dynamic> _controls({bool remoteMicOn = true}) {
    return {
      'role': 'owner',
      'can_manage': true,
      'can_update_settings': true,
      'can_assign_roles': true,
      'room': {'id': 77, 'owner_id': _user.id},
      'participants': [
        {
          'id': 2,
          'session_id': 11,
          'room_id': 77,
          'user_id': 101,
          'user_name': 'Remote Viewer',
          'role_in_room': 'end_user',
          'mic_enabled': remoteMicOn,
          'camera_enabled': true,
          'can_moderate': true,
        },
        {
          'id': 1,
          'session_id': 10,
          'room_id': 77,
          'user_id': _user.id,
          'user_name': _user.name,
          'role_in_room': 'owner',
          'mic_enabled': false,
          'camera_enabled': true,
          'can_moderate': false,
        },
      ],
    };
  }
}

class _FakeMediaService extends RtcMediaService {
  final List<bool> permissionRequests = [];

  @override
  Future<void> requestPermissions({required bool video}) async {
    permissionRequests.add(video);
  }
}

class _FakePeerCoordinator implements RtcPeerCoordinator {
  final _remoteStreams = StreamController<RtcRemoteStream>.broadcast();
  final _peerStates = StreamController<RtcPeerStateSnapshot>.broadcast();
  final List<bool> localStreamVideos = [];
  final List<List<String>> syncedPeerSocketIds = [];
  bool attachedSignaling = false;
  int closeCalls = 0;

  @override
  Stream<RtcRemoteStream> get remoteStreams => _remoteStreams.stream;

  @override
  Stream<RtcPeerStateSnapshot> get peerStates => _peerStates.stream;

  @override
  Future<void> attachSignaling(SignalingService signaling) async {
    attachedSignaling = true;
  }

  @override
  Future<void> setLocalStream(
    MediaStream? stream, {
    required bool video,
  }) async {
    localStreamVideos.add(video);
  }

  @override
  Future<void> syncPeers(List<Map<String, dynamic>> peers) async {
    syncedPeerSocketIds.add(
      peers
          .map((peer) => peer['socketId']?.toString())
          .whereType<String>()
          .toList(),
    );
  }

  @override
  Future<void> closeAll() async {
    closeCalls += 1;
  }

  @override
  Future<void> dispose() async {
    await _remoteStreams.close();
    await _peerStates.close();
  }
}

class _FakeSignalingService extends SignalingService {
  final _events = StreamController<String>.broadcast();
  final _peers = StreamController<List<Map<String, dynamic>>>.broadcast();
  final List<String> joinedRooms = [];
  final List<Map<String, Object>> mediaStates = [];
  final List<Map<String, dynamic>> broadcastMessages = [];
  bool left = false;

  @override
  Stream<String> get events => _events.stream;

  @override
  Stream<List<Map<String, dynamic>>> get peers => _peers.stream;

  @override
  Future<void> connect() async {
    _events.add('Connected as fake-socket');
  }

  @override
  Future<Map<String, dynamic>> joinRoom({
    required String signalingRoom,
    required int databaseRoomId,
    required AppUser user,
    required bool video,
    required bool micEnabled,
    required bool cameraEnabled,
  }) async {
    joinedRooms.add(signalingRoom);
    return {
      'ok': true,
      'roomId': signalingRoom,
      'users': const <Map<String, dynamic>>[],
    };
  }

  @override
  Future<List<Map<String, dynamic>>> requestPeers() async {
    final rows = [
      {
        'socketId': 'remote-1',
        'userId': 101,
        'userName': 'Remote Viewer',
        'rtcMode': 'video',
        'micEnabled': true,
        'cameraEnabled': true,
      },
    ];
    _peers.add(rows);
    return rows;
  }

  @override
  Future<Map<String, dynamic>> emitMediaState({
    required bool video,
    required bool micEnabled,
    required bool cameraEnabled,
    bool screenShared = false,
  }) async {
    mediaStates.add({
      'video': video,
      'micEnabled': micEnabled,
      'cameraEnabled': cameraEnabled,
      'screenShared': screenShared,
    });
    return {'ok': true};
  }

  @override
  Future<Map<String, dynamic>> emitChatMessage({
    required Map<String, dynamic> message,
  }) async {
    broadcastMessages.add(message);
    return {'ok': true};
  }

  @override
  void leaveRoom() {
    left = true;
    _peers.add(const []);
  }

  @override
  void dispose() {
    _events.close();
    _peers.close();
  }
}

class _MemorySessionStore implements SessionStore {
  final Map<String, String> _data = {};

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> write(String key, String value) async {
    _data[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _data.remove(key);
  }
}
