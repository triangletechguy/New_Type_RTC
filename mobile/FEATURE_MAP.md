# Web-To-Flutter Feature Map

Captured on 2026-06-14.

This map connects the frozen web reference to the native Flutter project. Use it
as the working checklist for Steps 5-20.

Status legend:

- Ready: native path is good enough for the next migration step.
- Partial: native path exists but does not yet match the web feature.
- Prototype: native path proves a concept but is not production parity.
- Missing: native Flutter implementation still needs to be built.

## Priority Order

1. Make native Flutter the default entry.
2. Remove the old WebView reference path after native parity.
3. Finalize native routes and app state.
4. Align design system, assets, and typography.
5. Complete auth and session behavior.
6. Complete room lobby and create-room parity.
7. Complete live room media, signaling, controls, and chat.
8. Complete profile/settings.
9. Complete admin and SDK docs.
10. Add tests and remove the WebView dependency.

## Feature Map

| Web Feature | Web Source | Flutter Owner | Status | Step |
| --- | --- | --- | --- | --- |
| App shell and view state | `frontend/src/App.jsx` | `mobile/lib/main.dart` | Partial | 5, 7 |
| Temporary web reference | `frontend/src/App.jsx` | Removed from mobile runtime | Removed | 20 |
| Auth modal/login/register | `components/auth/AuthModal.jsx`, `LoginScreen.jsx` | `screens/login_screen.dart`, `services/api_client.dart` | Ready | 11, 12 |
| Session restore/auth expiry | `services/api.js` | `services/api_client.dart`, `main.dart` | Ready | 11 |
| Room lobby/feed | `components/rooms/RoomsView.jsx` | `screens/room_list_screen.dart` | Ready | 13 |
| Feed tabs and filters | `components/rooms/roomsStaticData.js` | `screens/room_list_screen.dart` | Ready | 13 |
| Create room flow | `components/rooms/RoomsView.jsx` | `_CreateRoomSheet` in `room_list_screen.dart` | Ready | 14 |
| Room cards/covers | `RoomsView.jsx`, `assets/rtc/catalog.js` | `ui/rtc_mobile_ui.dart`, `ui/rtc_assets.dart` | Ready | 8, 9, 13 |
| Live room shell | `components/rtc/LiveRoomView.jsx` | `screens/live_room_screen.dart` | Ready | 15 |
| WebRTC peer media | `services/rtcClient.js`, `VideoTile.jsx` | `services/rtc_peer_connection_service.dart`, `screens/live_room_screen.dart` | Partial | 16 |
| Signaling | `services/signaling.js` | `services/signaling_service.dart` | Partial | 16 |
| Local media permissions | `services/media.js` | `services/rtc_media_service.dart` | Ready | 15, 16 |
| Live room controls | `LiveRoomView.jsx` | `screens/live_room_screen.dart` | Partial | 15, 16 |
| Chat panel | `components/rtc/ChatPanel.jsx` | `screens/live_room_screen.dart`, new native chat service | Prototype | 15, 16 |
| Direct messages | `RoomsView.jsx`, `ChatPanel.jsx` | new native messages area | Missing | 13, 15 |
| Follow requests/social actions | `LiveRoomView.jsx`, `ChatPanel.jsx` | new native social API/widgets | Missing | 15, 17 |
| Profile edit | `components/profile/ProfilePanel.jsx` | `screens/profile_screen.dart` | Ready | 17 |
| Profile avatar upload/crop | `ProfilePanel.jsx` | `screens/profile_screen.dart` | Partial | 17 |
| Settings/security/privacy | `RoomsView.jsx`, `roomsStaticData.js` | `screens/profile_screen.dart`, `services/profile_settings_store.dart` | Ready | 17 |
| Admin overview | `components/admin/AdminView.jsx` | `screens/admin_dashboard_screen.dart` | Ready for core console | 18, 19 |
| Admin mutations/details | `AdminView.jsx` | `screens/admin_dashboard_screen.dart`, API client | Partial | 18, 19 |
| SDK docs | `components/sdk/SdkView.jsx` | `screens/sdk_docs_screen.dart` | Ready | 18, 19 |
| Design tokens | `styles/chunk-01.css`, `chunk-18.css` | `ui/rtc_mobile_ui.dart` | Ready | 8, 10 |
| Asset catalog | `assets/rtc/catalog.js` | `ui/rtc_assets.dart`, `assets/rtc/` | Ready | 9 |
| API client coverage | `services/api.js` | `services/api_client.dart` | Partial | 11, 13-18 |
| Tests | web behavior reference | `mobile/test/`, `SCREEN_PARITY.md` | Targeted | 19 |

## App Shell

Web reference:

- `frontend/src/App.jsx`
- `frontend/src/components/layout/Sidebar.jsx`

Flutter target:

- `mobile/lib/main.dart`
- `NativeRtcShell`

Current Flutter state:

- `NativeRtcShell` exists.
- Restores saved user session.
- Shows login or rooms from the shell state.
- Opens live room, profile, admin, and SDK docs through named native routes.
- Default app starts `NativeRtcShell`.

Required work:

- Step 5 complete: `NativeRtcShell` is the default `home`.
- Step 20 complete: the WebView route, screen, config flags, and dependencies
  were removed from mobile runtime.
- Step 7 complete: `AppRoutes` defines stable native routes for root, login,
  rooms, live room, profile, admin, SDK docs, settings, error, and debug web
  reference paths.

Acceptance criteria:

- Flutter launches native UI without a frontend server.
- Back navigation leaves live rooms and returns to the room lobby.
- Admin navigation is hidden or blocked for non-admin roles.

## Auth And Session

Web reference:

- `frontend/src/components/auth/AuthModal.jsx`
- `frontend/src/components/auth/LoginScreen.jsx`
- `frontend/src/services/api.js`

Flutter target:

- `mobile/lib/screens/login_screen.dart`
- `mobile/lib/services/api_client.dart`
- `mobile/lib/models/app_user.dart`

Endpoints:

- `POST /auth/login`
- `POST /auth/register`
- `GET /auth/me`
- `PATCH /auth/me`
- `POST /auth/logout`

Current Flutter state:

- Login works.
- Register works.
- Session is stored with `flutter_secure_storage`.
- Session restore exists.
- Bearer headers are restored after cold start.
- Legacy superadmin emails normalize to `admin@gmail.com`, matching web.
- `401` responses clear local session and notify the native shell to return to
  login.
- Explicit logout calls the backend route and clears local session.
- `api_client_test.dart` covers login persistence, restore, auth expiry,
  logout, and web-matched email-provider error cleanup.
- Visible auth fields start empty, matching web instead of demo credentials.
- Native login/signup validation uses the web messages for email, password,
  name, gender, age, residence, and birthday.
- `login_screen_test.dart` covers web-matched validation and visible form
  errors.

Required work:

- Add forgot-password or email-verification UI only if the web app/backend
  introduces those flows.

Acceptance criteria:

- Login/register flows work after a cold app start.
- Expired sessions return to login with a clear message.
- Flutter auth fields and states match web/mobile reference.

## Room Lobby And Feed

Web reference:

- `frontend/src/components/rooms/RoomsView.jsx`
- `frontend/src/components/rooms/roomsStaticData.js`
- `frontend/src/assets/rtc/catalog.js`

Flutter target:

- `mobile/lib/screens/room_list_screen.dart`
- `mobile/lib/models/room.dart`
- `mobile/lib/ui/rtc_assets.dart`
- `mobile/lib/ui/rtc_mobile_ui.dart`

Endpoints:

- `GET /rooms`
- `GET /rooms/:id`
- `DELETE /rooms/:id`
- `PATCH /rooms/:id/controls`

Current Flutter state:

- Active room list loads from `GET /rooms`.
- Feed tabs match the web mobile lobby: following/Mine, for you/Popular,
  explore, nearby, latest, and global.
- Type, privacy, and sort filters call backend query params and are mirrored
  locally for responsive filtering.
- Search filters room names, descriptions, hosts, regions, companies, room
  types, and feature tags.
- `Room` parses the backend/web lobby payload, including owner, tenant, region,
  active participant previews, feature flags, privacy, status, and timestamps.
- Rich room cards use copied assets and show host, type, access, watchers,
  region, company, created time, feature tags, and participant previews.
- Owner-only room deletion calls `DELETE /rooms/:id`.
- Pull to refresh plus loading, error, and empty states exist.
- `room_lobby_test.dart` covers room parsing, feed tab API queries, and visible
  lobby metadata.

Required work:

- Add rankings, moments, direct messages, settings, feedback, share, and mobile
  room tool sheets in the later social/live-room steps.
- Add detailed room controls with the live-room controls step.
- Add live room controls, room tool sheets, and social actions in the later
  live-room/social steps.

Acceptance criteria:

- Native room lobby exposes the same core room actions as web mobile.
- Room cards show the same important metadata.
- Filtering/search behavior matches the web reference.

## Create Room

Web reference:

- Host/create flow inside `frontend/src/components/rooms/RoomsView.jsx`

Flutter target:

- `_CreateRoomSheet` in `mobile/lib/screens/room_list_screen.dart`

Endpoint:

- `POST /rooms`

Current Flutter state:

- Native bottom sheet creates a room.
- Supports name fallback, web default description, profile image URL, all web
  room types, privacy, password, stage seats, theme, and feature toggles.
- Applies web host-panel validation for room name, description length,
  password rooms, and one-to-one/stage seat limits.
- Sends the selected `profile_image`, `theme`, `chat_enabled`, `gift_enabled`,
  `screen_share_enabled`, and `ai_security_enabled` values to `POST /rooms`.
- Shows a created-room summary with room ID, type, privacy, seats, and an
  explicit Open room action.
- `api_client_test.dart` covers the create-room POST payload.
- `room_lobby_test.dart` covers host-panel validation, choices, toggles, and
  the created-room summary.

Required work:

- Add binary image upload/crop only if the web host panel adds that behavior.
- Wire newly-created room media mode into the full native live-room RTC step.

Acceptance criteria:

- A native-created room appears correctly in both Flutter and web.
- Password/private/video/audio options behave like web-created rooms.

## Live Room And RTC

Web reference:

- `frontend/src/components/rtc/LiveRoomView.jsx`
- `frontend/src/components/rtc/VideoTile.jsx`
- `frontend/src/components/rtc/RtcConnectionIndicator.jsx`
- `frontend/src/services/signaling.js`
- `frontend/src/services/rtcClient.js`
- `frontend/src/services/media.js`
- `frontend/src/services/videoFilters.js`

Flutter target:

- `mobile/lib/screens/live_room_screen.dart`
- `mobile/lib/services/signaling_service.dart`
- `mobile/lib/services/rtc_media_service.dart`
- `mobile/lib/services/rtc_peer_connection_service.dart`
- native video tile widgets inside `live_room_screen.dart`

Endpoints:

- `POST /rooms/:id/join`
- `POST /rooms/:id/leave`
- `GET /rooms/:id/controls`
- `PATCH /rooms/:id/controls`
- `POST /rooms/:id/media-state`
- `POST /rooms/:id/quality`
- `GET /rtc/config`

Socket events:

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

Current Flutter state:

- Native live room shell matches the web live surface structure: topbar,
  immersive stage, connection steps, participant tiles, media controls, tool
  panels, room status, and signaling event log.
- Password rooms can collect an access code and pass it to `POST /rooms/:id/join`.
- Local media permissions and local preview renderer are wired through
  `RtcMediaService.openLocalMedia` and `RTCVideoRenderer`.
- Backend join, Socket.IO connect, and signaling `join-room` are wired.
- Signaling peer refresh, join/leave, and `media-state-change` events update
  native participant tiles.
- Signaling now exposes typed offer, answer, ICE candidate, peer error, and
  session-replaced streams.
- `RtcPeerConnectionService` creates native `RTCPeerConnection` instances,
  syncs local tracks, sends and handles offers/answers/ICE candidates, queues
  early ICE, and closes stale peers.
- Remote streams are attached to native `RTCVideoRenderer`s and shown in the
  participant grid.
- Mic/camera controls update local tracks, call `POST /rooms/:id/media-state`,
  and emit signaling media-state changes.
- Leave calls `POST /rooms/:id/leave`, clears signaling peers, and stops local
  media/peer connections.
- Room tools expose native panels for access, chat shell, audio, beauty,
  screen share, room ops, and AI guard state.
- `api_client_test.dart` covers password join, media-state, and leave payloads.
- `live_room_screen_test.dart` covers password join, media sync, peer
  coordinator sync, participant updates, and leave behavior.

Required work:

- Verify two-device Flutter and mixed Flutter/web room media on Android
  hardware/emulators.
- Turn the chat shell into full message loading/sending/edit/delete behavior.
- Wire room ops panels to controls and moderation endpoints.
- Add real screen share, audio effects, and camera effects.
- Add reconnect/rejoin hardening after socket drops.
- Add quality reporting.

Acceptance criteria:

- Two Flutter clients can join the same room and see/hear each other.
- Flutter can interoperate with the web client in the same room if the backend
  protocol supports mixed clients.
- Leave/rejoin works without stale peers.
- Mic/camera buttons affect real media tracks and remote participant state.

## Chat, Direct Messages, And Social Actions

Web reference:

- `frontend/src/components/rtc/ChatPanel.jsx`
- `frontend/src/components/rooms/RoomsView.jsx`

Flutter target:

- new native chat panel/widget
- new native direct-message widgets or screen
- `mobile/lib/services/api_client.dart`
- `mobile/lib/services/signaling_service.dart`

Endpoints:

- `GET /rooms/:id/messages`
- `POST /rooms/:id/messages`
- `PATCH /messages/:id`
- `DELETE /messages/:id`
- `POST /rooms/:id/blocks`
- `GET /direct-messages/contacts`
- `GET /direct-messages/:peerId`
- `POST /direct-messages/:peerId`
- `PATCH /direct-messages/messages/:id`
- `DELETE /direct-messages/messages/:id`
- `GET /follow-requests`
- `POST /users/:peerId/follow-requests`
- `POST /follow-requests/:id/:action`

Socket events:

- `chat-message`
- `chat-message-edited`
- `chat-message-deleted`
- `chat-message-unsent`
- `direct-message`
- `direct-message-edited`
- `direct-message-deleted`
- `typing-start`
- `typing-stop`
- `follow-request-received`
- `follow-request-accepted`
- `follow-request-rejected`

Current Flutter state:

- Missing.

Required work:

- Add API methods.
- Add native chat UI for live rooms.
- Add message send/edit/delete/unsend behavior.
- Add typing state.
- Add direct-message contact and thread views.
- Add follow request and block actions.

Acceptance criteria:

- Flutter live-room chat syncs with web chat in real time.
- Direct messages and message moderation match web behavior.

## Profile And Settings

Web reference:

- `frontend/src/components/profile/ProfilePanel.jsx`
- settings sections in `frontend/src/components/rooms/RoomsView.jsx`
- settings copy in `frontend/src/components/rooms/roomsStaticData.js`

Flutter target:

- `mobile/lib/screens/profile_screen.dart`
- `mobile/lib/services/profile_settings_store.dart`

Endpoints:

- `GET /auth/me`
- `PATCH /auth/me`

Current Flutter state:

- Native profile hero/detail mode matches the web profile card structure.
- Edit mode supports name, gender, age, current residence, birthday, avatar
  URL/data URL text, avatar removal, web-matched validation, cancel, save, and
  logout.
- Profile save calls `PATCH /auth/me`, including `avatar_url: null` when the
  avatar is removed.
- `/profile` opens the profile section and `/settings` opens account settings.
- The room lobby exposes a settings shortcut next to profile/admin/SDK actions.
- Local settings mirror the web localStorage behavior through
  `ProfileSettingsStore`.
- Account security, privacy, content preferences, region, and terms/policy
  sections are available natively.
- `api_client_test.dart` covers avatar removal payloads.
- `profile_screen_test.dart` covers profile edit/save, avatar removal, settings
  persistence, and policy detail navigation.

Required work:

- Add binary avatar picker/crop/compression with a native plugin if full web
  photo-file parity is required.
- Replace local-only settings with backend persistence if settings endpoints are
  added.

Acceptance criteria:

- Profile changes appear in Flutter and web.
- Avatar URL/data URL and removal behavior matches the web save payload.
- Settings sections expose the same user-facing controls as web mobile.

## Admin

Web reference:

- `frontend/src/components/admin/AdminView.jsx`
- `frontend/src/components/admin/adminUiBits.jsx`
- `frontend/src/components/admin/adminStaticData.js`

Flutter target:

- `mobile/lib/screens/admin_dashboard_screen.dart`
- `mobile/lib/services/api_client.dart`

Endpoints:

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

Current Flutter state:

- Native tabbed admin console exists for command metrics, client companies,
  packages, SDK access, rooms, usage, and health.
- Admin mutations are wired for company status, SDK app generation/rotation,
  SDK app status, package requests, room creation/status/removal, company
  detail fetches, service-plan updates, tenant-id generation, and company admin
  invites.
- Role gate exists.

Required work:

- Add remaining web-only polish: richer company creation/edit forms, service
  package editor UI, admin deletion UI, invite workflows, and denser table
  affordances for tablet/desktop widths.
- Use `SCREEN_PARITY.md` as the follow-up checklist for final company/package
  admin polish.

Acceptance criteria:

- Admin can perform the same core management tasks on Flutter as web.
- Non-admin users cannot access admin data or actions.

## SDK Docs

Web reference:

- `frontend/src/components/sdk/SdkView.jsx`

Flutter target:

- `mobile/lib/screens/sdk_docs_screen.dart`

Endpoints:

- `GET /rtc/config`
- Client SDK reference docs shown for `/api/client/*`

Current Flutter state:

- Native SDK docs include web-style build flow, tabbed code samples, SDK
  console payload builder, token contract, route map, room types, SDK methods,
  events, error codes, webhooks, and media upgrade notes.
- Runtime RTC config loads.

Required work:

- Add copy/share affordances and any final wording/layout changes listed in
  `SCREEN_PARITY.md`.

Acceptance criteria:

- SDK docs in Flutter contain the same practical integration information as
  web, adapted for mobile reading.

## Design System And Assets

Web reference:

- `frontend/src/tailwind.css`
- `frontend/src/styles/chunk-01.css`
- `frontend/src/styles/chunk-04.css`
- `frontend/src/styles/chunk-05.css`
- `frontend/src/styles/chunk-06.css`
- `frontend/src/styles/chunk-16.css`
- `frontend/src/styles/chunk-18.css`
- `frontend/src/assets/rtc/catalog.js`

Flutter target:

- `mobile/lib/ui/rtc_mobile_ui.dart`
- `mobile/lib/ui/rtc_assets.dart`
- `mobile/assets/rtc/`
- `mobile/pubspec.yaml`

Current Flutter state:

- Core palette and reusable widgets exist.
- Palette, typography, radius, and shadow tokens match the frozen web CSS.
- Shared native controls now include icon buttons, filter bars, loading panels,
  message panels, and section headers.
- 49 web assets are copied and registered.
- `RtcAssets.allBundledAssets` and a Flutter asset-manifest test guard
  registration.
- Room covers and avatars use the asset helper.

Required work:

- Add reusable native components for drawers, sheets, chat bubbles, video
  tiles, admin tables, settings rows, and code panels.
- Make all fixed-format widgets stable at mobile widths.

Acceptance criteria:

- Screen-by-screen visual comparison shows Flutter matching web mobile layout,
  colors, spacing, icons, and states closely enough for product parity.

## API Client Coverage

Flutter target:

- `mobile/lib/services/api_client.dart`

Current Flutter state:

- Core auth, rooms, admin overview, and RTC config calls exist.

Required work:

- Add typed helpers for every endpoint required by this feature map.
- Add model parsing tests for common response shapes.
- Normalize backend error messages consistently.
- Add central expired-session handling.

Acceptance criteria:

- UI screens do not hand-build raw endpoint strings outside the API layer.
- Each mapped web endpoint has a Flutter method or a deliberate deferral note.

## Testing Map

Current Flutter state:

- `mobile/test/widget_test.dart` verifies app construction, native-only route
  registry, admin role gate, design tokens, and assets.
- `mobile/test/login_screen_test.dart`, `room_lobby_test.dart`,
  `live_room_screen_test.dart`, `profile_screen_test.dart`,
  `admin_sdk_screen_test.dart`, and `api_client_test.dart` cover every major
  migrated screen and API contract touched by Steps 11-19.
- `mobile/SCREEN_PARITY.md` records the screen-by-screen comparison outcome.

Required tests:

- App shell starts native path. Done through app construction and native-only
  route registry checks.
- Login/register validation. Done.
- `AppUser` role parsing. Done for admin role gate.
- `Room` parsing for web payload fields. Done.
- Room list loading and rich room states. Done; empty/error states can be
  expanded during polish.
- Create-room form validation. Done.
- Profile validation/save states. Done for save/settings; avatar picker remains
  a deferred gap.
- Admin role gate plus native admin actions for SDK app generation and package
  request review. Done.
- SDK docs loading/error states plus reference content and code sample tabs.
  Done.
- Signaling service payload helpers.
- Live room renderer/peer-manager tests where practical.

Acceptance criteria:

- Step 19 compares Flutter and web behavior screen by screen.
- `flutter analyze` and `flutter test` pass after removing WebView dependency.
