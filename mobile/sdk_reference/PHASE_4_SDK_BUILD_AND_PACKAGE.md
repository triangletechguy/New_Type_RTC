# Phase 4 SDK Build And Package

Phase 4 turns the Android RTC SDK module into a repeatable build artifact. The SDK remains headless; this phase only covers scripts, CI, artifact metadata, and release verification.

## Scripts

Build:

```bash
bash new_mobileRTC/agora-manager/scripts/build_rtc_enterprise_android_sdk.sh
```

Default build tasks:

```text
:agora-manager:compileDebugKotlin
:agora-manager:assembleRelease
```

Package:

```bash
bash new_mobileRTC/agora-manager/scripts/package_rtc_enterprise_android_sdk.sh
```

Default package outputs:

```text
new_mobileRTC/agora-manager/dist/rtc-enterprise-android-sdk-0.1.0.aar
new_mobileRTC/agora-manager/dist/rtc-enterprise-android-sdk-0.1.0.aar.sha256
new_mobileRTC/agora-manager/dist/rtc-enterprise-android-sdk-0.1.0.json
```

## Toolchain Rule

The current Android sample uses:

- Gradle 7.4
- Android Gradle Plugin 7.3.1
- Kotlin plugin 1.8.10
- Agora Android SDK 4.2.3

Build with Java 11 or Java 17. The build script intentionally stops on Java 21 unless `ALLOW_UNSUPPORTED_JAVA=1` is set after upgrading Gradle/AGP.

## Package Manifest

The package script writes a JSON manifest beside the AAR. It records:

- SDK package name and version
- AAR filename
- SHA256 checksum file and checksum value
- SDK entrypoint
- UTC build timestamp
- source commit
- dirty source-tree flag
- Java, Gradle, Android Gradle Plugin, Kotlin, Agora, compile SDK, min SDK, and target SDK versions
- Gradle task list used for the package

The script verifies the generated `.sha256` file with `sha256sum -c` before reporting success.

## CI

The workflow is:

```text
.github/workflows/android-rtc-sdk.yml
```

It uses Java 17, runs the phase verifiers, builds the SDK, packages the AAR, and uploads `new_mobileRTC/agora-manager/dist/` as a workflow artifact.

## Useful Environment Variables

Build script:

- `REFERENCE_APP_DIR`: override the Android reference app root.
- `SDK_MODULE_NAME`: override the Gradle module name.
- `GRADLE_ARGS`: pass extra Gradle args such as `--stacktrace --info`.
- `BUILD_LOG_DIR`: write a Gradle output log.
- `ALLOW_UNSUPPORTED_JAVA=1`: bypass the Java 21 guard after upgrading Gradle/AGP.

Package script:

- `SDK_VERSION`: release version used in artifact names.
- `DIST_DIR`: output directory.
- `SKIP_BUILD=1`: reuse an existing release AAR.
- `BUILD_TASKS`: override the Gradle tasks run before packaging.

## Acceptance

Run:

```bash
bash mobile/sdk_reference/scripts/verify_phase4_sdk_build_package.sh
```

Then, with Java 11 or 17:

```bash
bash new_mobileRTC/agora-manager/scripts/build_rtc_enterprise_android_sdk.sh
bash new_mobileRTC/agora-manager/scripts/package_rtc_enterprise_android_sdk.sh
```

On this machine, Java 21 triggers the expected toolchain guard before Gradle runs.
