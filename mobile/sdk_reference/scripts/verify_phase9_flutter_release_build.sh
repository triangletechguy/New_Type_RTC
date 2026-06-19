#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile"
OUTPUT_DIR="${OUTPUT_DIR:-$MOBILE_DIR/sdk_reference/phase9_release}"
API_BASE_URL="${API_BASE_URL:-https://funint.online/api}"
SIGNALING_URL="${SIGNALING_URL:-https://funint.online}"
SKIP_STATIC_CHECKS="${SKIP_STATIC_CHECKS:-0}"

APK_PATH="$MOBILE_DIR/build/app/outputs/flutter-apk/app-release.apk"
AAB_PATH="$MOBILE_DIR/build/app/outputs/bundle/release/app-release.aab"
SUMMARY_PATH="$OUTPUT_DIR/phase9_release_summary.txt"

mkdir -p "$OUTPUT_DIR"

{
  echo "Phase 9 Flutter release build"
  echo "Generated: $(date -Is)"
  echo "Workspace: $ROOT_DIR"
  echo "API_BASE_URL: $API_BASE_URL"
  echo "SIGNALING_URL: $SIGNALING_URL"
  echo
  echo "Note: mobile/android/app/build.gradle.kts currently signs release with the debug signing config."
  echo "Use a production keystore before Play Store or client production distribution."
  echo
} > "$SUMMARY_PATH"

"$MOBILE_DIR/sdk_reference/scripts/verify_100_frame_set.sh" | tee -a "$SUMMARY_PATH"

if [[ "$SKIP_STATIC_CHECKS" != "1" ]]; then
  {
    echo
    echo "Running flutter analyze..."
  } | tee -a "$SUMMARY_PATH"
  (cd "$MOBILE_DIR" && flutter analyze) | tee -a "$SUMMARY_PATH"

  {
    echo
    echo "Running flutter test..."
  } | tee -a "$SUMMARY_PATH"
  (cd "$MOBILE_DIR" && flutter test) | tee -a "$SUMMARY_PATH"
fi

{
  echo
  echo "Building release APK..."
} | tee -a "$SUMMARY_PATH"
(cd "$MOBILE_DIR" && flutter build apk --release \
  --dart-define=API_BASE_URL="$API_BASE_URL" \
  --dart-define=SIGNALING_URL="$SIGNALING_URL") | tee -a "$SUMMARY_PATH"

{
  echo
  echo "Building release AAB..."
} | tee -a "$SUMMARY_PATH"
(cd "$MOBILE_DIR" && flutter build appbundle --release \
  --dart-define=API_BASE_URL="$API_BASE_URL" \
  --dart-define=SIGNALING_URL="$SIGNALING_URL") | tee -a "$SUMMARY_PATH"

if [[ ! -f "$APK_PATH" ]]; then
  echo "Missing APK output: $APK_PATH" >&2
  exit 1
fi

if [[ ! -f "$AAB_PATH" ]]; then
  echo "Missing AAB output: $AAB_PATH" >&2
  exit 1
fi

cp "$APK_PATH" "$OUTPUT_DIR/app-release.apk"
cp "$AAB_PATH" "$OUTPUT_DIR/app-release.aab"

{
  echo
  echo "Release artifacts:"
  ls -lh "$APK_PATH" "$AAB_PATH"
  echo
  echo "Copied artifacts:"
  ls -lh "$OUTPUT_DIR/app-release.apk" "$OUTPUT_DIR/app-release.aab"
  echo
  echo "SHA-256:"
  sha256sum "$APK_PATH" "$AAB_PATH" "$OUTPUT_DIR/app-release.apk" "$OUTPUT_DIR/app-release.aab"
} | tee -a "$SUMMARY_PATH"
