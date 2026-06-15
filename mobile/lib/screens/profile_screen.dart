import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../services/api_client.dart';
import '../services/profile_settings_store.dart';
import '../ui/rtc_assets.dart';
import '../ui/rtc_mobile_ui.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.api,
    required this.user,
    required this.onSaved,
    required this.onLogout,
    this.initialSection = 'profile',
    this.settingsStore,
  });

  final ApiClient api;
  final AppUser user;
  final ValueChanged<AppUser> onSaved;
  final Future<void> Function() onLogout;
  final String initialSection;
  final ProfileSettingsStore? settingsStore;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TextEditingController _name;
  late final TextEditingController _age;
  late final TextEditingController _birthday;
  late final TextEditingController _residence;
  late final TextEditingController _avatarUrl;
  late final ProfileSettingsStore _settingsStore;
  late ProfileSettings _settings;
  late AppUser _user;
  late String _section;
  String _gender = '';
  String _profileStatus = '';
  String _settingsStatus = 'Changes are applied immediately for this session.';
  String _selectedPolicyId = '';
  bool _editing = false;
  bool _saving = false;
  bool _settingsLoading = true;

  @override
  void initState() {
    super.initState();
    _user = widget.user;
    _section = _sectionFor(widget.initialSection);
    _settingsStore =
        widget.settingsStore ?? const FlutterSecureProfileSettingsStore();
    _settings = ProfileSettings.defaults(_user);
    _name = TextEditingController();
    _age = TextEditingController();
    _birthday = TextEditingController();
    _residence = TextEditingController();
    _avatarUrl = TextEditingController();
    _resetForm();
    _loadSettings();
  }

  @override
  void dispose() {
    _name.dispose();
    _age.dispose();
    _birthday.dispose();
    _residence.dispose();
    _avatarUrl.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final settings = await _settingsStore.read(_user);
    if (!mounted) return;
    setState(() {
      _settings = settings;
      _settingsLoading = false;
    });
  }

  void _resetForm() {
    _name.text = _displayName(_user);
    _age.text = _user.age?.toString() ?? '';
    _birthday.text = _dateOnly(_user.birthday);
    _residence.text = _user.currentResidence;
    _avatarUrl.text = _user.avatarUrl;
    _gender = _user.gender;
  }

  Future<void> _saveProfile() async {
    final name = _name.text.trim();
    final age = int.tryParse(_age.text.trim());
    final birthday = _birthday.text.trim();
    final residence = _residence.text.trim();
    final avatar = _avatarUrl.text.trim();

    if (name.length < 2) {
      setState(() => _profileStatus = 'Name must be at least 2 characters.');
      return;
    }
    if (!_validGender(_gender)) {
      setState(() => _profileStatus = 'Gender is required.');
      return;
    }
    if (age == null || age < 13 || age > 120) {
      setState(() => _profileStatus = 'Age must be between 13 and 120.');
      return;
    }
    if (residence.length < 2) {
      setState(() => _profileStatus = 'Current residence country is required.');
      return;
    }
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(birthday)) {
      setState(() => _profileStatus = 'Birthday is required.');
      return;
    }

    setState(() {
      _saving = true;
      _profileStatus = 'Saving profile...';
    });

    try {
      final user = await widget.api.updateProfile(
        name: name,
        gender: _gender,
        age: age,
        birthday: birthday,
        currentResidence: residence,
        avatarUrl: avatar.isEmpty ? null : avatar,
      );
      widget.onSaved(user);
      if (!mounted) return;
      setState(() {
        _user = user;
        _editing = false;
        _profileStatus = 'Profile updated.';
        _settings = _settings.copyWith(region: user.currentResidence);
      });
      unawaited(_settingsStore.write(_user, _settings));
      _resetForm();
    } catch (error) {
      if (mounted) setState(() => _profileStatus = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _logout() async {
    await widget.api.logout();
    await widget.onLogout();
    if (mounted) Navigator.of(context).pop();
  }

  void _startEditing() {
    setState(() {
      _editing = true;
      _profileStatus = '';
      _resetForm();
    });
  }

  void _cancelEditing() {
    setState(() {
      _editing = false;
      _profileStatus = '';
      _resetForm();
    });
  }

  void _removeAvatar() {
    setState(() {
      _avatarUrl.clear();
      _profileStatus = 'Profile photo removed. Save profile to apply it.';
    });
  }

  Future<void> _updateSettings(ProfileSettings settings, String status) async {
    setState(() {
      _settings = settings;
      _settingsStatus = status;
    });
    await _settingsStore.write(_user, settings);
  }

  Future<void> _bindAccountSetting(String field) {
    final next = switch (field) {
      'phone' => _settings.copyWith(phoneBound: true),
      'email' => _settings.copyWith(emailBound: true),
      'password' => _settings.copyWith(loginPasswordSet: true),
      _ => _settings,
    };
    final status = switch (field) {
      'phone' => 'Cell phone bound.',
      'email' => 'Email bound.',
      'password' => 'Login password set.',
      _ => 'Account security updated.',
    };
    return _updateSettings(next, status);
  }

  bool _validGender(String value) {
    return _genderLabels.containsKey(value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              BrandHeader(
                title: _section == 'profile' ? 'Profile' : 'Settings',
                subtitle: _user.email,
                trailing: RtcIconButton(
                  tooltip: 'Back',
                  icon: Icons.arrow_back,
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ),
              const SizedBox(height: 14),
              _ProfileHero(
                user: _user,
                avatarValue: _editing ? _avatarUrl.text : _user.avatarUrl,
              ),
              const SizedBox(height: 12),
              _SectionTabs(
                active: _section,
                onChanged: (section) {
                  setState(() {
                    _section = section;
                    _selectedPolicyId = '';
                    _settingsStatus =
                        'Changes are applied immediately for this session.';
                  });
                },
              ),
              const SizedBox(height: 12),
              if (_section == 'profile')
                _editing ? _buildEditProfile() : _buildProfileDetails()
              else
                _buildSettingsSection(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProfileDetails() {
    final birthday = _dateOnly(_user.birthday).isEmpty
        ? 'Not set'
        : _dateOnly(_user.birthday);
    final residence = _user.currentResidence.isEmpty
        ? 'Not set'
        : _user.currentResidence;
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'PROFILE',
            title: 'Personal information',
            detail: 'Account details shown in rooms, chat, and profile tools.',
          ),
          const SizedBox(height: 16),
          _ProfileFacts(
            rows: [
              _FactRow('Name', _displayName(_user)),
              _FactRow('Gender', _genderLabels[_user.gender] ?? 'Not set'),
              _FactRow('Age', _user.age?.toString() ?? 'Not set'),
              _FactRow('Birthday', birthday),
              _FactRow('Email', _user.email.isEmpty ? 'Not set' : _user.email),
              _FactRow('Current Residence', residence),
            ],
          ),
          const SizedBox(height: 16),
          GradientButton(
            onPressed: _startEditing,
            icon: const Icon(Icons.edit_outlined, color: RtcPalette.text),
            child: const Text('Edit profile'),
          ),
          const SizedBox(height: 10),
          GhostButton(
            onPressed: _saving ? null : _logout,
            icon: Icons.logout,
            label: 'Sign out',
          ),
          if (_profileStatus.isNotEmpty) ...[
            const SizedBox(height: 12),
            _StatusBanner(message: _profileStatus),
          ],
        ],
      ),
    );
  }

  Widget _buildEditProfile() {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ProfileAvatar(user: _user, avatarValue: _avatarUrl.text),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _displayName(_user),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: RtcPalette.text,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'ID:${_user.id}',
                      style: const TextStyle(
                        color: RtcPalette.muted,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    GhostButton(
                      onPressed: _saving ? null : _removeAvatar,
                      icon: Icons.delete_outline,
                      label: 'Remove photo',
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _avatarUrl,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Avatar URL or data URL',
              prefixIcon: Icon(Icons.image_outlined),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _name,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              labelText: 'Name',
              prefixIcon: Icon(Icons.person_outline),
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _validGender(_gender) ? _gender : null,
            decoration: const InputDecoration(
              labelText: 'Gender',
              prefixIcon: Icon(Icons.badge_outlined),
            ),
            items: _genderLabels.entries
                .map(
                  (entry) => DropdownMenuItem(
                    value: entry.key,
                    child: Text(entry.value),
                  ),
                )
                .toList(),
            onChanged: (value) {
              setState(() {
                _gender = value ?? '';
                _profileStatus = '';
              });
            },
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _age,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Age'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _birthday,
                  keyboardType: TextInputType.datetime,
                  decoration: const InputDecoration(
                    labelText: 'Birthday',
                    hintText: 'YYYY-MM-DD',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _residence,
            decoration: const InputDecoration(
              labelText: 'Current Residence',
              prefixIcon: Icon(Icons.public),
            ),
          ),
          if (_profileStatus.isNotEmpty) ...[
            const SizedBox(height: 12),
            _StatusBanner(
              message: _profileStatus,
              error:
                  _profileStatus.toLowerCase().contains('required') ||
                  _profileStatus.toLowerCase().contains('must'),
            ),
          ],
          const SizedBox(height: 14),
          GhostButton(
            onPressed: _saving ? null : _cancelEditing,
            icon: Icons.close,
            label: 'Cancel',
          ),
          const SizedBox(height: 10),
          GradientButton(
            onPressed: _saving ? null : _saveProfile,
            icon: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.save_outlined, color: Colors.white),
            child: const Text('Save profile'),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingsSection() {
    if (_settingsLoading) {
      return const RtcLoadingPanel(label: 'Loading settings...');
    }

    final activeMeta = _settingsTabs.firstWhere(
      (item) => item.value == _section,
    );
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RtcSectionHeader(
            eyebrow: 'SETTINGS',
            title: activeMeta.label,
            detail: _settingsStatus,
          ),
          const SizedBox(height: 14),
          _buildSettingsContent(),
        ],
      ),
    );
  }

  Widget _buildSettingsContent() {
    return switch (_section) {
      'account' => _buildAccountSettings(),
      'privacy' => _buildPrivacySettings(),
      'content' => _buildContentSettings(),
      'region' => _buildRegionSettings(),
      'terms' => _buildPolicySettings(),
      _ => _buildAccountSettings(),
    };
  }

  Widget _buildAccountSettings() {
    return Column(
      children: [
        _SettingsActionRow(
          icon: Icons.phone_android,
          title: 'Binding cell phone',
          detail:
              'Recommended for account recovery and high-value account changes.',
          trailing: _settings.phoneBound ? 'Bound' : 'Bind cell phone',
          onTap: () => _bindAccountSetting('phone'),
        ),
        _SettingsActionRow(
          icon: Icons.alternate_email,
          title: 'Binding email',
          detail: 'Used for login recovery and security notices.',
          trailing: _settings.emailBound ? 'Bound' : 'Bind email',
          onTap: () => _bindAccountSetting('email'),
        ),
        _SettingsActionRow(
          icon: Icons.password,
          title: 'Set login password',
          detail: 'Protect this account when signing in on a new device.',
          trailing: _settings.loginPasswordSet ? 'Set' : 'Set password',
          onTap: () => _bindAccountSetting('password'),
        ),
        _SettingsSwitchRow(
          icon: Icons.devices_outlined,
          title: 'Devices Logged In',
          detail: 'Show alerts when a new device logs in.',
          value: _settings.deviceAlerts,
          activeLabel: 'Alerts on',
          inactiveLabel: 'Alerts off',
          onChanged: (value) => _updateSettings(
            _settings.copyWith(deviceAlerts: value),
            'Device login alerts updated.',
          ),
        ),
      ],
    );
  }

  Widget _buildPrivacySettings() {
    return Column(
      children: [
        _SettingsFieldShell(
          icon: Icons.message_outlined,
          title: 'Who can send me a message',
          detail: 'Controls the personal inbox and room chat shortcuts.',
          child: DropdownButtonFormField<String>(
            initialValue: _settings.messagePrivacy,
            decoration: const InputDecoration(labelText: 'Message privacy'),
            items: const [
              DropdownMenuItem(value: 'everyone', child: Text('Everyone')),
              DropdownMenuItem(
                value: 'followers',
                child: Text('Followers only'),
              ),
              DropdownMenuItem(value: 'nobody', child: Text('Nobody')),
            ],
            onChanged: (value) {
              if (value == null) return;
              unawaited(
                _updateSettings(
                  _settings.copyWith(messagePrivacy: value),
                  'Message privacy updated.',
                ),
              );
            },
          ),
        ),
        _SettingsSwitchRow(
          icon: Icons.lock_person_outlined,
          title: 'Private live invitation',
          detail: 'Allow hosts to invite you into private live rooms.',
          value: _settings.privateInvite,
          activeLabel: 'Allowed',
          inactiveLabel: 'Blocked',
          onChanged: (value) => _updateSettings(
            _settings.copyWith(privateInvite: value),
            'Private live invitation setting updated.',
          ),
        ),
        _SettingsActionRow(
          icon: Icons.block,
          title: 'Blacklist',
          detail: 'Blocked users are controlled from the chat user menu.',
          trailing: 'Open',
          onTap: () => setState(() {
            _settingsStatus =
                'Use Block in the chat panel to hide a user and remove their messages from your view.';
          }),
        ),
        _SettingsActionRow(
          icon: Icons.visibility_off_outlined,
          title: 'Live broadcast you are not interested in',
          detail: _settings.hideSensitive
              ? 'Filtered from your feed.'
              : 'Visible in your feed.',
          trailing: _settings.hideSensitive ? 'Filtered' : 'Show',
          onTap: () => _updateSettings(
            _settings.copyWith(hideSensitive: !_settings.hideSensitive),
            'Live preference updated.',
          ),
        ),
      ],
    );
  }

  Widget _buildContentSettings() {
    const modes = [
      _ModeOption(
        value: 'restricted',
        label: 'Restricted Mode',
        detail: 'Hide potentially sensitive content.',
      ),
      _ModeOption(
        value: 'warning',
        label: 'Warning Mode',
        detail: 'Show a warning before sensitive rooms open.',
      ),
      _ModeOption(
        value: 'all',
        label: 'All Modes',
        detail: 'Show all room content that is available to your account.',
      ),
    ];

    return Column(
      children: modes.map((mode) {
        final selected = _settings.contentMode == mode.value;
        return _SettingsActionRow(
          icon: selected
              ? Icons.radio_button_checked
              : Icons.radio_button_unchecked,
          title: mode.label,
          detail: mode.detail,
          trailing: selected ? 'Selected' : 'Choose',
          onTap: () => _updateSettings(
            _settings.copyWith(contentMode: mode.value),
            '${mode.label} selected.',
          ),
        );
      }).toList(),
    );
  }

  Widget _buildRegionSettings() {
    final selectedRegion = _settings.region.isEmpty
        ? 'United States'
        : _settings.region;
    final options = _regionOptions(selectedRegion);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String>(
          initialValue: selectedRegion,
          decoration: const InputDecoration(
            labelText: 'Region',
            prefixIcon: Icon(Icons.public),
          ),
          items: options
              .map(
                (region) =>
                    DropdownMenuItem(value: region, child: Text(region)),
              )
              .toList(),
          onChanged: (value) {
            if (value == null) return;
            unawaited(
              _updateSettings(
                _settings.copyWith(region: value),
                'Region changed to $value.',
              ),
            );
          },
        ),
        const SizedBox(height: 14),
        Center(
          child: Text(
            selectedRegion,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: RtcPalette.text,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPolicySettings() {
    final selected = _policies
        .where((policy) => policy.id == _selectedPolicyId)
        .firstOrNull;
    if (selected != null) {
      return _PolicyDetail(
        policy: selected,
        onBack: () => setState(() {
          _selectedPolicyId = '';
          _settingsStatus = 'Changes are applied immediately for this session.';
        }),
      );
    }

    return Column(
      children: _policies.map((policy) {
        return _SettingsActionRow(
          icon: policy.icon,
          title: policy.title,
          detail: policy.summary,
          trailing: 'Open',
          onTap: () => setState(() {
            _selectedPolicyId = policy.id;
            _settingsStatus = policy.summary;
          }),
        );
      }).toList(),
    );
  }
}

class _ProfileHero extends StatelessWidget {
  const _ProfileHero({required this.user, required this.avatarValue});

  final AppUser user;
  final String avatarValue;

  @override
  Widget build(BuildContext context) {
    final residence = user.currentResidence.isEmpty
        ? 'Not set'
        : user.currentResidence;
    return GlassPanel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _ProfileAvatar(user: user, avatarValue: avatarValue, size: 82),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _displayName(user),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: RtcPalette.text,
                    fontWeight: FontWeight.w900,
                    height: RtcTypography.tightHeight,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'ID:${user.id}',
                  style: const TextStyle(
                    color: RtcPalette.muted,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    MetricChip(
                      label: 'Age',
                      value: user.age?.toString() ?? '--',
                    ),
                    MetricChip(
                      label: 'Gender',
                      value: _genderLabels[user.gender] ?? 'Profile',
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'Email ${user.email.isEmpty ? 'Not set' : user.email}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: RtcPalette.soft,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  residence,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: RtcPalette.muted,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileAvatar extends StatelessWidget {
  const _ProfileAvatar({
    required this.user,
    required this.avatarValue,
    this.size = 72,
  });

  final AppUser user;
  final String avatarValue;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initial = _displayName(user)[0].toUpperCase();
    return ClipRRect(
      borderRadius: BorderRadius.circular(RtcRadius.brand),
      child: Image(
        image: _avatarImage(user, avatarValue),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => _AvatarFallback(
          initial: initial,
          size: size,
          gradient: RtcAssets.initialGradientForUser(user),
        ),
      ),
    );
  }
}

class _AvatarFallback extends StatelessWidget {
  const _AvatarFallback({
    required this.initial,
    required this.size,
    required this.gradient,
  });

  final String initial;
  final double size;
  final List<Color> gradient;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: gradient),
        borderRadius: BorderRadius.circular(RtcRadius.brand),
      ),
      child: Text(
        initial,
        style: TextStyle(
          color: RtcPalette.text,
          fontWeight: FontWeight.w900,
          fontSize: size * 0.42,
        ),
      ),
    );
  }
}

class _SectionTabs extends StatelessWidget {
  const _SectionTabs({required this.active, required this.onChanged});

  final String active;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final tabs = [_profileTab, ..._settingsTabs];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: tabs.map((tab) {
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              selected: active == tab.value,
              avatar: Icon(tab.icon, size: 16),
              label: Text(tab.label),
              onSelected: (_) => onChanged(tab.value),
              selectedColor: const Color.fromRGBO(56, 189, 248, 0.2),
              backgroundColor: RtcPalette.hoverBg,
              side: BorderSide(
                color: active == tab.value
                    ? const Color.fromRGBO(56, 189, 248, 0.48)
                    : RtcPalette.line,
              ),
              labelStyle: TextStyle(
                color: active == tab.value ? RtcPalette.text : RtcPalette.soft,
                fontWeight: FontWeight.w900,
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _ProfileFacts extends StatelessWidget {
  const _ProfileFacts({required this.rows});

  final List<_FactRow> rows;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: rows.map((row) {
        return Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: RtcPalette.line)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 128,
                child: Text(
                  row.label,
                  style: const TextStyle(
                    color: RtcPalette.muted,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Expanded(
                child: Text(
                  row.value,
                  style: const TextStyle(
                    color: RtcPalette.text,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

class _SettingsActionRow extends StatelessWidget {
  const _SettingsActionRow({
    required this.icon,
    required this.title,
    required this.detail,
    required this.trailing,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _SettingsRowShell(
      icon: icon,
      title: title,
      detail: detail,
      onTap: onTap,
      child: Text(
        trailing,
        textAlign: TextAlign.right,
        style: const TextStyle(
          color: RtcPalette.sky,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _SettingsSwitchRow extends StatelessWidget {
  const _SettingsSwitchRow({
    required this.icon,
    required this.title,
    required this.detail,
    required this.value,
    required this.activeLabel,
    required this.inactiveLabel,
    required this.onChanged,
  });

  final IconData icon;
  final String title;
  final String detail;
  final bool value;
  final String activeLabel;
  final String inactiveLabel;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return _SettingsRowShell(
      icon: icon,
      title: title,
      detail: detail,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value ? activeLabel : inactiveLabel,
            style: const TextStyle(
              color: RtcPalette.sky,
              fontWeight: FontWeight.w900,
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

class _SettingsFieldShell extends StatelessWidget {
  const _SettingsFieldShell({
    required this.icon,
    required this.title,
    required this.detail,
    required this.child,
  });

  final IconData icon;
  final String title;
  final String detail;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RtcPalette.hoverBg,
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(RtcRadius.control),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SettingsTitle(icon: icon, title: title, detail: detail),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _SettingsRowShell extends StatelessWidget {
  const _SettingsRowShell({
    required this.icon,
    required this.title,
    required this.detail,
    required this.child,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String detail;
  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(RtcRadius.control),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: RtcPalette.hoverBg,
              border: Border.all(color: RtcPalette.line),
              borderRadius: BorderRadius.circular(RtcRadius.control),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _SettingsTitle(
                    icon: icon,
                    title: title,
                    detail: detail,
                  ),
                ),
                const SizedBox(width: 10),
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SettingsTitle extends StatelessWidget {
  const _SettingsTitle({
    required this.icon,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: RtcPalette.sky, size: 22),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: RtcPalette.text,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                detail,
                style: const TextStyle(
                  color: RtcPalette.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PolicyDetail extends StatelessWidget {
  const _PolicyDetail({required this.policy, required this.onBack});

  final _PolicyDoc policy;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GhostButton(onPressed: onBack, icon: Icons.arrow_back, label: 'Back'),
        const SizedBox(height: 12),
        Text(
          policy.title,
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
            color: RtcPalette.text,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          policy.summary,
          style: const TextStyle(
            color: RtcPalette.muted,
            fontWeight: FontWeight.w700,
            height: 1.35,
          ),
        ),
        const SizedBox(height: 14),
        ...policy.sections.map((section) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  section.title,
                  style: const TextStyle(
                    color: RtcPalette.text,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  section.body,
                  style: const TextStyle(
                    color: RtcPalette.muted,
                    fontWeight: FontWeight.w700,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.message, this.error = false});

  final String message;
  final bool error;

  @override
  Widget build(BuildContext context) {
    return StatusPill(
      label: error ? 'Check' : 'Status',
      detail: message,
      state: error
          ? RtcStatusState.error
          : message.toLowerCase().contains('updated') ||
                message.toLowerCase().contains('ready') ||
                message.toLowerCase().contains('removed')
          ? RtcStatusState.good
          : RtcStatusState.idle,
    );
  }
}

class _FactRow {
  const _FactRow(this.label, this.value);

  final String label;
  final String value;
}

class _TabMeta {
  const _TabMeta({
    required this.value,
    required this.label,
    required this.icon,
  });

  final String value;
  final String label;
  final IconData icon;
}

class _ModeOption {
  const _ModeOption({
    required this.value,
    required this.label,
    required this.detail,
  });

  final String value;
  final String label;
  final String detail;
}

class _PolicyDoc {
  const _PolicyDoc({
    required this.id,
    required this.title,
    required this.summary,
    required this.sections,
    required this.icon,
  });

  final String id;
  final String title;
  final String summary;
  final List<_PolicySection> sections;
  final IconData icon;
}

class _PolicySection {
  const _PolicySection(this.title, this.body);

  final String title;
  final String body;
}

const _profileTab = _TabMeta(
  value: 'profile',
  label: 'Profile',
  icon: Icons.person_outline,
);

const _settingsTabs = [
  _TabMeta(
    value: 'account',
    label: 'Account Security',
    icon: Icons.verified_user_outlined,
  ),
  _TabMeta(
    value: 'privacy',
    label: 'Privacy Settings',
    icon: Icons.shield_outlined,
  ),
  _TabMeta(
    value: 'content',
    label: 'Content Preferences',
    icon: Icons.filter_alt_outlined,
  ),
  _TabMeta(value: 'region', label: 'Region', icon: Icons.public),
  _TabMeta(
    value: 'terms',
    label: 'Terms and Policies',
    icon: Icons.description_outlined,
  ),
];

const _genderLabels = {
  'male': 'Male',
  'female': 'Female',
  'non_binary': 'Non-binary',
  'prefer_not_to_say': 'Prefer not to say',
};

const _regions = [
  'United States',
  'Canada',
  'United Kingdom',
  'Australia',
  'Germany',
  'France',
  'India',
  'Japan',
  'South Korea',
  'Brazil',
  'Mexico',
  'Spain',
  'Italy',
  'Netherlands',
  'Sweden',
  'Norway',
  'United Arab Emirates',
  'Singapore',
  'Philippines',
  'South Africa',
];

const _policies = [
  _PolicyDoc(
    id: 'terms',
    title: 'Terms of Service',
    summary:
        'The basic rules for using TalkEachOther rooms, chat, profiles, and RTC features.',
    icon: Icons.gavel_outlined,
    sections: [
      _PolicySection(
        'Account responsibility',
        'You are responsible for activity from your account, keeping your login details private, and using accurate profile information.',
      ),
      _PolicySection(
        'Room behavior',
        'Do not harass people, impersonate others, share illegal content, or use live rooms for scams, private transactions, or harmful activity.',
      ),
      _PolicySection(
        'Service changes',
        'Features, rooms, moderation tools, and availability may change as the service improves or to protect the community.',
      ),
    ],
  ),
  _PolicyDoc(
    id: 'privacy',
    title: 'Privacy Policy',
    summary:
        'How account, room, chat, device, and usage information is handled inside the platform.',
    icon: Icons.privacy_tip_outlined,
    sections: [
      _PolicySection(
        'Information we use',
        'We use account details, room activity, messages, device signals, and usage records to run the service and keep rooms safe.',
      ),
      _PolicySection(
        'Security and moderation',
        'Safety teams and automated systems may review reports, moderation events, and abuse signals to protect users.',
      ),
      _PolicySection(
        'Your choices',
        'You can update profile details, manage privacy settings, and control room or message preferences from settings.',
      ),
    ],
  ),
  _PolicyDoc(
    id: 'child-safety',
    title: 'Child Safety Policy',
    summary:
        'Rules that protect minors and remove unsafe content or behavior quickly.',
    icon: Icons.family_restroom_outlined,
    sections: [
      _PolicySection(
        'Minimum age',
        'Users must meet the required age for their region. Accounts that do not meet age requirements may be restricted or removed.',
      ),
      _PolicySection(
        'Zero tolerance',
        'Sexualized, exploitative, grooming, or predatory behavior involving minors is prohibited and may be reported to authorities.',
      ),
      _PolicySection(
        'Reporting',
        'Use Feedback and Help or moderation controls to report suspicious behavior, unsafe rooms, or child safety concerns immediately.',
      ),
    ],
  ),
  _PolicyDoc(
    id: 'anti-bullying',
    title: 'Anti-Bullying Policy',
    summary:
        'Community rules for respectful live rooms, chat, direct messages, and profiles.',
    icon: Icons.health_and_safety_outlined,
    sections: [
      _PolicySection(
        'Harassment',
        'Threats, targeted insults, hate speech, stalking, doxxing, and repeated unwanted contact are not allowed.',
      ),
      _PolicySection(
        'Moderation tools',
        'Room owners and moderators can mute, remove, block, or report users who disrupt rooms or attack others.',
      ),
      _PolicySection(
        'Enforcement',
        'Violations may lead to removed content, disabled rooms, account restrictions, or bans.',
      ),
    ],
  ),
  _PolicyDoc(
    id: 'copyright',
    title: 'Copyright',
    summary:
        'Rules for sharing music, images, video, branding, and other protected content.',
    icon: Icons.copyright_outlined,
    sections: [
      _PolicySection(
        'Your content',
        'Only upload or stream content you own, created, licensed, or have permission to use.',
      ),
      _PolicySection(
        'Claims',
        'Copyright owners can report content that they believe infringes their rights. Valid reports may result in removal or account action.',
      ),
      _PolicySection(
        'Repeat violations',
        'Repeated copyright abuse can lead to room restrictions or account suspension.',
      ),
    ],
  ),
];

String _sectionFor(String value) {
  final normalized = value.trim().toLowerCase();
  if (normalized == 'settings') return 'account';
  if (normalized == 'profile') return 'profile';
  if (_settingsTabs.any((tab) => tab.value == normalized)) return normalized;
  return 'profile';
}

String _displayName(AppUser user) {
  if (user.name.trim().isNotEmpty) return user.name.trim();
  final emailName = user.email.split('@').first.trim();
  return emailName.isEmpty ? 'Guest' : emailName;
}

String _dateOnly(String value) {
  return value.length >= 10 ? value.substring(0, 10) : value;
}

List<String> _regionOptions(String selectedRegion) {
  if (_regions.contains(selectedRegion)) return _regions;
  return [selectedRegion, ..._regions];
}

ImageProvider _avatarImage(AppUser user, String avatarValue) {
  final trimmed = avatarValue.trim();
  final dataUri = _memoryImageFromDataUri(trimmed);
  if (dataUri != null) return dataUri;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return NetworkImage(trimmed);
  }
  if (trimmed.startsWith('assets/')) return AssetImage(trimmed);
  return RtcAssets.avatarImageForUser(
    AppUser(
      id: user.id,
      name: user.name,
      email: user.email,
      tenantId: user.tenantId,
      phone: user.phone,
      gender: user.gender,
      age: user.age,
      birthday: user.birthday,
      currentResidence: user.currentResidence,
      avatarUrl: '',
      roles: user.roles,
    ),
  );
}

MemoryImage? _memoryImageFromDataUri(String value) {
  if (!value.startsWith('data:image/')) return null;
  final comma = value.indexOf(',');
  if (comma < 0 || !value.substring(0, comma).contains(';base64')) return null;
  try {
    final bytes = base64Decode(value.substring(comma + 1));
    return MemoryImage(Uint8List.fromList(bytes));
  } catch (_) {
    return null;
  }
}
