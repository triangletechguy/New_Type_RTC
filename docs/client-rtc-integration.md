# Client RTC Integration Guide

This guide explains how a client company can use the RTC service from its own system.

## Option A: Use The Hosted Web App

This is the fastest path.

1. Deploy the web RTC platform to a domain.
2. Client users open the domain in a browser.
3. Users sign up or log in.
4. Users create or join rooms.
5. Browser asks for camera/microphone permission.
6. RTC starts in the web room.

This does not require Flutter.

## Option B: Integrate From Client Backend Or App

The project includes a client-company API under:

```text
/api/client/*
```

Client API requests use:

```text
x-rtc-api-key: CLIENT_API_KEY
```

or:

```text
Authorization: Bearer CLIENT_API_KEY
```

The API key is created/rotated from the admin client-company SDK/app section.

## Client Integration Flow

### 1. Verify API Key

```bash
curl -X GET https://chadnichok.com/api/client/me \
  -H "x-rtc-api-key: CLIENT_API_KEY"
```

### 2. Sync External User

Before a client user can join a room, sync that user into the RTC system.

```bash
curl -X POST https://chadnichok.com/api/client/users/sync \
  -H "Content-Type: application/json" \
  -H "x-rtc-api-key: CLIENT_API_KEY" \
  -d '{
    "external_user_id": "client-user-123",
    "name": "Client User",
    "email": "user@example.com",
    "avatar_url": "https://example.com/avatar.png",
    "status": "active"
  }'
```

### 3. Create A Room

```bash
curl -X POST https://chadnichok.com/api/client/rooms \
  -H "Content-Type: application/json" \
  -H "x-rtc-api-key: CLIENT_API_KEY" \
  -d '{
    "external_user_id": "client-user-123",
    "name": "Team Video Room",
    "description": "Client team room",
    "room_type": "normal_video_group_chat",
    "privacy_type": "public",
    "max_mic_count": 12,
    "chat_enabled": true,
    "gift_enabled": true,
    "screen_share_enabled": true,
    "ai_security_enabled": true
  }'
```

### 4. List Rooms

```bash
curl -X GET "https://chadnichok.com/api/client/rooms?status=active" \
  -H "x-rtc-api-key: CLIENT_API_KEY"
```

### 5. Request An RTC Token

The token represents a client user permission to use a room.

```bash
curl -X POST https://chadnichok.com/api/client/rtc/token \
  -H "Content-Type: application/json" \
  -H "x-rtc-api-key: CLIENT_API_KEY" \
  -d '{
    "external_user_id": "client-user-123",
    "room_id": 101,
    "role": "publisher",
    "rtc_mode": "video"
  }'
```

### 6. Start A Session

```bash
curl -X POST https://chadnichok.com/api/client/rtc/session/start \
  -H "Content-Type: application/json" \
  -H "x-rtc-api-key: CLIENT_API_KEY" \
  -d '{
    "external_user_id": "client-user-123",
    "room_id": 101,
    "rtc_mode": "video"
  }'
```

### 7. End A Session

```bash
curl -X POST https://chadnichok.com/api/client/rtc/session/end \
  -H "Content-Type: application/json" \
  -H "x-rtc-api-key: CLIENT_API_KEY" \
  -d '{
    "external_user_id": "client-user-123",
    "room_id": 101,
    "rtc_mode": "video"
  }'
```

## Important Concept

The client API manages users, rooms, permissions, sessions, and usage. The actual audio/video connection still needs an RTC frontend:

- the existing web frontend, or
- a future Flutter app using a Flutter WebRTC package, or
- another browser frontend using the same signaling and room/session concepts.

## Flutter Position

Flutter is not required for the current web platform.

Flutter is needed only if the client wants a native mobile app for Google Play Store or Apple App Store. That would be a second-phase mobile frontend connected to this backend.
