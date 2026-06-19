#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SDK_MODULE_DIR="$ROOT_DIR/new_mobileRTC/agora-manager"
BUILD_SCRIPT="$SDK_MODULE_DIR/scripts/build_rtc_enterprise_android_sdk.sh"
PACKAGE_SCRIPT="$SDK_MODULE_DIR/scripts/package_rtc_enterprise_android_sdk.sh"
SDK_FILE="$SDK_MODULE_DIR/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt"
REFERENCE_APP_DIR="$ROOT_DIR/new_mobileRTC/android-reference-app"
CI_WORKFLOW="$ROOT_DIR/.github/workflows/android-rtc-sdk.yml"

require_file() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    echo "Missing $label: $file" >&2
    exit 1
  fi
}

require_pattern() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if ! grep -q "$pattern" "$file"; then
    echo "Missing $label in $file" >&2
    exit 1
  fi
}

require_file "$BUILD_SCRIPT" "Android SDK build script"
require_file "$PACKAGE_SCRIPT" "Android SDK package script"
require_file "$SDK_FILE" "Android SDK entrypoint"
require_file "$REFERENCE_APP_DIR/gradlew" "Gradle wrapper"
require_file "$REFERENCE_APP_DIR/settings.gradle" "Gradle settings"
require_file "$REFERENCE_APP_DIR/gradle/wrapper/gradle-wrapper.properties" "Gradle wrapper properties"

bash -n "$BUILD_SCRIPT"
bash -n "$PACKAGE_SCRIPT"

require_pattern "$BUILD_SCRIPT" "ALLOW_UNSUPPORTED_JAVA" "Java compatibility guard"
require_pattern "$BUILD_SCRIPT" "compileDebugKotlin" "Kotlin compile task"
require_pattern "$BUILD_SCRIPT" "assembleRelease" "release assemble task"
require_pattern "$BUILD_SCRIPT" "sed 's/\\\\r\\$//'" "Gradle wrapper CRLF normalization"
require_pattern "$BUILD_SCRIPT" "BUILD_LOG_DIR" "optional build log directory"
require_pattern "$BUILD_SCRIPT" 'project('\'':\$SDK_MODULE_NAME'\'')' "module mapping check"

require_pattern "$PACKAGE_SCRIPT" "SDK_VERSION" "versioned artifact control"
require_pattern "$PACKAGE_SCRIPT" 'rtc-enterprise-android-sdk-\$SDK_VERSION.aar' "versioned AAR name"
require_pattern "$PACKAGE_SCRIPT" "sha256sum -c" "checksum verification"
require_pattern "$PACKAGE_SCRIPT" "source_commit" "source commit manifest field"
require_pattern "$PACKAGE_SCRIPT" "source_dirty" "dirty tree manifest field"
require_pattern "$PACKAGE_SCRIPT" "built_at_utc" "build timestamp manifest field"
require_pattern "$PACKAGE_SCRIPT" "android_gradle_plugin_version" "AGP manifest field"
require_pattern "$PACKAGE_SCRIPT" "kotlin_plugin_version" "Kotlin manifest field"
require_pattern "$PACKAGE_SCRIPT" "agora_sdk_version" "Agora SDK manifest field"
require_pattern "$PACKAGE_SCRIPT" "io.agora.agora_manager.RtcEnterpriseAndroidSdk" "SDK entrypoint manifest field"

if [[ -f "$CI_WORKFLOW" ]]; then
  require_pattern "$CI_WORKFLOW" "setup-java" "Java setup in CI workflow"
  require_pattern "$CI_WORKFLOW" "java-version: '17'" "Java 17 CI toolchain"
  require_pattern "$CI_WORKFLOW" "verify_phase4_sdk_build_package.sh" "Phase 4 verifier in CI workflow"
  require_pattern "$CI_WORKFLOW" "build_rtc_enterprise_android_sdk.sh" "SDK build in CI workflow"
  require_pattern "$CI_WORKFLOW" "package_rtc_enterprise_android_sdk.sh" "SDK package in CI workflow"
fi

DIST_DIR="$SDK_MODULE_DIR/dist"
if [[ -d "$DIST_DIR" ]] && compgen -G "$DIST_DIR/*.sha256" >/dev/null; then
  (
    cd "$DIST_DIR"
    for checksum in *.sha256; do
      sha256sum -c "$checksum"
    done
  )
fi

echo "Verified Phase 4 SDK build/package scripts."
