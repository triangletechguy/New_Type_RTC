#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE_VIDEO="${SOURCE_VIDEO:-$ROOT_DIR/new_mobile_RTC.mp4}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/mobile/sdk_reference}"
STORYBOARD_DIR="$OUTPUT_DIR/frames"
FRAME_SET_DIR="${FRAME_SET_DIR:-$OUTPUT_DIR/frames_100}"
IMAGE_DIR="$OUTPUT_DIR/images"
STORYBOARD_IMAGE="$IMAGE_DIR/new_mobile_RTC_reference_sheet.jpg"
CONTACT_SHEET_100="$IMAGE_DIR/new_mobile_RTC_100_contact_sheet.jpg"
FRAME_COUNT="${FRAME_COUNT:-100}"
FRAME_WIDTH="${FRAME_WIDTH:-640}"
CONTACT_WIDTH="${CONTACT_WIDTH:-320}"
JPEG_QUALITY="${JPEG_QUALITY:-3}"
FFMPEG_BIN="${FFMPEG_BIN:-}"
GENERATE_STORYBOARD="${GENERATE_STORYBOARD:-1}"
GENERATE_FRAME_SET="${GENERATE_FRAME_SET:-1}"

find_ffmpeg() {
  if [[ -n "$FFMPEG_BIN" && -x "$FFMPEG_BIN" ]]; then
    printf '%s\n' "$FFMPEG_BIN"
    return
  fi

  if command -v ffmpeg >/dev/null 2>&1; then
    command -v ffmpeg
    return
  fi

  local cached_bin="/tmp/rtc-ffmpeg-1Eo9p4/node_modules/ffmpeg-static/ffmpeg"
  if [[ -x "$cached_bin" ]]; then
    printf '%s\n' "$cached_bin"
    return
  fi

  local tmp_ffmpeg_dir="${TMP_FFMPEG_DIR:-/tmp/rtc-ffmpeg-static}"
  mkdir -p "$tmp_ffmpeg_dir"
  if [[ ! -x "$tmp_ffmpeg_dir/node_modules/ffmpeg-static/ffmpeg" ]]; then
    npm install --prefix "$tmp_ffmpeg_dir" ffmpeg-static >/dev/null
  fi
  printf '%s\n' "$tmp_ffmpeg_dir/node_modules/ffmpeg-static/ffmpeg"
}

duration_seconds() {
  { "$FFMPEG_BIN" -hide_banner -i "$SOURCE_VIDEO" 2>&1 || true; } | awk '
    /Duration:/ {
      gsub(",", "", $2)
      split($2, parts, ":")
      printf "%.3f\n", (parts[1] * 3600) + (parts[2] * 60) + parts[3]
      exit
    }
  '
}

timestamp_from_seconds() {
  awk -v seconds="$1" 'BEGIN {
    hours = int(seconds / 3600)
    minutes = int((seconds - (hours * 3600)) / 60)
    secs = seconds - (hours * 3600) - (minutes * 60)
    printf "%02d:%02d:%06.3f", hours, minutes, secs
  }'
}

extract_frame() {
  local timestamp="$1"
  local output="$2"

  "$FFMPEG_BIN" \
    -hide_banner \
    -loglevel error \
    -ss "$timestamp" \
    -i "$SOURCE_VIDEO" \
    -frames:v 1 \
    -q:v "$JPEG_QUALITY" \
    -vf "scale=$FRAME_WIDTH:-1" \
    "$output"
}

make_storyboard() {
  local times=(
    00:00:10
    00:03:00
    00:06:00
    00:09:00
    00:12:00
    00:15:00
    00:18:00
    00:21:00
    00:24:00
    00:27:00
    00:30:00
    00:33:00
    00:36:00
    00:39:00
    00:42:00
    00:46:30
  )

  mkdir -p "$STORYBOARD_DIR"
  rm -f "$STORYBOARD_DIR"/frame_*.jpg "$STORYBOARD_IMAGE"

  local idx=1
  local timestamp label output
  for timestamp in "${times[@]}"; do
    label="${timestamp//:/-}"
    output="$(printf '%s/frame_%02d_%s.jpg' "$STORYBOARD_DIR" "$idx" "$label")"
    extract_frame "$timestamp" "$output"
    idx=$((idx + 1))
  done

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  idx=1
  for frame in "$STORYBOARD_DIR"/frame_*.jpg; do
    cp "$frame" "$(printf '%s/rtc_storyboard_%02d.jpg' "$tmp_dir" "$idx")"
    idx=$((idx + 1))
  done

  "$FFMPEG_BIN" \
    -hide_banner \
    -loglevel error \
    -framerate 1 \
    -i "$tmp_dir/rtc_storyboard_%02d.jpg" \
    -frames:v 1 \
    -vf "scale=$CONTACT_WIDTH:-1,tile=4x4:margin=18:padding=8:color=white" \
    -q:v "$JPEG_QUALITY" \
    "$STORYBOARD_IMAGE"

  rm -rf "$tmp_dir"
}

make_100_frame_set() {
  local duration="$1"
  mkdir -p "$FRAME_SET_DIR"
  rm -f "$FRAME_SET_DIR"/frame_*.jpg "$FRAME_SET_DIR/index.tsv" "$CONTACT_SHEET_100"

  printf 'frame\ttimestamp\tseconds\tfile\n' > "$FRAME_SET_DIR/index.tsv"

  local idx seconds timestamp output
  for idx in $(seq 1 "$FRAME_COUNT"); do
    seconds="$(awk -v duration="$duration" -v idx="$idx" -v count="$FRAME_COUNT" 'BEGIN {
      printf "%.3f", duration * idx / (count + 1)
    }')"
    timestamp="$(timestamp_from_seconds "$seconds")"
    output="$(printf '%s/frame_%03d.jpg' "$FRAME_SET_DIR" "$idx")"
    printf 'Extracting %03d/%03d at %s\n' "$idx" "$FRAME_COUNT" "$timestamp"
    extract_frame "$timestamp" "$output"
    printf '%03d\t%s\t%s\t%s\n' "$idx" "$timestamp" "$seconds" "$output" >> "$FRAME_SET_DIR/index.tsv"
  done

  "$FFMPEG_BIN" \
    -hide_banner \
    -loglevel error \
    -framerate 1 \
    -i "$FRAME_SET_DIR/frame_%03d.jpg" \
    -frames:v 1 \
    -vf "scale=$CONTACT_WIDTH:-1,tile=10x10:margin=18:padding=6:color=white" \
    -q:v "$JPEG_QUALITY" \
    "$CONTACT_SHEET_100"
}

if [[ ! -f "$SOURCE_VIDEO" ]]; then
  echo "Source video not found: $SOURCE_VIDEO" >&2
  exit 1
fi

FFMPEG_BIN="$(find_ffmpeg)"
mkdir -p "$IMAGE_DIR"

DURATION_SECONDS="$(duration_seconds)"
if [[ -z "$DURATION_SECONDS" ]]; then
  echo "Could not detect video duration from $SOURCE_VIDEO" >&2
  exit 1
fi

echo "Source video: $SOURCE_VIDEO"
echo "Duration seconds: $DURATION_SECONDS"
echo "ffmpeg: $FFMPEG_BIN"

if [[ "$GENERATE_STORYBOARD" == "1" ]]; then
  make_storyboard
  echo "Storyboard image: $STORYBOARD_IMAGE"
fi

if [[ "$GENERATE_FRAME_SET" == "1" ]]; then
  make_100_frame_set "$DURATION_SECONDS"
  echo "100-frame directory: $FRAME_SET_DIR"
  echo "100-frame index: $FRAME_SET_DIR/index.tsv"
  echo "100-frame contact sheet: $CONTACT_SHEET_100"
fi
