#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SDK_FILE="$ROOT_DIR/new_mobileRTC/agora-manager/src/main/java/io/agora/agora_manager/RtcEnterpriseAndroidSdk.kt"
CONTRACT_FILE="$ROOT_DIR/mobile/sdk_reference/contracts/client_api_phase5_contract.json"
CONTRACT_RUNNER="$ROOT_DIR/mobile/sdk_reference/scripts/run_phase5_client_api_contract_tests.js"
CI_WORKFLOW="$ROOT_DIR/.github/workflows/android-rtc-sdk.yml"

require_file() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    echo "Missing $label: $file" >&2
    exit 1
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
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

reject_pattern() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if grep -q "$pattern" "$file"; then
    echo "Unexpected $label in $file" >&2
    exit 1
  fi
}

require_command node
require_file "$SDK_FILE" "Android SDK entrypoint"
require_file "$CONTRACT_FILE" "Phase 5 client API contract"
require_file "$CONTRACT_RUNNER" "Phase 5 mock contract runner"

node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" "$CONTRACT_FILE"
node --check "$CONTRACT_RUNNER"
node "$CONTRACT_RUNNER"

for endpoint in \
  "/client/me" \
  "/client/users/sync" \
  "/client/users/" \
  "/client/rooms" \
  "/client/rtc/token" \
  "/client/rtc/session/start" \
  "/client/rtc/session/end"
do
  require_pattern "$SDK_FILE" "$endpoint" "$endpoint SDK endpoint"
done

for payload_key in \
  '"external_user_id" to externalUserId' \
  '"room_id" to roomId' \
  '"role" to role.apiValue' \
  '"session_id" to sessionId' \
  '"mic_enabled" to microphoneEnabled' \
  '"camera_enabled" to cameraEnabled' \
  '"screen_shared" to screenShared'
do
  require_pattern "$SDK_FILE" "$payload_key" "$payload_key payload mapping"
done

require_pattern "$SDK_FILE" 'ROOM_ADMIN("admin")' "room admin role serialization"
require_pattern "$SDK_FILE" "fun leaveRoom" "leaveRoom API"
require_pattern "$SDK_FILE" "sessionId = handle.session.sessionId" "tracked session end on leave"
require_pattern "$SDK_FILE" "RtcEnterpriseEvent.UsageSessionEnded" "usage session ended event"
reject_pattern "$SDK_FILE" 'raw.optString("agora_token", raw.optString("rtc_token"))' "Agora token fallback to platform rtc_token"

for contract_id in \
  '"id": "me"' \
  '"id": "syncExternalUser"' \
  '"id": "createRoom"' \
  '"id": "issueRtcToken"' \
  '"id": "startSession"' \
  '"id": "endSession"'
do
  require_pattern "$CONTRACT_FILE" "$contract_id" "$contract_id contract item"
done

require_pattern "$CONTRACT_RUNNER" "http.createServer" "local mock API server"
require_pattern "$CONTRACT_RUNNER" "platform token and Agora token must differ" "token separation assertion"
require_pattern "$CONTRACT_RUNNER" "ROOM_ADMIN must serialize to admin" "room admin assertion"

if [[ -f "$CI_WORKFLOW" ]]; then
  require_pattern "$CI_WORKFLOW" "verify_phase5_contract_integration_tests.sh" "Phase 5 verifier in CI workflow"
fi

echo "Verified Phase 5 contract and integration tests."
