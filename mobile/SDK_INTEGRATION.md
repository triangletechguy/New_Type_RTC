# Mobile RTC SDK Integration

This mobile SDK file is for client-company apps that need to connect their own users to the RTC service:

```text
mobile/lib/sdk/rtc_enterprise_client_sdk.dart
```

For the client requirement checklist, reference-frame summary, and Flutter build commands, see:

```text
mobile/CLIENT_REQUIREMENTS_AND_FLUTTER_BUILD.md
```

The SDK uses the public client integration API under `/api/client/*`. It does not use the internal `/api/admin/*` dashboard routes.

## Admin Names

Use these names in UI and docs:

- Platform service admin: the TalkEachOther/service-side operator. This maps to the internal `super_admin` role and manages companies, packages, app credentials, and billing.
- Company service admin: the client-company operator. This maps to the internal `client_admin` role and manages only that company's RTC service, app access, users, rooms, and usage.
- Room admin: an in-room role for RTC moderation. This still serializes to the backend value `admin`, but SDK code should call it `RtcRoomRole.roomAdmin` so it is not confused with company/service admins.

## Client App Flow

1. A platform service admin or company service admin creates app credentials in the service console.
2. The client mobile backend stores the API key securely. Do not hard-code the API key in a public app build.
3. The mobile app asks the client backend for short-lived join data, or the client backend calls this SDK directly in a trusted runtime.
4. Sync the company's external user with `/api/client/users/sync`.
5. Create or fetch a room with `/api/client/rooms`.
6. Issue an RTC token with `/api/client/rtc/token`.
7. Use the returned `signaling_room`, `room.id`, `external_user.user_id`, and `rtc_token` with the mobile media layer.
8. Start and end session usage with `/api/client/rtc/session/start` and `/api/client/rtc/session/end`.

## Dart Example

```dart
import 'package:rtc_enterprise_mobile/sdk/rtc_enterprise_client_sdk.dart';

final sdk = RtcEnterpriseClientSdk(
  apiBaseUrl: 'https://example.com/api',
  apiKey: clientApiKey,
);

await sdk.syncExternalUser(
  const RtcExternalUserSyncRequest(
    externalUserId: 'company-user-123',
    name: 'Client User',
    email: 'user@example.com',
  ),
);

final roomResponse = await sdk.createRoom(
  const RtcRoomCreateRequest(
    externalUserId: 'company-user-123',
    name: 'Mobile video room',
    roomType: 'video',
    screenShareEnabled: true,
  ),
);

final room = roomResponse['room'] as Map<String, dynamic>;
final token = await sdk.issueRtcToken(
  RtcTokenRequest(
    externalUserId: 'company-user-123',
    roomId: room['id'] as int,
    role: RtcRoomRole.publisher,
    rtcMode: 'video',
  ),
);

await sdk.startSession(
  RtcSessionRequest(
    externalUserId: 'company-user-123',
    roomId: room['id'] as int,
    role: RtcRoomRole.publisher,
    rtcMode: token.mediaType,
  ),
);
```

The `new_mobileRTC` Android sample remains useful as a media-layer reference for Agora camera, microphone, screen-share, effects, and channel behavior. This SDK handles the TalkEachOther tenant, user, room, token, and usage API layer around that media SDK.
