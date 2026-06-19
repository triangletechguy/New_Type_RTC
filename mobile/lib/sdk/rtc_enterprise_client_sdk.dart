import 'package:dio/dio.dart';

class RtcEnterpriseClientSdk {
  RtcEnterpriseClientSdk({
    required String apiBaseUrl,
    required String apiKey,
    Dio? dio,
  }) : _apiKey = apiKey.trim(),
       _dio =
           dio ??
           Dio(
             BaseOptions(
               baseUrl: apiBaseUrl.replaceFirst(RegExp(r'/+$'), ''),
               connectTimeout: const Duration(seconds: 12),
               receiveTimeout: const Duration(seconds: 20),
               headers: const {'Accept': 'application/json'},
             ),
           );

  final String _apiKey;
  final Dio _dio;

  Future<Map<String, dynamic>> me() => _request('GET', '/client/me');

  Future<Map<String, dynamic>> syncExternalUser(
    RtcExternalUserSyncRequest user,
  ) {
    return _request('POST', '/client/users/sync', data: user.toJson());
  }

  Future<Map<String, dynamic>> getExternalUser(String externalUserId) {
    return _request(
      'GET',
      '/client/users/${Uri.encodeComponent(externalUserId)}',
    );
  }

  Future<Map<String, dynamic>> listRooms({
    String status = 'active',
    String privacyType = 'all',
    String roomType = 'all',
    String search = '',
    int page = 1,
    int perPage = 24,
  }) {
    return _request(
      'GET',
      '/client/rooms',
      queryParameters: {
        'status': status,
        'privacy_type': privacyType,
        'room_type': roomType,
        'q': search,
        'page': page,
        'per_page': perPage,
      },
    );
  }

  Future<Map<String, dynamic>> createRoom(RtcRoomCreateRequest room) {
    return _request('POST', '/client/rooms', data: room.toJson());
  }

  Future<Map<String, dynamic>> getRoom(int roomId) {
    return _request('GET', '/client/rooms/$roomId');
  }

  Future<Map<String, dynamic>> updateRoom(
    int roomId,
    Map<String, Object?> updates,
  ) {
    return _request('PATCH', '/client/rooms/$roomId', data: updates);
  }

  Future<Map<String, dynamic>> updateRoomStatus(int roomId, String status) {
    return _request(
      'PATCH',
      '/client/rooms/$roomId/status',
      data: {'status': status},
    );
  }

  Future<Map<String, dynamic>> disableRoom(int roomId) {
    return _request('POST', '/client/rooms/$roomId/disable');
  }

  Future<Map<String, dynamic>> endRoom(int roomId) {
    return _request('DELETE', '/client/rooms/$roomId');
  }

  Future<RtcTokenIssue> issueRtcToken(RtcTokenRequest request) async {
    final data = await _request(
      'POST',
      '/client/rtc/token',
      data: request.toJson(),
    );
    return RtcTokenIssue(data);
  }

  Future<RtcSessionEnvelope> startSession(RtcSessionRequest request) async {
    final data = await _request(
      'POST',
      '/client/rtc/session/start',
      data: request.toJson(),
    );
    return RtcSessionEnvelope(data);
  }

  Future<RtcSessionEnvelope> endSession(RtcSessionRequest request) async {
    final data = await _request(
      'POST',
      '/client/rtc/session/end',
      data: request.toJson(),
    );
    return RtcSessionEnvelope(data);
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Object? data,
    Map<String, Object?>? queryParameters,
  }) async {
    try {
      final response = await _dio.request<Map<String, dynamic>>(
        path,
        data: data,
        queryParameters: _cleanQuery(queryParameters),
        options: Options(
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'x-rtc-api-key': _apiKey,
          },
        ),
      );

      return response.data ?? const <String, dynamic>{};
    } on DioException catch (error) {
      final responseData = error.response?.data;
      if (responseData is Map) {
        final payload = Map<String, dynamic>.from(responseData);
        throw RtcClientApiException(
          statusCode: error.response?.statusCode ?? 0,
          code: payload['code']?.toString() ?? 'client_api_error',
          message:
              payload['message']?.toString() ?? 'Client API request failed.',
          errors: _asMap(payload['errors']),
        );
      }

      throw RtcClientApiException(
        statusCode: error.response?.statusCode ?? 0,
        code: 'network_error',
        message: error.message ?? 'Client API request failed.',
      );
    }
  }

  Map<String, Object?> _cleanQuery(Map<String, Object?>? query) {
    final source = query ?? const <String, Object?>{};
    return Map.fromEntries(
      source.entries.where((entry) {
        final value = entry.value;
        if (value == null) return false;
        if (value is String) return value.trim().isNotEmpty;
        return true;
      }),
    );
  }
}

class RtcExternalUserSyncRequest {
  const RtcExternalUserSyncRequest({
    required this.externalUserId,
    required this.name,
    this.email,
    this.phone,
    this.avatarUrl,
    this.status = 'active',
    this.metadata,
  });

  final String externalUserId;
  final String name;
  final String? email;
  final String? phone;
  final String? avatarUrl;
  final String status;
  final Map<String, Object?>? metadata;

  Map<String, Object?> toJson() => _withoutNulls({
    'external_user_id': externalUserId,
    'name': name,
    'email': email,
    'phone': phone,
    'avatar_url': avatarUrl,
    'status': status,
    'metadata': metadata,
  });
}

class RtcRoomCreateRequest {
  const RtcRoomCreateRequest({
    required this.externalUserId,
    required this.name,
    this.description,
    this.profileImage,
    this.roomType = 'video',
    this.privacyType = 'public',
    this.password,
    this.maxMicCount = 8,
    this.theme,
    this.chatEnabled = true,
    this.giftEnabled = false,
    this.screenShareEnabled = false,
    this.aiSecurityEnabled = false,
  });

  final String externalUserId;
  final String name;
  final String? description;
  final String? profileImage;
  final String roomType;
  final String privacyType;
  final String? password;
  final int maxMicCount;
  final String? theme;
  final bool chatEnabled;
  final bool giftEnabled;
  final bool screenShareEnabled;
  final bool aiSecurityEnabled;

  Map<String, Object?> toJson() => _withoutNulls({
    'external_user_id': externalUserId,
    'name': name,
    'description': description,
    'profile_image': profileImage,
    'room_type': roomType,
    'privacy_type': privacyType,
    'password': password,
    'max_mic_count': maxMicCount,
    'theme': theme,
    'chat_enabled': chatEnabled,
    'gift_enabled': giftEnabled,
    'screen_share_enabled': screenShareEnabled,
    'ai_security_enabled': aiSecurityEnabled,
  });
}

enum RtcRoomRole {
  audience('audience'),
  publisher('publisher'),
  moderator('moderator'),
  roomAdmin('admin'),
  owner('owner');

  const RtcRoomRole(this.apiValue);

  final String apiValue;
}

class RtcTokenRequest {
  const RtcTokenRequest({
    required this.externalUserId,
    required this.roomId,
    this.role = RtcRoomRole.publisher,
    this.permissions = const [],
    this.rtcMode,
  });

  final String externalUserId;
  final int roomId;
  final RtcRoomRole role;
  final List<String> permissions;
  final String? rtcMode;

  Map<String, Object?> toJson() => _withoutNulls({
    'external_user_id': externalUserId,
    'room_id': roomId,
    'role': role.apiValue,
    'permissions': permissions,
    'rtc_mode': rtcMode,
  });
}

class RtcSessionRequest {
  const RtcSessionRequest({
    required this.externalUserId,
    required this.roomId,
    this.sessionId,
    this.role = RtcRoomRole.publisher,
    this.rtcMode,
  });

  final String externalUserId;
  final int roomId;
  final int? sessionId;
  final RtcRoomRole role;
  final String? rtcMode;

  Map<String, Object?> toJson() => _withoutNulls({
    'external_user_id': externalUserId,
    'room_id': roomId,
    'session_id': sessionId,
    'role': role.apiValue,
    'rtc_mode': rtcMode,
  });
}

class RtcTokenIssue {
  const RtcTokenIssue(this.raw);

  final Map<String, dynamic> raw;

  String get rtcToken => raw['rtc_token']?.toString() ?? '';
  String get tokenType => raw['token_type']?.toString() ?? 'Bearer';
  String get expiresAt => raw['expires_at']?.toString() ?? '';
  int get expiresIn => _asInt(raw['expires_in']);
  Map<String, dynamic> get room => _asMap(raw['room']);
  Map<String, dynamic> get externalUser => _asMap(raw['external_user']);
  String get signalingRoom => room['signaling_room']?.toString() ?? '';
  String get mediaType {
    final profile = _asMap(room['rtc_profile']);
    return profile['media_type']?.toString() ?? 'video';
  }
}

class RtcSessionEnvelope {
  const RtcSessionEnvelope(this.raw);

  final Map<String, dynamic> raw;

  Map<String, dynamic> get session => _asMap(raw['session']);
  Map<String, dynamic> get participant => _asMap(raw['participant']);
  Map<String, dynamic> get room => _asMap(raw['room']);
  int get sessionId => _asInt(raw['session_id'] ?? session['id']);
  int get participantId => _asInt(raw['participant_id'] ?? participant['id']);
  int get billableMinutes => _asInt(raw['billable_minutes']);
}

class RtcClientApiException implements Exception {
  const RtcClientApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.errors = const {},
  });

  final int statusCode;
  final String code;
  final String message;
  final Map<String, dynamic> errors;

  @override
  String toString() => message;
}

Map<String, Object?> _withoutNulls(Map<String, Object?> value) {
  return Map.fromEntries(value.entries.where((entry) => entry.value != null));
}

Map<String, dynamic> _asMap(Object? value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  return const <String, dynamic>{};
}

int _asInt(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
