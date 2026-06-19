#!/usr/bin/env bash
set -euo pipefail

SDK_MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RTC_ROOT_DIR="$(cd "$SDK_MODULE_DIR/../.." && pwd)"
REFERENCE_APP_DIR="${REFERENCE_APP_DIR:-$SDK_MODULE_DIR/../android-reference-app}"
SDK_MODULE_NAME="${SDK_MODULE_NAME:-agora-manager}"
WRAPPER="$REFERENCE_APP_DIR/gradlew"
SETTINGS_FILE="$REFERENCE_APP_DIR/settings.gradle"
SDK_ENTRYPOINT="$SDK_MODULE_DIR/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt"
BUILD_LOG_DIR="${BUILD_LOG_DIR:-}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Build the Android RTC Enterprise SDK module.

Usage:
  build_rtc_enterprise_android_sdk.sh [gradle-task ...]

Default tasks:
  :agora-manager:compileDebugKotlin :agora-manager:assembleRelease

Environment:
  REFERENCE_APP_DIR          Android reference app root. Defaults to ../android-reference-app.
  SDK_MODULE_NAME            Gradle module name. Defaults to agora-manager.
  GRADLE_ARGS                Extra Gradle args, for example "--stacktrace --info".
  BUILD_LOG_DIR              Optional directory for a Gradle output log.
  ALLOW_UNSUPPORTED_JAVA=1   Bypass the Java 21 guard after upgrading Gradle/AGP.
USAGE
  exit 0
fi

if [[ $# -gt 0 ]]; then
  TASKS=("$@")
else
  TASKS=(":$SDK_MODULE_NAME:compileDebugKotlin" ":$SDK_MODULE_NAME:assembleRelease")
fi

read -r -a EXTRA_GRADLE_ARGS <<< "${GRADLE_ARGS:-}"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
}

java_major_version() {
  local version_line
  version_line="$(java -version 2>&1 | head -n 1)"
  if [[ "$version_line" =~ \"1\.([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return
  fi
  if [[ "$version_line" =~ \"([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return
  fi
  printf '0\n'
}

require_command java
require_command sed
require_command mktemp

if [[ ! -f "$WRAPPER" ]]; then
  echo "Gradle wrapper not found: $WRAPPER" >&2
  exit 1
fi

if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "Gradle settings file not found: $SETTINGS_FILE" >&2
  exit 1
fi

if ! grep -q "project(':$SDK_MODULE_NAME')" "$SETTINGS_FILE"; then
  echo "Gradle module :$SDK_MODULE_NAME is not mapped in $SETTINGS_FILE" >&2
  exit 1
fi

if [[ ! -f "$SDK_ENTRYPOINT" ]]; then
  echo "SDK entrypoint not found: $SDK_ENTRYPOINT" >&2
  exit 1
fi

JAVA_MAJOR="$(java_major_version)"
if [[ "$JAVA_MAJOR" -ge 21 && "${ALLOW_UNSUPPORTED_JAVA:-0}" != "1" ]]; then
  echo "This Android sample uses Gradle 7.4 / AGP 7.3.1 and does not run on Java $JAVA_MAJOR." >&2
  echo "Use Java 11 or 17, or set ALLOW_UNSUPPORTED_JAVA=1 if you upgraded Gradle/AGP." >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

sed 's/\r$//' "$WRAPPER" > "$TMP_DIR/gradlew"
chmod +x "$TMP_DIR/gradlew"

echo "RTC root: $RTC_ROOT_DIR"
echo "SDK module: $SDK_MODULE_DIR"
echo "Reference app: $REFERENCE_APP_DIR"
echo "SDK entrypoint: $SDK_ENTRYPOINT"
echo "Java: $(java -version 2>&1 | head -n 1)"
echo "Gradle tasks: ${TASKS[*]}"
if [[ "${#EXTRA_GRADLE_ARGS[@]}" -gt 0 ]]; then
  echo "Extra Gradle args: ${EXTRA_GRADLE_ARGS[*]}"
fi

run_gradle() {
  (
    cd "$REFERENCE_APP_DIR"
    "$TMP_DIR/gradlew" --no-daemon "${TASKS[@]}" "${EXTRA_GRADLE_ARGS[@]}"
  )
}

if [[ -n "$BUILD_LOG_DIR" ]]; then
  mkdir -p "$BUILD_LOG_DIR"
  LOG_FILE="$BUILD_LOG_DIR/rtc-enterprise-android-sdk-build.log"
  run_gradle 2>&1 | tee "$LOG_FILE"
  echo "Build log: $LOG_FILE"
else
  run_gradle
fi
