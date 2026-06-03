# WebRTC Architecture

This project is an organized browser-based RTC platform. It is not a Flutter SDK and it is not a random static UI. The product is a web RTC app with a backend API, signaling server, database, and TURN relay configuration.

## What The Client Gets

Clients can use the RTC service in two ways:

1. **Hosted web RTC platform**
   Users open the deployed domain, log in, create or join rooms, allow camera/microphone, and use RTC in the browser.

2. **Client app integration**
   A client company can connect its own app/backend to the RTC API to sync users, create rooms, request RTC tokens, and track sessions. A native Flutter app would be a separate frontend that connects to these same backend concepts.

## Runtime Layers

```text
User browser
  |
  | React/Vite UI
  | - login/signup
  | - room list
  | - live room UI
  | - camera/mic controls
  |
  +--> REST API: /api/*
  |    - auth
  |    - rooms
  |    - join/leave sessions
  |    - chat
  |    - admin/client company management
  |
  +--> Socket.IO: /socket.io
  |    - join signaling room
  |    - relay WebRTC offer/answer
  |    - relay ICE candidates
  |    - media state updates
  |
  +--> WebRTC peer connection
       - direct audio/video between browsers when possible
       - STUN/TURN used for NAT traversal
       - TURN relays media when direct peer connection fails

Backend
  |
  +--> Express API
  +--> Socket.IO signaling
  +--> MySQL persistence
  +--> TURN config endpoint

Database
  |
  +--> users, tenants, client_apps
  +--> rooms
  +--> rtc_sessions
  +--> rtc_session_participants
  +--> rtc_events
  +--> chat_messages
  +--> usage logs
```

## Important Files

### Frontend RTC

- `frontend/src/components/rtc/LiveRoomView.jsx`
  Main RTC room controller. It handles room join, local media, signaling connection, peer negotiation, chat, gifts, screen sharing, mic/camera state, and cleanup.

- `frontend/src/services/media.js`
  Browser camera/microphone permission and stream capture. It supports real camera/mic and mock media for local testing.

- `frontend/src/services/rtcClient.js`
  Native WebRTC peer connection layer. It creates `RTCPeerConnection`, attaches local tracks, receives remote tracks, handles offer/answer, handles ICE candidates, replaces tracks, renegotiates, and closes peers.

- `frontend/src/services/signaling.js`
  Socket.IO client wrapper. It connects to the backend signaling server and joins a signaling room.

- `frontend/src/components/rtc/VideoTile.jsx`
  Displays local and remote media streams.

### Backend RTC

- `backend/src/server.js`
  Express app and Socket.IO server. It exposes `/api/rtc/config` so the browser can load STUN/TURN settings from production env.

- `backend/src/sockets/signaling.js`
  Signaling relay. It does not process media. It only relays room presence, WebRTC offers, answers, ICE candidates, media state changes, moderation events, and chat broadcasts.

- `backend/src/routes/roomRoutes.js`
  User-facing room APIs. Includes room list, create/update room, join room, leave room, media state updates, and session persistence.

- `backend/src/routes/clientRoutes.js`
  Client-company integration API. It supports syncing external users, creating/listing rooms, issuing RTC tokens, starting sessions, ending sessions, usage tracking, audit logs, and webhook events.

- `database/schema.sql`
  Database model for tenants, client apps, users, rooms, RTC sessions, participants, events, chat, billing, and usage.

## WebRTC Join Flow

When a user joins a room:

1. The frontend calls the room join API.
   Example backend path: `POST /api/rooms/:id/join`

2. Backend verifies:
   - room exists
   - room is active
   - password/private rules
   - room capacity
   - user/session state

3. Backend creates or updates:
   - `rtc_sessions`
   - `rtc_session_participants`
   - `rtc_events`

4. Frontend loads ICE/TURN config from:
   - `GET /api/rtc/config`

5. Frontend captures local media:
   - camera and mic for video rooms
   - mic only for audio rooms

6. Frontend opens Socket.IO signaling:
   - `/socket.io`

7. Frontend joins the signaling room returned by the backend.

8. Each browser creates peer connections with other users:
   - offer
   - answer
   - ICE candidate exchange

9. Media flows peer-to-peer where possible, or through TURN when needed.

10. When the user leaves, the frontend closes tracks, closes peer connections, disconnects the socket, and calls the leave/session APIs.

## Production Requirements

Real RTC in production needs:

- HTTPS domain
- backend API reachable from frontend
- Socket.IO websocket proxy configured
- browser camera/microphone permissions
- STUN server
- TURN server for reliable production calls
- MySQL running
- backend env configured
- frontend env pointing to the production API/domain

Current production env keys:

```text
FRONTEND_ORIGINS=https://chadnichok.com
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:chadnichok.com:3478?transport=udp,turn:chadnichok.com:3478?transport=tcp
TURN_SHARED_SECRET=...
TURN_TTL_SECONDS=3600
RTC_ICE_TRANSPORT_POLICY=all
```

Production coturn is configured with `use-auth-secret` and
`static-auth-secret`. The backend signs temporary TURN usernames with HMAC-SHA1
and returns them from `/api/rtc/config`, so browsers receive short-lived TURN
credentials instead of one reusable server password.

## What To Tell A Client

```text
This is a web RTC platform. The RTC is organized into frontend media capture, WebRTC peer connection logic, Socket.IO signaling, backend room/session APIs, MySQL persistence, and TURN relay configuration.

Users can use it directly from the deployed domain in a browser. If you want a native Flutter app, that is a separate mobile frontend that can connect to the same backend/API, but the current delivered product is the web RTC platform.
```
