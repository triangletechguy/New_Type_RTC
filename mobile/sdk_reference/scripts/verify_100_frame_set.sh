#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FRAME_SET_DIR="${FRAME_SET_DIR:-$ROOT_DIR/mobile/sdk_reference/frames_100}"
CONTACT_SHEET="${CONTACT_SHEET:-$ROOT_DIR/mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg}"
EXPECTED_FRAME_COUNT="${EXPECTED_FRAME_COUNT:-100}"

if [[ ! -d "$FRAME_SET_DIR" ]]; then
  echo "Frame directory not found: $FRAME_SET_DIR" >&2
  exit 1
fi

actual_count="$(find "$FRAME_SET_DIR" -maxdepth 1 -type f -name 'frame_*.jpg' | wc -l | tr -d ' ')"
if [[ "$actual_count" != "$EXPECTED_FRAME_COUNT" ]]; then
  echo "Expected $EXPECTED_FRAME_COUNT frames, found $actual_count in $FRAME_SET_DIR" >&2
  exit 1
fi

if [[ ! -f "$FRAME_SET_DIR/index.tsv" ]]; then
  echo "Missing frame index: $FRAME_SET_DIR/index.tsv" >&2
  exit 1
fi

if [[ ! -f "$CONTACT_SHEET" ]]; then
  echo "Missing 100-frame contact sheet: $CONTACT_SHEET" >&2
  exit 1
fi

for idx in $(seq -f '%03g' 1 "$EXPECTED_FRAME_COUNT"); do
  if [[ ! -f "$FRAME_SET_DIR/frame_$idx.jpg" ]]; then
    echo "Missing frame: $FRAME_SET_DIR/frame_$idx.jpg" >&2
    exit 1
  fi
done

echo "Verified $actual_count frames"
echo "Frame index: $FRAME_SET_DIR/index.tsv"
echo "Contact sheet: $CONTACT_SHEET"
