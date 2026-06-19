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

require_pattern "class RtcEnterpriseAndroidSdk" "SDK entrypoint"
require_pattern "interface ResultCallback" "callback contract"
require_pattern "mainHandler.post" "main-thread callback delivery"
require_pattern "private fun <T> validateRequest" "request validation helper"
require_pattern "fun validationErrors()" "request validation methods"
require_pattern "val RtcEnterpriseException.errorMap" "typed error map"
require_pattern "ROOM_ADMIN(\"admin\")" "room admin role naming"
require_pattern "val roomItems: List<RtcRoom>" "typed room list accessor"
require_pattern "val roomModel: RtcRoom" "typed room accessor"
require_pattern "val sessionModel: RtcSession" "typed session accessor"
require_pattern "val participantModel: RtcParticipant" "typed participant accessor"

for model in \
  RtcTenant \
  RtcClientApp \
  RtcBillingPolicy \
  RtcExternalUser \
  RtcRoom \
  RtcProfile \
  RtcRoomControls \
  RtcTokenGrants \
  RtcSession \
  RtcParticipant \
  RtcPagination
do
  require_pattern "data class $model" "$model model"
done

for endpoint in \
  "/client/me" \
  "/client/users/sync" \
  "/client/rooms" \
  "/client/rtc/token" \
  "/client/rtc/session/start" \
  "/client/rtc/session/end"
do
  require_pattern "$endpoint" "$endpoint endpoint"
done

if grep -q "R.layout\\|setContentView\\|findViewById" "$SDK_FILE"; then
  echo "SDK file appears to own app layout UI; Phase 2 must stay headless." >&2
  exit 1
fi

echo "Verified Phase 2 Android SDK foundation: $SDK_FILE"
