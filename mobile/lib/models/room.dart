class Room {
  const Room({
    required this.id,
    required this.name,
    this.description = '',
    this.roomType = 'video',
    this.privacyType = 'public',
    this.profileImage = '',
    this.maxMicCount = 1,
  });

  final int id;
  final String name;
  final String description;
  final String roomType;
  final String privacyType;
  final String profileImage;
  final int maxMicCount;

  bool get supportsVideo {
    return roomType.contains('video') ||
        roomType == 'solo_live' ||
        roomType == 'pk_live';
  }

  factory Room.fromJson(Map<String, dynamic> json) {
    return Room(
      id: _asInt(json['id']),
      name: (json['name'] ?? 'Untitled room').toString(),
      description: (json['description'] ?? '').toString(),
      roomType: (json['room_type'] ?? 'video').toString(),
      privacyType: (json['privacy_type'] ?? 'public').toString(),
      profileImage: (json['profile_image'] ?? '').toString(),
      maxMicCount: _asInt(json['max_mic_count'], fallback: 1),
    );
  }
}

int _asInt(Object? value, {int fallback = 0}) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}
