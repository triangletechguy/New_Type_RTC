# Client Handoff Response

Use this when a client asks whether the RTC is AI-generated or unorganized.

```text
This is not a random AI-generated UI. It is a browser-based WebRTC platform organized into clear layers:

1. React web frontend for login, room list, live room UI, mic/camera controls, chat, and service admin views.
2. Browser media layer for camera and microphone permission/capture.
3. Native WebRTC peer connection layer using RTCPeerConnection for audio/video.
4. Socket.IO signaling server for room presence, offer/answer exchange, ICE candidates, chat, and media state events.
5. Express backend APIs for auth, rooms, join/leave sessions, client-company API, service admin, and RTC config.
6. MySQL persistence for users, rooms, sessions, participants, chat, events, tenants, and usage.
7. STUN/TURN configuration for production WebRTC reliability.

Users use the RTC from the deployed domain:
https://chadnichok.com/

Flutter is not part of the current web delivery. Flutter would be a separate native Android/iOS frontend if the client wants a mobile app for Google Play Store or Apple App Store. That app can connect to the same backend, room API, token/session API, signaling concept, and WebRTC flow.
```

## What Is Already Organized

- Web app: `frontend/src/components/rtc/LiveRoomView.jsx`
- Camera/mic capture: `frontend/src/services/media.js`
- WebRTC peer connection: `frontend/src/services/rtcClient.js`
- Socket signaling client: `frontend/src/services/signaling.js`
- Signaling server: `backend/src/sockets/signaling.js`
- Room/session API: `backend/src/routes/roomRoutes.js`
- Client-company API: `backend/src/routes/clientRoutes.js`
- Database model: `database/schema.sql`

## Simple Client Flow

1. User opens `https://chadnichok.com/`.
2. User signs up or logs in.
3. User creates or joins a room.
4. Browser asks for camera/microphone permission.
5. Frontend joins the backend room/session API.
6. Frontend connects to Socket.IO signaling.
7. Browsers exchange WebRTC offer/answer/ICE candidates.
8. Audio/video flows peer-to-peer where possible, or through TURN when direct connection is blocked.
