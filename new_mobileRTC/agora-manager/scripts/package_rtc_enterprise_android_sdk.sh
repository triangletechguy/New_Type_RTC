#!/usr/bin/env bash
set -euo pipefail

SDK_MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RTC_ROOT_DIR="$(cd "$SDK_MODULE_DIR/../.." && pwd)"
REFERENCE_APP_DIR="${REFERENCE_APP_DIR:-$SDK_MODULE_DIR/../android-reference-app}"
DIST_DIR="${DIST_DIR:-$SDK_MODULE_DIR/dist}"
SDK_VERSION="${SDK_VERSION:-0.1.0}"
SDK_MODULE_NAME="${SDK_MODULE_NAME:-agora-manager}"
BUILD_SCRIPT="$SDK_MODULE_DIR/scripts/build_rtc_enterprise_android_sdk.sh"
AAR_SOURCE="$SDK_MODULE_DIR/build/outputs/aar/$SDK_MODULE_NAME-release.aar"
AAR_BASENAME="rtc-enterprise-android-sdk-$SDK_VERSION.aar"
AAR_OUTPUT="$DIST_DIR/$AAR_BASENAME"
SHA_OUTPUT="$AAR_OUTPUT.sha256"
MANIFEST_BASENAME="rtc-enterprise-android-sdk-$SDK_VERSION.json"
MANIFEST_OUTPUT="$DIST_DIR/$MANIFEST_BASENAME"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Package the Android RTC Enterprise SDK release AAR.

Usage:
  package_rtc_enterprise_android_sdk.sh

Environment:
  SDK_VERSION       Release version. Defaults to 0.1.0.
  DIST_DIR          Output directory. Defaults to new_mobileRTC/agora-manager/dist.
  SKIP_BUILD=1      Reuse an existing release AAR instead of running the build script.
  BUILD_TASKS       Gradle tasks used when SKIP_BUILD is not set. Defaults to :agora-manager:assembleRelease.
  REFERENCE_APP_DIR Android reference app root. Defaults to ../android-reference-app.
USAGE
  exit 0
fi

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
}

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf '%s' "$value"
}

json_array() {
  local first=1
  printf '['
  for item in "$@"; do
    if [[ "$first" -eq 0 ]]; then
      printf ', '
    fi
    first=0
    printf '"%s"' "$(json_escape "$item")"
  done
  printf ']'
}

property_value() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    printf 'unknown'
    return
  fi
  awk -F= -v key="$key" '$1 == key { print $2; found=1; exit } END { if (!found) print "unknown" }' "$file"
}

gradle_plugin_version() {
  local plugin_id="$1"
  local file="$REFERENCE_APP_DIR/build.gradle"
  if [[ ! -f "$file" ]]; then
    printf 'unknown'
    return
  fi
  sed -n "s/.*id '$plugin_id' version '\\([^']*\\)'.*/\\1/p" "$file" | head -n 1
}

android_config_value() {
  local key="$1"
  sed -n "s/^[[:space:]]*$key[[:space:]]\\+\\([0-9][0-9]*\\).*/\\1/p" "$SDK_MODULE_DIR/build.gradle" | head -n 1
}

git_value() {
  git -C "$RTC_ROOT_DIR" "$@" 2>/dev/null || true
}

require_command awk
require_command date
require_command git
require_command sha256sum

if [[ "$SDK_VERSION" =~ [^A-Za-z0-9._+-] || -z "$SDK_VERSION" ]]; then
  echo "SDK_VERSION must contain only letters, numbers, dot, underscore, plus, or dash." >&2
  exit 1
fi

if [[ -n "${BUILD_TASKS:-}" ]]; then
  read -r -a BUILD_TASK_ARRAY <<< "$BUILD_TASKS"
else
  BUILD_TASK_ARRAY=(":$SDK_MODULE_NAME:assembleRelease")
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  "$BUILD_SCRIPT" "${BUILD_TASK_ARRAY[@]}"
fi

if [[ ! -f "$AAR_SOURCE" ]]; then
  echo "Release AAR not found: $AAR_SOURCE" >&2
  echo "Run the build script first, or pass SKIP_BUILD=0 with a supported Java version." >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
cp "$AAR_SOURCE" "$AAR_OUTPUT"

SHA256_VALUE="$(sha256sum "$AAR_OUTPUT" | awk '{ print $1 }')"
printf '%s  %s\n' "$SHA256_VALUE" "$AAR_BASENAME" > "$SHA_OUTPUT"

SOURCE_COMMIT="$(git_value rev-parse --short=12 HEAD)"
if [[ -z "$SOURCE_COMMIT" ]]; then
  SOURCE_COMMIT="unknown"
fi

if [[ -n "$(git_value status --porcelain)" ]]; then
  SOURCE_DIRTY=true
else
  SOURCE_DIRTY=false
fi

BUILT_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
JAVA_VERSION_LINE="$(java -version 2>&1 | head -n 1 || true)"
GRADLE_DISTRIBUTION="$(property_value "$REFERENCE_APP_DIR/gradle/wrapper/gradle-wrapper.properties" "distributionUrl")"
AGORA_SDK_VERSION="$(property_value "$REFERENCE_APP_DIR/gradle.properties" "agoraSDKVersion")"
AGP_VERSION="$(gradle_plugin_version "com.android.library")"
KOTLIN_PLUGIN_VERSION="$(gradle_plugin_version "org.jetbrains.kotlin.android")"
COMPILE_SDK="$(android_config_value compileSdk)"
MIN_SDK="$(android_config_value minSdk)"
TARGET_SDK="$(android_config_value targetSdk)"

cat > "$MANIFEST_OUTPUT" <<JSON
{
  "name": "rtc-enterprise-android-sdk",
  "version": "$(json_escape "$SDK_VERSION")",
  "module": "new_mobileRTC/agora-manager",
  "entrypoint": "io.agora.agora_manager.RtcEnterpriseAndroidSdk",
  "artifact": {
    "aar": "$(json_escape "$AAR_BASENAME")",
    "sha256_file": "$(json_escape "$(basename "$SHA_OUTPUT")")",
    "sha256": "$(json_escape "$SHA256_VALUE")"
  },
  "build": {
    "built_at_utc": "$(json_escape "$BUILT_AT_UTC")",
    "source_commit": "$(json_escape "$SOURCE_COMMIT")",
    "source_dirty": $SOURCE_DIRTY,
    "java": "$(json_escape "$JAVA_VERSION_LINE")",
    "gradle_distribution": "$(json_escape "$GRADLE_DISTRIBUTION")",
    "android_gradle_plugin_version": "$(json_escape "$AGP_VERSION")",
    "kotlin_plugin_version": "$(json_escape "$KOTLIN_PLUGIN_VERSION")",
    "agora_sdk_version": "$(json_escape "$AGORA_SDK_VERSION")",
    "compile_sdk": "$(json_escape "$COMPILE_SDK")",
    "min_sdk": "$(json_escape "$MIN_SDK")",
    "target_sdk": "$(json_escape "$TARGET_SDK")",
    "tasks": $(json_array "${BUILD_TASK_ARRAY[@]}")
  }
}
JSON

(
  cd "$DIST_DIR"
  sha256sum -c "$(basename "$SHA_OUTPUT")"
)

echo "SDK AAR: $AAR_OUTPUT"
echo "SHA256: $SHA_OUTPUT"
echo "Manifest: $MANIFEST_OUTPUT"
