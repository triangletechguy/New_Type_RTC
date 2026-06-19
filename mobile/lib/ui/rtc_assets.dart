import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';

class RtcAssets {
  const RtcAssets._();

  static const root = 'assets/rtc';

  static const brandAppIcon = '$root/modern-project-svgs/site_icon.svg';
  static const brandAppIconSmall = '$root/modern-project-svgs/site_avatar.svg';
  static const brandAppScreenshots = '$root/brand/app-screenshots.png';

  static const liveRoomsIcon = '$root/modern-project-svgs/live_rooms_icon.svg';
  static const liveRoomsAvatar =
      '$root/modern-project-svgs/live_rooms_avatar.svg';
  static const adminDashboardIcon =
      '$root/modern-project-svgs/admin_dashboard_icon.svg';
  static const adminDashboardAvatar =
      '$root/modern-project-svgs/admin_dashboard_avatar.svg';
  static const feedbackHelpIcon =
      '$root/modern-project-svgs/feedback_help_icon.svg';
  static const feedbackHelpAvatar =
      '$root/modern-project-svgs/feedback_help_avatar.svg';
  static const settingsIcon = '$root/modern-project-svgs/settings_icon.svg';

  static const composerMic = '$root/live-ui/composer-mic.svg';
  static const composerPhoto = '$root/live-ui/photo.svg';
  static const railLive = '$root/live-ui/rail-live.svg';
  static const railMoments = '$root/live-ui/rail-moments.svg';
  static const seatLock = '$root/live-ui/seat-lock.svg';
  static const seatMic = '$root/live-ui/seat-mic.svg';
  static const send = '$root/live-ui/send.svg';

  static const backAvatar = '$root/avatars/back_avatar.svg';
  static const messageAvatar = '$root/avatars/message_avatar.svg';
  static const rankingAvatar = '$root/avatars/ranking_avatar.svg';

  static const loadingMovie = '$root/loading.gif';
  static const emptySessions = '$root/admin/empty-sessions.png';
  static const sidebarEmpty = '$root/admin/sidebar-empty.png';

  static const smartBars = '$root/asset-image2/smart-bars.png';
  static const smartCreatorAvatar =
      '$root/asset-image2/smart-creator-avatar.png';
  static const smartGoatHeader = '$root/asset-image2/smart-goat-header.png';
  static const smartGroupIcon = '$root/asset-image2/smart-group-icon.png';
  static const smartHomeIcon = '$root/asset-image2/smart-home-icon.png';
  static const smartLockIcon = '$root/asset-image2/smart-lock-icon.png';
  static const smartMobileHeroBg =
      '$root/asset-image2/smart-mobile-hero-bg.png';
  static const smartSearchIcon = '$root/asset-image2/smart-search-icon.png';

  static const avatarAssets = [
    '$root/avatars/avatar-01.png',
    '$root/avatars/avatar-02.png',
    '$root/avatars/avatar-03.png',
    '$root/avatars/avatar-04.png',
    '$root/avatars/avatar-05.png',
    '$root/avatars/avatar-06.png',
    '$root/avatars/avatar-07.png',
    '$root/avatars/avatar-08.png',
  ];

  static const audioDuet = '$root/rooms/audio-duet.png';
  static const audioStage = '$root/rooms/audio-stage.png';
  static const avatarGrid = '$root/rooms/avatar-grid.png';
  static const cameraOff = '$root/rooms/camera-off.png';
  static const musicRoom = '$root/rooms/music-room.png';
  static const passwordRoom = '$root/rooms/password-room.png';
  static const privateRoom = '$root/rooms/private-room.png';
  static const soloLive = '$root/rooms/solo-live.png';
  static const stageMoods = '$root/rooms/stage-moods.png';
  static const studioStage = '$root/rooms/studio-stage.png';
  static const videoRoom = '$root/rooms/video-room.png';

  static const coverRotation = [
    videoRoom,
    musicRoom,
    soloLive,
    studioStage,
    audioStage,
    audioDuet,
    stageMoods,
    avatarGrid,
  ];

  static const allBundledAssets = [
    brandAppIcon,
    brandAppIconSmall,
    brandAppScreenshots,
    liveRoomsIcon,
    liveRoomsAvatar,
    adminDashboardIcon,
    adminDashboardAvatar,
    feedbackHelpIcon,
    feedbackHelpAvatar,
    settingsIcon,
    composerMic,
    composerPhoto,
    railLive,
    railMoments,
    seatLock,
    seatMic,
    send,
    backAvatar,
    messageAvatar,
    rankingAvatar,
    loadingMovie,
    emptySessions,
    sidebarEmpty,
    smartBars,
    smartCreatorAvatar,
    smartGoatHeader,
    smartGroupIcon,
    smartHomeIcon,
    smartLockIcon,
    smartMobileHeroBg,
    smartSearchIcon,
    ...avatarAssets,
    audioDuet,
    audioStage,
    avatarGrid,
    cameraOff,
    musicRoom,
    passwordRoom,
    privateRoom,
    soloLive,
    stageMoods,
    studioStage,
    videoRoom,
  ];

  static const initialAvatarThemes = [
    [Color(0xFF9259FE), Color(0xFF6365FF)],
    [Color(0xFFF97316), Color(0xFFEF4444)],
    [Color(0xFF06B6D4), Color(0xFF2563EB)],
    [Color(0xFF22C55E), Color(0xFF0F766E)],
    [Color(0xFFEC4899), Color(0xFF8B5CF6)],
    [Color(0xFFF59E0B), Color(0xFFDC2626)],
    [Color(0xFF14B8A6), Color(0xFF7C3AED)],
    [Color(0xFF64748B), Color(0xFF111827)],
  ];

  static String avatarForIndex(int index) {
    return avatarAssets[_safeIndex(index, avatarAssets.length)];
  }

  static ImageProvider avatarImageForUser(AppUser user) {
    final avatarUrl = user.avatarUrl.trim();
    if (_isRemoteImage(avatarUrl)) return NetworkImage(avatarUrl);
    if (avatarUrl.startsWith('assets/')) return AssetImage(avatarUrl);
    return AssetImage(avatarForIndex(user.id));
  }

  static bool hasCustomAvatar(AppUser user) {
    final avatarUrl = user.avatarUrl.trim();
    return _isRemoteImage(avatarUrl) || avatarUrl.startsWith('assets/');
  }

  static bool shouldUseAdminAvatar(AppUser user) {
    return user.canUseAdminDashboard && !hasCustomAvatar(user);
  }

  static List<Color> initialGradientForUser(AppUser user) {
    final seed = _hashString('${user.name}-${user.id}');
    return initialAvatarThemes[_safeIndex(seed, initialAvatarThemes.length)];
  }

  static String coverForRoomType(
    String roomType,
    String privacyType, [
    int index = 0,
  ]) {
    final normalizedRoomType = roomType.toLowerCase();
    final normalizedPrivacy = privacyType.toLowerCase();

    if (normalizedPrivacy == 'password') return passwordRoom;
    if (normalizedPrivacy == 'private') return privateRoom;

    if (normalizedRoomType == 'audio') return musicRoom;
    if (normalizedRoomType == 'youtube_audio') return musicRoom;
    if (normalizedRoomType == 'one_to_one_audio') return audioDuet;
    if (normalizedRoomType == 'group_audio') return audioDuet;
    if (normalizedRoomType == 'group_video') return videoRoom;
    if (normalizedRoomType == 'solo_live') return soloLive;
    if (normalizedRoomType == 'pk_live') return studioStage;
    if (normalizedRoomType == 'one_to_one_video') return videoRoom;
    if (normalizedRoomType == 'video') return videoRoom;

    return coverRotation[_safeIndex(index, coverRotation.length)];
  }

  static ImageProvider coverImageForRoom(Room room, int index) {
    final profileImage = room.profileImage.trim();
    if (_isRemoteImage(profileImage)) return NetworkImage(profileImage);
    if (profileImage.startsWith('assets/')) return AssetImage(profileImage);
    return AssetImage(coverForRoomType(room.roomType, room.privacyType, index));
  }

  static ImageProvider? imageProviderFromValue(String value) {
    final trimmed = value.trim();
    if (_isRemoteImage(trimmed)) return NetworkImage(trimmed);
    if (trimmed.startsWith('assets/')) return AssetImage(trimmed);
    return null;
  }

  static bool _isRemoteImage(String value) {
    return value.startsWith('http://') || value.startsWith('https://');
  }

  static int _safeIndex(int index, int length) {
    if (length <= 0) return 0;
    return index.abs() % length;
  }

  static int _hashString(String value) {
    var hash = 0;
    for (final codeUnit in value.codeUnits) {
      hash = ((hash << 5) - hash + codeUnit) & 0x7fffffff;
    }
    return hash;
  }
}
