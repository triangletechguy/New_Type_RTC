# Current Flutter App Audit

Captured on 2026-06-14. Updated after Step 7 when native route names and typed
route arguments were added.

This audit records what the native Flutter app already has before the
web-to-Flutter feature map is created.

## Summary

The project already contains a native Flutter app foundation, and the default
runtime now launches `NativeRtcShell`. The native path is usable as a starting
point with auth, room lobby, create room, profile, admin overview, SDK docs, and
a signaling prototype.

The largest remaining area is full live RTC parity. The current live room joins
the backend and signaling room, opens local media, negotiates native WebRTC peer
connections, and renders remote streams, but it still needs device-level
verification plus the web chat/moderation/control surface.

## Entry Point

Current default:

- `mobile/lib/main.dart` uses `home: const NativeRtcShell()`.

Native app shell already exists:

- `NativeRtcShell` restores saved sessions.
- Unauthenticated users see `LoginScreen`.
- Authenticated users see `RoomListScreen`.
- Admin users can open `AdminDashboardScreen` through `/admin`.
- All users can open `SdkDocsScreen` through `/sdk`.
- Profile opens through `/profile`.
- Settings opens through `/settings` and reuses the native profile/settings
  surface.
- Live rooms open through `/room`.

Native route registry:

- `mobile/lib/navigation/app_routes.dart`
- `mobile/NATIVE_ROUTES.md`

Audit status:

- Usable foundation: yes.
- Native default: yes.
- Step 5 switched the default app entry to `NativeRtcShell`.
- Step 7 added named routes and a native route error screen.

## Dependencies

Native dependencies already present in `pubspec.yaml`:

- HTTP/API: `dio`, `http`
- Secure session storage: `flutter_secure_storage`
- Signaling: `socket_io_client`
- Media/WebRTC: `flutter_webrtc`
- Permissions: `permission_handler`
- SVG assets: `flutter_svg`

Audit status:

- The required package categories exist.
- Later steps may still need more focused state management or media helpers,
  but no new package is required for the basic migration path yet.

## Models

Implemented:

- `AppUser`
  - id, tenant id, name, email, phone, gender, age, birthday, residence,
    avatar URL, roles.
  - `canUseAdminDashboard` matches the web role names:
    `client_admin`, `super_admin`.
- `Room`
  - id, name, description, room type, privacy type, profile image, max mic
    count.
  - `supportsVideo` helper.

Gaps:

- `Room` is still smaller than the web room payload.
- Missing room owner/host details, participant counts, active users, controls,
  roles, billing/session metadata, chat flags, and moderation fields.

## API Client

Implemented in `mobile/lib/services/api_client.dart`:

- Session restore/save/clear with secure storage.
- `POST /auth/login`
- `POST /auth/register`
- `GET /auth/me`
- `PATCH /auth/me`
- `POST /auth/logout`
- `GET /health`
- `GET /rtc/config`
- `GET /admin/overview`
- `GET /admin/dashboard`
- `GET /rooms`
- `POST /rooms`
- `POST /rooms/:id/join`
- `POST /rooms/:id/leave`
- `POST /rooms/:id/media-state`

Auth/session behavior:

- Saved sessions restore bearer headers after cold start.
- `401` responses clear secure storage and notify `NativeRtcShell` to return
  to login.
- Legacy superadmin emails normalize to `admin@gmail.com`, matching web.
- Logout calls `/auth/logout` when a token exists and clears local state in all
  cases.
- `api_client_test.dart` covers login persistence, session restore, auth
  expiry, logout, and web-matched email-provider error cleanup.

Gaps against the web reference:

- Missing room detail APIs.
- Missing room controls/quality APIs.
- Missing room message APIs.
- Missing direct-message APIs.
- Missing follow request APIs.
- Missing feedback API.
- Missing most admin mutation/detail APIs.

## Screens

### Login And Signup

File:

- `mobile/lib/screens/login_screen.dart`

Implemented:

- Login/register modes.
- Empty fields by default, matching the web modal.
- Web-matched validation messages for email, password, name, gender, age,
  residence, and birthday.
- Per-field error display plus web-style login/signup status copy.
- Native UI styled with the RTC palette/components and copied brand mark.
- `login_screen_test.dart` covers auth validation and visible form errors.

Gaps:

- Missing forgot-password/email-verification flows if required by backend.

### Room Lobby

File:

- `mobile/lib/screens/room_list_screen.dart`

Implemented:

- Fetch active rooms from `GET /rooms`.
- Pull to refresh.
- Search by room, host, region, company, type, and feature tags.
- Web feed tabs for Mine, Popular, Explore, Nearby, Latest, and Global.
- Type, access, and sort filters using backend query params.
- Create room sheet.
- Rich room cards using copied web assets, participant previews, host, room
  type, access, watchers, region, company, created date, and feature tags.
- Owner-only room deletion through `DELETE /rooms/:id`.
- Loading, error, and empty states.
- Header actions for profile, admin, SDK docs, refresh, logout.
- `room_lobby_test.dart` covers room payload parsing, feed tab queries, and
  card metadata.

Gaps:

- Missing rankings, moments, direct-message drawer, settings, feedback, share,
  mobile room tool sheets, and detailed room controls.
- Create-room parity is still handled separately in Step 14.

### Create Room

File:

- `mobile/lib/screens/room_list_screen.dart`

Implemented:

- Bottom sheet with name fallback, web default description, profile image URL,
  all web room types, privacy, password, seats, and theme.
- Feature toggles for chat, gifts, screen share, and AI guard.
- Web-matched host-panel validation for name, description, password rooms, and
  one-to-one/stage seat limits.
- Calls `POST /rooms` with the selected host-panel payload.
- Shows created-room summary with room ID, type, privacy, seats, and an Open
  room action.
- `api_client_test.dart` covers the create-room POST payload.
- `room_lobby_test.dart` covers host-panel validation and selected payload.

Gaps:

- Binary room image upload/crop can be added if the web host panel introduces
  it.
- Full media-mode behavior belongs to the live-room RTC steps.

### Live Room

File:

- `mobile/lib/screens/live_room_screen.dart`

Implemented:

- Calls `POST /rooms/:id/join`.
- Requests mic/camera permissions.
- Opens local media and attaches it to an `RTCVideoRenderer`.
- Connects Socket.IO signaling.
- Emits `join-room`.
- Tracks peer refresh, join/leave, and media-state events.
- Creates native peer connections through `RtcPeerConnectionService`.
- Sends and handles WebRTC offers, answers, and ICE candidates.
- Queues early ICE candidates until remote descriptions are ready.
- Renders remote streams with native `RTCVideoRenderer`s in participant tiles.
- Closes stale peer connections when peers leave or the room session is
  replaced.
- Password room access code input.
- Native stage with connection steps, participant tiles, local preview, media
  badges, and room metrics.
- Mic/camera controls update local tracks, backend media state, and signaling
  media state.
- Leave calls `POST /rooms/:id/leave`, stops local media, and clears peers.
- Tool panels for access, chat shell, audio, beauty/background, screen share,
  room ops, and AI guard state.
- `api_client_test.dart` covers join password, media-state, and leave calls.
- `live_room_screen_test.dart` covers password join, media sync, peer
  coordinator sync, participant update, and leave behavior.

Gaps:

- Needs two-device Flutter and mixed Flutter/web media verification.
- Chat panel is a shell only; missing message load/send/edit/delete, direct
  messages, typing, follow/block, and moderation actions.
- Room ops panels are not connected to controls/moderation endpoints yet.
- Missing real screen share, filters/beauty, audio effects, reconnect recovery,
  quality reporting, and participant role controls.

### Profile

File:

- `mobile/lib/screens/profile_screen.dart`

Implemented:

- Profile hero/detail mode with avatar, ID, age, gender, email, and residence.
- Edit mode for name, gender, age, birthday, residence, and avatar URL/data URL.
- Web-matched profile validation messages.
- Avatar removal sends `avatar_url: null` through `PATCH /auth/me`.
- Save through `PATCH /auth/me`, local shell user update, cancel, and logout.
- Native account security, privacy, content preferences, region, and
  terms/policies sections.
- Local profile settings persistence through `ProfileSettingsStore`, matching
  the web localStorage behavior.
- `/profile` and `/settings` named routes are active.
- Room lobby exposes a settings shortcut.
- `api_client_test.dart` covers avatar removal payloads.
- `profile_screen_test.dart` covers profile edit/save, avatar removal, settings
  persistence, and policy navigation.

Gaps:

- Missing native binary avatar picker/crop/compression plugin parity with the
  web file picker.
- Settings are local-only until backend settings endpoints exist.

### Admin

File:

- `mobile/lib/screens/admin_dashboard_screen.dart`

Implemented:

- Loads `GET /admin/overview`.
- Shows native command metrics, current package, invoice, service flow, company
  directory, package plans/requests, SDK app management, room management, usage
  logs, active sessions, and feature controls.
- Calls admin mutation/detail endpoints for company status/detail, SDK app
  generation/rotation/status, package request review/purchase, and room
  creation/status/removal.
- Role-gated from the native shell.

Gaps:

- Still lighter than web `AdminView` for company creation/edit forms, service
  package editing UI, admin invite/delete flows, and dense table controls.
- Use `SCREEN_PARITY.md` for final spacing, copy, and mobile/tablet follow-up
  notes.

### SDK Docs

File:

- `mobile/lib/screens/sdk_docs_screen.dart`

Implemented:

- Loads `GET /rtc/config`.
- Shows app screenshot asset, web-style integration flow, tabbed code samples,
  SDK console payload builder, token claims, API route map, room types, SDK
  methods, events, error codes, webhooks, and media upgrade path.

Gaps:

- Copy/share buttons and exact web wording/layout polish remain after the Step
  19 parity pass.

### WebView Reference

File:

- Removed in Step 20.

Implemented:

- The mobile runtime no longer includes a WebView screen, route, config flag,
  or WebView package dependency.

Migration status:

- Complete. Web source files remain reference documentation only.

## Services

### Signaling

File:

- `mobile/lib/services/signaling_service.dart`

Implemented:

- Socket.IO connection.
- `join-room` ack.
- `room-peers` refresh.
- Typed streams for existing users, peer join/leave, media state, offer,
  answer, ICE, peer signal errors, and session replacement.
- Emit helpers for media state, WebRTC offers, answers, and ICE candidates.
- Event and peer streams.

Gaps:

- Transport order differs from the currently hardened web client.
- No emit/listen helpers for chat, moderation, room controls, or role updates.
- No reconnect room rejoin logic.

### Media

File:

- `mobile/lib/services/rtc_media_service.dart`

Implemented:

- Permission request helper.
- `getUserMedia` helper.
- Live room local media renderer lifecycle.
- Native peer connection manager for local tracks and remote streams.

Gaps:

- No camera switch, screen share capture, background filters, or audio effects.
- No media quality reporting yet.

## UI And Assets

Implemented:

- `RtcPalette`
- `RtcTypography`
- `RtcRadius`
- `RtcShadows`
- `RtcBackdrop`
- `GlassPanel`
- `BrandMark`
- `BrandHeader`
- `GradientButton`
- `GhostButton`
- `RtcIconButton`
- `RtcFilterBar`
- `RtcLoadingPanel`
- `RtcMessagePanel`
- `RtcSectionHeader`
- `StatusPill`
- `MetricChip`
- Asset helper `RtcAssets`
- 49 copied web assets under `mobile/assets/rtc/`
- `RtcAssets.allBundledAssets` tracks the copied bundle.
- `widget_test.dart` verifies the copied assets are registered in Flutter's
  asset manifest.
- `widget_test.dart` verifies palette and typography tokens match the frozen
  web CSS.

Gaps:

- Need fuller native equivalents for web feed cards, modals, drawers, tabs,
  bottom sheets, live controls, chat bubbles, admin tables, SDK code panels,
  and advanced settings/account modals.

## Platform Notes

Android debug manifest currently includes:

- `io.flutter.embedding.android.EnableImpeller = false`
- `io.flutter.embedding.android.EnableSoftwareRendering = true`

Risk:

- These settings can affect platform views and rendering performance. Review
  them before emulator verification, especially for native WebRTC media.

## Test Coverage

Current tests:

- `mobile/test/widget_test.dart` verifies app construction, copied asset
  registration, and frozen design tokens.
- `mobile/test/api_client_test.dart` covers auth/session behavior.
- `mobile/test/login_screen_test.dart` covers auth form validation.
- `mobile/test/room_lobby_test.dart` covers native lobby parsing and feed UI.
- `mobile/test/live_room_screen_test.dart` covers native live-room join,
  password access, peer sync, media-state sync, and leave behavior.
- `mobile/test/profile_screen_test.dart` covers native profile edit/avatar
  removal and settings persistence.
- `mobile/test/admin_sdk_screen_test.dart` covers native admin SDK app
  generation, package request review, and SDK docs reference sections.

Gaps:

- No isolated signaling/media service tests.
- No Android device integration test for two-client WebRTC media.

## Readiness Table

| Area | Status | Notes |
| --- | --- | --- |
| Native shell | Partial | Default launch path with named routes; deep-link parity still incomplete. |
| Auth | Partial | Login/register/session work, web parity incomplete. |
| Room lobby | Ready | Feed tabs, filters, metadata cards, owner delete, search, and refresh. |
| Create room | Ready | Web host fields, validation, toggles, payload, and created-room summary. |
| Live room | Partial | Native stage, local/remote media, peer negotiation, media-state sync, and leave logging; chat/control parity incomplete. |
| Profile | Partial | Native profile/settings parity exists; binary avatar picker/crop and backend settings persistence remain. |
| Admin | Partial | Native core console and mutations exist; remaining gaps are richer company/package/admin-edit workflows and visual comparison. |
| SDK docs | Ready | Native docs expose flow, samples, console payloads, token claims, route map, references, errors, webhooks, and media roadmap. |
| API client | Partial | Core endpoints plus admin mutations exist; remaining web-specific endpoints should be filled as screens require them. |
| Signaling | Partial | Connect/join/listen, peer refresh, media-state, offer/answer/ICE, and peer error streams. |
| Media/WebRTC | Partial | Local preview, peer connection manager, and remote renderers exist; screen share, effects, quality, and device verification remain. |
| UI system | Partial | Good foundation, more widgets needed. |
| Tests | Targeted | App shell, design/assets, auth/session, login, lobby, create-room, live-room, profile/settings, admin, and SDK docs coverage. |

## Step 4 Inputs

The feature map should prioritize:

1. Switchable native app shell and route inventory.
2. Auth parity.
3. Create-room parity.
4. Live room media/signaling/chat parity.
5. Profile/settings parity.
6. Admin parity.
7. SDK docs parity.
8. API endpoint coverage.
10. Tests for every migrated screen.
