#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SDK_FILE="${SDK_FILE:-$ROOT_DIR/new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt}"

if [[ ! -f "$SDK_FILE" ]]; then
  echo "Android SDK file not found: $SDK_FILE" >&2
  exit 1
fi

require_pattern() {
  local pattern="$1"
  local label="$2"
  if ! grep -q "$pattern" "$SDK_FILE"; then
    echo "Missing $label in $SDK_FILE" >&2
    exit 1
  fi
}

reject_pattern() {
  local pattern="$1"
  local label="$2"
  if grep -q "$pattern" "$SDK_FILE"; then
    echo "Unexpected $label in $SDK_FILE" >&2
    exit 1
  fi
}

require_pattern "private data class AgoraJoinResult" "typed Agora join result"
require_pattern "private fun preflightAgoraMedia" "media preflight helper"
require_pattern "private fun resolveAgoraRtcToken" "Agora token resolver"
require_pattern "private fun missingMediaPermissions" "mode-aware Android permission check"
require_pattern "private fun cleanupFailedUsageSession" "failed media session cleanup"
require_pattern "missing_agora_rtc_token" "missing Agora token error"
require_pattern "agoraRtcTokenOverride" "adapter token override"
require_pattern "MediaPreflightPassed" "media preflight success event"
require_pattern "MediaPreflightFailed" "media preflight failure event"
require_pattern "FailedSessionCleanedUp" "failed session cleanup event"
require_pattern "FailedSessionCleanupError" "failed session cleanup error event"
require_pattern "TokenRenewalFailed" "token renewal failure event"
require_pattern "val hasAgoraRtcToken" "explicit Agora token availability accessor"
require_pattern "engine.joinChannel(tokenForAgora" "native Agora join uses resolved token"
require_pattern "agoraEngine?.renewToken(agoraToken)" "Agora token renewal uses resolved token"

reject_pattern "raw.optString(\"agora_token\", raw.optString(\"rtc_token\"))" "Agora token fallback to platform rtc_token"
reject_pattern "joinChannel(request.agoraRtcTokenOverride ?: tokenIssue.agoraRtcToken" "direct nullable override fallback in joinChannel"
reject_pattern "renewToken(request.agoraRtcTokenOverride ?: result.agoraRtcToken" "direct nullable override fallback in renewToken"

agora_token_block="$(
  awk '
    /val agoraRtcToken: String/ { in_block=1 }
    in_block { print }
    /val hasAgoraRtcToken/ { in_block=0 }
  ' "$SDK_FILE"
)"

if grep -q '"rtc_token"' <<<"$agora_token_block"; then
  echo "agoraRtcToken accessor must not read platform rtc_token." >&2
  exit 1
fi

echo "Verified Phase 3 media reliability: $SDK_FILE"
