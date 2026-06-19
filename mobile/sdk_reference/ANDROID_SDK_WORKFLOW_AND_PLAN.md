# Android RTC SDK Workflow And Plan

This workflow uses `new_mobile_RTC.mp4` as the visual behavior source and `new_mobileRTC` as the Android Agora reference app.

## Current SDK File

Android SDK entrypoint:

```text
new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt
```

The SDK file wraps:

- `GET /api/client/me`
- `POST /api/client/users/sync`
- `/api/client/rooms`
- `POST /api/client/rtc/token`
- `POST /api/client/rtc/session/start`
- `POST /api/client/rtc/session/end`
- Agora local/remote video setup, join, leave, mic, camera, switch camera, and token renewal events

Room admin is named `RtcRoomRole.ROOM_ADMIN` in SDK code and serializes to backend value `admin`. This keeps it separate from platform service admins and company service admins.

## Reference Image Workflow

Generate reference images:

```bash
bash mobile/sdk_reference/scripts/extract_new_mobile_rtc_reference.sh
```

Outputs:

- `mobile/sdk_reference/frames_100/frame_001.jpg` through `frame_100.jpg`
- `mobile/sdk_reference/frames_100/index.tsv`
- `mobile/sdk_reference/FRAME_SCOPE_AUDIT.tsv`
- `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`
- `mobile/sdk_reference/images/new_mobile_RTC_reference_sheet.jpg`

Verify the 100-frame set:

```bash
bash mobile/sdk_reference/scripts/verify_100_frame_set.sh
bash mobile/sdk_reference/scripts/verify_phase1_scope.sh
bash mobile/sdk_reference/scripts/verify_phase2_android_sdk_foundation.sh
bash mobile/sdk_reference/scripts/verify_phase3_media_reliability.sh
bash mobile/sdk_reference/scripts/verify_phase4_sdk_build_package.sh
bash mobile/sdk_reference/scripts/verify_phase5_contract_integration_tests.sh
```

Use the 100 frames to confirm SDK coverage for room list, live room, chat, profile sheet, creator setup, connection state, participant actions, and long-running session cleanup.

Phase 1 scope is locked in:

```text
mobile/sdk_reference/PHASE_1_SCOPE_LOCK.md
mobile/sdk_reference/FRAME_SCOPE_AUDIT.tsv
```

Phase 2 Android foundation is tracked in:

```text
mobile/sdk_reference/PHASE_2_ANDROID_SDK_FOUNDATION.md
```

Phase 3 media reliability is tracked in:

```text
mobile/sdk_reference/PHASE_3_MEDIA_RELIABILITY.md
```

Phase 4 SDK build/package is tracked in:

```text
mobile/sdk_reference/PHASE_4_SDK_BUILD_AND_PACKAGE.md
```

Phase 5 contract/integration tests are tracked in:

```text
mobile/sdk_reference/PHASE_5_CONTRACT_AND_INTEGRATION_TESTS.md
```

## SDK Build Scripts

Compile and assemble the Android SDK module:

```bash
bash new_mobileRTC/agora-manager/scripts/build_rtc_enterprise_android_sdk.sh
```

Package a release AAR:

```bash
bash new_mobileRTC/agora-manager/scripts/package_rtc_enterprise_android_sdk.sh
```

The current Android sample uses Gradle 7.4 and Android Gradle Plugin 7.3.1. Use Java 11 or Java 17 for these scripts. Java 21 fails before Kotlin compilation with `Unsupported class file major version 65`.

## Integration Workflow

1. Extract the 100 reference frames.
2. Review `frames_100/index.tsv` and mark each frame as room list, room setup, live media, chat, profile, controls, admin/service state, or diagnostics.
3. Confirm each behavior maps to SDK API, SDK event, or app UI responsibility.
4. Run `verify_phase1_scope.sh`.
5. Build the Android SDK module.
6. Package the AAR.
7. Add the AAR to a clean Android sample app.
8. Run the join flow against a local or staging backend.
9. Verify usage sessions end on leave, app background, network failure, and token expiration.

## First Complete Android Scenario

```kotlin
val sdk = RtcEnterpriseAndroidSdk(
    context = this,
    apiBaseUrl = "https://rtc.example.com/api",
    clientApiKey = clientApiKey,
    agoraAppId = agoraAppId,
)

sdk.joinRoom(
    RtcEnterpriseJoinRequest(
        externalUser = RtcExternalUserSyncRequest(
            externalUserId = "company-user-123",
            name = "Client User",
            email = "user@example.com",
        ),
        roomId = 101,
        role = RtcRoomRole.PUBLISHER,
        rtcMode = "video",
        agoraRtcTokenOverride = agoraRtcTokenFromCompanyBackend,
    ),
    object : RtcEnterpriseAndroidSdk.ResultCallback<RtcEnterpriseJoinHandle> {
        override fun onSuccess(result: RtcEnterpriseJoinHandle) {
            // Attach sdk.localVideo to the Activity layout.
        }

        override fun onError(error: RtcEnterpriseException) {
            // Show error.code and error.message.
        }
    },
)
```

Native Agora joins require a real Agora RTC token. The platform `rtc_token` from the current `/client/rtc/token` route is a service JWT and is not used as a media token. Add `agora_rtc_token` to the backend token response or provide `agoraRtcTokenOverride` from a client-company backend join bundle.

For production apps, do not ship a long-lived client API key in the APK. Put the API key on the client company's backend and have the app request a short-lived join bundle.

## Build Plan

Phase 1: Scope lock from video evidence

- Use `FRAME_SCOPE_AUDIT.tsv` as the source of truth for what the SDK owns.
- Keep `sdk_core` items in the Android SDK runtime.
- Keep `sdk_events` as typed events or planned event APIs.
- Keep `app_ui_plus_sdk_data` as SDK data/state only.
- Keep `sdk_build_test` as scripts, docs, and tests.
- Keep `app_ui` outside the SDK runtime.

Phase 2: Android SDK foundation

- Keep `RtcEnterpriseAndroidSdk.kt` as the public entrypoint.
- Add typed request/response models for client API, room, token, session, and errors. Done in `RtcEnterpriseAndroidSdk.kt`.
- Validate request data before network calls. Done for user sync, room list/create/status, token, session, and join requests.
- Keep callback delivery on the Android main thread. Done with `mainHandler.post`.
- Keep UI layout outside the SDK.

Phase 3: Media reliability

- Keep platform `rtc_token` separate from native Agora media tokens. Done in `RtcEnterpriseAndroidSdk.kt`.
- Confirm Agora join works with a true Agora RTC token from `agora_rtc_token`, `agora_token`, or `agoraRtcTokenOverride`.
- Preflight App ID, signaling room, Agora media token, and mode-aware Android permissions before session start. Done in `RtcEnterpriseAndroidSdk.kt`.
- Clean up a just-opened usage session if native Agora `joinChannel` fails. Done in `RtcEnterpriseAndroidSdk.kt`.
- Add token renewal failure events and prevent renewal with a platform JWT. Done in `RtcEnterpriseAndroidSdk.kt`.
- Add backend support for `agora_rtc_token` if `/api/client/rtc/token` remains a platform JWT.
- Add emulator/device tests for token renewal, reconnect, audio-only, audience, and video-room behavior.

Phase 4: Scripted build and package

- Make Java 11/17 the SDK build requirement.
- Run `build_rtc_enterprise_android_sdk.sh` locally and in CI. Done.
- Run `package_rtc_enterprise_android_sdk.sh` only after compile/release assemble pass. Done.
- Store AAR, SHA256, manifest JSON, source commit, dirty-tree flag, and toolchain versions together. Done.
- Verify script syntax, release contract fields, and optional dist checks with `verify_phase4_sdk_build_package.sh`. Done.
- Use `.github/workflows/android-rtc-sdk.yml` for Java 17 CI build/package/upload. Done.

Phase 5: Contract and integration tests

- Mock every `/api/client/*` endpoint used by the Android SDK. Done with `run_phase5_client_api_contract_tests.js`.
- Verify payloads for user sync, room create, token issue, session start, and session end. Done.
- Verify `RtcRoomRole.ROOM_ADMIN` sends `admin`. Done.
- Verify session end is called after media leave. Done with static SDK contract checks.
- Verify platform `rtc_token` and native `agora_rtc_token` stay separate. Done.
- Run `verify_phase5_contract_integration_tests.sh` locally and in CI. Done.

Phase 6: Video parity QA

- Use the 100 frames as the checklist.
- Confirm SDK events can support every mobile behavior shown in the video.
- Keep UI-specific behavior in the app layer, not the SDK.
- Sign off with one emulator and one physical Android device.
