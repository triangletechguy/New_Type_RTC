# Mobile RTC SDK Build Script

Source video: `new_mobile_RTC.mp4`

Reference image: `mobile/sdk_reference/images/new_mobile_RTC_reference_sheet.jpg`

100-frame contact sheet: `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`

100-frame directory: `mobile/sdk_reference/frames_100`

Frame extraction script: `mobile/sdk_reference/scripts/extract_new_mobile_rtc_reference.sh`

100-frame verification script: `mobile/sdk_reference/scripts/verify_100_frame_set.sh`

Android SDK file: `new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt`

Android SDK build script: `new_mobileRTC/agora-manager/scripts/build_rtc_enterprise_android_sdk.sh`

Android SDK package script: `new_mobileRTC/agora-manager/scripts/package_rtc_enterprise_android_sdk.sh`

Full workflow plan: `mobile/sdk_reference/ANDROID_SDK_WORKFLOW_AND_PLAN.md`

Phase 1 scope lock: `mobile/sdk_reference/PHASE_1_SCOPE_LOCK.md`

Frame scope audit: `mobile/sdk_reference/FRAME_SCOPE_AUDIT.tsv`

Phase 2 Android foundation: `mobile/sdk_reference/PHASE_2_ANDROID_SDK_FOUNDATION.md`

Phase 3 media reliability: `mobile/sdk_reference/PHASE_3_MEDIA_RELIABILITY.md`

Phase 4 SDK build/package: `mobile/sdk_reference/PHASE_4_SDK_BUILD_AND_PACKAGE.md`

Phase 5 contract/integration tests: `mobile/sdk_reference/PHASE_5_CONTRACT_AND_INTEGRATION_TESTS.md`

## Video Facts

- Duration: 47:18.85
- Resolution: 2560x1386
- Frame rate: 30 fps
- Video codec: H.264 Main
- Audio codec: AAC stereo
- Created: 2026-06-17 16:50:28 UTC

## Generated Frame Assets

The extraction script now produces two reference sets:

- A 16-frame storyboard for quick scanning.
- A 100-frame evenly spaced set for detailed SDK behavior review.

Run:

```bash
bash mobile/sdk_reference/scripts/extract_new_mobile_rtc_reference.sh
bash mobile/sdk_reference/scripts/verify_100_frame_set.sh
bash mobile/sdk_reference/scripts/verify_phase1_scope.sh
bash mobile/sdk_reference/scripts/verify_phase2_android_sdk_foundation.sh
bash mobile/sdk_reference/scripts/verify_phase3_media_reliability.sh
bash mobile/sdk_reference/scripts/verify_phase4_sdk_build_package.sh
bash mobile/sdk_reference/scripts/verify_phase5_contract_integration_tests.sh
```

The 100-frame set writes:

- `mobile/sdk_reference/frames_100/frame_001.jpg` through `frame_100.jpg`
- `mobile/sdk_reference/frames_100/index.tsv`
- `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`

Use `index.tsv` as the audit map when assigning each frame to SDK responsibility: client API, media join, session tracking, participant state, chat, profile sheet, moderation, connection diagnostics, or app-only UI.

The locked Phase 1 audit is stored in `FRAME_SCOPE_AUDIT.tsv`. It assigns every frame to one of these boundaries:

- `sdk_core`: runtime Android SDK ownership.
- `sdk_events`: typed SDK events or event APIs.
- `app_ui_plus_sdk_data`: SDK supplies state/data, app owns UI.
- `sdk_build_test`: scripts, docs, contract tests, and QA workflow.
- `app_ui`: app-only presentation.

## Reference Image Map

The reference sheet is a 4x4 storyboard. Read left to right, top to bottom:

| Tile | Timestamp | SDK observation |
| --- | --- | --- |
| 1 | 00:00:10 | Active RTC room with local browser participant, remote tile, bottom call controls, and a floating note window. |
| 2 | 00:03:00 | Mobile room/list surface beside desktop RTC room. SDK must support same room identity across mobile and web. |
| 3 | 00:06:00 | Mobile participant/role action dialog while desktop room continues. SDK must allow safe state changes while connected. |
| 4 | 00:09:00 | Development/debug view plus mirrored mobile device. SDK must expose errors and connection diagnostics clearly. |
| 5 | 00:12:00 | Mobile room landing/profile panel and desktop active call. SDK must separate room metadata from media connection. |
| 6 | 00:15:00 | Mobile room grid/list with avatars and reactions. SDK should provide room list, participant previews, reactions, and status streams. |
| 7 | 00:18:00 | Issue/bug tracking while mobile room is live. SDK testing must include regressions for join and state restoration. |
| 8 | 00:21:00 | Profile/member bottom sheet in mobile room. SDK must expose user profile, room role, and follow/invite actions as data. |
| 9 | 00:24:00 | Mobile chat/comment timeline in a live room. SDK must support chat events independently from audio/video. |
| 10 | 00:27:00 | Creator live setup screen. SDK must support preflight setup before joining media. |
| 11 | 00:30:00 | Login/auth screen and active RTC room. SDK needs session restoration and expired-token handling. |
| 12 | 00:33:00 | Live room controls, settings, and participant panels. SDK must publish room controls and live participant state. |
| 13 | 00:36:00 | GitHub/task review while room remains connected. SDK should be testable through mocked backend and signaling layers. |
| 14 | 00:39:00 | Full RTC stage with primary participant and picture-in-picture local tile. SDK should not force UI layout. |
| 15 | 00:42:00 | Long-running room state. SDK must handle reconnects and stale-session cleanup. |
| 16 | 00:46:30 | Final active-room state and message panel. SDK must end sessions reliably and preserve usage logs. |

## Product Meaning

The video shows one RTC service used through multiple clients:

- Web room experience: active participant tiles, bottom call controls, chat, status, and profile/settings overlays.
- Mobile room experience: room list, live room, creator setup, profile/member panel, chat timeline, and reactions.
- Service console/admin experience: app credentials, package/service status, and backend testing.
- SDK integration requirement: client-company apps should be able to join the same RTC rooms without knowing internal service-admin routes.

Keep these terms distinct:

- Platform service admin: service-side operator, backend role `super_admin`.
- Company service admin: client-company operator, backend role `client_admin`.
- Room admin: in-room moderation role, backend room role value `admin`.

## SDK Architecture Script

Build the SDK as a headless integration layer first. UI widgets can be added later, but the core SDK should work without knowing whether the app uses Flutter widgets, native Android views, Agora, or WebRTC.

### 1. Client API Layer

Current Flutter/Dart file:

```text
mobile/lib/sdk/rtc_enterprise_client_sdk.dart
```

Current Android/Kotlin file:

```text
new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt
```

Responsibilities:

- Verify client app access with `GET /api/client/me`.
- Sync a company external user with `POST /api/client/users/sync`.
- List, create, update, disable, and end rooms through `/api/client/rooms`.
- Issue short-lived RTC join tokens through `POST /api/client/rtc/token`.
- Treat `rtc_token` as the platform JWT and use only `agora_rtc_token`, `agora_token`, or `agoraRtcTokenOverride` for native Agora media.
- Start and end billable usage sessions through `/api/client/rtc/session/start` and `/api/client/rtc/session/end`.
- Convert client API errors into `RtcClientApiException`.
- On Android, expose `RtcEnterpriseAndroidSdk.ResultCallback` and main-thread callbacks.

Security rule:

- Do not hard-code long-lived client API keys in public app builds.
- For production mobile apps, the client company's backend should store the API key and return a short-lived join bundle to the app.
- The SDK can still support direct API-key mode for trusted internal tools, demos, and server-side Dart.

Android build rule:

- Build with Java 11 or 17 for this sample's Gradle 7.4 / AGP 7.3.1 toolchain.
- Use Java 21 only after upgrading Gradle and Android Gradle Plugin.
- Run `bash new_mobileRTC/agora-manager/scripts/build_rtc_enterprise_android_sdk.sh`.
- Package with `bash new_mobileRTC/agora-manager/scripts/package_rtc_enterprise_android_sdk.sh`.

### 2. Join Orchestration Layer

Create a coordinator such as:

```text
mobile/lib/sdk/rtc_mobile_session_coordinator.dart
```

Responsibilities:

1. Accept `externalUserId`, display profile, room target, and desired mode.
2. Sync the external user.
3. Fetch or create the room.
4. Issue an RTC token.
5. Start a usage session.
6. Call a media adapter to join the channel/signaling room.
7. Subscribe to chat, participant, role, control, and connection events.
8. End usage session on leave, app background timeout, or fatal disconnect.

Suggested public call:

```dart
final handle = await coordinator.join(
  RtcMobileJoinRequest(
    externalUserId: 'company-user-123',
    displayName: 'Client User',
    roomId: 101,
    role: RtcRoomRole.publisher,
    mode: 'video',
  ),
);
```

### 3. Media Adapter Layer

Create an interface independent of provider:

```dart
abstract class RtcMediaAdapter {
  Stream<RtcMediaEvent> get events;
  Future<void> initialize();
  Future<void> join(RtcMediaJoinConfig config);
  Future<void> setMicrophoneEnabled(bool enabled);
  Future<void> setCameraEnabled(bool enabled);
  Future<void> switchCamera();
  Future<void> shareScreen(bool enabled);
  Future<void> leave();
  Future<void> dispose();
}
```

Adapters:

- `WebRtcMediaAdapter`: wraps the existing `RtcMediaService`, `RtcPeerConnectionService`, and `SignalingService`.
- `AgoraMediaAdapter`: wraps the `new_mobileRTC` Agora sample patterns for channel join, tokens, roles, effects, screen share, and quality events.

The SDK must expose media state, but it should not own the UI layout. The video shows several layouts: mobile portrait, desktop stage, picture-in-picture, and split tiles.

### 4. Event Layer

The SDK should expose typed streams:

```dart
Stream<RtcParticipantEvent> participants;
Stream<RtcChatEvent> chat;
Stream<RtcRoomControlEvent> controls;
Stream<RtcConnectionEvent> connection;
Stream<RtcModerationEvent> moderation;
```

Minimum events:

- joined, left, reconnecting, reconnected, failed
- remote participant joined/left
- mic/camera/screen state changed
- room controls updated
- chat message received/deleted
- role changed: owner, roomAdmin, moderator, speaker, audience
- token expiring/expired
- usage session started/ended

### 5. Optional UI Kit

After the headless SDK is stable, add optional Flutter widgets:

- `RtcRoomListView`
- `RtcLiveRoomView`
- `RtcParticipantTile`
- `RtcControlBar`
- `RtcChatTimeline`
- `RtcCreatorSetupSheet`
- `RtcMemberProfileSheet`
- `RtcConnectionBanner`

These widgets should consume SDK streams and models. They should not call `/api/client/*` directly.

## Full Integration Script

Use this sequence as the first complete SDK scenario:

```dart
final sdk = RtcEnterpriseClientSdk(
  apiBaseUrl: 'https://rtc.example.com/api',
  apiKey: clientApiKey,
);

await sdk.syncExternalUser(
  const RtcExternalUserSyncRequest(
    externalUserId: 'company-user-123',
    name: 'Client User',
    email: 'user@example.com',
    avatarUrl: 'https://example.com/avatar.png',
  ),
);

final roomEnvelope = await sdk.createRoom(
  const RtcRoomCreateRequest(
    externalUserId: 'company-user-123',
    name: 'Mobile live room',
    roomType: 'video',
    privacyType: 'public',
    maxMicCount: 8,
    chatEnabled: true,
    screenShareEnabled: true,
  ),
);

final room = roomEnvelope['room'] as Map<String, dynamic>;
final roomId = room['id'] as int;

final token = await sdk.issueRtcToken(
  RtcTokenRequest(
    externalUserId: 'company-user-123',
    roomId: roomId,
    role: RtcRoomRole.publisher,
    rtcMode: 'video',
  ),
);

final agoraRtcToken = token.agoraRtcToken; // Or inject this from the client company's backend.

final session = await sdk.startSession(
  RtcSessionRequest(
    externalUserId: 'company-user-123',
    roomId: roomId,
    role: RtcRoomRole.publisher,
    rtcMode: token.mediaType,
  ),
);

await mediaAdapter.initialize();
await mediaAdapter.join(
  RtcMediaJoinConfig(
    roomId: roomId,
    signalingRoom: token.signalingRoom,
    rtcToken: agoraRtcToken,
    mediaType: token.mediaType,
    role: RtcRoomRole.publisher,
  ),
);

// Runtime:
// - Render participant tiles from mediaAdapter events.
// - Render chat and room controls from SDK/signaling events.
// - Refresh token before token.expiresAt.
// - Keep usage session active while media is connected.

await mediaAdapter.leave();
await sdk.endSession(
  RtcSessionRequest(
    externalUserId: 'company-user-123',
    roomId: roomId,
    sessionId: session.sessionId,
    role: RtcRoomRole.publisher,
    rtcMode: token.mediaType,
  ),
);
```

## Build Plan

### Phase 0: Frame Evidence And SDK Scope

- Generate 100 frames from `new_mobile_RTC.mp4`.
- Verify the frame set with `verify_100_frame_set.sh`.
- Review every tenth frame first, then fill gaps from the full frame set.
- Mark each frame as SDK responsibility or app UI responsibility.
- Verify the locked scope with `verify_phase1_scope.sh`.
- Keep web app changes out of this Android SDK build path.

### Phase 1: Harden The Client API SDK

- Add typed response models for `me`, external users, rooms, tokens, and sessions. Android Phase 2 adds typed accessors in `RtcEnterpriseAndroidSdk.kt`.
- Add request validation before network calls. Android Phase 2 validates user, room, token, session, and join requests before HTTP calls.
- Add retry/backoff only for safe idempotent reads and recoverable network errors.
- Add token-expiry helpers.
- Add API-key mode and backend-join-bundle mode.
- Add examples for direct trusted use and production backend proxy use.

### Phase 2: Add Session Coordinator

- Implement `RtcMobileSessionCoordinator`.
- Connect the coordinator to existing Flutter services.
- Make join/leave idempotent.
- Add lifecycle hooks for app background/foreground.
- Ensure usage sessions end on leave, crash recovery, and stale reconnect timeout.

### Phase 3: Add Media Adapter Interface

- Define provider-neutral media contracts.
- Implement `WebRtcMediaAdapter` from current Flutter WebRTC services.
- Implement `AgoraMediaAdapter` using `new_mobileRTC` reference patterns.
- Keep platform `rtc_token` separate from native Agora media tokens.
- Preflight native media token, channel, App ID, and Android permissions before starting a usage session.
- Clean up a just-opened usage session if native Agora `joinChannel` fails.
- Normalize provider events into SDK events.
- For Android, keep `RtcEnterpriseAndroidSdk.kt` as the native Agora adapter and package it as an AAR.

### Phase 4: Scripted Android Build And Package

- Use `PHASE_4_SDK_BUILD_AND_PACKAGE.md` as the Android AAR release contract.
- Build with Java 11 or 17.
- Run `build_rtc_enterprise_android_sdk.sh` for `compileDebugKotlin` and `assembleRelease`.
- Run `package_rtc_enterprise_android_sdk.sh` to create the AAR, SHA256 file, and JSON manifest.
- Keep source commit, dirty-tree flag, toolchain versions, and artifact checksum together in the manifest.
- Run `verify_phase4_sdk_build_package.sh` locally and in CI.

### Phase 5: Contract And Integration Tests

- Use `PHASE_5_CONTRACT_AND_INTEGRATION_TESTS.md` as the client API contract test plan.
- Mock every `/api/client/*` endpoint used by the Android SDK.
- Verify payloads for user sync, room create, token issue, session start, and session end.
- Verify `RtcRoomRole.ROOM_ADMIN` sends backend room role value `admin`.
- Verify `leaveRoom` ends the tracked usage session.
- Verify platform `rtc_token` remains separate from native `agora_rtc_token`.
- Run `verify_phase5_contract_integration_tests.sh` locally and in CI.

### Phase 6: Add Event And Chat Layer

- Wrap signaling events as typed SDK streams.
- Support participant updates, room controls, moderation, chat, and deleted-message events.
- Add token refresh and reconnect events.

### Phase 7: Add Optional UI Kit

- Build reusable Flutter widgets after the headless SDK is stable.
- Match the reference video surfaces: room list, live stage, controls, chat, member profile, creator setup, and connection banners.
- Keep the UI kit optional so client apps can use custom screens.

## Test Plan

### Unit Tests

- Request serialization for every SDK endpoint.
- `RtcRoomRole.roomAdmin` serializes to backend value `admin`.
- API-key trimming and header injection.
- Client error mapping to `RtcClientApiException`.
- Token response parsing: `rtc_token`, `signaling_room`, `media_type`, `expires_at`.
- Agora token parsing: `agora_rtc_token`/`agora_token` without falling back to platform `rtc_token`.
- Session response parsing: `sessionId`, `participantId`, billable minutes.

### Contract Tests

- Mock `/api/client/me`.
- Mock `/api/client/users/sync`.
- Mock `/api/client/rooms`.
- Mock `/api/client/rtc/token`.
- Mock `/api/client/rtc/session/start`.
- Mock `/api/client/rtc/session/end`.
- Verify payloads match backend route expectations.

### Integration Tests

- Local backend: sync user -> create room -> issue token -> start session -> end session.
- Verify usage log and daily usage rows are created.
- Verify client-company billing scope remains `client_company`.
- Verify room admin role is treated as room role, not company service admin.

### Media Tests

- Join audio-only room.
- Join video room.
- Verify missing Agora media token returns `missing_agora_rtc_token` before session start.
- Verify audience/audio-only joins do not require camera permission.
- Toggle mic/camera.
- Switch camera.
- Simulate reconnect.
- Simulate remote participant join/leave.
- Verify media adapter emits normalized events.

### Mobile UI Regression Tests

- Room list loads with active participant previews.
- Creator setup can create/start a room.
- Live room shows local and remote tiles.
- Chat timeline receives and deletes messages.
- Member/profile bottom sheet opens from participant data.
- Connection indicator changes during reconnect.
- Leave ends usage session.

### Manual Video-Parity Checklist

Use `new_mobile_RTC_reference_sheet.jpg` and verify:

- Mobile room list matches tile 2/6.
- Profile/member panel matches tile 8.
- Chat timeline matches tile 9.
- Creator live setup matches tile 10.
- Login/session restore matches tile 11.
- Live room controls and participant panel match tile 12.
- Active RTC stage and picture-in-picture match tile 14/16.

## Done Criteria

- `bash mobile/sdk_reference/scripts/verify_100_frame_set.sh` passes.
- `bash mobile/sdk_reference/scripts/verify_phase3_media_reliability.sh` passes.
- `bash mobile/sdk_reference/scripts/verify_phase4_sdk_build_package.sh` passes.
- `bash mobile/sdk_reference/scripts/verify_phase5_contract_integration_tests.sh` passes.
- 100 extracted images exist in `mobile/sdk_reference/frames_100`.
- Android SDK source exists at `new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt`.
- `flutter analyze` has no SDK issues.
- SDK unit and contract tests pass.
- Android SDK module compiles with Java 11/17.
- Android AAR is generated with SHA256 manifest.
- Local integration test creates billable usage and closes it.
- WebRTC and Agora adapters can join the same backend-issued room identity with provider-correct media credentials.
- Reference video checklist is satisfied on Android emulator and one physical device.
