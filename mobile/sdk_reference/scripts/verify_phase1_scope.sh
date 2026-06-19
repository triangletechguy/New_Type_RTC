#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
AUDIT_FILE="${AUDIT_FILE:-$ROOT_DIR/mobile/sdk_reference/FRAME_SCOPE_AUDIT.tsv}"
INDEX_FILE="${INDEX_FILE:-$ROOT_DIR/mobile/sdk_reference/frames_100/index.tsv}"
EXPECTED_FRAME_COUNT="${EXPECTED_FRAME_COUNT:-100}"

if [[ ! -f "$AUDIT_FILE" ]]; then
  echo "Scope audit not found: $AUDIT_FILE" >&2
  exit 1
fi

if [[ ! -f "$INDEX_FILE" ]]; then
  echo "Frame index not found: $INDEX_FILE" >&2
  exit 1
fi

row_count="$(awk 'NR > 1 { count++ } END { print count + 0 }' "$AUDIT_FILE")"
if [[ "$row_count" != "$EXPECTED_FRAME_COUNT" ]]; then
  echo "Expected $EXPECTED_FRAME_COUNT audit rows, found $row_count" >&2
  exit 1
fi

awk -F '\t' -v expected="$EXPECTED_FRAME_COUNT" '
  NR == 1 {
    if ($1 != "frame" || $2 != "timestamp" || $4 != "sdk_boundary") {
      print "Unexpected audit header" > "/dev/stderr"
      exit 1
    }
    next
  }
  {
    expected_frame = sprintf("%03d", NR - 1)
    if ($1 != expected_frame) {
      print "Expected frame " expected_frame ", found " $1 > "/dev/stderr"
      exit 1
    }
    allowed = $4 == "sdk_core" || $4 == "sdk_events" || $4 == "sdk_build_test" || $4 == "app_ui_plus_sdk_data" || $4 == "app_ui"
    if (!allowed) {
      print "Invalid boundary for frame " $1 ": " $4 > "/dev/stderr"
      exit 1
    }
    if ($3 == "" || $5 == "" || $6 == "" || $7 == "") {
      print "Missing scope data for frame " $1 > "/dev/stderr"
      exit 1
    }
  }
  END {
    if (NR != expected + 1) {
      print "Unexpected line count" > "/dev/stderr"
      exit 1
    }
  }
' "$AUDIT_FILE"

awk -F '\t' '
  NR == FNR && NR > 1 {
    timestamps[$1] = $2
    next
  }
  NR != FNR && FNR > 1 {
    if (!($1 in timestamps)) {
      print "Audit frame not found in index: " $1 > "/dev/stderr"
      exit 1
    }
    if ($2 != timestamps[$1]) {
      print "Timestamp mismatch for frame " $1 ": audit=" $2 ", index=" timestamps[$1] > "/dev/stderr"
      exit 1
    }
  }
' "$INDEX_FILE" "$AUDIT_FILE"

echo "Verified Phase 1 scope audit: $AUDIT_FILE"
