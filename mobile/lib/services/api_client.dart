import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../config/app_config.dart';
import '../models/app_user.dart';
import '../models/room.dart';

class AppSession {
  const AppSession({required this.token, required this.user});

  final String token;
  final AppUser user;
}

class ApiClient {
  ApiClient({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage(),
      dio = Dio(
        BaseOptions(
          baseUrl: AppConfig.apiBaseUrl,
          connectTimeout: const Duration(seconds: 12),
          receiveTimeout: const Duration(seconds: 20),
          headers: const {'Accept': 'application/json'},
        ),
      );

  static const _tokenKey = 'rtc_access_token';
  static const _userKey = 'rtc_user';

  final FlutterSecureStorage _storage;
  final Dio dio;

  AppSession? _session;
  AppSession? get session => _session;

  Future<AppSession?> restoreSession() async {
    final token = await _storage.read(key: _tokenKey);
    final savedUser = await _storage.read(key: _userKey);
    if (token == null || token.isEmpty || savedUser == null) return null;

    try {
      final user = AppUser.fromJson(
        jsonDecode(savedUser) as Map<String, dynamic>,
      );
      _setToken(token);
      _session = AppSession(token: token, user: user);
      return _session;
    } catch (_) {
      await clearSession();
      return null;
    }
  }

  Future<AppSession> login(String email, String password) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    final data = response.data ?? {};
    final token = data['access_token']?.toString() ?? '';
    if (token.isEmpty) {
      throw StateError('Backend did not return an access token.');
    }

    final user = AppUser.fromJson(
      Map<String, dynamic>.from(data['user'] as Map),
    );
    await _saveSession(token, user);
    return _session!;
  }

  Future<AppSession> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: {'name': name, 'email': email, 'password': password},
    );
    final data = response.data ?? {};
    final token = data['access_token']?.toString() ?? '';
    if (token.isEmpty) {
      throw StateError('Backend did not return an access token.');
    }

    final user = AppUser.fromJson(
      Map<String, dynamic>.from(data['user'] as Map),
    );
    await _saveSession(token, user);
    return _session!;
  }

  Future<AppUser> refreshCurrentUser() async {
    final response = await dio.get<Map<String, dynamic>>('/auth/me');
    final user = AppUser.fromJson(
      Map<String, dynamic>.from((response.data ?? {})['user'] as Map),
    );
    final token = _session?.token ?? await _storage.read(key: _tokenKey) ?? '';
    await _saveSession(token, user);
    return user;
  }

  Future<Map<String, dynamic>> health() async {
    final response = await dio.get<Map<String, dynamic>>('/health');
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> rtcConfig() async {
    final response = await dio.get<Map<String, dynamic>>('/rtc/config');
    return response.data ?? {};
  }

  Future<List<Room>> rooms() async {
    final response = await dio.get<Map<String, dynamic>>(
      '/rooms',
      queryParameters: const {
        'status': 'active',
        'privacy': 'all',
        'per_page': 50,
      },
    );
    final data = response.data ?? {};
    final roomsEnvelope = data['rooms'];
    final rows = roomsEnvelope is Map ? roomsEnvelope['data'] : roomsEnvelope;
    if (rows is! List) return const [];
    return rows
        .whereType<Map>()
        .map((row) => Room.fromJson(Map<String, dynamic>.from(row)))
        .toList();
  }

  Future<Map<String, dynamic>> joinRoom(
    int roomId, {
    required bool video,
    bool micEnabled = true,
    bool cameraEnabled = true,
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/join',
      data: {
        'rtc_mode': video ? 'video' : 'audio',
        'mic_enabled': micEnabled,
        'camera_enabled': video && cameraEnabled,
      },
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> updateRoomMediaState(
    int roomId, {
    required bool micEnabled,
    required bool cameraEnabled,
    bool screenShared = false,
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/media-state',
      data: {
        'mic_enabled': micEnabled,
        'camera_enabled': cameraEnabled,
        'screen_shared': screenShared,
      },
    );
    return response.data ?? {};
  }

  Future<void> leaveRoom(int roomId) async {
    await dio.post<Map<String, dynamic>>('/rooms/$roomId/leave');
  }

  Future<List<Map<String, dynamic>>> roomMessages(
    int roomId, {
    int limit = 50,
  }) async {
    final response = await dio.get<Map<String, dynamic>>(
      '/rooms/$roomId/messages',
      queryParameters: {'limit': limit},
    );
    final messages = (response.data ?? {})['messages'];
    if (messages is! List) return const [];
    return messages
        .whereType<Map>()
        .map((message) => Map<String, dynamic>.from(message))
        .toList();
  }

  Future<Map<String, dynamic>> sendRoomMessage(int roomId, String body) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/messages',
      data: {'message_type': 'text', 'message_body': body},
    );
    final message = (response.data ?? {})['chat_message'];
    if (message is Map) return Map<String, dynamic>.from(message);
    throw StateError('Backend did not return chat_message.');
  }

  Future<void> clearSession() async {
    _session = null;
    dio.options.headers.remove('Authorization');
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _userKey);
  }

  Future<void> _saveSession(String token, AppUser user) async {
    _setToken(token);
    _session = AppSession(token: token, user: user);
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _userKey, value: jsonEncode(user.toJson()));
  }

  void _setToken(String token) {
    dio.options.headers['Authorization'] = 'Bearer $token';
  }
}

String apiErrorMessage(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['message'] != null) {
      return data['message'].toString();
    }
    if (error.type == DioExceptionType.connectionError) {
      return 'Backend is unreachable at ${AppConfig.apiBaseUrl}.';
    }
    return error.message ?? 'Request failed.';
  }
  return error.toString();
}
