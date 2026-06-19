# Phase 9 - Flutter Release Build

This phase builds the Flutter Android APK and AAB release artifacts for the RTC Enterprise mobile app.

## Scope

- Build release APK.
- Build release AAB.
- Record artifact size and SHA-256 hashes.
- Keep the 100-frame reference verification in the release build workflow.

## Script

Run from the repository root:

```bash
bash mobile/sdk_reference/scripts/verify_phase9_flutter_release_build.sh
```

Defaults:

```text
API_BASE_URL=https://funint.online/api
SIGNALING_URL=https://funint.online
```

Override backend URLs:

```bash
API_BASE_URL=https://funint.online/api \
SIGNALING_URL=https://funint.online \
bash mobile/sdk_reference/scripts/verify_phase9_flutter_release_build.sh
```

Skip static checks when you only need to rebuild artifacts:

```bash
SKIP_STATIC_CHECKS=1 \
bash mobile/sdk_reference/scripts/verify_phase9_flutter_release_build.sh
```

## Build Outputs

Flutter output paths:

```text
mobile/build/app/outputs/flutter-apk/app-release.apk
mobile/build/app/outputs/bundle/release/app-release.aab
```

Copied evidence paths:

```text
mobile/sdk_reference/phase9_release/app-release.apk
mobile/sdk_reference/phase9_release/app-release.aab
mobile/sdk_reference/phase9_release/phase9_release_summary.txt
```

## Signing Note

Current Android config signs release builds with the debug signing config:

```text
mobile/android/app/build.gradle.kts
```

This is acceptable for local QA installation, but not for Play Store or production client distribution. Before production release, configure a real keystore and signing properties.

## Release Shrinker Note

The Android release build uses R8. OkHttp references optional TLS providers by reflection, so the app includes narrow release rules here:

```text
mobile/android/app/proguard-rules.pro
```

These rules suppress missing-class failures for optional BouncyCastle, Conscrypt, and OpenJSSE providers.

## Verification Checklist

- 100-frame reference set verifies.
- `flutter analyze` passes.
- `flutter test` passes.
- APK release build succeeds.
- AAB release build succeeds.
- SHA-256 hashes are recorded.

## Current Verification

Generated artifacts:

```text
mobile/build/app/outputs/flutter-apk/app-release.apk
mobile/build/app/outputs/bundle/release/app-release.aab
mobile/sdk_reference/phase9_release/app-release.apk
mobile/sdk_reference/phase9_release/app-release.aab
mobile/sdk_reference/phase9_release/phase9_release_summary.txt
```

Sizes:

```text
app-release.apk 278M
app-release.aab 184M
```

SHA-256:

```text
app-release.apk 1b7064f5e447bc29b0afa706af10b16ac647ad2f32ad4fd281a0bf1a3a2e0a68
app-release.aab f8fd0dcaf4018b0bf8be55191ad91797d3d7f84b9d7ef797af46f183e9a1ad87
```

Status:

- 100-frame reference verification passed.
- `flutter analyze` passed.
- `flutter test` passed.
- Release APK build passed.
- Release AAB build passed.
- Gradle emitted a future Kotlin Gradle Plugin migration warning for `agora-manager` and `flutter_webrtc`; this did not block the current release build.
