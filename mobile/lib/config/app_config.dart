class AppConfig {
  static const appName = String.fromEnvironment(
    'APP_NAME',
    defaultValue: 'TalkEachOther',
  );

  static const _apiBaseUrlOverride = String.fromEnvironment('API_BASE_URL');
  static const _signalingUrlOverride = String.fromEnvironment('SIGNALING_URL');

  static String get apiBaseUrl => _apiBaseUrlOverride.isNotEmpty
      ? _apiBaseUrlOverride
      : 'http://10.0.2.2:8000/api';

  static String get signalingUrl => _signalingUrlOverride.isNotEmpty
      ? _signalingUrlOverride
      : 'http://10.0.2.2:8000';
}
