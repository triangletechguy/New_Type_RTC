# Phase 1 Scope Lock

Phase 1 converts the video evidence into SDK boundaries. The goal is to stop the SDK from becoming a copy of the app UI while still capturing every runtime capability the mobile app needs.

## Inputs

- Source video: `new_mobile_RTC.mp4`
- Frame set: `mobile/sdk_reference/frames_100`
- Frame index: `mobile/sdk_reference/frames_100/index.tsv`
- Scope audit: `mobile/sdk_reference/FRAME_SCOPE_AUDIT.tsv`
- Contact sheet: `mobile/sdk_reference/images/new_mobile_RTC_100_contact_sheet.jpg`

## Method

1. Verify the 100-frame extraction.
2. Review every tenth frame first.
3. Fill the gaps by scanning the full 10x10 contact sheet.
4. Assign each frame to a surface and boundary.
5. Convert repeated visual evidence into SDK commitments.

## Scope Categories

| Boundary | Meaning |
| --- | --- |
| `sdk_core` | Must be implemented in the Android SDK runtime. |
| `sdk_events` | Must be represented as typed SDK events or later event APIs. |
| `app_ui_plus_sdk_data` | SDK provides data/state; app owns the screen and layout. |
| `sdk_build_test` | Used for scripts, docs, contract tests, and QA workflow. |
| `app_ui` | App-only presentation; no SDK runtime ownership. |

## Locked SDK Runtime Commitments

- Client API wrapper for `/api/client/me`, `/api/client/users/sync`, `/api/client/rooms`, `/api/client/rtc/token`, `/api/client/rtc/session/start`, and `/api/client/rtc/session/end`.
- Join orchestration: sync external user, issue token, start session, join media, and return a stable handle.
- Leave orchestration: leave media, end usage session, release local state, and surface errors.
- Agora media adapter behavior: local video, remote video, mic toggle, camera toggle, switch camera, token renewal, and connection events.
- Room role naming: SDK code uses `RtcRoomRole.ROOM_ADMIN`; backend value remains `admin`.
- Main-thread callback delivery for Android app integration.
- No fixed UI layout inside the SDK.

## Deferred SDK/Event Commitments

- Chat stream events.
- Deleted-message and moderation events.
- Room controls update stream.
- Participant/profile event stream.
- Background heartbeat and stale-session recovery.
- Backend join-bundle mode for production apps that cannot ship API keys.

## Explicitly Out Of SDK Runtime Scope

- Mobile room list visuals.
- Live-room tile layout.
- Profile sheets and action-sheet rendering.
- Chat timeline rendering.
- Creator setup forms.
- GitHub, IDE, docs, and admin-console screens shown in the video.
- Floating notes or desktop overlays.

## Phase 1 Acceptance

- `bash mobile/sdk_reference/scripts/verify_100_frame_set.sh` passes.
- `bash mobile/sdk_reference/scripts/verify_phase1_scope.sh` passes.
- `FRAME_SCOPE_AUDIT.tsv` has exactly 100 frame rows.
- Each row has a boundary that maps to one of the approved scope categories.
- The Android SDK public entrypoint remains `RtcEnterpriseAndroidSdk.kt`.
