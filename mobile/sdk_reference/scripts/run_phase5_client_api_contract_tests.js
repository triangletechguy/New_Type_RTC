#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const CONTRACT_FILE = path.join(ROOT_DIR, 'mobile/sdk_reference/contracts/client_api_phase5_contract.json');
const SDK_FILE = path.join(
  ROOT_DIR,
  'new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt',
);

const contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
const sdkSource = fs.readFileSync(SDK_FILE, 'utf8');
const API_KEY = 'phase5-test-api-key';

function jsonResponse(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${text}`));
      }
    });
  });
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertRequiredKeys(object, keys, label) {
  for (const key of keys || []) {
    assert.ok(hasOwn(object, key), `${label} missing key: ${key}`);
  }
}

function assertQuery(actualUrl, expectedQuery) {
  for (const [key, expected] of Object.entries(expectedQuery || {})) {
    assert.equal(actualUrl.searchParams.get(key) || '', expected, `query ${key}`);
  }
}

function roomFixture(overrides = {}) {
  return {
    id: 101,
    tenant_id: 7,
    name: 'Mobile live room',
    description: 'Phase 5 mocked RTC room',
    room_type: 'video',
    privacy_type: 'public',
    status: 'active',
    max_mic_count: 8,
    active_participants: 1,
    signaling_room: 'webrtc_tenant_7_room_101',
    rtc_profile: {
      channel_profile: 'communication',
      agora_web_mode: 'rtc',
      client_role: 'broadcaster',
      media_type: 'video',
    },
    controls: {
      chat_enabled: true,
      gift_enabled: false,
      screen_share_enabled: true,
      ai_security_enabled: false,
    },
    billing: {
      payer: 'client_company',
      billing_scope: 'client_company',
      tenant_id: 7,
      tenant_name: 'Client Company',
      user_pays: false,
    },
    ...overrides,
  };
}

function externalUserFixture(overrides = {}) {
  return {
    id: 91,
    user_id: 501,
    external_user_id: 'company-user-123',
    name: 'Client User',
    email: 'user@example.com',
    avatar_url: 'https://example.com/avatar.png',
    status: 'active',
    billing_scope: 'client_company',
    user_pays: false,
    ...overrides,
  };
}

function responseFor(endpoint, body) {
  switch (endpoint.id) {
    case 'me':
      return {
        tenant: { id: 7, name: 'Client Company' },
        app: { id: 12, app_key: 'client-app-key', name: 'Mobile Client App' },
        billing: { payer: 'client_company', billing_scope: 'client_company', user_pays: false },
        auth: 'ok',
      };
    case 'syncExternalUser':
    case 'getExternalUser':
      return {
        external_user: externalUserFixture({ name: body.name || 'Client User' }),
        user_id: 501,
      };
    case 'listRooms':
      return {
        rooms: [roomFixture()],
        pagination: { page: 1, per_page: 24, total: 1, total_pages: 1 },
      };
    case 'createRoom':
    case 'getRoom':
    case 'updateRoom':
    case 'updateRoomStatus':
    case 'disableRoom':
      return {
        room: roomFixture({
          name: body.name || 'Mobile live room',
          status: body.status || 'active',
        }),
      };
    case 'endRoom':
      return { room_id: 101 };
    case 'issueRtcToken':
      return {
        rtc_token: 'platform.jwt.token',
        agora_rtc_token: 'agora.native.media.token',
        token_type: 'Bearer',
        expires_in: 900,
        expires_at: '2026-06-17T17:15:00Z',
        room: roomFixture(),
        external_user: externalUserFixture(),
        grants: {
          role: body.role,
          room_id: body.room_id,
          permissions: body.permissions,
        },
      };
    case 'startSession':
      return {
        session_id: 7001,
        participant_id: 8001,
        session: {
          id: 7001,
          room_id: body.room_id,
          signaling_room: 'webrtc_tenant_7_room_101',
          status: 'active',
          session_type: body.rtc_mode,
        },
        participant: {
          id: 8001,
          session_id: 7001,
          user_id: 501,
          role: body.role,
          connection_status: 'connected',
          mic_enabled: body.mic_enabled,
          camera_enabled: body.camera_enabled,
          screen_shared: body.screen_shared,
        },
        room: roomFixture(),
        external_user: externalUserFixture(),
      };
    case 'endSession':
      return {
        session_id: body.session_id,
        duration_seconds: 125,
        billable_minutes: 3,
        room_minutes: 3,
      };
    default:
      throw new Error(`No response fixture for ${endpoint.id}`);
  }
}

function requestOptions(port, endpoint, body) {
  const url = new URL(`${contract.basePath}${endpoint.path}`, `http://127.0.0.1:${port}`);
  for (const [key, value] of Object.entries(endpoint.query || {})) {
    url.searchParams.set(key, value);
  }

  const payload = body == null ? undefined : JSON.stringify(body);
  return {
    method: endpoint.method,
    hostname: '127.0.0.1',
    port,
    path: `${url.pathname}${url.search}`,
    headers: {
      accept: 'application/json',
      [contract.apiKeyHeader]: API_KEY,
      ...(payload
        ? {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(payload),
          }
        : {}),
    },
    payload,
  };
}

function requestJson(port, endpoint, body) {
  const options = requestOptions(port, endpoint, body);
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({
            statusCode: res.statusCode,
            body: text ? JSON.parse(text) : {},
          });
        } catch (error) {
          reject(new Error(`Invalid response JSON: ${text}`));
        }
      });
    });
    req.on('error', reject);
    if (options.payload) req.write(options.payload);
    req.end();
  });
}

function sampleBody(endpoint) {
  switch (endpoint.id) {
    case 'syncExternalUser':
      return {
        external_user_id: 'company-user-123',
        name: 'Client User',
        email: 'user@example.com',
        phone: '+15555550123',
        avatar_url: 'https://example.com/avatar.png',
        status: 'active',
        metadata: { plan: 'enterprise' },
      };
    case 'createRoom':
      return {
        external_user_id: 'company-user-123',
        name: 'Mobile live room',
        description: 'Created by Phase 5 contract test',
        profile_image: 'https://example.com/room.png',
        room_type: 'video',
        privacy_type: 'public',
        max_mic_count: 8,
        theme: 'default',
        chat_enabled: true,
        gift_enabled: false,
        screen_share_enabled: true,
        ai_security_enabled: false,
      };
    case 'updateRoom':
      return { name: 'Updated mobile room', chat_enabled: false };
    case 'updateRoomStatus':
      return { status: 'inactive' };
    case 'issueRtcToken':
      return {
        external_user_id: 'company-user-123',
        room_id: 101,
        role: 'admin',
        permissions: ['publish_audio', 'publish_video'],
        rtc_mode: 'video',
      };
    case 'startSession':
      return {
        external_user_id: 'company-user-123',
        room_id: 101,
        role: 'admin',
        rtc_mode: 'video',
        mic_enabled: true,
        camera_enabled: true,
        screen_shared: false,
      };
    case 'endSession':
      return {
        external_user_id: 'company-user-123',
        room_id: 101,
        session_id: 7001,
        role: 'admin',
        rtc_mode: 'video',
        mic_enabled: true,
        camera_enabled: true,
        screen_shared: false,
      };
    default:
      return undefined;
  }
}

function assertSdkSourceContract() {
  for (const endpoint of contract.endpoints) {
    const sdkPath = endpoint.path
      .replace('/company-user-123', '/${urlEncode(externalUserId)}')
      .replace('/101/status', '/$roomId/status')
      .replace('/101/disable', '/$roomId/disable')
      .replace('/101', '/$roomId');
    assert.ok(
      sdkSource.includes(sdkPath),
      `SDK source missing endpoint path: ${endpoint.path}`,
    );
  }

  for (const key of [
    '"external_user_id" to externalUserId',
    '"room_id" to roomId',
    '"role" to role.apiValue',
    '"session_id" to sessionId',
    '"mic_enabled" to microphoneEnabled',
    '"camera_enabled" to cameraEnabled',
    '"screen_shared" to screenShared',
  ]) {
    assert.ok(sdkSource.includes(key), `SDK source missing payload mapping: ${key}`);
  }

  assert.ok(sdkSource.includes('ROOM_ADMIN("admin")'), 'ROOM_ADMIN must serialize to admin');
  assert.ok(sdkSource.includes('sessionId = handle.session.sessionId'), 'leaveRoom must end tracked session id');
  assert.ok(sdkSource.includes('endSession('), 'leaveRoom/session cleanup must call endSession');
  assert.ok(!sdkSource.includes('raw.optString("agora_token", raw.optString("rtc_token"))'), 'Agora token must not fall back to rtc_token');
}

async function main() {
  assertSdkSourceContract();

  const hits = new Map(contract.endpoints.map((endpoint) => [endpoint.id, 0]));
  const server = http.createServer(async (req, res) => {
    try {
      const actualUrl = new URL(req.url, `http://${req.headers.host}`);
      const endpoint = contract.endpoints.find(
        (candidate) =>
          candidate.method === req.method &&
          `${contract.basePath}${candidate.path}` === actualUrl.pathname,
      );

      if (!endpoint) {
        jsonResponse(res, 404, { error: `Unexpected route ${req.method} ${actualUrl.pathname}` });
        return;
      }

      assert.equal(req.headers[contract.apiKeyHeader], API_KEY, 'client API key header');
      assertQuery(actualUrl, endpoint.query);

      const body = await readRequestBody(req);
      assertRequiredKeys(body, endpoint.requiredBodyKeys, `${endpoint.id} request`);
      if (endpoint.id === 'issueRtcToken' || endpoint.id === 'startSession' || endpoint.id === 'endSession') {
        assert.equal(body.role, 'admin', `${endpoint.id} room admin role`);
      }

      const response = responseFor(endpoint, body);
      assertRequiredKeys(response, endpoint.requiredResponseKeys, `${endpoint.id} response`);
      if (endpoint.id === 'issueRtcToken') {
        assert.notEqual(response.rtc_token, response.agora_rtc_token, 'platform token and Agora token must differ');
      }

      hits.set(endpoint.id, hits.get(endpoint.id) + 1);
      jsonResponse(res, 200, response);
    } catch (error) {
      jsonResponse(res, 500, { error: error.message, stack: error.stack });
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    for (const endpoint of contract.endpoints) {
      const result = await requestJson(port, endpoint, sampleBody(endpoint));
      assert.equal(result.statusCode, 200, `${endpoint.id} status: ${JSON.stringify(result.body)}`);
      assertRequiredKeys(result.body, endpoint.requiredResponseKeys, `${endpoint.id} client response`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  for (const [id, count] of hits.entries()) {
    assert.equal(count, 1, `${id} hit count`);
  }

  console.log(`Verified Phase 5 client API mock contract: ${contract.endpoints.length} endpoints.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
