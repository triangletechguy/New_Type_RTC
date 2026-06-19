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
    expect(media.permissionRequests.single, isFalse);
    expect(api.joinCameraIntents.single, isFalse);
    expect(signaling.joinedMediaStates.single['video'], isFalse);
    expect(signaling.joinedRooms.single, 'tenant-1-room-77');
    expect(peers.attachedSignaling, isTrue);
    expect(peers.localStreamVideos, contains(isFalse));
    expect(
      peers.syncedPeerSocketIds.any(
        (socketIds) => socketIds.length == 1 && socketIds.single == 'remote-1',
      ),
      isTrue,
    );
    expect(find.byTooltip('Leave room'), findsWidgets);
    expect(find.text('Remote Viewer'), findsWidgets);

    await tester.ensureVisible(find.byTooltip('Turn microphone off'));
    await tester.tap(find.byTooltip('Turn microphone off').first);
    await tester.pumpAndSettle();

    expect(api.mediaStates.single['micEnabled'], isFalse);
    expect(signaling.mediaStates.single['micEnabled'], isFalse);
    expect(find.byTooltip('Turn microphone on'), findsWidgets);

    await tester.ensureVisible(find.byTooltip('Open room menu'));
    await tester.tap(find.byTooltip('Open room menu'));
    await tester.pumpAndSettle();

    expect(find.text('Number of Mic'), findsOneWidget);
    expect(find.text('Gather followers'), findsOneWidget);

    await tester.tap(find.text('Number of Mic'));
    await tester.pumpAndSettle();

    expect(find.text('Choose number of mic'), findsOneWidget);
    expect(find.text('4 people'), findsOneWidget);
    expect(find.text('8 people'), findsOneWidget);
    expect(find.text('15 people'), findsOneWidget);

    await tester.tap(find.text('15 people'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Use'));
    await tester.pumpAndSettle();

    expect(api.controlUpdateCalls.single['maxMicCount'], 15);
    expect(find.text('No.15'), findsOneWidget);

    await tester.ensureVisible(find.byTooltip('Open room menu'));
    await tester.tap(find.byTooltip('Open room menu'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byTooltip('Open live chat'));
    await tester.tap(find.byTooltip('Open live chat'));
    await tester.pumpAndSettle();

    expect(_textFieldByHint('Type a message...'), findsOneWidget);

    await tester.enterText(_textFieldByHint('Type a message...'), 'Hi mobile');
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();

    expect(api.sentMessages.single['message_body'], 'Hi mobile');
    expect(signaling.broadcastMessages.single['id'], 501);
    expect(find.text('Hi mobile'), findsWidgets);

    await tester.ensureVisible(find.byTooltip('Room menu'));
    await tester.tap(find.byTooltip('Room menu'));
    await tester.pumpAndSettle();

    expect(find.text('Number of Mic'), findsOneWidget);
    expect(find.text('Unlock'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Gather followers'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);
    expect(api.controlsLoadCalls, greaterThanOrEqualTo(1));

    await tester.tap(find.text('Admin'));
    await tester.pumpAndSettle();

    expect(find.text('Remote Viewer'), findsWidgets);

    final muteButton = find.widgetWithText(OutlinedButton, 'Mute').first;
    await tester.ensureVisible(muteButton);
    await tester.tap(muteButton);
    await tester.pumpAndSettle();

    expect(api.moderationCalls.single['roomId'], 77);
    expect(api.moderationCalls.single['userId'], 101);
    expect(api.moderationCalls.single['action'], 'mute_mic');

    await tester.drag(find.byType(Scrollable).first, const Offset(0, 900));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byTooltip('Leave room'));
    await tester.tap(find.byTooltip('Leave room').first);
    await tester.pumpAndSettle();

    expect(api.leaveCalls, 1);
    expect(signaling.left, isTrue);
    expect(peers.closeCalls, 1);
  });

  testWidgets('audience enters receive-only and requests stage approval', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeLiveApi(canPublishOnJoin: false);
    final media = _FakeMediaService();
    final signaling = _FakeSignalingService();
    final peers = _FakePeerCoordinator();

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: LiveRoomScreen(
          api: api,
          user: _audienceUser,
          room: _publicRoom,
          mediaService: media,
          peerCoordinator: peers,
          signalingService: signaling,
          enableLocalPreview: false,
          autoConnect: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(api.joinMicIntents.single, isTrue);
    expect(media.permissionRequests, isEmpty);
    expect(signaling.joinedMediaStates.single['micEnabled'], isFalse);
    expect(signaling.joinedMediaStates.single['cameraEnabled'], isFalse);
    expect(find.text('Audience · watching and listening'), findsOneWidget);
    expect(find.byTooltip('Request mic'), findsWidgets);

    await tester.ensureVisible(find.byTooltip('Request mic'));
    await tester.tap(find.byTooltip('Request mic').first);
    await tester.pumpAndSettle();

    expect(api.stageRequests.single['roomId'], 88);
    expect(find.byTooltip('Cancel mic request'), findsWidgets);

    signaling.emitStagePermission({
      'targetUserId': _audienceUser.id,
      'approved': true,
      'action': 'approve',
      'participant': {
        'user_id': _audienceUser.id,
        'role_in_room': 'speaker',
        'stage_access': {
          'role': 'speaker',
          'can_publish': true,
          'requests_enabled': true,
          'status': 'approved',
        },
      },
    });
    await tester.pumpAndSettle();

    expect(api.mediaStates.single['micEnabled'], isTrue);
    expect(signaling.mediaStates.single['micEnabled'], isTrue);
    expect(find.byTooltip('Turn microphone off'), findsWidgets);
    expect(find.text('Audience · watching and listening'), findsNothing);
  });

  testWidgets('youtube room connects and switches music tab choices', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: LiveRoomScreen(
          api: _FakeLiveApi(),
          user: _user,
          room: _publicRoom,
          mediaService: _FakeMediaService(),
          peerCoordinator: _FakePeerCoordinator(),
          signalingService: _FakeSignalingService(),
          enableLocalPreview: false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(
      find.widgetWithText(ElevatedButton, 'Connect YouTube').first,
    );
    await tester.tap(
      find.widgetWithText(ElevatedButton, 'Connect YouTube').first,
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Enable YouTube Music and video picks for this room.'),
      findsOneWidget,
    );

    await tester.tap(find.text('Connect YouTube').last);
    await tester.pumpAndSettle();

    expect(find.text('Music room-ready tracks'), findsOneWidget);
    expect(find.text('Live Music Room Mix'), findsWidgets);

    await tester.tap(find.byKey(const ValueKey('youtube-tab-video')));
    await tester.pumpAndSettle();

    expect(find.text('Room video picks'), findsOneWidget);
    expect(find.text('Popular 90s Hit Playlist'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('youtube-tab-music')));
    await tester.pumpAndSettle();

    expect(find.text('Music room-ready tracks'), findsOneWidget);

    await tester.tap(find.text('Bengali'));
    await tester.pumpAndSettle();

    expect(find.text('Bengali Chill Music Set'), findsOneWidget);

    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Live Music Room Mix').first);
    await tester.pumpAndSettle();

    expect(find.text('Open YouTube'), findsOneWidget);
    expect(find.text('Live Music Room Mix'), findsWidgets);
  });

  testWidgets('publisher microphone permission denial blocks backend join', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeLiveApi();
    final media = _FakeMediaService(
      permissionError: const RtcMediaPermissionException(
        'Microphone permission is required to join the room.',
      ),
    );
    final signaling = _FakeSignalingService();
    final peers = _FakePeerCoordinator();

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: LiveRoomScreen(
          api: api,
          user: _user,
          room: _ownerVideoRoom,
          mediaService: media,
          peerCoordinator: peers,
          signalingService: signaling,
          enableLocalPreview: false,
          autoConnect: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(media.permissionRequests.single, isFalse);
    expect(api.joinMicIntents, isEmpty);
    expect(api.joinCameraIntents, isEmpty);
    expect(signaling.joinedRooms, isEmpty);
    expect(peers.localStreamVideos, isEmpty);
    expect(
      find.text('Microphone permission is required to join the room.'),
      findsWidgets,
    );
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

const _audienceUser = AppUser(
  id: 104,
  name: 'Audience Tester',
  email: 'audience@example.com',
  gender: 'male',
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

final _ownerVideoRoom = Room.fromJson({
  'id': 79,
  'tenant_id': 1,
  'tenant_name': 'RTC Enterprise',
  'owner_id': 99,
  'owner_name': 'Taylor Tester',
  'owner_region': 'United States',
  'name': 'Owner Video Room',
  'description': 'A publisher permission room.',
  'room_type': 'group_video',
  'privacy_type': 'public',
  'is_password_protected': false,
  'max_mic_count': 4,
  'active_participants': 0,
  'chat_enabled': true,
  'gift_enabled': false,
  'screen_share_enabled': true,
  'ai_security_enabled': false,
  'status': 'active',
});

final _publicRoom = Room.fromJson({
  'id': 88,
  'tenant_id': 1,
  'tenant_name': 'RTC Enterprise',
  'owner_id': 99,
  'owner_name': 'Taylor Tester',
  'owner_region': 'United States',
  'name': 'Public Stage',
  'description': 'Audience first room.',
  'room_type': 'group_audio',
  'privacy_type': 'public',
  'is_password_protected': false,
  'max_mic_count': 4,
  'active_participants': 1,
  'chat_enabled': true,
  'gift_enabled': false,
  'screen_share_enabled': false,
  'ai_security_enabled': false,
  'status': 'active',
});

class _FakeLiveApi extends ApiClient {
  _FakeLiveApi({this.canPublishOnJoin = true})
    : super(
        sessionStore: _MemorySessionStore(),
        dioClient: Dio(BaseOptions(baseUrl: 'https://rtc.test/api')),
      );

  final bool canPublishOnJoin;
  final List<String> joinPasswords = [];
  final List<bool> joinMicIntents = [];
  final List<bool> joinCameraIntents = [];
  final List<Map<String, Object>> stageRequests = [];
  final List<Map<String, Object>> stageResponses = [];
  final List<Map<String, Object>> mediaStates = [];
  final List<Map<String, Object>> sentMessages = [];
  final List<int> deletedMessageIds = [];
  final List<Map<String, Object>> moderationCalls = [];
  final List<Map<String, Object>> controlUpdateCalls = [];
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
    joinMicIntents.add(micEnabled);
    joinCameraIntents.add(cameraEnabled);
    final role = canPublishOnJoin ? 'owner' : 'audience';
    return {
      'rtc': {
        'signaling_room': 'tenant-1-room-$roomId',
        'mic_enabled': canPublishOnJoin && micEnabled,
        'camera_enabled': canPublishOnJoin && video && cameraEnabled,
        'stage_access': {
          'role': role,
          'can_publish': canPublishOnJoin,
          'requires_approval': !canPublishOnJoin,
          'requests_enabled': true,
          'status': canPublishOnJoin ? 'approved' : 'audience',
        },
      },
    };
  }

  @override
  Future<Map<String, dynamic>> createStageRequest(
    int roomId, {
    bool requestedMic = true,
    bool requestedCamera = true,
    String requestedRtcMode = 'video',
  }) async {
    final request = {
      'id': 701,
      'roomId': roomId,
      'userId': _audienceUser.id,
      'userName': _audienceUser.name,
      'requested_mic': requestedMic,
      'requested_camera': requestedCamera,
      'requested_rtc_mode': requestedRtcMode,
      'status': 'pending',
    };
    stageRequests.add(request);
    return {'message': 'Request sent to the room owner.', 'request': request};
  }

  @override
  Future<Map<String, dynamic>> cancelStageRequest(
    int roomId,
    int requestId,
  ) async {
    return {
      'message': 'Stage request cancelled.',
      'request': {'id': requestId, 'status': 'cancelled'},
    };
  }

  @override
  Future<Map<String, dynamic>> respondToStageRequest(
    int roomId,
    int requestId, {
    required bool approve,
  }) async {
    stageResponses.add({
      'roomId': roomId,
      'requestId': requestId,
      'approve': approve,
    });
    return {
      'message': approve ? 'Stage request approved.' : 'Request declined.',
      'approved': approve,
      'controls': _controls(stageRequests: const []),
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
        'stage_access': {
          'role':
              canPublishOnJoin || micEnabled || cameraEnabled || screenShared
              ? 'speaker'
              : 'audience',
          'can_publish':
              canPublishOnJoin || micEnabled || cameraEnabled || screenShared,
          'requires_approval': false,
          'requests_enabled': true,
          'status':
              canPublishOnJoin || micEnabled || cameraEnabled || screenShared
              ? 'approved'
              : 'audience',
        },
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
  Future<Map<String, dynamic>> deleteRoomMessage(
    int messageId, {
    bool forEveryone = true,
  }) async {
    deletedMessageIds.add(messageId);
    return {
      'message': 'Message deleted successfully.',
      'message_id': messageId,
      'room_id': 77,
      'deleted_for_everyone': forEveryone,
      'realtime_broadcasted': false,
    };
  }

  @override
  Future<Map<String, dynamic>> roomControls(int roomId) async {
    controlsLoadCalls += 1;
    return _controls();
  }

  @override
  Future<Map<String, dynamic>> updateRoomControls(
    int roomId, {
    int? maxMicCount,
    String? privacyType,
    String? password,
    String? theme,
    bool? chatEnabled,
    bool? screenShareEnabled,
    bool? aiSecurityEnabled,
    bool? stageRequestsEnabled,
  }) async {
    final update = <String, Object>{'roomId': roomId};
    if (maxMicCount != null) update['maxMicCount'] = maxMicCount;
    if (privacyType != null) update['privacyType'] = privacyType;
    if (password != null) update['password'] = password;
    if (theme != null) update['theme'] = theme;
    if (chatEnabled != null) update['chatEnabled'] = chatEnabled;
    if (screenShareEnabled != null) {
      update['screenShareEnabled'] = screenShareEnabled;
    }
    if (aiSecurityEnabled != null) {
      update['aiSecurityEnabled'] = aiSecurityEnabled;
    }
    if (stageRequestsEnabled != null) {
      update['stageRequestsEnabled'] = stageRequestsEnabled;
    }
    controlUpdateCalls.add(update);
    return _controls(maxMicCount: maxMicCount ?? 4);
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

  Map<String, dynamic> _controls({
    bool remoteMicOn = true,
    int maxMicCount = 4,
    List<Map<String, dynamic>> stageRequests = const [],
  }) {
    return {
      'role': 'owner',
      'can_manage': true,
      'can_update_settings': true,
      'can_assign_roles': true,
      'can_approve_stage': true,
      'room': {
        'id': 77,
        'owner_id': _user.id,
        'max_mic_count': maxMicCount,
        'privacy_type': 'password',
        'theme': 'neon',
      },
      'package': {
        'plan_name': 'Test Package',
        'max_mic_count': 15,
        'allowed_mic_counts': [4, 8, 12, 15],
      },
      'stage_requests': stageRequests,
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
  _FakeMediaService({this.permissionError});

  final Object? permissionError;
  final List<bool> permissionRequests = [];

  @override
  Future<void> requestPermissions({required bool video}) async {
    permissionRequests.add(video);
    final error = permissionError;
    if (error != null) throw error;
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
  final _stagePermissions = StreamController<Map<String, dynamic>>.broadcast();
  final List<String> joinedRooms = [];
  final List<Map<String, Object>> joinedMediaStates = [];
  final List<Map<String, Object>> mediaStates = [];
  final List<Map<String, dynamic>> broadcastMessages = [];
  final List<int> deletedMessageIds = [];
  bool left = false;

  @override
  Stream<String> get events => _events.stream;

  @override
  Stream<List<Map<String, dynamic>>> get peers => _peers.stream;

  @override
  Stream<Map<String, dynamic>> get stagePermissionUpdates =>
      _stagePermissions.stream;

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
    joinedMediaStates.add({
      'video': video,
      'micEnabled': micEnabled,
      'cameraEnabled': cameraEnabled,
    });
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
  Future<Map<String, dynamic>> emitChatMessageDeleted({
    required int messageId,
  }) async {
    deletedMessageIds.add(messageId);
    return {'ok': true};
  }

  @override
  void leaveRoom() {
    left = true;
    _peers.add(const []);
  }

  void emitStagePermission(Map<String, dynamic> payload) {
    _stagePermissions.add(payload);
  }

  @override
  void dispose() {
    _events.close();
    _peers.close();
    _stagePermissions.close();
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
