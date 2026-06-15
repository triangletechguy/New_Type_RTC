# MP4 Behavior Reference

Updated: 2026-06-14 America/New_York

This document freezes `video6115948754223768409.mp4` as the behavior and UX
reference for the native Flutter rebuild. The video is a reference for product
flow, layout structure, interaction states, and feature coverage only.

## Reference File

- File: `mobile/video6115948754223768409.mp4`
- Matching web copy: `frontend/public/mobile-room-reference.mp4`
- SHA-256:
  `84aaf3754bc6fd0d54b86fce3059e18a305a377c39fa326b75bc62683df7b39f`
- Video size: `580x1280`
- Duration: about `267.7` seconds

## Hard Asset Rule

Do not use, crop, trace, recreate, or ship visual assets from the MP4.

Not allowed:

- avatars shown in the video
- room cover images shown in the video
- gift images, badges, logos, stickers, or branded marks from the video
- screenshots or extracted frames from the video committed into the app
- copied background illustrations or decorative images from the video

Allowed:

- current project-owned assets under `mobile/assets/rtc/`
- backend-provided user or room images when they belong to this product
- original Flutter-rendered UI shapes, gradients, badges, and icon buttons
- original generated or user-provided licensed assets added later
- the MP4's layout, screen order, interaction patterns, and state behavior

Temporary extracted frames may be used only for local visual analysis. Keep
them outside the repository, such as under `/tmp`.

## Screens Observed

The MP4 reference contains these major mobile surfaces:

1. Lobby/home feed with a teal illustrated header, top tabs, compact room rows,
   floating reward button, and bottom navigation.
2. Feed filters/tabs such as Mine, Popular, Explore, Recently, Follow, and
   Group.
3. Reward/sign-in modal overlay.
4. Live room with dark red/purple stage, room header, media/player section,
   mic-seat grid, chat stream, bottom composer, and floating gift/tool actions.
5. Live room keyboard states while composing chat.
6. Video/music close confirmation modal.
7. Direct message or user chat screen with a yellow top bar and message input.
8. Room side/profile panel showing user list and moments.
9. Group member list screen.
10. Room profile/member privilege bottom sheet.
11. Room options bottom sheet with lock, password, theme, share, admin, and
    history actions.
12. Settings screen with profile, room name, announcement, room title, blocked
    list, kick history, remove history, operate history, live record/balance,
    and guidance rows.

## Flutter Build Interpretation

Match the MP4 at the product level:

- Keep the app dense and mobile-first.
- Use a compact room-feed row system, not oversized dashboard cards.
- Keep live rooms focused on seats, chat, and quick controls.
- Prefer bottom sheets for room tools and member actions.
- Keep chat composer and keyboard behavior stable.
- Keep RTC state visible through simple labels such as live, connected,
  joining, muted, locked, or seat states.

Do not match the MP4 by copying its content:

- Use backend room names, users, participant counts, and messages.
- Use TalkEachOther/project branding.
- Use project-owned images or original generated placeholders.
- Use Flutter icons and original badge styles for features and gifts.

## Step 1 Acceptance Criteria

- The MP4 is documented as the current UX and behavior reference.
- Asset-copy restrictions are explicit.
- Future design work can reference screen flow and layout without importing
  MP4 visuals.
- No extracted MP4 frames or third-party assets are committed to the repo.

## Next Step

Step 2 should rebuild the native Flutter design system around original
TalkEachOther assets and widgets that can support the lobby and live-room
structures described above.
