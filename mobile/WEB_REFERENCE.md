# Web Reference For Native Flutter

Captured on 2026-06-14 from repository HEAD `bcf5f73`.

This document freezes the rtc-enterprise web/mobile app as the source of truth
for the native Flutter migration. The web frontend is a product/design
reference only. Native Flutter must not depend on loading these React files or a
frontend dev server at runtime.

## Reference Rule

When Flutter behavior is unclear, match the web/mobile implementation first:

- Same user-visible screens and navigation.
- Same primary actions and disabled/loading/error states.
- Same backend API contract.
- Same RTC signaling contract.
- Same brand assets, colors, spacing, and responsive mobile behavior.

## Web App Shell

The web app uses app-level view state instead of a route file.

Source files:

- `frontend/src/App.jsx`
- `frontend/src/components/layout/Sidebar.jsx`
- `frontend/src/components/common/LoadingMovie.jsx`

Reference paths:

- `/` opens the room lobby/feed.
- `/room/:id` opens the live room for an authenticated user.
- `/admin` opens the service dashboard for users with `client_admin` or
  `super_admin`.
- Auth and profile are modal overlays on top of the active view.

Flutter parity target:

- Native shell with equivalent tabs/views.
- Native back behavior for room entry/exit.
- Native auth/profile overlays or screens.
- Role-gated admin entry.

## Screen Sources

Use these web files as the source of truth while rebuilding native screens:

- Auth: `frontend/src/components/auth/AuthModal.jsx`
- Login page variant: `frontend/src/components/auth/LoginScreen.jsx`
- Room lobby/feed: `frontend/src/components/rooms/RoomsView.jsx`
- Room static lists/copy: `frontend/src/components/rooms/roomsStaticData.js`
- Live room: `frontend/src/components/rtc/LiveRoomView.jsx`
- Live video tile: `frontend/src/components/rtc/VideoTile.jsx`
- Live chat/direct messages: `frontend/src/components/rtc/ChatPanel.jsx`
- RTC connection indicator: `frontend/src/components/rtc/RtcConnectionIndicator.jsx`
- Profile: `frontend/src/components/profile/ProfilePanel.jsx`
- Service dashboard: `frontend/src/components/admin/AdminView.jsx`
- Admin UI helpers/static data:
  `frontend/src/components/admin/adminUiBits.jsx`,
  `frontend/src/components/admin/adminStaticData.js`

## Design Reference

Primary style sources:

- `frontend/src/tailwind.css`
- `frontend/src/styles/chunk-01.css`
- `frontend/src/styles/chunk-04.css`
- `frontend/src/styles/chunk-05.css`
- `frontend/src/styles/chunk-06.css`
- `frontend/src/styles/chunk-16.css`
- `frontend/src/styles/chunk-18.css`

Core tokens from the web CSS:

| Token | Value |
| --- | --- |
| Background | `#0a1020` |
| Surface | `#121827` |
| Surface 2 | `#182133` |
| Surface 3 | `#202a3f` |
| Text | `#f8fafc` |
| Muted | `#a8b3c7` |
| Soft | `#d7e0ef` |
| Hot | `#ff3f7f` |
| Hot 2 | `#ff7a45` |
| Sky | `#38bdf8` |
| Mint | `#34d399` |
| Violet | `#8b5cf6` |
| Amber | `#f59e0b` |
| Red | `#ef4444` |
| Font | `Inter`, system sans-serif |

Mobile-responsive CSS reference:

- `frontend/src/styles/chunk-18.css`

Flutter parity target:

- Recreate these tokens in Dart theme/widgets.
- Keep the mobile UI dense and app-like, not a web landing page.
- Match the room feed, live room, chat, profile, and admin visual states.

## Asset Reference

Primary asset catalog:

- `frontend/src/assets/rtc/catalog.js`

Asset folders:

- `frontend/src/assets/rtc/brand/`
- `frontend/src/assets/rtc/asset-image2/`
- `frontend/src/assets/rtc/avatars/`
- `frontend/src/assets/rtc/rooms/`
- `frontend/src/assets/rtc/live-ui/`
- `frontend/src/assets/rtc/admin/`
- `frontend/src/assets/rtc/modern-project-svgs/`

Flutter parity target:

- Register copied assets under `mobile/assets/rtc/`.
- Use native Flutter image/SVG widgets.
- Keep room covers, avatars, live-room icons, admin empty states, and brand
  marks visually aligned with the web catalog.

## API Reference

Primary API client:

- `frontend/src/services/api.js`

Auth/profile endpoints:

- `POST /auth/login`
- `POST /auth/register`
- `GET /auth/me`
- `PATCH /auth/me`

RTC config:

- `GET /rtc/config`

Room endpoints used by web screens:

- `GET /rooms`
- `POST /rooms`
- `GET /rooms/:id`
- `DELETE /rooms/:id`
- `POST /rooms/:id/join`
- `POST /rooms/:id/leave`
- `GET /rooms/:id/controls`
- `PATCH /rooms/:id/controls`
- `PATCH /rooms/:id/media-state`
- `POST /rooms/:id/quality`
- `GET /rooms/:id/messages`
- `POST /rooms/:id/messages`
- `PATCH /messages/:id`
- `DELETE /messages/:id`
- `POST /rooms/:id/blocks`

Direct message/social endpoints used by web screens:

- `GET /direct-messages/contacts`
- `GET /direct-messages/:peerId`
- `POST /direct-messages/:peerId`
- `PATCH /direct-messages/messages/:id`
- `DELETE /direct-messages/messages/:id`
- `GET /follow-requests`
- `POST /users/:peerId/follow-requests`
- `POST /follow-requests/:id/:action`
- `POST /feedback`

Admin endpoints used by web screens:

- `GET /admin/overview`
- `GET /admin/dashboard`
- `GET /admin/companies/:id/detail`
- `POST /admin/companies`
- `PATCH /admin/companies/:id`
- `POST /admin/companies/:id/admin-invite`
- `GET /admin/companies/generate-tenant-id`
- `POST /admin/client-apps`
- `POST /admin/client-apps/:id/rotate-credentials`
- `POST /admin/plan-requests`
- `PATCH /admin/plan-requests/:id`
- `PATCH /admin/service-plans/:id`
- `POST /admin/rooms`
- `PATCH /admin/rooms/:id/status`
- `DELETE /admin/rooms/:id`
- `DELETE /admin/admins/:id`


Flutter parity target:

- Add missing methods to `mobile/lib/services/api_client.dart`.
- Keep token/session persistence native.
- Match web error handling and auth-expired behavior.

## RTC Signaling Reference

Signaling client:

- `frontend/src/services/signaling.js`

WebRTC client:

- `frontend/src/services/rtcClient.js`

Live room orchestration:

- `frontend/src/components/rtc/LiveRoomView.jsx`

Socket events used by the web implementation:

- `join-room`
- `leave-room`
- `room-peers`
- `existing-users`
- `user-joined`
- `user-left`
- `webrtc-offer`
- `webrtc-answer`
- `webrtc-ice-candidate`
- `peer-signal-error`
- `media-state-change`
- `room-session-replaced`
- `room-controls-updated`
- `room-roles-updated`
- `moderation-action`
- `follow-request-received`
- `follow-request-accepted`
- `follow-request-rejected`
- `chat-message`
- `chat-message-edited`
- `chat-message-deleted`
- `chat-message-unsent`
- `direct-message`
- `direct-message-edited`
- `direct-message-deleted`
- `typing-start`
- `typing-stop`

Flutter parity target:

- Use native Socket.IO/WebRTC packages.
- Do not use the web JavaScript RTC client at runtime.
- Match join, reconnect, media state, peer negotiation, chat, moderation, and
  leave behavior.

## Role Reference

Role helper:

- `frontend/src/utils/roles.js`

Admin access:

- `client_admin`
- `super_admin`

Flutter parity target:

- Keep the same role names and access checks in `AppUser`.

## Verification Reference

Each native Flutter screen should be checked against the web/mobile reference:

- Visual parity at Android phone width.
- Same visible actions.
- Same backend endpoint usage.
- Same loading, empty, disabled, and error states.
- Same authenticated and unauthenticated behavior.
- Same role-gated behavior.

Normal native verification must eventually run without the frontend server:

```bash
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:8000/api \
  --dart-define=SIGNALING_URL=http://10.0.2.2:8000
```
