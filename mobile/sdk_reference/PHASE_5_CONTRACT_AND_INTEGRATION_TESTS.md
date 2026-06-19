# Phase 5 Contract And Integration Tests

Phase 5 locks the Android SDK client API contract before emulator/device video-parity work. The goal is to catch endpoint, payload, role, token, and session-lifecycle regressions without needing a live backend.

## Contract Fixture

```text
mobile/sdk_reference/contracts/client_api_phase5_contract.json
```

The fixture lists the client API endpoints used by the SDK:

- `GET /client/me`
- `POST /client/users/sync`
- `GET /client/users/:externalUserId`
- `GET /client/rooms`
- `POST /client/rooms`
- `GET /client/rooms/:roomId`
- `PATCH /client/rooms/:roomId`
- `PATCH /client/rooms/:roomId/status`
- `POST /client/rooms/:roomId/disable`
- `DELETE /client/rooms/:roomId`
- `POST /client/rtc/token`
- `POST /client/rtc/session/start`
- `POST /client/rtc/session/end`

It also records the important Phase 5 assertions:

- `RtcRoomRole.ROOM_ADMIN` must serialize to backend room role value `admin`.
- `leaveRoom` must end the tracked usage session with `handle.session.sessionId`.
- `rtc_token` remains the platform token and must not replace `agora_rtc_token`.

## Mock Contract Runner

```bash
node mobile/sdk_reference/scripts/run_phase5_client_api_contract_tests.js
```

The runner starts a local dependency-free Node HTTP server, sends one request for every contract endpoint, validates request payload keys, validates response keys, and confirms the platform token and Agora media token are separate values.

The runner also reads:

```text
new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt
```

It statically checks the SDK endpoint paths, JSON payload mappings, room-admin role value, leave-session cleanup, and token separation rule.

## Verifier

```bash
bash mobile/sdk_reference/scripts/verify_phase5_contract_integration_tests.sh
```

The verifier checks JSON syntax, JavaScript syntax, runs the mock contract runner, verifies SDK source patterns, and confirms the Phase 5 verifier is wired into CI.

## CI

Phase 5 is included in:

```text
.github/workflows/android-rtc-sdk.yml
```

The CI workflow runs all phase verifiers before building and packaging the Android SDK.

## Acceptance

Run:

```bash
bash mobile/sdk_reference/scripts/verify_phase5_contract_integration_tests.sh
```

Expected output:

```text
Verified Phase 5 client API mock contract: 13 endpoints.
Verified Phase 5 contract and integration tests.
```

Phase 5 does not require a live backend, Android emulator, or Java 11/17. The real Android compile/package step still requires Java 11 or 17 because of the sample app's Gradle 7.4 / AGP 7.3.1 toolchain.
