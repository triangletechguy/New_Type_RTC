# Phase 3 Media Reliability

Phase 3 protects the Android SDK join flow from starting billable usage sessions before native media is ready. It also separates the platform client API token from the Agora RTC media token.

## Android Entrypoint

```text
new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt
```

## Token Contract

The backend currently returns `rtc_token` from `/client/rtc/token` as a signed platform JWT. That token is useful for service authorization and session tracking, but it is not an Agora RTC media token.

For native Android media joins, the SDK now accepts only:

- `agora_rtc_token` from `/client/rtc/token`
- `agora_token` from `/client/rtc/token`
- `RtcEnterpriseJoinRequest.agoraRtcTokenOverride`

The SDK no longer falls back from `agoraRtcToken` to `rtc_token`.

## Join Reliability

When `joinAgoraMedia = true`, the SDK now preflights media before `POST /client/rtc/session/start`:

- Agora App ID is present.
- The token response includes `signaling_room`.
- A real Agora media token is available through `agora_rtc_token`, `agora_token`, or `agoraRtcTokenOverride`.
- Android permissions match the requested publish mode.

If preflight fails, the SDK returns `missing_agora_rtc_token`, `missing_agora_app_id`, `missing_signaling_room`, or `missing_android_permissions` without starting a usage session.

Apps that only need the client API/session workflow, or that join media through another adapter, can set `joinAgoraMedia = false`.

If preflight passes but native `joinChannel` fails after the usage session starts, the SDK attempts `POST /client/rtc/session/end` for that just-opened session before returning the join error.

## Audio And Video Behavior

Permission checks now follow the requested role and media mode:

- Publisher/moderator/owner video rooms require microphone permission when publishing audio and camera permission when publishing camera video.
- Audio-only rooms do not require camera permission.
- Audience joins do not require local capture permissions when they are not publishing local tracks.

The SDK still exposes `hasRequiredPermissions()` for apps that want the older "camera plus microphone" check before opening a full video publishing flow.

## Events Added

- `MediaPreflightPassed`
- `MediaPreflightFailed`
- `FailedSessionCleanedUp`
- `FailedSessionCleanupError`
- `TokenRenewalFailed`

Existing `Error`, `TokenWillExpire`, `TokenExpired`, and `TokenRenewed` events remain available.

## Backend Work Remaining

Add one of these before production native Agora joining:

1. Generate an Agora RTC token in `/client/rtc/token` and return it as `agora_rtc_token`.
2. Return a backend join bundle to the mobile app that includes `agora_rtc_token`.
3. Keep `rtc_token` as the platform JWT and inject an Agora token through `agoraRtcTokenOverride` from the client company's backend.

Do not rename `rtc_token` to mean Agora token unless all web and backend consumers are updated together. Keeping both fields avoids mixing service authorization with provider media credentials.

## Acceptance

Run:

```bash
bash mobile/sdk_reference/scripts/verify_phase3_media_reliability.sh
```

Then, with Java 11 or 17:

```bash
bash new_mobileRTC/agora-manager/scripts/build_rtc_enterprise_android_sdk.sh
```

The current machine uses Java 21, so the build script intentionally stops before Gradle 7.4 / Android Gradle Plugin 7.3.1 can fail with an unsupported class-file error.
