#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile"
OUTPUT_DIR="${OUTPUT_DIR:-$MOBILE_DIR/sdk_reference/phase8_evidence}"
CONTACT_SHEET="${CONTACT_SHEET:-$MOBILE_DIR/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg}"
SCREENSHOT_PATH="${SCREENSHOT_PATH:-$OUTPUT_DIR/rtc_mobile_current.png}"
SUMMARY_PATH="$OUTPUT_DIR/phase8_summary.txt"
HTML_PATH="$OUTPUT_DIR/reference_compare.html"
DEVICE_ID="${DEVICE_ID:-}"
REQUIRE_DEVICE="${REQUIRE_DEVICE:-0}"
SKIP_FLUTTER_CHECKS="${SKIP_FLUTTER_CHECKS:-0}"

mkdir -p "$OUTPUT_DIR"

{
  echo "Phase 8 Flutter reference QA"
  echo "Generated: $(date -Is)"
  echo "Workspace: $ROOT_DIR"
  echo
} > "$SUMMARY_PATH"

"$MOBILE_DIR/sdk_reference/scripts/verify_100_frame_set.sh" | tee -a "$SUMMARY_PATH"

if [[ "$SKIP_FLUTTER_CHECKS" != "1" ]]; then
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

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not available; emulator screenshot capture skipped." | tee -a "$SUMMARY_PATH"
  [[ "$REQUIRE_DEVICE" == "1" ]] && exit 1
  exit 0
fi

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(adb devices | awk '$2 == "device" { print $1; exit }')"
fi

if [[ -z "$DEVICE_ID" ]]; then
  {
    echo
    echo "No authorized adb device found; screenshot capture skipped."
    echo "Start an emulator, then rerun:"
    echo "DEVICE_ID=<device-id> bash mobile/sdk_reference/scripts/verify_phase8_flutter_reference.sh"
  } | tee -a "$SUMMARY_PATH"
  [[ "$REQUIRE_DEVICE" == "1" ]] && exit 1
  exit 0
fi

{
  echo
  echo "Capturing screenshot from device: $DEVICE_ID"
} | tee -a "$SUMMARY_PATH"

adb -s "$DEVICE_ID" exec-out screencap -p > "$SCREENSHOT_PATH"

cat > "$HTML_PATH" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phase 8 RTC Mobile Reference Compare</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #0a1020; color: #f8fafc; }
    main { padding: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; align-items: start; }
    figure { margin: 0; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 12px; }
    img { width: 100%; height: auto; display: block; border-radius: 6px; background: #111827; }
    figcaption { margin-top: 10px; font-weight: 700; color: #d7e0ef; }
    code { color: #34d399; }
  </style>
</head>
<body>
  <main>
    <h1>Phase 8 RTC Mobile Reference Compare</h1>
    <p>Captured device: <code>$DEVICE_ID</code></p>
    <div class="grid">
      <figure>
        <img src="$SCREENSHOT_PATH" alt="Current emulator screenshot">
        <figcaption>Current emulator screenshot</figcaption>
      </figure>
      <figure>
        <img src="$CONTACT_SHEET" alt="100-frame mobile RTC reference sheet">
        <figcaption>100-frame reference contact sheet</figcaption>
      </figure>
    </div>
  </main>
</body>
</html>
HTML

{
  echo "Screenshot: $SCREENSHOT_PATH"
  echo "Comparison HTML: $HTML_PATH"
} | tee -a "$SUMMARY_PATH"
