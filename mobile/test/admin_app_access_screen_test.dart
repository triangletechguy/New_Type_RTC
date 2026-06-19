import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rtc_enterprise_mobile/models/app_user.dart';
import 'package:rtc_enterprise_mobile/screens/admin_dashboard_screen.dart';
import 'package:rtc_enterprise_mobile/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'native service console creates app access and reviews package requests',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final api = _FakeAdminApi();

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(useMaterial3: true),
          home: AdminDashboardScreen(api: api, user: _adminUser, onBack: () {}),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Client Company Dashboard'), findsOneWidget);
      expect(find.text('RTC Control Center'), findsOneWidget);

      await tester.tap(find.text('App Access'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Generate app access'));
      await tester.tap(find.text('Generate app access'));
      await tester.pumpAndSettle();

      expect(api.createdClientApps, hasLength(1));
      expect(api.createdClientApps.single['tenantId'], 3);
      expect(find.textContaining('APP_KEY=app_native'), findsOneWidget);

      await tester.fling(find.byType(ListView), const Offset(0, 900), 1000);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Packages'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Approve'));
      await tester.tap(find.text('Approve'));
      await tester.pumpAndSettle();

      expect(api.reviewedRequests, [
        {'requestId': 7, 'status': 'approved'},
      ]);
      expect(find.text('Package request approved.'), findsOneWidget);
    },
  );

  testWidgets('native service console shows backend error state', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: AdminDashboardScreen(
          api: _FailingAdminApi(),
          user: _adminUser,
          onBack: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Could not load service console'), findsOneWidget);
    expect(find.text('Admin overview offline'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });
}

const _adminUser = AppUser(
  id: 1,
  tenantId: 1,
  name: 'TalkEachOther Platform Service Admin',
  email: 'admin@gmail.com',
  roles: ['super_admin'],
);

class _FakeAdminApi extends ApiClient {
  _FakeAdminApi()
    : super(
        sessionStore: _MemorySessionStore(),
        dioClient: Dio(BaseOptions(baseUrl: 'https://rtc.test/api')),
      );

  final List<Map<String, Object?>> createdClientApps = [];
  final List<Map<String, Object?>> reviewedRequests = [];

  @override
  Future<Map<String, dynamic>> adminOverview() async {
    return _overviewFixture();
  }

  @override
  Future<Map<String, dynamic>> adminCreateClientApp({
    required String name,
    int? tenantId,
    String allowedOrigins = '',
    String status = 'active',
  }) async {
    createdClientApps.add({
      'name': name,
      'tenantId': tenantId,
      'allowedOrigins': allowedOrigins,
      'status': status,
    });
    return const {
      'message': 'Flutter Client App access generated.',
      'credentials': {
        'app_key': 'app_native',
        'api_key': 'rtc_api_native',
        'sdk_token': 'rtc_access_native',
      },
    };
  }

  @override
  Future<Map<String, dynamic>> adminReviewPlanRequest(
    int requestId, {
    required String status,
    String note = '',
  }) async {
    reviewedRequests.add({'requestId': requestId, 'status': status});
    return const {'message': 'Package request approved.'};
  }
}

class _FailingAdminApi extends _FakeAdminApi {
  DioException _error(String path, String message) {
    final requestOptions = RequestOptions(path: path);
    return DioException(
      requestOptions: requestOptions,
      response: Response<Map<String, dynamic>>(
        requestOptions: requestOptions,
        statusCode: 503,
        data: {'message': message},
      ),
    );
  }

  @override
  Future<Map<String, dynamic>> adminOverview() async {
    throw _error('/admin/overview', 'Admin overview offline');
  }
}

Map<String, dynamic> _overviewFixture() {
  return {
    'scope': 'super_admin',
    'admin': {'tenant_name': 'TalkEachOther'},
    'dashboard': {
      'active_sessions': 2,
      'minutes_used_today': 24,
      'minutes_used_this_month': 420,
      'rtc_status': 'online',
      'metrics': {
        'rooms': {'active': 5, 'total': 8},
        'sessions': {'active': 2, 'total': 13},
        'usage': {
          'month': {'minutes': 420},
        },
        'verification': {'status': 'verified', 'issue_count': 0},
      },
      'recent_usage_logs': [
        {
          'room_name': 'Board Room',
          'user_name': 'Mina',
          'usage_type': 'video',
          'billable_minutes': 12,
        },
      ],
      'active_sessions_monitor': {
        'sessions': [
          {
            'room_name': 'Board Room',
            'active_participants': 3,
            'reconnecting': 0,
            'health': 'live',
          },
        ],
      },
    },
    'enterprise': {
      'service_model': {
        'purpose': 'Client companies integrate RTC in their own apps.',
        'rtc_provider': 'online',
        'connection_indicator': 'online',
      },
      'service_flow': [
        {'title': 'Create company app', 'status': 'ready'},
        {'title': 'Issue RTC token', 'status': 'ready'},
      ],
      'platform_totals': {
        'active_clients': 1,
        'active_apps': 1,
        'estimated_invoice': 120,
      },
      'billing': {'estimated_invoice': 120},
      'current_plan': {'id': 2, 'name': 'Growth'},
      'clients': [
        {
          'id': 3,
          'tenant_uid': 'acme',
          'name': 'Acme RTC',
          'status': 'active',
          'plan': {'name': 'Growth'},
        },
      ],
      'admins': [
        {
          'name': 'Acme Service Admin',
          'email': 'admin@acme.test',
          'tenant_name': 'Acme RTC',
          'active_rooms': 4,
        },
      ],
      'plans': [
        {
          'id': 2,
          'name': 'Growth',
          'status': 'active',
          'monthly_base_price': 99,
          'monthly_minute_allowance': 10000,
        },
      ],
      'plan_requests': [
        {
          'id': 7,
          'status': 'pending',
          'billing_type': 'monthly',
          'current_plan': {'name': 'Starter'},
          'requested_plan': {'name': 'Growth'},
        },
      ],
      'apps': [
        {
          'id': 4,
          'name': 'Client Web',
          'app_key': 'app_web',
          'tenant_name': 'Acme RTC',
          'status': 'active',
        },
      ],
      'sdk_status': {'auth_flow': 'Client app requests a room token.'},
      'feature_controls': [
        {'label': 'Screen share', 'enabled': true},
      ],
    },
    'rooms': [
      {
        'id': 9,
        'name': 'Board Room',
        'room_type': 'video',
        'status': 'active',
        'active_participants': 3,
        'billable_minutes': 120,
      },
    ],
    'daily_usage': [
      {'usage_date': '2026-06-14', 'billable_minutes': 120},
    ],
    'participant_records': [
      {'id': 1},
    ],
  };
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
