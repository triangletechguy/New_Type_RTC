import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../config/app_config.dart';
import '../models/app_user.dart';
import '../models/room.dart';

const Object _profileAvatarUnchanged = Object();

class AppSession {
  const AppSession({required this.token, required this.user});

  final String token;
  final AppUser user;
}

typedef AuthExpiredHandler = void Function(String message);

abstract class SessionStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class FlutterSecureSessionStore implements SessionStore {
  const FlutterSecureSessionStore(this.storage);

  final FlutterSecureStorage storage;

  @override
  Future<String?> read(String key) => storage.read(key: key);

  @override
  Future<void> write(String key, String value) {
    return storage.write(key: key, value: value);
  }

  @override
  Future<void> delete(String key) => storage.delete(key: key);
}

class ApiClient {
  ApiClient({
    FlutterSecureStorage? storage,
    SessionStore? sessionStore,
    Dio? dioClient,
    this.onAuthExpired,
  }) : _sessionStore =
           sessionStore ??
           FlutterSecureSessionStore(storage ?? const FlutterSecureStorage()),
       dio = dioClient ?? _createDio() {
    _installAuthExpiredInterceptor();
  }

  static const _tokenKey = 'rtc_access_token';
  static const _userKey = 'rtc_user';

  final SessionStore _sessionStore;
  final AuthExpiredHandler? onAuthExpired;
  final Dio dio;

  AppSession? _session;
  AppSession? get session => _session;

  static Dio _createDio() {
    return Dio(
      BaseOptions(
        baseUrl: AppConfig.apiBaseUrl,
        connectTimeout: const Duration(seconds: 12),
        receiveTimeout: const Duration(seconds: 20),
        headers: const {'Accept': 'application/json'},
      ),
    );
  }

  void _installAuthExpiredInterceptor() {
    dio.interceptors.add(
      QueuedInterceptorsWrapper(
        onError: (error, handler) async {
          final suppressAuthExpired =
              error.requestOptions.extra['suppressAuthExpired'] == true;
          if (error.response?.statusCode == 401 && !suppressAuthExpired) {
            await clearSession(
              notifyAuthExpired: true,
              message: 'Your session expired. Please log in again.',
            );
          }
          handler.next(error);
        },
      ),
    );
  }

  Future<AppSession?> restoreSession() async {
    final token = await _sessionStore.read(_tokenKey);
    final savedUser = await _sessionStore.read(_userKey);
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
      data: {'email': _normalizeAuthEmail(email), 'password': password},
    );
    final data = response.data ?? {};
    await _saveAuthResponse(data);
    return _session!;
  }

  Future<AppSession> register({
    required String name,
    required String email,
    required String password,
    String gender = '',
    int? age,
    String currentResidence = '',
    String birthday = '',
  }) async {
    final payload = <String, Object?>{
      'name': name,
      'email': _normalizeAuthEmail(email),
      'password': password,
    };
    if (gender.isNotEmpty) payload['gender'] = gender;
    if (age != null) payload['age'] = age;
    if (currentResidence.isNotEmpty) {
      payload['current_residence'] = currentResidence;
    }
    if (birthday.isNotEmpty) payload['birthday'] = birthday;

    final response = await dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: payload,
    );
    final data = response.data ?? {};
    await _saveAuthResponse(data);
    return _session!;
  }

  Future<AppUser> refreshCurrentUser() async {
    final response = await dio.get<Map<String, dynamic>>('/auth/me');
    final user = _userFromEnvelope(response.data ?? {});
    final token = _session?.token ?? await _sessionStore.read(_tokenKey) ?? '';
    await _saveSession(token, user);
    return user;
  }

  Future<AppUser> updateProfile({
    required String name,
    required String gender,
    required int age,
    required String birthday,
    required String currentResidence,
    Object? avatarUrl = _profileAvatarUnchanged,
  }) async {
    final payload = <String, Object?>{
      'name': name,
      'gender': gender,
      'age': age,
      'birthday': birthday,
      'current_residence': currentResidence,
    };
    if (!identical(avatarUrl, _profileAvatarUnchanged)) {
      payload['avatar_url'] = avatarUrl;
    }

    final response = await dio.patch<Map<String, dynamic>>(
      '/auth/me',
      data: payload,
    );
    final user = _userFromEnvelope(response.data ?? {});
    final token = _session?.token ?? await _sessionStore.read(_tokenKey) ?? '';
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

  Future<Map<String, dynamic>> adminOverview() async {
    final response = await dio.get<Map<String, dynamic>>('/admin/overview');
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminDashboard() async {
    final response = await dio.get<Map<String, dynamic>>('/admin/dashboard');
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminCompanyDetail(int companyId) async {
    final response = await dio.get<Map<String, dynamic>>(
      '/admin/companies/$companyId/detail',
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminGenerateTenantId({
    String companyName = '',
  }) async {
    final query = <String, Object>{};
    final trimmedName = companyName.trim();
    if (trimmedName.isNotEmpty) query['company_name'] = trimmedName;

    final response = await dio.get<Map<String, dynamic>>(
      '/admin/companies/generate-tenant-id',
      queryParameters: query,
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminCreateClientApp({
    required String name,
    int? tenantId,
    String allowedOrigins = '',
    String status = 'active',
  }) async {
    final payload = <String, Object?>{
      'name': name.trim().isEmpty ? 'Native Client App' : name.trim(),
      'allowed_origins': allowedOrigins.trim(),
      'status': status,
    };
    if (tenantId != null) payload['tenant_id'] = tenantId;

    final response = await dio.post<Map<String, dynamic>>(
      '/admin/client-apps',
      data: payload,
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminRotateClientAppCredentials(
    int appId, {
    String reason = 'Rotated from Flutter service console',
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/admin/client-apps/$appId/rotate-credentials',
      data: {'reason': reason.trim().isEmpty ? 'Manual rotation' : reason},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminUpdateClientApp(
    int appId, {
    String? name,
    String? status,
    String? allowedOrigins,
  }) async {
    final payload = <String, Object?>{};
    if (name != null) payload['name'] = name.trim();
    if (status != null) payload['status'] = status;
    if (allowedOrigins != null) payload['allowed_origins'] = allowedOrigins;

    final response = await dio.patch<Map<String, dynamic>>(
      '/admin/client-apps/$appId',
      data: payload,
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminRequestPlan({
    required int planId,
    String note = '',
  }) async {
    final trimmedNote = note.trim();
    final response = await dio.post<Map<String, dynamic>>(
      '/admin/plan-requests',
      data: {
        'plan_id': planId,
        if (trimmedNote.isNotEmpty) 'note': trimmedNote,
      },
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminReviewPlanRequest(
    int requestId, {
    required String status,
    String note = '',
  }) async {
    final trimmedNote = note.trim();
    final response = await dio.patch<Map<String, dynamic>>(
      '/admin/plan-requests/$requestId',
      data: {'status': status, if (trimmedNote.isNotEmpty) 'note': trimmedNote},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminUpdateRoomStatus(
    int roomId,
    String status,
  ) async {
    final response = await dio.patch<Map<String, dynamic>>(
      '/admin/rooms/$roomId/status',
      data: {'status': status},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminDeleteRoom(int roomId) async {
    final response = await dio.delete<Map<String, dynamic>>(
      '/admin/rooms/$roomId',
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminCreateRoom({
    int? tenantId,
    required String name,
    String description = '',
    String roomType = 'video',
    String privacyType = 'public',
    String password = '',
    int maxMicCount = 8,
    bool chatEnabled = true,
    bool giftEnabled = false,
    bool screenShareEnabled = false,
    bool aiSecurityEnabled = false,
  }) async {
    final payload = <String, Object?>{
      'name': name.trim().isEmpty ? 'Native RTC room' : name.trim(),
      'description': description.trim(),
      'room_type': roomType,
      'privacy_type': privacyType,
      if (privacyType == 'password') 'password': password,
      'max_mic_count': maxMicCount,
      'chat_enabled': chatEnabled,
      'gift_enabled': giftEnabled,
      'screen_share_enabled': screenShareEnabled,
      'ai_security_enabled': aiSecurityEnabled,
    };
    if (tenantId != null) payload['tenant_id'] = tenantId;

    final response = await dio.post<Map<String, dynamic>>(
      '/admin/rooms',
      data: payload,
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminUpdateCompanyStatus(
    int companyId,
    String status,
  ) async {
    final response = await dio.patch<Map<String, dynamic>>(
      '/admin/companies/$companyId/status',
      data: {'status': status},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminInviteCompanyAdmin(
    int companyId, {
    required String email,
    String name = '',
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/admin/companies/$companyId/admin-invite',
      data: {
        'email': email.trim(),
        if (name.trim().isNotEmpty) 'name': name.trim(),
      },
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> adminUpdateServicePlan(
    int planId,
    Map<String, Object?> payload,
  ) async {
    final response = await dio.patch<Map<String, dynamic>>(
      '/admin/service-plans/$planId',
      data: payload,
    );
    return response.data ?? {};
  }

  Future<List<Room>> rooms({
    String feed = 'for_you',
    String type = 'all',
    String privacy = 'all',
    String sort = 'active',
    String search = '',
    int perPage = 60,
  }) async {
    final firstPage = await _roomPage(
      feed: feed,
      type: type,
      privacy: privacy,
      sort: sort,
      search: search,
      perPage: perPage,
      page: 1,
    );
    final rooms = [...firstPage.rooms];
    final totalPages = firstPage.totalPages.clamp(1, 20);

    for (var page = 2; page <= totalPages; page += 1) {
      final nextPage = await _roomPage(
        feed: feed,
        type: type,
        privacy: privacy,
        sort: sort,
        search: search,
        perPage: perPage,
        page: page,
      );
      rooms.addAll(nextPage.rooms);
    }

    return rooms;
  }

  Future<_RoomPage> _roomPage({
    required String feed,
    required String type,
    required String privacy,
    required String sort,
    required String search,
    required int perPage,
    required int page,
  }) async {
    final query = <String, Object>{
      'page': page,
      'status': 'active',
      'privacy': privacy,
      'type': type,
      'sort': sort,
      'feed': feed,
      'per_page': perPage,
    };
    final trimmedSearch = search.trim();
    if (trimmedSearch.isNotEmpty) query['q'] = trimmedSearch;

    final response = await dio.get<Map<String, dynamic>>(
      '/rooms',
      queryParameters: query,
    );
    final data = response.data ?? {};
    final roomsEnvelope = data['rooms'];
    final rows = roomsEnvelope is Map ? roomsEnvelope['data'] : roomsEnvelope;
    final meta = roomsEnvelope is Map ? roomsEnvelope['meta'] : null;
    final totalPages = meta is Map
        ? int.tryParse((meta['total_pages'] ?? '').toString()) ?? 1
        : 1;
    if (rows is! List) return _RoomPage(const [], totalPages);
    return _RoomPage(
      rows
          .whereType<Map>()
          .map((row) => Room.fromJson(Map<String, dynamic>.from(row)))
          .toList(),
      totalPages,
    );
  }

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
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms',
      data: {
        'name': name,
        'description': description,
        if (profileImage.trim().isNotEmpty)
          'profile_image': profileImage.trim(),
        'room_type': roomType,
        'privacy_type': privacyType,
        if (privacyType == 'password') 'password': password,
        'max_mic_count': maxMicCount,
        if (theme != 'neon') 'theme': theme,
        'chat_enabled': chatEnabled,
        'gift_enabled': giftEnabled,
        'screen_share_enabled': screenShareEnabled,
        'ai_security_enabled': aiSecurityEnabled,
      },
    );

    final data = response.data ?? {};
    final room = data['room'];
    if (room is! Map) throw StateError('Backend did not return a room.');
    return Room.fromJson(Map<String, dynamic>.from(room));
  }

  Future<void> deleteRoom(int roomId) async {
    await dio.delete<Map<String, dynamic>>('/rooms/$roomId');
  }

  Future<Map<String, dynamic>> joinRoom(
    int roomId, {
    required bool video,
    bool micEnabled = true,
    bool cameraEnabled = true,
    String password = '',
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/join',
      data: {
        'rtc_mode': video ? 'video' : 'audio',
        'mic_enabled': micEnabled,
        'camera_enabled': video && cameraEnabled,
        if (password.trim().isNotEmpty) 'password': password.trim(),
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

  Future<Map<String, dynamic>> createStageRequest(
    int roomId, {
    bool requestedMic = true,
    bool requestedCamera = true,
    String requestedRtcMode = 'video',
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/stage-requests',
      data: {
        'requested_mic': requestedMic,
        'requested_camera': requestedRtcMode == 'video' && requestedCamera,
        'requested_rtc_mode': requestedRtcMode == 'audio' ? 'audio' : 'video',
      },
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> cancelStageRequest(
    int roomId,
    int requestId,
  ) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/stage-requests/$requestId/cancel',
      data: const <String, dynamic>{},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> respondToStageRequest(
    int roomId,
    int requestId, {
    required bool approve,
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/stage-requests/$requestId/${approve ? 'approve' : 'reject'}',
      data: const <String, dynamic>{},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> updateParticipantStagePermission(
    int roomId,
    int userId, {
    required bool approve,
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/participants/$userId/stage',
      data: {'action': approve ? 'approve' : 'reject'},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> leaveRoom(int roomId) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/leave',
      data: const <String, dynamic>{},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> roomControls(int roomId) async {
    final response = await dio.get<Map<String, dynamic>>(
      '/rooms/$roomId/controls',
    );
    final controls = response.data?['controls'];
    return controls is Map ? Map<String, dynamic>.from(controls) : {};
  }

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
    final payload = <String, Object?>{};
    if (maxMicCount != null) payload['max_mic_count'] = maxMicCount;
    if (privacyType != null) payload['privacy_type'] = privacyType;
    if (password != null) payload['password'] = password;
    if (theme != null) payload['theme'] = theme;
    if (chatEnabled != null) payload['chat_enabled'] = chatEnabled;
    if (screenShareEnabled != null) {
      payload['screen_share_enabled'] = screenShareEnabled;
    }
    if (aiSecurityEnabled != null) {
      payload['ai_security_enabled'] = aiSecurityEnabled;
    }
    if (stageRequestsEnabled != null) {
      payload['stage_requests_enabled'] = stageRequestsEnabled;
    }
    final response = await dio.patch<Map<String, dynamic>>(
      '/rooms/$roomId/controls',
      data: payload,
    );
    final controls = response.data?['controls'];
    return controls is Map ? Map<String, dynamic>.from(controls) : {};
  }

  Future<Map<String, dynamic>> updateRoomSeat(
    int roomId,
    int seatNumber, {
    required bool locked,
  }) async {
    final response = await dio.patch<Map<String, dynamic>>(
      '/rooms/$roomId/seats/$seatNumber',
      data: {'locked': locked},
    );
    final controls = response.data?['controls'];
    return controls is Map ? Map<String, dynamic>.from(controls) : {};
  }

  Future<Map<String, dynamic>> updateAllRoomSeats(
    int roomId, {
    required bool locked,
  }) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/seats/lock-all',
      data: {'locked': locked},
    );
    final controls = response.data?['controls'];
    return controls is Map ? Map<String, dynamic>.from(controls) : {};
  }

  Future<Map<String, dynamic>> assignRoomRole(
    int roomId,
    int userId, {
    required String role,
  }) async {
    final response = await dio.put<Map<String, dynamic>>(
      '/rooms/$roomId/roles/$userId',
      data: {'role': role},
    );
    final controls = response.data?['controls'];
    return controls is Map ? Map<String, dynamic>.from(controls) : {};
  }

  Future<Map<String, dynamic>> removeRoomRole(int roomId, int userId) async {
    final response = await dio.delete<Map<String, dynamic>>(
      '/rooms/$roomId/roles/$userId',
    );
    final controls = response.data?['controls'];
    return controls is Map ? Map<String, dynamic>.from(controls) : {};
  }

  Future<Map<String, dynamic>> moderateRoomParticipant(
    int roomId,
    int userId, {
    required String action,
    String banType = 'temporary',
    int durationMinutes = 60,
    String reason = 'Room moderation',
  }) async {
    final pathAction = switch (action) {
      'mute_mic' => 'mute',
      'disable_camera' => 'moderation',
      'kick' => 'kick',
      'ban' => 'ban',
      _ => 'moderation',
    };
    final payload = <String, Object?>{
      'action': action,
      if (action == 'ban') ...{
        'ban_type': banType,
        'duration_minutes': durationMinutes,
        'reason': reason,
      },
    };

    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/participants/$userId/$pathAction',
      data: payload,
    );
    return response.data ?? {};
  }

  Future<List<Map<String, dynamic>>> roomMessages(
    int roomId, {
    int limit = 50,
    int? afterId,
  }) async {
    final response = await dio.get<Map<String, dynamic>>(
      '/rooms/$roomId/messages',
      queryParameters: {
        'limit': limit,
        if (afterId != null && afterId > 0) 'after_id': afterId,
      },
    );
    final rows = response.data?['messages'];
    return rows is List
        ? rows
              .whereType<Map>()
              .map((row) => Map<String, dynamic>.from(row))
              .toList()
        : <Map<String, dynamic>>[];
  }

  Future<Map<String, dynamic>> sendRoomMessage(
    int roomId, {
    required String body,
    String messageType = 'text',
    String mediaUrl = '',
  }) async {
    final trimmedBody = body.trim();
    final payload = <String, Object?>{
      'message_body': trimmedBody,
      'message_type': messageType,
    };
    if (mediaUrl.trim().isNotEmpty) payload['media_url'] = mediaUrl.trim();

    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/messages',
      data: payload,
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> deleteRoomMessage(
    int messageId, {
    bool forEveryone = true,
  }) async {
    final response = await dio.delete<Map<String, dynamic>>(
      '/messages/$messageId',
      data: {'for_everyone': forEveryone},
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> clearRoomMessages(int roomId) async {
    final response = await dio.post<Map<String, dynamic>>(
      '/rooms/$roomId/messages/clear',
      data: const <String, dynamic>{},
    );
    return response.data ?? {};
  }

  Future<List<Map<String, dynamic>>> directMessageContacts() async {
    final response = await dio.get<Map<String, dynamic>>(
      '/direct-messages/contacts',
    );
    final rows = response.data?['contacts'];
    return rows is List
        ? rows
              .whereType<Map>()
              .map((row) => Map<String, dynamic>.from(row))
              .toList()
        : <Map<String, dynamic>>[];
  }

  Future<List<Map<String, dynamic>>> directMessages(
    int userId, {
    int limit = 50,
  }) async {
    final response = await dio.get<Map<String, dynamic>>(
      '/direct-messages/$userId',
      queryParameters: {'limit': limit},
    );
    final rows = response.data?['messages'];
    return rows is List
        ? rows
              .whereType<Map>()
              .map((row) => Map<String, dynamic>.from(row))
              .toList()
        : <Map<String, dynamic>>[];
  }

  Future<Map<String, dynamic>> sendDirectMessage(
    int userId, {
    required String body,
    String messageType = 'text',
    String mediaUrl = '',
  }) async {
    final payload = <String, Object?>{
      'message_body': body.trim(),
      'message_type': messageType,
    };
    if (mediaUrl.trim().isNotEmpty) payload['media_url'] = mediaUrl.trim();

    final response = await dio.post<Map<String, dynamic>>(
      '/direct-messages/$userId',
      data: payload,
    );
    return response.data ?? {};
  }

  Future<void> logout() async {
    try {
      final token = _session?.token ?? await _sessionStore.read(_tokenKey);
      if (token != null && token.isNotEmpty) {
        _setToken(token);
        await dio.post<Map<String, dynamic>>(
          '/auth/logout',
          options: Options(extra: const {'suppressAuthExpired': true}),
        );
      }
    } catch (_) {
      // Logout should always clear local state, even if the token has expired.
    } finally {
      await clearSession();
    }
  }

  Future<void> clearSession({
    bool notifyAuthExpired = false,
    String message = 'Your session expired. Please log in again.',
  }) async {
    _session = null;
    dio.options.headers.remove('Authorization');
    await _sessionStore.delete(_tokenKey);
    await _sessionStore.delete(_userKey);
    if (notifyAuthExpired) onAuthExpired?.call(message);
  }

  Future<void> _saveAuthResponse(Map<String, dynamic> data) async {
    final token = data['access_token']?.toString() ?? '';
    if (token.isEmpty) {
      throw StateError('Backend did not return an access token.');
    }

    await _saveSession(token, _userFromEnvelope(data));
  }

  Future<void> _saveSession(String token, AppUser user) async {
    if (token.isEmpty) {
      throw StateError('Cannot save an empty access token.');
    }
    _setToken(token);
    _session = AppSession(token: token, user: user);
    await _sessionStore.write(_tokenKey, token);
    await _sessionStore.write(_userKey, jsonEncode(user.toJson()));
  }

  void _setToken(String token) {
    dio.options.headers['Authorization'] = 'Bearer $token';
  }
}

class _RoomPage {
  const _RoomPage(this.rooms, this.totalPages);

  final List<Room> rooms;
  final int totalPages;
}

AppUser _userFromEnvelope(Map<String, dynamic> data) {
  final user = data['user'];
  if (user is! Map) {
    throw StateError('Backend did not return a user.');
  }
  return AppUser.fromJson(Map<String, dynamic>.from(user));
}

String _normalizeAuthEmail(String value) {
  return value.trim().toLowerCase();
}

String apiErrorMessage(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['message'] != null) {
      return _cleanApiErrorMessage(
        data['message'].toString(),
        error.response?.statusCode,
      );
    }
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return 'Backend is unreachable. Check that Node backend is running on ${AppConfig.apiBaseUrl}.';
    }
    return _cleanApiErrorMessage(
      error.message ?? 'Request failed.',
      error.response?.statusCode,
    );
  }
  return error.toString();
}

String _cleanApiErrorMessage(String message, int? status) {
  final fallback =
      'Request failed${status == null ? '' : ' with status $status'}.';
  final text = message.trim().isEmpty ? fallback : message.trim();

  if (RegExp(
    r'api key is invalid|"statusCode"\s*:\s*401',
    caseSensitive: false,
  ).hasMatch(text)) {
    return 'Email delivery is connected, but the email API key is invalid. Update the server email settings and try again.';
  }

  if (RegExp(
    r'validation_error|email provider rejected',
    caseSensitive: false,
  ).hasMatch(text)) {
    return 'Email delivery is connected, but the email provider rejected the request. Check the sender domain/settings and try again.';
  }

  return text;
}
