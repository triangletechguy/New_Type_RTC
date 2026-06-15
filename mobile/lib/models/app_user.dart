class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    this.tenantId = 0,
    this.phone = '',
    this.gender = '',
    this.age,
    this.birthday = '',
    this.currentResidence = '',
    this.avatarUrl = '',
    this.roles = const [],
  });

  final int id;
  final String name;
  final String email;
  final int tenantId;
  final String phone;
  final String gender;
  final int? age;
  final String birthday;
  final String currentResidence;
  final String avatarUrl;
  final List<String> roles;

  bool get canUseAdminDashboard {
    return roles.any((role) {
      final value = role.trim().toLowerCase();
      return value == 'client_admin' || value == 'super_admin';
    });
  }

  factory AppUser.fromJson(Map<String, dynamic> json) {
    return AppUser(
      id: _asInt(json['id']),
      name: (json['name'] ?? json['display_name'] ?? 'User').toString(),
      email: normalizeUserEmail(json['email']),
      tenantId: _asInt(json['tenant_id'] ?? json['tenantId']),
      phone: (json['phone'] ?? '').toString(),
      gender: (json['gender'] ?? '').toString(),
      age: _nullableInt(json['age']),
      birthday: _dateOnly(json['birthday']),
      currentResidence:
          (json['current_residence'] ?? json['currentResidence'] ?? '')
              .toString(),
      avatarUrl: (json['avatar_url'] ?? json['avatarUrl'] ?? '').toString(),
      roles: _roleNames(json['roles']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'tenant_id': tenantId,
      'name': name,
      'email': email,
      'phone': phone,
      'gender': gender,
      'age': age,
      'birthday': birthday,
      'current_residence': currentResidence,
      'avatar_url': avatarUrl,
      'roles': roles,
    };
  }

  AppUser copyWith({
    String? name,
    String? gender,
    int? age,
    String? birthday,
    String? currentResidence,
    String? avatarUrl,
  }) {
    return AppUser(
      id: id,
      tenantId: tenantId,
      name: name ?? this.name,
      email: email,
      phone: phone,
      gender: gender ?? this.gender,
      age: age ?? this.age,
      birthday: birthday ?? this.birthday,
      currentResidence: currentResidence ?? this.currentResidence,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      roles: roles,
    );
  }
}

String normalizeUserEmail(Object? value) {
  final email = (value ?? '').toString().trim().toLowerCase();
  return _legacySuperAdminEmails.contains(email) ? _superAdminEmail : email;
}

const _superAdminEmail = 'admin@gmail.com';
const _legacySuperAdminEmails = {
  'superadmin@talkeachother.com',
  'superadmin@chadnichok.com',
};

int _asInt(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

int? _nullableInt(Object? value) {
  if (value == null || value.toString().isEmpty) return null;
  if (value is int) return value;
  return int.tryParse(value.toString());
}

String _dateOnly(Object? value) {
  final text = value?.toString() ?? '';
  return text.length >= 10 ? text.substring(0, 10) : text;
}

List<String> _roleNames(Object? value) {
  if (value is! List) return const [];
  return value
      .map((role) {
        if (role is String) return role;
        if (role is Map) {
          return (role['name'] ?? role['role'] ?? '').toString();
        }
        return '';
      })
      .where((role) => role.trim().isNotEmpty)
      .toList(growable: false);
}
