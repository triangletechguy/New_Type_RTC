class Room {
  const Room({
    required this.id,
    required this.name,
    this.tenantId = 0,
    this.tenantName = '',
    this.ownerId = 0,
    this.ownerName = '',
    this.ownerRegion = '',
    this.ownerFollowed = false,
    this.description = '',
    this.roomType = 'video',
    this.privacyType = 'public',
    this.isPasswordProtected = false,
    this.profileImage = '',
    this.maxMicCount = 1,
    this.activeParticipants = 0,
    this.activeParticipantPreviews = const [],
    this.theme = '',
    this.chatEnabled = true,
    this.giftEnabled = false,
    this.screenShareEnabled = false,
    this.aiSecurityEnabled = false,
    this.status = 'active',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final int id;
  final int tenantId;
  final String tenantName;
  final int ownerId;
  final String ownerName;
  final String ownerRegion;
  final bool ownerFollowed;
  final String name;
  final String description;
  final String roomType;
  final String privacyType;
  final bool isPasswordProtected;
  final String profileImage;
  final int maxMicCount;
  final int activeParticipants;
  final List<RoomParticipantPreview> activeParticipantPreviews;
  final String theme;
  final bool chatEnabled;
  final bool giftEnabled;
  final bool screenShareEnabled;
  final bool aiSecurityEnabled;
  final String status;
  final String createdAt;
  final String updatedAt;

  bool get supportsVideo => videoCapableRoomTypes.contains(roomType);
  bool get isPrivate => privacyType == 'private';
  bool get isLocked => isPasswordProtected || privacyType == 'password';

  String get displayHost {
    final name = ownerName.trim();
    return name.isEmpty ? 'Room host' : name;
  }

  String get displayRegion {
    final region = ownerRegion.trim();
    return region.isEmpty ? 'Global' : region;
  }

  String get roomTypeLabel => roomTypeMeta(roomType).label;
  String get roomTypeShortLabel => roomTypeMeta(roomType).shortLabel;

  List<String> get featureTags {
    final tags = <String>[];
    if (chatEnabled) tags.add('Chat');
    if (screenShareEnabled) tags.add('Share');
    if (aiSecurityEnabled) tags.add('Guard');
    return tags.isEmpty ? const ['Live'] : tags;
  }

  bool matchesTypeFilter(String filter) {
    return switch (filter) {
      'all' => true,
      'live' => liveRoomTypes.contains(roomType),
      'video' => videoRoomTypes.contains(roomType),
      'music' || 'voice' => musicRoomTypes.contains(roomType),
      'pk' => roomType == 'pk_live',
      _ => roomType == filter,
    };
  }

  bool matchesPrivacyFilter(String filter) {
    return filter == 'all' || privacyType == filter;
  }

  bool matchesSearch(String query) {
    final term = query.trim().toLowerCase();
    if (term.isEmpty) return true;
    final haystack = [
      name,
      description,
      roomType,
      roomTypeLabel,
      privacyType,
      ownerName,
      ownerRegion,
      tenantName,
      ...featureTags,
    ].join(' ').toLowerCase();
    return haystack.contains(term);
  }

  factory Room.fromJson(Map<String, dynamic> json) {
    final privacyType = (json['privacy_type'] ?? 'public').toString();
    return Room(
      id: _asInt(json['id']),
      tenantId: _asInt(json['tenant_id'] ?? json['tenantId']),
      tenantName: (json['tenant_name'] ?? json['tenantName'] ?? '').toString(),
      ownerId: _asInt(json['owner_id'] ?? json['ownerId']),
      ownerName: (json['owner_name'] ?? json['ownerName'] ?? '').toString(),
      ownerRegion:
          (json['owner_region'] ??
                  json['owner_current_residence'] ??
                  json['country'] ??
                  '')
              .toString(),
      ownerFollowed: _asBool(json['owner_followed'] ?? json['ownerFollowed']),
      name: (json['name'] ?? 'Untitled room').toString(),
      description: (json['description'] ?? '').toString(),
      roomType: (json['room_type'] ?? json['roomType'] ?? 'video').toString(),
      privacyType: privacyType,
      isPasswordProtected:
          _asBool(
            json['is_password_protected'] ?? json['isPasswordProtected'],
          ) ||
          privacyType == 'password',
      profileImage: (json['profile_image'] ?? json['profileImage'] ?? '')
          .toString(),
      maxMicCount: _asInt(
        json['max_mic_count'] ?? json['maxMicCount'],
        fallback: 1,
      ),
      activeParticipants: _asInt(
        json['active_participants'] ?? json['activeParticipants'],
      ),
      activeParticipantPreviews: _participantPreviews(
        json['active_participant_previews'] ??
            json['activeParticipantPreviews'],
      ),
      theme: (json['theme'] ?? '').toString(),
      chatEnabled: _asBool(json['chat_enabled'] ?? json['chatEnabled'], true),
      giftEnabled: _asBool(json['gift_enabled'] ?? json['giftEnabled']),
      screenShareEnabled: _asBool(
        json['screen_share_enabled'] ?? json['screenShareEnabled'],
      ),
      aiSecurityEnabled: _asBool(
        json['ai_security_enabled'] ?? json['aiSecurityEnabled'],
      ),
      status: (json['status'] ?? 'active').toString(),
      createdAt: (json['created_at'] ?? json['createdAt'] ?? '').toString(),
      updatedAt: (json['updated_at'] ?? json['updatedAt'] ?? '').toString(),
    );
  }
}

class RoomParticipantPreview {
  const RoomParticipantPreview({
    required this.userId,
    required this.name,
    this.avatarUrl = '',
  });

  final int userId;
  final String name;
  final String avatarUrl;

  factory RoomParticipantPreview.fromJson(Map<String, dynamic> json) {
    return RoomParticipantPreview(
      userId: _asInt(json['user_id'] ?? json['userId']),
      name: (json['name'] ?? json['user_name'] ?? 'User').toString(),
      avatarUrl: (json['avatar_url'] ?? json['avatarUrl'] ?? '').toString(),
    );
  }
}

class RoomTypeMeta {
  const RoomTypeMeta({required this.label, required this.shortLabel});

  final String label;
  final String shortLabel;
}

const liveRoomTypes = ['solo_live', 'pk_live'];
const videoRoomTypes = ['video', 'one_to_one_video', 'group_video'];
const musicRoomTypes = [
  'audio',
  'youtube_audio',
  'one_to_one_audio',
  'group_audio',
];
const videoCapableRoomTypes = [...videoRoomTypes, ...liveRoomTypes];

RoomTypeMeta roomTypeMeta(String roomType) {
  return switch (roomType) {
    'audio' => const RoomTypeMeta(label: 'Music Room', shortLabel: 'Music'),
    'youtube_audio' => const RoomTypeMeta(
      label: 'YouTube Audio Room',
      shortLabel: 'YouTube',
    ),
    'one_to_one_audio' => const RoomTypeMeta(
      label: '1:1 Voice Call',
      shortLabel: 'Voice',
    ),
    'video' => const RoomTypeMeta(label: 'Video Room', shortLabel: 'Video'),
    'one_to_one_video' => const RoomTypeMeta(
      label: '1:1 Video Call',
      shortLabel: 'Call',
    ),
    'group_audio' => const RoomTypeMeta(
      label: 'Group Music',
      shortLabel: 'Music',
    ),
    'group_video' => const RoomTypeMeta(
      label: 'Group Video',
      shortLabel: 'Group',
    ),
    'solo_live' => const RoomTypeMeta(label: 'Solo Live', shortLabel: 'Solo'),
    'pk_live' => const RoomTypeMeta(label: 'PK Live', shortLabel: 'PK'),
    _ => RoomTypeMeta(
      label: roomType.isEmpty ? 'Room' : roomType,
      shortLabel: 'Live',
    ),
  };
}

List<RoomParticipantPreview> _participantPreviews(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map(
        (row) =>
            RoomParticipantPreview.fromJson(Map<String, dynamic>.from(row)),
      )
      .toList(growable: false);
}

int _asInt(Object? value, {int fallback = 0}) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

bool _asBool(Object? value, [bool fallback = false]) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final normalized = value?.toString().trim().toLowerCase();
  if (normalized == null || normalized.isEmpty) return fallback;
  if (const {'true', '1', 'yes', 'on'}.contains(normalized)) return true;
  if (const {'false', '0', 'no', 'off'}.contains(normalized)) return false;
  return fallback;
}
