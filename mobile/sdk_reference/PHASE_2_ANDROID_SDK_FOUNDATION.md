# Phase 2 Android SDK Foundation

Phase 2 hardens the Android SDK entrypoint without adding app UI. The SDK remains a headless integration layer for the client API, usage sessions, and Agora media controls.

## Android Entrypoint

```text
new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt
```

## Foundation Decisions

- `RtcEnterpriseAndroidSdk` remains the public native Android entrypoint.
- Public callbacks still use `RtcEnterpriseAndroidSdk.ResultCallback<T>`.
- SDK callbacks and listener events are delivered on Android's main thread.
- The SDK can return Android `SurfaceView` objects for media rendering, but it does not own screen layout, room-list UI, chat UI, profile sheets, or creator setup screens.
- Direct API-key mode is supported for trusted internal builds. Production mobile apps should prefer a client-company backend join bundle.

## Request Validation

The SDK validates requests before network calls:

- `apiBaseUrl` must start with `http://` or `https://`.
- `clientApiKey` is required in direct API-key mode.
- `externalUserId` is required and capped at 190 characters.
- User status must be `active`, `inactive`, or `banned`.
- Room IDs and session IDs must be positive.
- Room type, privacy type, list filters, page size, and room password rules match the backend client API.
- `RtcRoomRole.ROOM_ADMIN` remains the SDK name for backend room role value `admin`.

Validation failures return `RtcEnterpriseException` with:

- `statusCode = 422`
- `code = "validation_error"`
- `message = "Check RTC SDK request details."`
- `errorMap` for field-level errors

## Typed Response Models

The SDK still exposes raw JSON for compatibility, but now adds typed accessors:

| Model | Purpose |
| --- | --- |
| `RtcTenant` | Client tenant/company metadata. |
| `RtcClientApp` | Client app metadata. |
| `RtcBillingPolicy` | Client-company billing policy. |
| `RtcExternalUser` | Synced company user mapping. |
| `RtcRoom` | Room metadata, status, controls, RTC profile, and billing. |
| `RtcProfile` | Media profile: channel profile, mode, role, media type. |
| `RtcRoomControls` | Chat, gift, screen-share, and AI security toggles. |
| `RtcTokenGrants` | Token role, permissions, and room ID. |
| `RtcSession` | Active usage session metadata. |
| `RtcParticipant` | Session participant metadata and local media state. |
| `RtcPagination` | Room list pagination. |

## Runtime Surface After Phase 2

- `me`
- `syncExternalUser`
- `getExternalUser`
- `listRooms`
- `createRoom`
- `getRoom`
- `updateRoom`
- `updateRoomStatus`
- `disableRoom`
- `endRoom`
- `issueRtcToken`
- `startSession`
- `endSession`
- `joinRoom`
- `leaveRoom`
- `localVideo`
- `setMicrophoneEnabled`
- `setCameraEnabled`
- `switchCamera`
- `release`

## Acceptance

Run:

```bash
bash mobile/sdk_reference/scripts/verify_phase2_android_sdk_foundation.sh
```

Then, with Java 11 or 17:

```bash
bash new_mobileRTC/agora-manager/scripts/build_rtc_enterprise_android_sdk.sh
```

The current machine uses Java 21, so Gradle 7.4 / Android Gradle Plugin 7.3.1 stops before Kotlin compilation. That is a toolchain blocker, not a Phase 2 source-scope blocker.
