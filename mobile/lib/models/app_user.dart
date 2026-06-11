class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    this.gender = '',
    this.avatarUrl = '',
  });

  final int id;
  final String name;
  final String email;
  final String gender;
  final String avatarUrl;

  factory AppUser.fromJson(Map<String, dynamic> json) {
    return AppUser(
      id: _asInt(json['id']),
      name: (json['name'] ?? json['display_name'] ?? 'User').toString(),
      email: (json['email'] ?? '').toString(),
      gender: (json['gender'] ?? '').toString(),
      avatarUrl: (json['avatar_url'] ?? json['avatarUrl'] ?? '').toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'email': email,
      'gender': gender,
      'avatar_url': avatarUrl,
    };
  }
}

int _asInt(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
