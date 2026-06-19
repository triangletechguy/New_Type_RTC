import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rtc_enterprise_mobile/models/app_user.dart';
import 'package:rtc_enterprise_mobile/models/room.dart';
import 'package:rtc_enterprise_mobile/navigation/app_routes.dart';
import 'package:rtc_enterprise_mobile/screens/room_list_screen.dart';
import 'package:rtc_enterprise_mobile/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('Room parses web lobby metadata', () {
    final room = Room.fromJson({
      'id': 7,
      'tenant_id': 1,
      'tenant_name': 'RTC Enterprise',
      'owner_id': 2,
      'owner_name': 'Sam Host',
      'owner_region': 'Canada',
      'owner_followed': 1,
      'name': 'Friday Video Stage',
      'description': 'A room for product demos.',
      'room_type': 'group_video',
      'privacy_type': 'password',
      'is_password_protected': true,
      'profile_image': 'https://example.com/room.png',
      'max_mic_count': 8,
      'active_participants': 1200,
      'active_participant_previews': [
        {'user_id': 3, 'name': 'Ava', 'avatar_url': ''},
      ],
      'theme': 'neon',
      'chat_enabled': 1,
      'gift_enabled': 0,
      'screen_share_enabled': 1,
      'ai_security_enabled': 1,
      'status': 'active',
      'created_at': '2026-06-14T12:00:00.000Z',
    });

    expect(room.id, 7);
    expect(room.tenantName, 'RTC Enterprise');
    expect(room.displayHost, 'Sam Host');
    expect(room.displayRegion, 'Canada');
    expect(room.ownerFollowed, isTrue);
    expect(room.supportsVideo, isTrue);
    expect(room.isLocked, isTrue);
    expect(room.roomTypeLabel, 'Group Video');
    expect(room.activeParticipants, 1200);
    expect(room.activeParticipantPreviews.single.name, 'Ava');
    expect(room.featureTags, containsAll(['Chat', 'Share', 'Guard']));
    expect(room.matchesTypeFilter('video'), isTrue);
    expect(room.matchesPrivacyFilter('password'), isTrue);
    expect(room.matchesSearch('sam'), isTrue);
    expect(room.matchesSearch('group'), isTrue);
  });

  testWidgets('room lobby shows mobile tabs, filters, and room metadata', (
    tester,
  ) async {
    final api = _FakeRoomApi([
      _room(
        id: 1,
        name: 'Popular Video Room',
        ownerName: 'Alex Host',
        roomType: 'group_video',
        privacyType: 'public',
        activeParticipants: 24,
      ),
      _room(
        id: 2,
        name: 'Music Stage',
        ownerName: 'Mia Music',
        roomType: 'audio',
        privacyType: 'password',
        activeParticipants: 8,
      ),
    ]);

    await _pumpLobby(tester, api);

    expect(api.calls.first['feed'], 'for_you');
    expect(api.calls.first['sort'], 'active');
    expect(find.text('Live'), findsWidgets);
    expect(find.text('Help'), findsWidgets);
    expect(find.text('Settings'), findsWidgets);
    expect(find.text('Message'), findsOneWidget);
    expect(find.text('Me'), findsWidgets);
    expect(find.text('Create room'), findsNothing);
    expect(find.text('Mine'), findsWidgets);
    expect(find.text('Popular'), findsWidgets);
    expect(find.text('Explore'), findsOneWidget);
    expect(find.text('Recently'), findsOneWidget);
    expect(find.text('Follow'), findsWidgets);
    expect(find.text('Group'), findsOneWidget);
    expect(find.text('All types'), findsOneWidget);
    expect(find.text('All access'), findsOneWidget);
    expect(find.text('Most active'), findsOneWidget);

    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();

    expect(api.calls.last['feed'], 'explore');
    expect(api.calls.last['sort'], 'active');

    await tester.tap(find.text('Group'));
    await tester.pumpAndSettle();

    expect(api.calls.last['feed'], 'global');
    expect(api.calls.last['sort'], 'active');

    await tester.tap(find.text('Recently'));
    await tester.pumpAndSettle();

    expect(api.calls.last['feed'], 'for_you');
    expect(api.calls.last['sort'], 'active');

    await tester.drag(
      find.byKey(const ValueKey('room_lobby_scroll')),
      const Offset(0, -620),
    );
    await tester.pumpAndSettle();

    expect(find.text('Popular Video Room'), findsWidgets);
    expect(find.text('Alex Host'), findsOneWidget);
    expect(find.text('Group Video'), findsWidgets);
    expect(find.text('24'), findsWidgets);
  });

  testWidgets('popular mobile feed keeps every returned room visible', (
    tester,
  ) async {
    final rooms = List<Room>.generate(
      10,
      (index) => _room(
        id: index + 1,
        name: 'Room ${index + 1}',
        ownerName: 'Host ${index + 1}',
        roomType: index.isEven ? 'group_video' : 'audio',
        privacyType: index % 3 == 0 ? 'password' : 'public',
        activeParticipants: 20 - index,
      ),
    );
    final api = _FakeRoomApi(rooms);

    await _pumpLobby(tester, api);

    expect(api.calls.first['feed'], 'for_you');
    expect(api.calls.first['sort'], 'active');

    await tester.tap(find.text('Recently'));
    await tester.pumpAndSettle();

    expect(api.calls.last['feed'], 'for_you');
    expect(api.calls.last['sort'], 'active');
    await tester.scrollUntilVisible(
      find.text('Room 10'),
      280,
      scrollable: find.byType(Scrollable),
    );
    expect(find.text('Room 10'), findsWidgets);
  });

  testWidgets('featured hero room opens the live room route', (tester) async {
    final api = _FakeRoomApi([
      _room(
        id: 1,
        name: 'Popular Video Room',
        ownerName: 'Alex Host',
        roomType: 'group_video',
        privacyType: 'public',
        activeParticipants: 24,
      ),
    ]);
    LiveRoomRouteArgs? openedArgs;

    await _pumpLobby(
      tester,
      api,
      onGenerateRoute: (settings) {
        if (settings.name == AppRoutes.liveRoom) {
          openedArgs = settings.arguments as LiveRoomRouteArgs;
          return MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Opened live room')),
          );
        }
        return null;
      },
    );

    await tester.tap(find.text('Popular Video Room').first);
    await tester.pumpAndSettle();

    expect(find.text('Opened live room'), findsOneWidget);
    expect(openedArgs?.room.id, 1);
    expect(openedArgs?.autoConnect, isTrue);
  });

  testWidgets('bottom navigation opens the requested mobile tabs', (
    tester,
  ) async {
    final api = _FakeRoomApi([
      _room(
        id: 1,
        name: 'Popular Video Room',
        ownerName: 'Alex Host',
        roomType: 'group_video',
        privacyType: 'public',
        activeParticipants: 24,
      ),
    ]);

    await _pumpLobby(tester, api);

    await tester.tap(find.text('Help').last);
    await tester.pumpAndSettle();
    expect(find.text('Feedback and Help'), findsOneWidget);
    expect(find.text('How to create a room'), findsWidgets);

    await tester.tap(find.text('Settings').last);
    await tester.pumpAndSettle();
    expect(find.text('Account Security'), findsWidgets);
    expect(find.text('Binding cell phone'), findsOneWidget);

    await tester.tap(find.text('Message').last);
    await tester.pumpAndSettle();
    expect(find.text('Messages'), findsWidgets);
    expect(find.text('No follower messages yet.'), findsOneWidget);

    await tester.tap(find.text('Me').last);
    await tester.pumpAndSettle();
    expect(find.text('Taylor Tester'), findsWidgets);
    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Email'), findsOneWidget);

    await tester.tap(find.text('Live').last);
    await tester.pumpAndSettle();
    expect(find.text('Popular Video Room'), findsWidgets);
  });

  testWidgets('create room sheet matches web host validation and payload', (
    tester,
  ) async {
    final api = _FakeRoomApi([]);

    await _pumpLobby(tester, api);
    await tester.tap(find.text('Create room').first);
    await tester.pumpAndSettle();

    expect(find.text('Host panel'), findsOneWidget);

    await tester.enterText(_textFieldByLabel('Room name'), 'AB');
    await tester.ensureVisible(find.text('Create Live Room').last);
    await tester.tap(find.text('Create Live Room').last);
    await tester.pumpAndSettle();

    expect(find.text('Use at least 3 characters.'), findsOneWidget);
    expect(api.createCalls, isEmpty);

    await tester.enterText(_textFieldByLabel('Room name'), 'Native Host Room');
    await tester.enterText(
      _textFieldByLabel('Description'),
      'A Flutter-created room.',
    );
    await tester.ensureVisible(find.widgetWithText(ChoiceChip, '1:1 Video'));
    await tester.tap(find.widgetWithText(ChoiceChip, '1:1 Video'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(ChoiceChip, 'Password'));
    await tester.tap(find.widgetWithText(ChoiceChip, 'Password'));
    await tester.pumpAndSettle();
    await tester.enterText(_textFieldByLabel('Password'), '2468');
    await tester.enterText(_textFieldByLabel('Stage Seats'), '4');
    await tester.ensureVisible(find.text('Create Live Room').last);
    await tester.tap(find.text('Create Live Room').last);
    await tester.pumpAndSettle();

    expect(find.text('Choose 1 or 2 call seats.'), findsOneWidget);
    expect(api.createCalls, isEmpty);

    await tester.enterText(_textFieldByLabel('Stage Seats'), '2');
    await tester.ensureVisible(_textFieldByLabel('Profile image URL'));
    await tester.enterText(
      _textFieldByLabel('Profile image URL'),
      'https://example.com/room.png',
    );
    await tester.ensureVisible(find.text('Neon').last);
    await tester.tap(find.text('Neon').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Midnight').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.widgetWithText(SwitchListTile, 'Screen share'),
    );
    await tester.tap(find.widgetWithText(SwitchListTile, 'Screen share'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(SwitchListTile, 'Guard'));
    await tester.tap(find.widgetWithText(SwitchListTile, 'Guard'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Create Live Room').last);
    await tester.tap(find.text('Create Live Room').last);
    await tester.pumpAndSettle();

    expect(api.createCalls, hasLength(1));
    expect(api.createCalls.single['name'], 'Native Host Room');
    expect(api.createCalls.single['description'], 'A Flutter-created room.');
    expect(
      api.createCalls.single['profileImage'],
      'https://example.com/room.png',
    );
    expect(api.createCalls.single['roomType'], 'one_to_one_video');
    expect(api.createCalls.single['privacyType'], 'password');
    expect(api.createCalls.single['password'], '2468');
    expect(api.createCalls.single['maxMicCount'], 2);
    expect(api.createCalls.single['theme'], 'midnight');
    expect(api.createCalls.single['chatEnabled'], isTrue);
    expect(api.createCalls.single['giftEnabled'], isFalse);
    expect(api.createCalls.single['screenShareEnabled'], isTrue);
    expect(api.createCalls.single['aiSecurityEnabled'], isTrue);
    expect(find.text('Ready to open'), findsOneWidget);
    expect(find.text('Open room'), findsOneWidget);
  });
}

Future<void> _pumpLobby(
  WidgetTester tester,
  _FakeRoomApi api, {
  VoidCallback? onOpenProfile,
  VoidCallback? onOpenSettings,
  Route<dynamic>? Function(RouteSettings)? onGenerateRoute,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData.dark(useMaterial3: true),
      onGenerateRoute: onGenerateRoute,
      home: RoomListScreen(
        api: api,
        user: const AppUser(
          id: 99,
          name: 'Taylor Tester',
          email: 'taylor@example.com',
        ),
        onLoggedOut: () async {},
        onOpenProfile: onOpenProfile,
        onOpenSettings: onOpenSettings,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _textFieldByLabel(String label) {
  return find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label,
    description: 'TextField with label "$label"',
  );
}

Room _room({
  required int id,
  required String name,
  required String ownerName,
  required String roomType,
  required String privacyType,
  required int activeParticipants,
}) {
  return Room.fromJson({
    'id': id,
    'tenant_name': 'RTC Enterprise',
    'owner_id': id + 10,
    'owner_name': ownerName,
    'owner_region': 'United States',
    'name': name,
    'description': 'A native lobby test room.',
    'room_type': roomType,
    'privacy_type': privacyType,
    'max_mic_count': 8,
    'active_participants': activeParticipants,
    'active_participant_previews': [
      {'user_id': id + 20, 'name': ownerName, 'avatar_url': ''},
    ],
    'chat_enabled': 1,
    'screen_share_enabled': roomType.contains('video') ? 1 : 0,
    'ai_security_enabled': 1,
    'status': 'active',
    'created_at': '2026-06-14T12:00:00.000Z',
  });
}

class _FakeRoomApi extends ApiClient {
  _FakeRoomApi(this.rows)
    : super(
        sessionStore: _MemorySessionStore(),
        dioClient: Dio(BaseOptions(baseUrl: 'https://rtc.test/api')),
      );

  final List<Room> rows;
  final List<Map<String, Object>> calls = [];
  final List<Map<String, Object>> createCalls = [];

  @override
  Future<List<Room>> rooms({
    String feed = 'for_you',
    String type = 'all',
    String privacy = 'all',
    String sort = 'active',
    String search = '',
    int perPage = 60,
  }) async {
    calls.add({
      'feed': feed,
      'type': type,
      'privacy': privacy,
      'sort': sort,
      'search': search,
      'perPage': perPage,
    });
    return rows;
  }

  @override
  Future<List<Map<String, dynamic>>> directMessageContacts() async => [];

  @override
  Future<List<Map<String, dynamic>>> directMessages(
    int userId, {
    int limit = 50,
  }) async => [];

  @override
  Future<Map<String, dynamic>> sendDirectMessage(
    int userId, {
    required String body,
    String messageType = 'text',
    String mediaUrl = '',
  }) async => {'id': 1, 'body': body, 'message': body, 'sender_id': 99};

  @override
  Future<Room> createRoom({
    required String name,
    String description = '',
    String profileImage = '',
    String roomType = 'video',
    String privacyType = 'public',
    String password = '',
    int maxMicCount = 8,
    String theme = 'neon',
    bool chatEnabled = true,
    bool giftEnabled = false,
    bool screenShareEnabled = false,
    bool aiSecurityEnabled = false,
  }) async {
    createCalls.add({
      'name': name,
      'description': description,
      'profileImage': profileImage,
      'roomType': roomType,
      'privacyType': privacyType,
      'password': password,
      'maxMicCount': maxMicCount,
      'theme': theme,
      'chatEnabled': chatEnabled,
      'giftEnabled': giftEnabled,
      'screenShareEnabled': screenShareEnabled,
      'aiSecurityEnabled': aiSecurityEnabled,
    });
    final room = Room.fromJson({
      'id': 42,
      'tenant_name': 'RTC Enterprise',
      'owner_id': 99,
      'owner_name': 'Taylor Tester',
      'owner_region': 'United States',
      'name': name,
      'description': description,
      'profile_image': profileImage,
      'room_type': roomType,
      'privacy_type': privacyType,
      'max_mic_count': maxMicCount,
      'active_participants': 0,
      'theme': theme,
      'chat_enabled': chatEnabled,
      'gift_enabled': giftEnabled,
      'screen_share_enabled': screenShareEnabled,
      'ai_security_enabled': aiSecurityEnabled,
      'status': 'active',
      'created_at': '2026-06-14T12:00:00.000Z',
    });
    rows.insert(0, room);
    return room;
  }

  @override
  Future<void> logout() async {}
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
