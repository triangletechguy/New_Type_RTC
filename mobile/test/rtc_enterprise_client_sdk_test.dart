import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rtc_enterprise_mobile/sdk/rtc_enterprise_client_sdk.dart';

void main() {
  test('issues RTC tokens through the client API', () async {
    final adapter = _MockHttpAdapter((options) {
      expect(options.method, 'POST');
      expect(options.uri.path, '/api/client/rtc/token');
      expect(options.headers['x-rtc-api-key'], 'client-key');
      expect(options.data, isA<Map>());

      final body = Map<String, dynamic>.from(options.data as Map);
      expect(body['external_user_id'], 'company-user-1');
      expect(body['room_id'], 44);
      expect(body['role'], 'admin');
      expect(body['rtc_mode'], 'video');

      return _MockResponse.ok({
        'rtc_token': 'rtc-token',
        'expires_in': 900,
        'expires_at': '2026-06-17T12:00:00.000Z',
        'room': {
          'id': 44,
          'signaling_room': 'webrtc_tenant_1_room_44',
          'rtc_profile': {'media_type': 'video'},
        },
        'external_user': {'external_user_id': 'company-user-1'},
      });
    });
    final sdk = _sdk(adapter);

    final token = await sdk.issueRtcToken(
      const RtcTokenRequest(
        externalUserId: 'company-user-1',
        roomId: 44,
        role: RtcRoomRole.roomAdmin,
        rtcMode: 'video',
      ),
    );

    expect(token.rtcToken, 'rtc-token');
    expect(token.signalingRoom, 'webrtc_tenant_1_room_44');
    expect(token.mediaType, 'video');
  });

  test('maps client API errors to typed exceptions', () async {
    final adapter = _MockHttpAdapter((_) {
      return const _MockResponse(422, {
        'code': 'permission_denied',
        'message': 'Check RTC token payload.',
        'errors': {'room_id': 'room_id must be a positive integer.'},
      });
    });
    final sdk = _sdk(adapter);

    await expectLater(
      sdk.issueRtcToken(
        const RtcTokenRequest(externalUserId: 'company-user-1', roomId: 0),
      ),
      throwsA(
        isA<RtcClientApiException>()
            .having((error) => error.statusCode, 'statusCode', 422)
            .having((error) => error.code, 'code', 'permission_denied')
            .having(
              (error) => error.errors['room_id'],
              'room_id error',
              'room_id must be a positive integer.',
            ),
      ),
    );
  });
}

RtcEnterpriseClientSdk _sdk(_MockHttpAdapter adapter) {
  final dio = Dio(
    BaseOptions(
      baseUrl: 'https://rtc.test/api',
      headers: const {'Accept': 'application/json'},
    ),
  )..httpClientAdapter = adapter;

  return RtcEnterpriseClientSdk(
    apiBaseUrl: 'https://rtc.test/api',
    apiKey: ' client-key ',
    dio: dio,
  );
}

class _MockHttpAdapter implements HttpClientAdapter {
  _MockHttpAdapter(this.handler);

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
