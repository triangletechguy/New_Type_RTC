import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rtc_enterprise_mobile/models/app_user.dart';
import 'package:rtc_enterprise_mobile/screens/profile_screen.dart';
import 'package:rtc_enterprise_mobile/services/api_client.dart';
import 'package:rtc_enterprise_mobile/services/profile_settings_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('profile edit removes avatar and saves web payload', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeProfileApi();
    final settingsStore = _MemoryProfileSettingsStore();
    AppUser? savedUser;

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: ProfileScreen(
          api: api,
          user: _user,
          settingsStore: settingsStore,
          onSaved: (user) => savedUser = user,
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Personal information'), findsOneWidget);
    expect(find.text('Edit profile'), findsOneWidget);

    await tester.tap(find.text('Edit profile'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Remove photo'));
    await tester.tap(find.text('Remove photo'));
    await tester.pumpAndSettle();

    expect(
      find.text('Profile photo removed. Save profile to apply it.'),
      findsOneWidget,
    );

    await tester.ensureVisible(find.text('Save profile'));
    await tester.tap(find.text('Save profile'));
    await tester.pumpAndSettle();

    expect(api.profileCalls, hasLength(1));
    expect(api.profileCalls.single['name'], 'Taylor Tester');
    expect(api.profileCalls.single['gender'], 'female');
    expect(api.profileCalls.single['age'], 29);
    expect(api.profileCalls.single['birthday'], '1997-05-06');
    expect(api.profileCalls.single['currentResidence'], 'United States');
    expect(api.profileCalls.single['avatarUrl'], isNull);
    expect(savedUser?.avatarUrl, isEmpty);
    expect(find.text('Profile updated.'), findsOneWidget);
  });

  testWidgets('settings section persists privacy and policy choices', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final settingsStore = _MemoryProfileSettingsStore();

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: ProfileScreen(
          api: _FakeProfileApi(),
          user: _user,
          initialSection: 'privacy',
          settingsStore: settingsStore,
          onSaved: (_) {},
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Privacy Settings'), findsWidgets);
    expect(find.text('Private live invitation'), findsOneWidget);

    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();

    final savedSettings = settingsStore.savedFor(_user);
    expect(savedSettings?.privateInvite, isFalse);
    expect(
      find.text('Private live invitation setting updated.'),
      findsOneWidget,
    );

    await tester.ensureVisible(find.text('Terms and Policies'));
    await tester.tap(find.text('Terms and Policies'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Privacy Policy'));
    await tester.tap(find.text('Privacy Policy'));
    await tester.pumpAndSettle();

    expect(find.text('Information we use'), findsOneWidget);
  });
}

const _user = AppUser(
  id: 99,
  name: 'Taylor Tester',
  email: 'taylor@example.com',
  phone: '',
  gender: 'female',
  age: 29,
  birthday: '1997-05-06',
  currentResidence: 'United States',
  avatarUrl: 'assets/rtc/avatars/avatar-01.png',
);

class _FakeProfileApi extends ApiClient {
  _FakeProfileApi()
    : super(
        sessionStore: _MemorySessionStore(),
        dioClient: Dio(BaseOptions(baseUrl: 'https://rtc.test/api')),
      );

  final List<Map<String, Object?>> profileCalls = [];
  int logoutCalls = 0;

  @override
  Future<AppUser> updateProfile({
    required String name,
    required String gender,
    required int age,
    required String birthday,
    required String currentResidence,
    Object? avatarUrl,
  }) async {
    profileCalls.add({
      'name': name,
      'gender': gender,
      'age': age,
      'birthday': birthday,
      'currentResidence': currentResidence,
      'avatarUrl': avatarUrl,
    });
    return AppUser(
      id: _user.id,
      name: name,
      email: _user.email,
      gender: gender,
      age: age,
      birthday: birthday,
      currentResidence: currentResidence,
      avatarUrl: avatarUrl is String ? avatarUrl : '',
    );
  }

  @override
  Future<void> logout() async {
    logoutCalls += 1;
  }
}

class _MemoryProfileSettingsStore implements ProfileSettingsStore {
  final _settings = <int, ProfileSettings>{};

  @override
  Future<ProfileSettings> read(AppUser user) async {
    return _settings[user.id] ?? ProfileSettings.defaults(user);
  }

  @override
  Future<void> write(AppUser user, ProfileSettings settings) async {
    _settings[user.id] = settings;
  }

  ProfileSettings? savedFor(AppUser user) => _settings[user.id];
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
