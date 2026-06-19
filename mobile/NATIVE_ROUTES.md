# Native Route Map

Captured on 2026-06-14.

The mobile app uses native Flutter routes only. The former web reference route
was removed in Step 20.

## Route Registry

The route constants and typed arguments live in:

- `mobile/lib/navigation/app_routes.dart`

| Route | Purpose | Current Owner | Status |
| --- | --- | --- | --- |
| `/` | App root/native shell | `NativeRtcShell` | Active |
| `/login` | Auth state inside native shell | `LoginScreen` | Reserved by shell |
| `/rooms` | Authenticated room lobby | `RoomListScreen` | Reserved by shell |
| `/room` | Live room detail | `LiveRoomScreen` | Active named route |
| `/profile` | Profile editor | `ProfileScreen` | Active named route |
| `/admin` | Service console | `AdminDashboardScreen` | Active named route |
| `/settings` | Profile/settings parity work | Future settings screen | Reserved |
| `/error` | Native route error state | `NativeRouteErrorScreen` | Active |

## Routing Rules

- Normal app startup opens `NativeRtcShell`.
- `NativeRtcShell` owns auth restoration and decides whether to show login or
  rooms.
- Live room, profile, and admin open through named routes.
- Unknown or malformed routes render a native route error screen.
- Service console routes require a `client_admin` or `super_admin` user.

## Next Routing Work

The reserved `/settings` route opens the native profile/settings screen. Future
routing work should focus on deep links and notification entry points.
