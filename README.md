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
Superadmin: superadmin@talkeachother.com / 123!@#
Accenture admin: admin@accenture.com / 123!@#
```

## Demo seed data

```txt
Password room password: Room@1234
```

Run `npm run db:seed` to create or refresh the two admin accounts, demo rooms,
active RTC sessions, chat messages, moderation examples, and verified usage logs.

## Notes

- Use `http://localhost:5173` locally, not HTTPS.
- Backend and Socket.IO signaling run together on `http://127.0.0.1:8000`.
- Frontend uses `VITE_MEDIA_MODE=real` by default for real camera/microphone.
- Use `VITE_MEDIA_MODE=mock` in `frontend/.env` only when you need a generated test stream.
- Browsers require HTTPS for real camera/microphone access on deployed servers.
- Production peer-to-peer video should use a TURN server. The browser now loads
  ICE/TURN settings from the backend at `/api/rtc/config`, so set `TURN_URLS`,
  `TURN_USERNAME`, and `TURN_CREDENTIAL` in `backend/.env` or PM2 env, then
  restart the backend.

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
npm run db:seed      # create/refresh idempotent demo data
npm run e2e          # run full API + DB end-to-end smoke with cleanup
npm run dev:backend  # run only backend API + signaling
npm run dev:frontend # run only frontend on 127.0.0.1:5173
npm run backend:check
npm run frontend:check
```

For final UI polish, see `docs/assets-needed.md`.

If the API health check says `Host ... is not allowed to connect`, grant XAMPP
MySQL access for the WSL subnet from the Windows/XAMPP MySQL client.
