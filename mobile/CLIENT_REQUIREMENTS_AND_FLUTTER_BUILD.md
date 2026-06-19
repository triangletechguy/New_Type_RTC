# Client Requirements And Flutter Build Workflow

This document describes what a client-company mobile app needs to integrate the TalkEachOther RTC service and how to build the `rtc-enterprise` Flutter mobile project.

For a Flutter-app-only implementation checklist based on the 100 reference frames, see:

```text
mobile/FLUTTER_UPDATE_FROM_100_FRAMES.md
```

## Reference Inputs

- Video reference: `new_mobile_RTC.mp4`
- Extracted frame set: `mobile/sdk_reference/frames_100/`
- Frame index: `mobile/sdk_reference/frames_100/index.tsv`
- 100-frame contact sheet: `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`
- Android SDK source: `new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt`
- Android SDK release artifact: `mobile/build/agora-manager/outputs/aar/agora-manager-release.aar`
- Flutter client API wrapper: `mobile/lib/sdk/rtc_enterprise_client_sdk.dart`

The 100-frame reference set covers the expected mobile RTC behavior: call room layout, local preview, remote participant tiles, screen share, chat/notifications, participant/room-admin controls, microphone/camera toggles, and leave/end-call behavior.

## Backend URLs

Use this production API base URL in client SDK configuration:

```text
https://funint.online/api
```

Use this health endpoint only to verify that the backend is online:

```text
https://funint.online/api/health
```

Use this signaling/server URL for realtime room signaling:

```text
https://funint.online
```

For Android emulator local development, use:

```text
API_BASE_URL=http://10.0.2.2:8000/api
SIGNALING_URL=http://10.0.2.2:8000
```

## Client Deliverables

Send these files to a native Android client:

- `mobile/build/agora-manager/outputs/aar/agora-manager-release.aar`
- `mobile/SDK_INTEGRATION.md`
- `mobile/CLIENT_REQUIREMENTS_AND_FLUTTER_BUILD.md`
- Public API contract: endpoint list, request examples, response examples, and error codes

Send this file to a Flutter client that wants the API wrapper:

- `mobile/lib/sdk/rtc_enterprise_client_sdk.dart`

Do not send backend source files unless the client will self-host the backend or needs source review under NDA.

## Required Client Credentials

Each client-company app needs:

- API base URL: `https://funint.online/api`
- Signaling URL: `https://funint.online`
- Client app API key from the service console
- Agora App ID
- Agora RTC token support from the backend

Do not put a service-admin or platform-admin secret in a public mobile build. If a direct mobile SDK integration is used, the key must be a scoped, revocable client-app key.

## Admin Naming Requirement

Use these terms in client docs and UI:

- Platform service admin: manages the TalkEachOther platform, companies, packages, credentials, and billing.
- Company service admin: manages one client company's RTC service, app access, rooms, users, and usage.
- Room admin: in-room RTC moderation role. The API value is still `admin`, but SDK/UI should display this as room admin.

## Backend API Requirements

The SDK calls the public client API under `/api/client/*`:

```text
GET    /api/client/me
POST   /api/client/users/sync
GET    /api/client/users/:externalUserId
GET    /api/client/rooms
POST   /api/client/rooms
GET    /api/client/rooms/:roomId
PATCH  /api/client/rooms/:roomId
PATCH  /api/client/rooms/:roomId/status
POST   /api/client/rooms/:roomId/disable
DELETE /api/client/rooms/:roomId
POST   /api/client/rtc/token
POST   /api/client/rtc/session/start
POST   /api/client/rtc/session/end
```

Every client API request must include:

```text
x-rtc-api-key: CLIENT_APP_API_KEY
Accept: application/json
Content-Type: application/json
```

Native Agora media join requires the token response to include a real Agora RTC token, such as:

```json
{
  "agora_rtc_token": "..."
}
```

The platform `rtc_token` must not be reused as the Agora media token.

## Mobile App Functional Requirements

Build these flows from the 100-frame reference set:

- App start and authenticated company context.
- Room list and room details.
- External user sync before join.
- Room create/fetch before join.
- Token issue before media join.
- Session start before media join.
- Large active speaker or shared-screen area.
- Local preview tile.
- Remote participant tiles.
- Microphone mute/unmute.
- Camera on/off.
- Speaker/audio route controls.
- Screen-share viewing and, where supported, screen-share publishing.
- Chat/notification surfaces.
- Participant list with room-admin controls.
- Room role handling for audience, publisher, moderator, room admin, and owner.
- Leave room with session end tracking.
- Error states for missing permissions, expired token, disabled room, inactive user, and network failure.

## Android Requirements

Minimum requirements for the native Android SDK:

- Android minSdk: 24 or higher
- Java/Kotlin JVM target: 17
- Agora SDK: `io.agora.rtc:full-sdk:4.2.3`
- OkHttp: `com.squareup.okhttp3:okhttp:4.9.3`
- AndroidX enabled

Required permissions:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

If the app targets newer Android versions and uses Bluetooth audio devices or screen capture, add the relevant runtime permission handling in the host app.

## Native Android SDK Integration

Add the AAR to the client app:

```text
app/libs/agora-manager-release.aar
```

Add Gradle dependencies:

```kotlin
dependencies {
    implementation(files("libs/agora-manager-release.aar"))
    implementation("io.agora.rtc:full-sdk:4.2.3")
    implementation("com.squareup.okhttp3:okhttp:4.9.3")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.9.0")
}
```

Initialize the SDK:

```kotlin
val sdk = RtcEnterpriseAndroidSdk(
    context = this,
    apiBaseUrl = "https://funint.online/api",
    clientApiKey = clientAppApiKey,
    agoraAppId = agoraAppId,
)
```

Before joining media, request camera and microphone permissions from the host app.

## Flutter Project Build Steps

From the repo root:

```bash
cd mobile
flutter pub get
```

Run on an Android emulator against the local backend:

```bash
flutter run -d emulator-5554 \
  --dart-define=API_BASE_URL=http://10.0.2.2:8000/api \
  --dart-define=SIGNALING_URL=http://10.0.2.2:8000
```

Run on an Android emulator against production:

```bash
flutter run -d emulator-5554 \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Build a release APK:

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Build a release app bundle:

```bash
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://funint.online/api \
  --dart-define=SIGNALING_URL=https://funint.online
```

Release outputs:

```text
mobile/build/app/outputs/flutter-apk/app-release.apk
mobile/build/app/outputs/bundle/release/app-release.aab
```

The current Android Flutter project includes the Android SDK module through:

```text
mobile/android/settings.gradle.kts
mobile/android/app/build.gradle.kts
```

## Android SDK Package Build Steps

Build the native SDK AAR from the Flutter Android project:

```bash
cd mobile/android
./gradlew :agora-manager:assembleRelease --no-daemon
```

Expected output:

```text
mobile/build/agora-manager/outputs/aar/agora-manager-release.aar
```

Build a debug SDK package when testing locally:

```bash
cd mobile/android
./gradlew :agora-manager:assembleDebug --no-daemon
```

Expected output:

```text
mobile/build/agora-manager/outputs/aar/agora-manager-debug.aar
```

## Verification Steps

Verify the extracted 100-frame reference set:

```bash
bash mobile/sdk_reference/scripts/verify_100_frame_set.sh
```

Verify Android SDK planning phases:

```bash
bash mobile/sdk_reference/scripts/verify_phase2_android_sdk_foundation.sh
bash mobile/sdk_reference/scripts/verify_phase3_media_reliability.sh
bash mobile/sdk_reference/scripts/verify_phase4_sdk_build_package.sh
bash mobile/sdk_reference/scripts/verify_phase5_contract_integration_tests.sh
```

Verify Flutter code:

```bash
cd mobile
flutter analyze
flutter test
```

Verify Android build:

```bash
cd mobile/android
./gradlew :agora-manager:compileDebugKotlin :app:assembleDebug --no-daemon
```

Verify SDK runtime loading on emulator:

```bash
adb logcat -c
flutter run -d emulator-5554 --debug --no-resident
adb logcat -d | rg "RtcSdkSmoke|FATAL EXCEPTION|AndroidRuntime"
```

Expected SDK smoke log:

```text
RtcEnterpriseAndroidSdk loaded; fullMediaPermissions=true
```

## Client Acceptance Checklist

- Backend health check returns OK from `https://funint.online/api/health`.
- Client API key works with `GET /api/client/me`.
- External user sync succeeds.
- Room list/create/fetch succeeds.
- Token issue succeeds and includes an Agora RTC media token.
- Android permission prompt appears before camera/microphone use.
- User can join a video room.
- Local preview renders.
- Remote participant video/audio renders.
- Microphone mute/unmute works.
- Camera on/off works.
- Screen-share viewing works.
- Room admin controls are visible only to allowed roles.
- Leaving the room calls session end.
- App handles offline, expired token, disabled room, and permission-denied states.
