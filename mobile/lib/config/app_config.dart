class AppConfig {
  static const appName = String.fromEnvironment(
    'APP_NAME',
    defaultValue: 'RTC Enterprise',
  );

  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://127.0.0.1:8000/api',
  );

  static const signalingUrl = String.fromEnvironment(
    'SIGNALING_URL',
    defaultValue: 'http://127.0.0.1:8000',
  );
}
