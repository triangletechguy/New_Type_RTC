import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/app_user.dart';

class ProfileSettings {
  const ProfileSettings({
    required this.phoneBound,
    required this.emailBound,
    required this.loginPasswordSet,
    required this.deviceAlerts,
    required this.messagePrivacy,
    required this.privateInvite,
    required this.hideSensitive,
    required this.contentMode,
    required this.region,
  });

  final bool phoneBound;
  final bool emailBound;
  final bool loginPasswordSet;
  final bool deviceAlerts;
  final String messagePrivacy;
  final bool privateInvite;
  final bool hideSensitive;
  final String contentMode;
  final String region;

  factory ProfileSettings.defaults(AppUser user) {
    return ProfileSettings(
      phoneBound: user.phone.trim().isNotEmpty,
      emailBound: user.email.trim().isNotEmpty,
      loginPasswordSet: true,
      deviceAlerts: true,
      messagePrivacy: 'everyone',
      privateInvite: true,
      hideSensitive: true,
      contentMode: 'warning',
      region: user.currentResidence.trim().isNotEmpty
          ? user.currentResidence.trim()
          : 'United States',
    );
  }

  factory ProfileSettings.fromJson(
    Map<String, dynamic> json, {
    required AppUser user,
  }) {
    final defaults = ProfileSettings.defaults(user);
    return defaults.copyWith(
      phoneBound: _bool(json['phoneBound'], defaults.phoneBound),
      emailBound: _bool(json['emailBound'], defaults.emailBound),
      loginPasswordSet: _bool(
        json['loginPasswordSet'],
        defaults.loginPasswordSet,
      ),
      deviceAlerts: _bool(json['deviceAlerts'], defaults.deviceAlerts),
      messagePrivacy: _oneOf(json['messagePrivacy'], const {
        'everyone',
        'followers',
        'nobody',
      }, defaults.messagePrivacy),
      privateInvite: _bool(json['privateInvite'], defaults.privateInvite),
      hideSensitive: _bool(json['hideSensitive'], defaults.hideSensitive),
      contentMode: _oneOf(json['contentMode'], const {
        'restricted',
        'warning',
        'all',
      }, defaults.contentMode),
      region: (json['region'] ?? defaults.region).toString(),
    );
  }

  ProfileSettings copyWith({
    bool? phoneBound,
    bool? emailBound,
    bool? loginPasswordSet,
    bool? deviceAlerts,
    String? messagePrivacy,
    bool? privateInvite,
    bool? hideSensitive,
    String? contentMode,
    String? region,
  }) {
    return ProfileSettings(
      phoneBound: phoneBound ?? this.phoneBound,
      emailBound: emailBound ?? this.emailBound,
      loginPasswordSet: loginPasswordSet ?? this.loginPasswordSet,
      deviceAlerts: deviceAlerts ?? this.deviceAlerts,
      messagePrivacy: messagePrivacy ?? this.messagePrivacy,
      privateInvite: privateInvite ?? this.privateInvite,
      hideSensitive: hideSensitive ?? this.hideSensitive,
      contentMode: contentMode ?? this.contentMode,
      region: region ?? this.region,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'phoneBound': phoneBound,
      'emailBound': emailBound,
      'loginPasswordSet': loginPasswordSet,
      'deviceAlerts': deviceAlerts,
      'messagePrivacy': messagePrivacy,
      'privateInvite': privateInvite,
      'hideSensitive': hideSensitive,
      'contentMode': contentMode,
      'region': region,
    };
  }

  static bool _bool(Object? value, bool fallback) {
    if (value is bool) return value;
    if (value is num) return value != 0;
    final normalized = value?.toString().trim().toLowerCase();
    if (normalized == null || normalized.isEmpty) return fallback;
    if (const {'true', '1', 'yes', 'on'}.contains(normalized)) return true;
    if (const {'false', '0', 'no', 'off'}.contains(normalized)) return false;
    return fallback;
  }

  static String _oneOf(Object? value, Set<String> allowed, String fallback) {
    final normalized = value?.toString().trim();
    return allowed.contains(normalized) ? normalized! : fallback;
  }
}

abstract class ProfileSettingsStore {
  Future<ProfileSettings> read(AppUser user);

  Future<void> write(AppUser user, ProfileSettings settings);
}

class FlutterSecureProfileSettingsStore implements ProfileSettingsStore {
  const FlutterSecureProfileSettingsStore([
    this._storage = const FlutterSecureStorage(),
  ]);

  final FlutterSecureStorage _storage;

  @override
  Future<ProfileSettings> read(AppUser user) async {
    final raw = await _storage.read(key: _key(user));
    if (raw == null || raw.isEmpty) return ProfileSettings.defaults(user);
    try {
      final data = jsonDecode(raw);
      if (data is Map) {
        return ProfileSettings.fromJson(
          Map<String, dynamic>.from(data),
          user: user,
        );
      }
    } catch (_) {
      // Invalid local settings should not block profile access.
    }
    return ProfileSettings.defaults(user);
  }

  @override
  Future<void> write(AppUser user, ProfileSettings settings) {
    return _storage.write(key: _key(user), value: jsonEncode(settings));
  }

  String _key(AppUser user) => 'rtc_profile_settings_${user.id}';
}
