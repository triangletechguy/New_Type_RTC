import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rtc_enterprise_mobile/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('login saves bearer session and normalizes user email', () async {
    final store = _MemorySessionStore();
    final adapter = _MockHttpAdapter((options) {
      expect(options.uri.path, endsWith('/auth/login'));
      expect(options.data, isA<Map>());
      final body = Map<String, dynamic>.from(options.data as Map);
      expect(body['email'], 'admin@gmail.com');
      expect(body['password'], 'admin@gmail.com');

      return _MockResponse.ok({
        'access_token': 'token-1',
        'user': _userJson(email: 'superadmin@talkeachother.com'),
      });
    });
    final client = _client(adapter, store);

    final session = await client.login(' ADMIN@gmail.com ', 'admin@gmail.com');

    expect(session.token, 'token-1');
    expect(session.user.email, 'admin@gmail.com');
    expect(client.dio.options.headers['Authorization'], 'Bearer token-1');
    expect(store.data['rtc_access_token'], 'token-1');
    expect(store.data['rtc_user'], contains('"email":"admin@gmail.com"'));
  });

  test('restoreSession reloads saved token and normalized user', () async {
    final store = _MemorySessionStore({
      'rtc_access_token': 'saved-token',
      'rtc_user': jsonEncode(_userJson(email: 'superadmin@chadnichok.com')),
    });
    final client = _client(_MockHttpAdapter.noop(), store);

    final session = await client.restoreSession();

    expect(session, isNotNull);
    expect(session!.token, 'saved-token');
    expect(session.user.email, 'admin@gmail.com');
    expect(client.dio.options.headers['Authorization'], 'Bearer saved-token');
  });

  test('401 responses clear session and notify auth expiry', () async {
    final store = _MemorySessionStore({
      'rtc_access_token': 'expired-token',
      'rtc_user': jsonEncode(_userJson()),
    });
    var expiredMessage = '';
    final adapter = _MockHttpAdapter((options) {
      expect(options.uri.path, endsWith('/auth/me'));
      return _MockResponse(401, {'message': 'Unauthenticated'});
    });
    final client = _client(
      adapter,
      store,
      onAuthExpired: (message) => expiredMessage = message,
    );
    await client.restoreSession();

    await expectLater(
      client.refreshCurrentUser(),
      throwsA(isA<DioException>()),
    );

    expect(client.session, isNull);
    expect(client.dio.options.headers['Authorization'], isNull);
    expect(store.data, isEmpty);
    expect(expiredMessage, 'Your session expired. Please log in again.');
  });

  test(
    'logout calls backend when token exists and always clears local state',
    () async {
      final store = _MemorySessionStore({
        'rtc_access_token': 'token-logout',
        'rtc_user': jsonEncode(_userJson()),
      });
      final adapter = _MockHttpAdapter((options) {
        expect(options.uri.path, endsWith('/auth/logout'));
        expect(options.method, 'POST');
        expect(options.headers['Authorization'], 'Bearer token-logout');
        return _MockResponse.ok({'message': 'Logged out successfully'});
      });
      final client = _client(adapter, store);
      await client.restoreSession();

      await client.logout();

      expect(client.session, isNull);
      expect(client.dio.options.headers['Authorization'], isNull);
      expect(store.data, isEmpty);
    },
  );

  test('apiErrorMessage matches web email-provider cleanup', () {
    final requestOptions = RequestOptions(path: '/auth/register');
    final error = DioException(
      requestOptions: requestOptions,
      response: Response<Map<String, dynamic>>(
        requestOptions: requestOptions,
        statusCode: 422,
        data: const {
          'message': 'validation_error: email provider rejected the request',
        },
      ),
    );

    expect(
      apiErrorMessage(error),
      'Email delivery is connected, but the email provider rejected the request. Check the sender domain/settings and try again.',
    );
  });

  test('createRoom sends web host panel payload and parses room', () async {
    final store = _MemorySessionStore();
    final adapter = _MockHttpAdapter((options) {
      expect(options.uri.path, endsWith('/rooms'));
      expect(options.method, 'POST');
      expect(options.data, isA<Map>());
      final body = Map<String, dynamic>.from(options.data as Map);

      expect(body['name'], 'Native Host Room');
      expect(body['description'], 'A Flutter-created room.');
      expect(body['profile_image'], 'https://example.com/room.png');
      expect(body['room_type'], 'one_to_one_video');
      expect(body['privacy_type'], 'password');
      expect(body['password'], '2468');
      expect(body['max_mic_count'], 2);
      expect(body['theme'], 'midnight');
      expect(body['chat_enabled'], isTrue);
      expect(body['gift_enabled'], isTrue);
      expect(body['screen_share_enabled'], isTrue);
      expect(body['ai_security_enabled'], isTrue);

      return _MockResponse.ok({
        'room': {
          'id': 42,
          'tenant_id': 1,
          'tenant_name': 'RTC Enterprise',
          'owner_id': 1,
          'owner_name': 'TalkEachOther Admin',
          'name': body['name'],
          'description': body['description'],
          'profile_image': body['profile_image'],
          'room_type': body['room_type'],
          'privacy_type': body['privacy_type'],
          'max_mic_count': body['max_mic_count'],
          'theme': body['theme'],
          'chat_enabled': body['chat_enabled'],
          'gift_enabled': body['gift_enabled'],
          'screen_share_enabled': body['screen_share_enabled'],
          'ai_security_enabled': body['ai_security_enabled'],
          'status': 'active',
        },
      });
    });
    final client = _client(adapter, store);

    final room = await client.createRoom(
      name: 'Native Host Room',
      description: 'A Flutter-created room.',
      profileImage: 'https://example.com/room.png',
      roomType: 'one_to_one_video',
      privacyType: 'password',
      password: '2468',
      maxMicCount: 2,
      theme: 'midnight',
      chatEnabled: true,
      giftEnabled: true,
      screenShareEnabled: true,
      aiSecurityEnabled: true,
    );

    expect(room.id, 42);
    expect(room.roomType, 'one_to_one_video');
    expect(room.privacyType, 'password');
    expect(room.maxMicCount, 2);
    expect(room.theme, 'midnight');
    expect(room.featureTags, containsAll(['Chat', 'Gifts', 'Share', 'Guard']));
  });

  test(
    'live room APIs send password, media state, and leave payloads',
    () async {
      final store = _MemorySessionStore();
      final seen = <String>[];
      final adapter = _MockHttpAdapter((options) {
        seen.add('${options.method} ${options.uri.path}');
        final body = Map<String, dynamic>.from(options.data as Map? ?? {});

        if (options.uri.path.endsWith('/rooms/7/join')) {
          expect(body['rtc_mode'], 'video');
          expect(body['mic_enabled'], isTrue);
          expect(body['camera_enabled'], isTrue);
          expect(body['password'], '2468');
          return _MockResponse.ok({
            'rtc': {
              'signaling_room': 'tenant-1-room-7',
              'mic_enabled': true,
              'camera_enabled': true,
            },
          });
        }

        if (options.uri.path.endsWith('/rooms/7/media-state')) {
          expect(body['mic_enabled'], isFalse);
          expect(body['camera_enabled'], isTrue);
          expect(body['screen_shared'], isFalse);
          return _MockResponse.ok({
            'rtc': {
              'mic_enabled': false,
              'camera_enabled': true,
              'screen_shared': false,
            },
          });
        }

        if (options.uri.path.endsWith('/rooms/7/leave')) {
          expect(body, isEmpty);
          return _MockResponse.ok({
            'left': true,
            'message': 'Left room successfully',
            'usage_logged': true,
          });
        }

        throw StateError('Unexpected request ${options.uri.path}');
      });
      final client = _client(adapter, store);

      final join = await client.joinRoom(7, video: true, password: '2468');
      final media = await client.updateRoomMediaState(
        7,
        micEnabled: false,
        cameraEnabled: true,
      );
      final leave = await client.leaveRoom(7);

      expect(join['rtc'], isA<Map>());
      expect(media['rtc'], isA<Map>());
      expect(leave['usage_logged'], isTrue);
      expect(seen, [
        'POST /api/rooms/7/join',
        'POST /api/rooms/7/media-state',
        'POST /api/rooms/7/leave',
      ]);
    },
  );

  test('room message APIs load chat and send text/gift payloads', () async {
    final store = _MemorySessionStore();
    final seen = <String>[];
    final adapter = _MockHttpAdapter((options) {
      seen.add('${options.method} ${options.uri.path}');
      final body = Map<String, dynamic>.from(options.data as Map? ?? {});

      if (options.uri.path.endsWith('/rooms/7/messages') &&
          options.method == 'GET') {
        expect(options.uri.queryParameters['limit'], '25');
        expect(options.uri.queryParameters['after_id'], '9');
        return _MockResponse.ok({
          'messages': [
            {
              'id': 10,
              'sender_name': 'Host',
              'message_type': 'text',
              'message_body': 'Welcome',
            },
          ],
        });
      }

      if (options.uri.path.endsWith('/rooms/7/messages') &&
          options.method == 'POST') {
        expect(body['message_body'], isIn(['Hi room', 'Applause']));
        expect(body['message_type'], isIn(['text', 'gift']));
        if (body['message_type'] == 'gift') {
          expect(body['media_url'], 'applause');
        }
        return _MockResponse.ok({
          'chat_message': {'id': body['message_type'] == 'gift' ? 12 : 11},
          'realtime_broadcasted': false,
        });
      }

      throw StateError('Unexpected request ${options.method} ${options.uri}');
    });
    final client = _client(adapter, store);

    final messages = await client.roomMessages(7, limit: 25, afterId: 9);
    final text = await client.sendRoomMessage(7, body: 'Hi room');
    final gift = await client.sendRoomMessage(
      7,
      body: 'Applause',
      messageType: 'gift',
      mediaUrl: 'applause',
    );

    expect(messages.single['message_body'], 'Welcome');
    expect(text['chat_message']['id'], 11);
    expect(gift['chat_message']['id'], 12);
    expect(seen, [
      'GET /api/rooms/7/messages',
      'POST /api/rooms/7/messages',
      'POST /api/rooms/7/messages',
    ]);
  });

  test('room controls APIs load controls and moderate participants', () async {
    final store = _MemorySessionStore();
    final seen = <String>[];
    final adapter = _MockHttpAdapter((options) {
      seen.add('${options.method} ${options.uri.path}');
      final body = Map<String, dynamic>.from(options.data as Map? ?? {});

      if (options.uri.path.endsWith('/rooms/7/controls')) {
        expect(options.method, 'GET');
        return _MockResponse.ok({
          'controls': {
            'role': 'owner',
            'participants': [
              {
                'user_id': 101,
                'user_name': 'Remote Viewer',
                'role_in_room': 'end_user',
                'can_moderate': true,
                'mic_enabled': true,
                'camera_enabled': true,
              },
            ],
          },
        });
      }

      if (options.uri.path.endsWith('/rooms/7/participants/101/mute')) {
        expect(body['action'], 'mute_mic');
        return _MockResponse.ok({
          'message': 'Moderation action applied.',
          'action': 'mute_mic',
          'controls': {'role': 'owner'},
        });
      }

      if (options.uri.path.endsWith('/rooms/7/participants/101/moderation')) {
        expect(body['action'], 'disable_camera');
        return _MockResponse.ok({
          'message': 'Moderation action applied.',
          'action': 'disable_camera',
          'controls': {'role': 'owner'},
        });
      }

      if (options.uri.path.endsWith('/rooms/7/participants/101/ban')) {
        expect(body['action'], 'ban');
        expect(body['ban_type'], 'temporary');
        expect(body['duration_minutes'], 60);
        return _MockResponse.ok({
          'message': 'Moderation action applied.',
          'action': 'ban',
          'controls': {'role': 'owner'},
        });
      }

      throw StateError('Unexpected request ${options.method} ${options.uri}');
    });
    final client = _client(adapter, store);

    final controls = await client.roomControls(7);
    final mute = await client.moderateRoomParticipant(
      7,
      101,
      action: 'mute_mic',
    );
    final camera = await client.moderateRoomParticipant(
      7,
      101,
      action: 'disable_camera',
    );
    final ban = await client.moderateRoomParticipant(7, 101, action: 'ban');

    expect(controls['role'], 'owner');
    expect(mute['action'], 'mute_mic');
    expect(camera['action'], 'disable_camera');
    expect(ban['action'], 'ban');
    expect(seen, [
      'GET /api/rooms/7/controls',
      'POST /api/rooms/7/participants/101/mute',
      'POST /api/rooms/7/participants/101/moderation',
      'POST /api/rooms/7/participants/101/ban',
    ]);
  });

  test('updateProfile can remove avatar with a null web payload', () async {
    final store = _MemorySessionStore({
      'rtc_access_token': 'profile-token',
      'rtc_user': jsonEncode(_userJson()),
    });
    final adapter = _MockHttpAdapter((options) {
      expect(options.uri.path, endsWith('/auth/me'));
      expect(options.method, 'PATCH');
      expect(options.headers['Authorization'], 'Bearer profile-token');
      final body = Map<String, dynamic>.from(options.data as Map);

      expect(body['name'], 'Native Profile');
      expect(body['gender'], 'female');
      expect(body['age'], 28);
      expect(body['birthday'], '1998-02-03');
      expect(body['current_residence'], 'Canada');
      expect(body.containsKey('avatar_url'), isTrue);
      expect(body['avatar_url'], isNull);

      return _MockResponse.ok({
        'user': {
          ..._userJson(),
          'name': body['name'],
          'gender': body['gender'],
          'age': body['age'],
          'birthday': body['birthday'],
          'current_residence': body['current_residence'],
          'avatar_url': '',
        },
      });
    });
    final client = _client(adapter, store);
    await client.restoreSession();

    final user = await client.updateProfile(
      name: 'Native Profile',
      gender: 'female',
      age: 28,
      birthday: '1998-02-03',
      currentResidence: 'Canada',
      avatarUrl: null,
    );

    expect(user.name, 'Native Profile');
    expect(user.avatarUrl, isEmpty);
    expect(store.data['rtc_user'], contains('"current_residence":"Canada"'));
  });

  test('admin APIs send web admin routes and payloads', () async {
    final store = _MemorySessionStore();
    final seen = <String>[];
    final adapter = _MockHttpAdapter((options) {
      seen.add('${options.method} ${options.uri.path}');
      final body = Map<String, dynamic>.from(options.data as Map? ?? {});

      if (options.uri.path.endsWith('/admin/companies/generate-tenant-id')) {
        expect(options.method, 'GET');
        expect(options.uri.queryParameters['company_name'], 'Acme RTC');
        return _MockResponse.ok({'tenant_id': 'acme-rtc'});
      }

      if (options.uri.path.endsWith('/admin/companies/3/detail')) {
        expect(options.method, 'GET');
        return _MockResponse.ok({
          'company': {'id': 3},
        });
      }

      if (options.uri.path.endsWith('/admin/companies/3/status')) {
        expect(options.method, 'PATCH');
        expect(body['status'], 'suspended');
        return _MockResponse.ok({'message': 'Company status updated.'});
      }

      if (options.uri.path.endsWith('/admin/client-apps')) {
        expect(options.method, 'POST');
        expect(body['tenant_id'], 3);
        expect(body['name'], 'Flutter SDK App');
        expect(body['allowed_origins'], 'https://client.test');
        expect(body['status'], 'active');
        return _MockResponse.ok({
          'app': {'id': 4},
          'credentials': {'app_key': 'app_1'},
        });
      }

      if (options.uri.path.endsWith(
        '/admin/client-apps/4/rotate-credentials',
      )) {
        expect(options.method, 'POST');
        expect(body['reason'], 'mobile rotation');
        return _MockResponse.ok({
          'credentials': {'api_key': 'rtc_api_secret'},
        });
      }

      if (options.uri.path.endsWith('/admin/client-apps/4')) {
        expect(options.method, 'PATCH');
        expect(body['status'], 'suspended');
        return _MockResponse.ok({
          'app': {'id': 4},
        });
      }

      if (options.uri.path.endsWith('/admin/plan-requests/5')) {
        expect(options.method, 'PATCH');
        expect(body['status'], 'approved');
        expect(body['note'], 'ok');
        return _MockResponse.ok({'message': 'Package request approved.'});
      }

      if (options.uri.path.endsWith('/admin/plan-requests')) {
        expect(options.method, 'POST');
        expect(body['plan_id'], 2);
        expect(body['note'], 'Need more rooms');
        return _MockResponse.ok({'message': 'Package request sent.'});
      }

      if (options.uri.path.endsWith('/admin/rooms/9/status')) {
        expect(options.method, 'PATCH');
        expect(body['status'], 'disabled');
        return _MockResponse.ok({
          'room': {'id': 9},
        });
      }

      if (options.uri.path.endsWith('/admin/rooms/9')) {
        expect(options.method, 'DELETE');
        return _MockResponse.ok({'room_id': 9});
      }

      if (options.uri.path.endsWith('/admin/rooms')) {
        expect(options.method, 'POST');
        expect(body['tenant_id'], 3);
        expect(body['name'], 'Managed room');
        expect(body['room_type'], 'video');
        expect(body['privacy_type'], 'password');
        expect(body['password'], '2468');
        expect(body['max_mic_count'], 6);
        expect(body['screen_share_enabled'], isTrue);
        return _MockResponse.ok({
          'room': {'id': 9},
        });
      }

      throw StateError('Unexpected request ${options.method} ${options.uri}');
    });
    final client = _client(adapter, store);

    await client.adminGenerateTenantId(companyName: 'Acme RTC');
    await client.adminCompanyDetail(3);
    await client.adminUpdateCompanyStatus(3, 'suspended');
    await client.adminCreateClientApp(
      name: 'Flutter SDK App',
      tenantId: 3,
      allowedOrigins: 'https://client.test',
    );
    await client.adminRotateClientAppCredentials(4, reason: 'mobile rotation');
    await client.adminUpdateClientApp(4, status: 'suspended');
    await client.adminRequestPlan(planId: 2, note: 'Need more rooms');
    await client.adminReviewPlanRequest(5, status: 'approved', note: 'ok');
    await client.adminCreateRoom(
      tenantId: 3,
      name: 'Managed room',
      roomType: 'video',
      privacyType: 'password',
      password: '2468',
      maxMicCount: 6,
      screenShareEnabled: true,
    );
    await client.adminUpdateRoomStatus(9, 'disabled');
    await client.adminDeleteRoom(9);

    expect(seen, [
      'GET /api/admin/companies/generate-tenant-id',
      'GET /api/admin/companies/3/detail',
      'PATCH /api/admin/companies/3/status',
      'POST /api/admin/client-apps',
      'POST /api/admin/client-apps/4/rotate-credentials',
      'PATCH /api/admin/client-apps/4',
      'POST /api/admin/plan-requests',
      'PATCH /api/admin/plan-requests/5',
      'POST /api/admin/rooms',
      'PATCH /api/admin/rooms/9/status',
      'DELETE /api/admin/rooms/9',
    ]);
  });
}

ApiClient _client(
  _MockHttpAdapter adapter,
  _MemorySessionStore store, {
  AuthExpiredHandler? onAuthExpired,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: 'https://rtc.test/api',
      headers: const {'Accept': 'application/json'},
    ),
  )..httpClientAdapter = adapter;

  return ApiClient(
    sessionStore: store,
    dioClient: dio,
    onAuthExpired: onAuthExpired,
  );
}

Map<String, dynamic> _userJson({String email = 'admin@gmail.com'}) {
  return {
    'id': 1,
    'tenant_id': 1,
    'name': 'TalkEachOther Admin',
    'email': email,
    'phone': '',
    'avatar_url': '',
    'gender': 'male',
    'age': 30,
    'birthday': '1996-01-01',
    'current_residence': 'United States',
    'roles': const [
      {'name': 'super_admin'},
    ],
  };
}

class _MemorySessionStore implements SessionStore {
  _MemorySessionStore([Map<String, String>? seed]) : data = {...?seed};

  final Map<String, String> data;

  @override
  Future<String?> read(String key) async => data[key];

  @override
  Future<void> write(String key, String value) async {
    data[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    data.remove(key);
  }
}

class _MockHttpAdapter implements HttpClientAdapter {
  _MockHttpAdapter(this.handler);

  _MockHttpAdapter.noop()
    : handler = ((_) => _MockResponse.ok(<String, dynamic>{}));

  final FutureOr<_MockResponse> Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final response = await handler(options);
    return ResponseBody.fromString(
      jsonEncode(response.body),
      response.statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _MockResponse {
  const _MockResponse(this.statusCode, this.body);

  _MockResponse.ok(this.body) : statusCode = 200;

  final int statusCode;
  final Object? body;
}
