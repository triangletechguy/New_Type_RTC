# Native Flutter Design System

Captured on 2026-06-14.
Updated for MP4 behavior-reference Step 2 on 2026-06-14.

The native mobile app should build screens from shared Flutter widgets in
`mobile/lib/ui/rtc_mobile_ui.dart`. Screen files may still own feature-specific
layout, but generic controls, loading states, empty/error states, and common
headers should live in the UI layer.

## Token Layer

Current source:

- `RtcPalette`
- `RtcTypography`
- `RtcRadius`
- `RtcSpacing`
- `RtcShadows`
- `RtcBackdrop`
- `GlassPanel`

Frozen web token match:

- Background: `#0a1020`
- Surfaces: `#121827`, `#182133`, `#202a3f`
- Lines: `rgba(148, 163, 184, .2)`,
  `rgba(226, 232, 240, .28)`
- Text: `#f8fafc`, `#d7e0ef`, `#a8b3c7`
- Accents: `#ff3f7f`, `#ff7a45`, `#38bdf8`, `#34d399`,
  `#8b5cf6`, `#f59e0b`, `#ef4444`
- Typography family: `Inter`, with platform fallbacks.

Guard:

- `widget_test.dart` checks the Flutter palette and typography constants
  against the frozen web values.

## MP4 Behavior Reference Update

The MP4 in `mobile/video6115948754223768409.mp4` is a behavior and layout
reference only. The design system must not copy, crop, trace, or ship avatars,
room covers, gifts, logos, screenshots, backgrounds, badges, or decorative
assets from that video.

The updated UI layer adds original TalkEachOther-native primitives for the
mobile app shape shown in the reference:

- light lobby colors: `lobbyBg`, `lobbySurface`, `lobbyInk`, `lobbySoft`,
  `lobbyMuted`, `lobbyLine`, `lobbyTeal`, `lobbyTealDark`, `lobbyMint`,
  `lobbyGold`, and `lobbyGoldSoft`
- dark live-room colors: `stageBg`, `stageWine`, `stagePlum`, `stagePanel`,
  `stagePanelSoft`, `stageLine`, and `chatPurple`
- shared spacing constants in `RtcSpacing`

## Brand And Identity

Current source:

- `BrandMark`
- `BrandHeader`
- `InitialAvatar`
- `RtcAvatarToken`
- `RoomGradientCover`

Asset source:

- `mobile/lib/ui/rtc_assets.dart`
- `mobile/assets/rtc/`
- `mobile/ASSETS.md`

## Controls

Shared native controls:

- `GradientButton`
- `GhostButton`
- `RtcIconButton`
- `RtcFilterBar`
- `RtcCompactTabs`
- `RtcMobileBottomNav`
- `RtcRewardButton`
- `StatusPill`
- `MetricChip`
- `RtcMiniBadge`

Usage rule:

- Use `RtcIconButton` for square toolbar/header actions.
- Use `RtcFilterBar` for horizontal segmented/filter choices.
- Use `GradientButton` for primary destructive-free actions.
- Use `GhostButton` for secondary actions.

## States And Structure

Shared native state/structure widgets:

- `RtcMobileFrame`
- `RtcLobbyHero`
- `RtcLoadingPanel`
- `RtcMessagePanel`
- `RtcSectionHeader`
- `RtcActionSheetPanel`
- `RtcSheetActionTile`

Usage rule:

- Use `RtcLoadingPanel` for screen-section loading rows.
- Use `RtcMessagePanel` for empty/error/retry states.
- Use `RtcSectionHeader` for panel headings with eyebrow, title, and detail.

## Step 8 Refactor Coverage

The following screens now use shared design-system widgets instead of local
duplicates:

- `RoomListScreen`
- `AdminDashboardScreen`
- `SdkDocsScreen`
- `LiveRoomScreen`

Remaining future design-system work:

- Screen integration of the new lobby and live-room primitives.
- Admin tables/lists.
- SDK code panels and copy controls.
- Settings rows and grouped forms.

## New Step 2 Widgets

These widgets exist so Step 3 and later can rebuild screens without local
one-off UI:

- `RtcMobileFrame`: native mobile scaffold with optional bottom navigation.
- `RtcLobbyHero`: compact top hero/header for the light lobby surface.
- `RtcMobileBottomNav`: app-style bottom navigation with optional badges.
- `RtcCompactTabs`: small horizontal tabs for lobby/live filters.
- `RtcLobbyRoomRow`: compact room/feed row using project or backend images.
- `RtcRewardButton`: original floating reward/action button.
- `RtcStageSeat`: reusable live-room mic seat with open, occupied, speaking,
  muted, and locked states.
- `RtcStageActionButton`: compact live-room control button.
- `RtcChatBubble`: chat message bubble for live-room streams.
- `RtcChatComposer`: keyboard-safe message composer.
- `RtcActionSheetPanel` and `RtcSheetActionTile`: bottom sheet shell and rows
  for lock, password, theme, share, admin, and history actions.
