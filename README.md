# talk-each-other RTC Enterprise

TalkEachOther video and music room platform using native WebRTC:

- React + Vite frontend
- Node.js + Express backend
- Socket.IO signaling
- MySQL database

## Local Windows run order

1. Start XAMPP MySQL.
2. Initialize database once:

```powershell
cd C:\rtc-enterprise\backend
npm install
npm run db:init
```

3. Start backend:

```powershell
cd C:\rtc-enterprise\backend
npm run dev
```

Backend health:

```txt
http://127.0.0.1:8000/api/health
```

4. Start frontend:

```powershell
cd C:\rtc-enterprise\frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

```txt
http://localhost:5173
```

## Default account

```txt
Superadmin: admin@gmail.com / admin@gmail.com
```

## Seed data

Run `npm run db:seed` to create or refresh production bootstrap data and remove
known seeded demo rooms. It does not create demo rooms.

Run `npm run db:seed:demo` only in a local demonstration environment if you need
sample rooms, seeded chat messages, moderation examples, and usage logs.

## Email verification

Signup creates a pending account and requires a 6-digit verification code before
login. For production email, the simplest setup is Resend:

```bash
RESEND_API_KEY=re_xxxxxxxxx
EMAIL_FROM="TalkEachOther <verify@yourdomain.com>"
```

Standard SMTP is also supported:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="TalkEachOther <verify@yourdomain.com>"
```

The backend also accepts Laravel-style aliases, which are normalized to the same
SMTP config:

```bash
MAIL_MAILER=smtp
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USERNAME=your-smtp-user
MAIL_PASSWORD=your-smtp-password
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=verify@yourdomain.com
MAIL_FROM_NAME="TalkEachOther"
```

If no email provider is configured, local development still enters the code
verification screen and prints/returns a local verification code for testing.

## Notes

- Use `http://localhost:5173` locally, not HTTPS.
- Backend and Socket.IO signaling run together on `http://127.0.0.1:8000`.
- Frontend uses `VITE_MEDIA_MODE=real` by default for real camera/microphone.
- Use `VITE_MEDIA_MODE=mock` in `frontend/.env` only when you need a generated test stream.
- Browsers require HTTPS for real camera/microphone access on deployed servers.
- Production RTC should use a TURN server. The browser loads ICE/TURN settings
  from `/api/rtc/config`. For coturn production, set `TURN_URLS` and
  `TURN_SHARED_SECRET`; the backend returns short-lived HMAC TURN credentials
  instead of exposing one permanent password. Open `3478/tcp`, `3478/udp`,
  `5349/tcp`, and the relay UDP range configured by coturn.

## WebRTC Architecture

This is a browser-based RTC platform. It is organized into:

- React RTC room UI
- browser media capture
- native `RTCPeerConnection` logic
- Socket.IO signaling
- Express room/session APIs
- MySQL persistence
- STUN/TURN configuration for production RTC reliability
- client-company API for external app integration

Read:

- [`docs/webrtc-architecture.md`](docs/webrtc-architecture.md)
- [`docs/client-rtc-integration.md`](docs/client-rtc-integration.md)
- [`docs/client-handoff-response.md`](docs/client-handoff-response.md)

Client-facing summary:

```txt
This is a web RTC platform. Users can use it from the deployed domain in a browser.
Flutter is not required for the current delivery. If a native Android/iOS app is
needed later, Flutter can be built as a separate mobile frontend connected to
this backend and RTC API.
```

## WSL Ubuntu run order

Use a Linux Node.js/npm install inside WSL. Do not use the Windows `npm` from
`/mnt/c/Program Files/nodejs`.

This machine is configured with Node.js at:

```bash
~/.local/node/bin/node
```

Start XAMPP MySQL on Windows, then run the project from the repo root:

```bash
cd ~/rtc-enterprise
npm run db:host:wsl
npm run install:all
npm run db:init
npm run dev
```

To run backend and frontend in separate terminals:

```bash
# Terminal 1: backend API + Socket.IO
cd ~/rtc-enterprise
npm run dev:backend
```

```bash
# Terminal 2: Vite frontend
cd ~/rtc-enterprise
npm run dev:frontend
```

Open:

```txt
http://127.0.0.1:5173
```

Useful root scripts:

```bash
npm run check        # backend syntax check + frontend production build
npm run health       # backend, database, and frontend health checks
npm run db:host:wsl  # refresh backend/.env DB_HOST after WSL restarts
npm run db:init      # create/refresh database tables and seed admin user
npm run db:seed      # create/refresh production bootstrap data; removes demo rooms
npm run db:seed:demo # opt-in local demo rooms and sample RTC history
npm run e2e          # run full API + DB end-to-end smoke with cleanup
npm run dev:backend  # run only backend API + signaling
npm run dev:frontend # run only frontend on 127.0.0.1:5173
npm run backend:check
npm run frontend:check
```

For final UI polish, see `docs/assets-needed.md`.

If the API health check says `Host ... is not allowed to connect`, grant XAMPP
MySQL access for the WSL subnet from the Windows/XAMPP MySQL client.
