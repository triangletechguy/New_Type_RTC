import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rtc_enterprise_mobile/screens/login_screen.dart';
import 'package:rtc_enterprise_mobile/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('auth validation matches web login messages', () {
    expect(validateAuthFields(mode: 'login', email: '', password: ''), {
      'email': 'Email is required.',
      'password': 'Password is required.',
    });

    expect(
      validateAuthFields(mode: 'login', email: 'not-an-email', password: 'x'),
      {'email': 'Use a valid email like name@gmail.com or name@company.com.'},
    );
  });

  test('auth validation matches web signup messages', () {
    expect(
      validateAuthFields(
        mode: 'register',
        name: 'A',
        gender: 'other',
        age: '12',
        currentResidence: 'U',
        birthday: '2024-99-99',
        email: 'bad',
        password: 'short',
      ),
      {
        'name': 'Name must be at least 2 characters.',
        'gender': 'Choose a valid gender option.',
        'age': 'Age must be between 13 and 120.',
        'current_residence': 'Current residence country is required.',
        'birthday': 'Choose a valid birthday.',
        'email': 'Use a valid email like name@gmail.com or name@company.com.',
        'password': 'Use at least 10 characters.',
      },
    );

    expect(
      getPasswordError('abcdefghij', strong: true),
      'Add an uppercase letter.',
    );
    expect(getPasswordError('Abcdefghij', strong: true), 'Add a number.');
    expect(getPasswordError('Abcdefghi1', strong: true), 'Add a symbol.');
  });

  testWidgets('login screen matches web mobile showcase and auth card', (
    tester,
  ) async {
    await _pumpLoginScreen(tester);

    final fields = tester.widgetList<TextField>(find.byType(TextField));
    expect(fields, hasLength(2));
    for (final field in fields) {
      expect(field.controller?.text, isEmpty);
    }

    expect(find.text('TalkEachOther'), findsOneWidget);
    expect(find.text('Hot'), findsOneWidget);
    expect(find.text('2.4K watching'), findsOneWidget);
    expect(find.text('Daily Standup'), findsOneWidget);
    expect(find.text('Open Mic Lounge'), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Enter video and music rooms'), findsOneWidget);
    expect(find.text('Register'), findsOneWidget);
    expect(
      find.text(
        'Use admin@gmail.com or admin@accenture.com with password admin@gmail.com.',
      ),
      findsOneWidget,
    );
    expect(find.text('admin@gmail.com'), findsNothing);
    expect(find.text('Test User'), findsNothing);
  });

  testWidgets('empty login submit shows highlighted field errors', (
    tester,
  ) async {
    await _pumpLoginScreen(tester);

    await tester.tap(find.text('Login').last);
    await tester.pump();

    expect(
      find.text('Please fix the highlighted login details.'),
      findsOneWidget,
    );
    expect(find.text('Email is required.'), findsOneWidget);
    expect(find.text('Password is required.'), findsOneWidget);
  });

  testWidgets('empty signup submit shows signup field errors', (tester) async {
    await _pumpLoginScreen(tester);

    await tester.tap(find.text('Register'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Create account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create account'));
    await tester.pump();

    expect(find.text('Enter video and music rooms'), findsOneWidget);
    expect(
      find.text('Please fix the highlighted signup details.'),
      findsOneWidget,
    );
    expect(find.text('Name must be at least 2 characters.'), findsOneWidget);
    expect(find.text('Email is required.'), findsOneWidget);
    expect(find.text('Password is required.'), findsOneWidget);
  });
}

Future<void> _pumpLoginScreen(WidgetTester tester) async {
  tester.view.physicalSize = const Size(430, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData.dark(useMaterial3: true),
      home: LoginScreen(
        api: ApiClient(
          sessionStore: _MemorySessionStore(),
          dioClient: Dio(BaseOptions(baseUrl: 'https://rtc.test/api')),
        ),
        onLoggedIn: () async {},
      ),
    ),
  );
  await tester.pump();
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
