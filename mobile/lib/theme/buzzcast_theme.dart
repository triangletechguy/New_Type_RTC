import 'package:flutter/material.dart';

import '../models/room.dart';

class BuzzColors {
  static const feedBackground = Color(0xFFF4F5F7);
  static const feedText = Color(0xFF111827);
  static const mutedText = Color(0xFF667085);
  static const softText = Color(0xFF98A2B3);
  static const green = Color(0xFF17836E);
  static const mint = Color(0xFF43B68F);
  static const teal = Color(0xFF10A37F);
  static const yellow = Color(0xFFFFD95A);
  static const amber = Color(0xFFF59E0B);
  static const hot = Color(0xFFFF3F7F);
  static const sky = Color(0xFF38BDF8);
  static const roomDark = Color(0xFF10131D);
  static const roomPanel = Color(0xFF171927);
}

class BuzzAssets {
  static const homeIcon = 'assets/rtc/asset-image2/smart-home-icon.png';
  static const searchIcon = 'assets/rtc/asset-image2/smart-search-icon.png';
  static const goat = 'assets/rtc/asset-image2/smart-goat-header.png';
  static const bars = 'assets/rtc/asset-image2/smart-bars.png';
  static const group = 'assets/rtc/asset-image2/smart-group-icon.png';
  static const lock = 'assets/rtc/asset-image2/smart-lock-icon.png';
  static const creator = 'assets/rtc/asset-image2/smart-creator-avatar.png';
  static const videoRoom = 'assets/rtc/rooms/video-room.png';
  static const musicRoom = 'assets/rtc/rooms/music-room.png';
  static const soloLive = 'assets/rtc/rooms/solo-live.png';
  static const studioStage = 'assets/rtc/rooms/studio-stage.png';
  static const audioStage = 'assets/rtc/rooms/audio-stage.png';
  static const audioDuet = 'assets/rtc/rooms/audio-duet.png';
  static const stageMoods = 'assets/rtc/rooms/stage-moods.png';
  static const avatarGrid = 'assets/rtc/rooms/avatar-grid.png';
  static const privateRoom = 'assets/rtc/rooms/private-room.png';
  static const passwordRoom = 'assets/rtc/rooms/password-room.png';

  static const avatars = [
    'assets/rtc/avatars/avatar-01.png',
    'assets/rtc/avatars/avatar-02.png',
    'assets/rtc/avatars/avatar-03.png',
    'assets/rtc/avatars/avatar-04.png',
    'assets/rtc/avatars/avatar-05.png',
    'assets/rtc/avatars/avatar-06.png',
    'assets/rtc/avatars/avatar-07.png',
    'assets/rtc/avatars/avatar-08.png',
  ];

  static const _coverRotation = [
    videoRoom,
    musicRoom,
    soloLive,
    studioStage,
    audioStage,
    audioDuet,
    stageMoods,
    avatarGrid,
  ];

  static String avatarForIndex(int index) {
    return avatars[index.abs() % avatars.length];
  }

  static String coverForRoom(Room room, [int fallbackIndex = 0]) {
    final privacy = room.privacyType.toLowerCase();
    final type = room.roomType.toLowerCase();
    if (privacy == 'password') return passwordRoom;
    if (privacy == 'private' || privacy == 'sensitive') return privateRoom;
    if (type.contains('music') || type.contains('audio')) return musicRoom;
    if (type == 'solo_live') return soloLive;
    if (type == 'pk_live') return stageMoods;
    if (type.contains('group')) return studioStage;
    if (type.contains('video')) return videoRoom;
    return _coverRotation[(room.id + fallbackIndex).abs() %
        _coverRotation.length];
  }
}

String compactCount(num value) {
  final number = value.toDouble();
  if (number >= 1000000) return '${(number / 1000000).toStringAsFixed(1)}M';
  if (number >= 1000) {
    final decimals = number >= 10000 ? 0 : 1;
    return '${(number / 1000).toStringAsFixed(decimals)}K';
  }
  return number.round().toString();
}

String roomTypeLabel(String value) {
  final normalized = value.replaceAll('_', ' ').trim();
  if (normalized.isEmpty) return 'Video Room';
  return normalized
      .split(RegExp(r'\s+'))
      .map((word) {
        if (word.isEmpty) return word;
        return '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}';
      })
      .join(' ');
}
