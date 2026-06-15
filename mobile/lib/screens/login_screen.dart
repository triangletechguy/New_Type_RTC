import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/api_client.dart';
import '../ui/rtc_assets.dart';
import '../ui/rtc_mobile_ui.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.api,
    required this.onLoggedIn,
    this.initialStatus = '',
  });

  final ApiClient api;
  final Future<void> Function() onLoggedIn;
  final String initialStatus;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _age = TextEditingController();
  final _residence = TextEditingController();
  final _birthday = TextEditingController();
  final Map<String, String> _fieldErrors = {};

  String _mode = 'login';
  String _gender = '';
  bool _loading = false;
  bool _showPassword = false;
  late String _status;

  @override
  void initState() {
    super.initState();
    _status = widget.initialStatus.isNotEmpty
        ? widget.initialStatus
        : 'Use admin@gmail.com or admin@accenture.com with password admin@gmail.com.';
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _age.dispose();
    _residence.dispose();
    _birthday.dispose();
    super.dispose();
  }

  void _switchMode(String mode) {
    if (_loading || mode == _mode) return;
    setState(() {
      _mode = mode;
      _fieldErrors.clear();
      _status = mode == 'login'
          ? 'Use admin@gmail.com or admin@accenture.com with password admin@gmail.com.'
          : 'Create a host profile for video rooms, music rooms, and live chat.';
    });
  }

  void _clearFieldError(String field) {
    if (!_fieldErrors.containsKey(field)) return;
    setState(() => _fieldErrors.remove(field));
  }

  void _setGender(String? value) {
    setState(() {
      _gender = value ?? '';
      _fieldErrors.remove('gender');
    });
  }

  Future<void> _submit() async {
    final errors = validateAuthFields(
      mode: _mode,
      name: _name.text,
      gender: _gender,
      age: _age.text,
      currentResidence: _residence.text,
      birthday: _birthday.text,
      email: _email.text,
      password: _password.text,
    );

    if (errors.isNotEmpty) {
      setState(() {
        _fieldErrors
          ..clear()
          ..addAll(errors);
        _status = _mode == 'login'
            ? 'Please fix the highlighted login details.'
            : 'Please fix the highlighted signup details.';
      });
      return;
    }

    setState(() {
      _fieldErrors.clear();
      _loading = true;
      _status = _mode == 'login' ? 'Logging in...' : 'Creating account...';
    });

    try {
      final email = normalizeAuthEmail(_email.text);
      if (_mode == 'login') {
        await widget.api.login(email, _password.text);
      } else {
        await widget.api.register(
          name: _name.text.trim(),
          email: email,
          password: _password.text,
          gender: _gender,
          age: int.tryParse(_age.text.trim()),
          currentResidence: _residence.text.trim(),
          birthday: _birthday.text.trim(),
        );
      }
      await widget.onLoggedIn();
    } catch (error) {
      if (mounted) setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final registering = _mode == 'register';
    final passwordStrong = getPasswordError(
      _password.text,
      strong: true,
    ).isEmpty;

    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final wide = constraints.maxWidth >= 860;
              final authCard = _buildAuthCard(
                context,
                registering: registering,
                passwordStrong: passwordStrong,
              );

              if (wide) {
                return Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1080),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const Expanded(child: _LoginShowcase()),
                          const SizedBox(width: 28),
                          SizedBox(width: 440, child: authCard),
                        ],
                      ),
                    ),
                  ),
                );
              }

              return ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  const _LoginShowcase(),
                  const SizedBox(height: 12),
                  authCard,
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildAuthCard(
    BuildContext context, {
    required bool registering,
    required bool passwordStrong,
  }) {
    return _AuthPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Welcome back',
            style: TextStyle(
              color: RtcPalette.sky,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            'Enter video and music rooms',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
              color: RtcPalette.text,
              fontWeight: FontWeight.w900,
              height: 1.05,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Sign in or create a host profile for live RTC rooms, chat, and creator flows.',
            style: TextStyle(
              color: RtcPalette.muted,
              fontWeight: FontWeight.w700,
              height: RtcTypography.bodyHeight,
            ),
          ),
          const SizedBox(height: 18),
          _AuthTabs(mode: _mode, onChanged: _switchMode),
          const SizedBox(height: 14),
          if (registering) ...[
            _AuthTextField(
              controller: _name,
              field: 'name',
              label: 'Name',
              autofillHints: const [AutofillHints.name],
              textInputAction: TextInputAction.next,
              error: _fieldErrors['name'],
              onChanged: _clearFieldError,
            ),
            const SizedBox(height: 12),
            _AuthInlineFields(
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _gender,
                  decoration: _authInputDecoration(
                    label: 'Gender',
                    error: _fieldErrors['gender'],
                  ),
                  dropdownColor: RtcPalette.surface2,
                  items: const [
                    DropdownMenuItem(value: '', child: Text('Select gender')),
                    DropdownMenuItem(value: 'male', child: Text('Male')),
                    DropdownMenuItem(value: 'female', child: Text('Female')),
                    DropdownMenuItem(
                      value: 'non_binary',
                      child: Text('Non-binary'),
                    ),
                    DropdownMenuItem(
                      value: 'prefer_not_to_say',
                      child: Text('Prefer not to say'),
                    ),
                  ],
                  onChanged: _loading ? null : _setGender,
                ),
                _AuthTextField(
                  controller: _age,
                  field: 'age',
                  label: 'Age',
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.next,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(3),
                  ],
                  error: _fieldErrors['age'],
                  onChanged: _clearFieldError,
                ),
              ],
            ),
            const SizedBox(height: 12),
            _AuthInlineFields(
              residence: true,
              children: [
                _AuthTextField(
                  controller: _residence,
                  field: 'current_residence',
                  label: 'Current Residence',
                  hintText: 'Country',
                  autofillHints: const [AutofillHints.countryName],
                  textInputAction: TextInputAction.next,
                  error: _fieldErrors['current_residence'],
                  onChanged: _clearFieldError,
                ),
                _AuthTextField(
                  controller: _birthday,
                  field: 'birthday',
                  label: 'Birthday',
                  hintText: 'YYYY-MM-DD',
                  keyboardType: TextInputType.datetime,
                  textInputAction: TextInputAction.next,
                  error: _fieldErrors['birthday'],
                  onChanged: _clearFieldError,
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          _AuthTextField(
            controller: _email,
            field: 'email',
            label: 'Email',
            hintText: 'name@gmail.com or name@company.com',
            autofillHints: const [AutofillHints.email],
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
            error: _fieldErrors['email'],
            onChanged: _clearFieldError,
          ),
          const SizedBox(height: 12),
          _AuthTextField(
            controller: _password,
            field: 'password',
            label: 'Password',
            hintText: registering
                ? '10+ chars, upper, lower, number, symbol'
                : 'Password',
            autofillHints: [
              registering ? AutofillHints.newPassword : AutofillHints.password,
            ],
            obscureText: !_showPassword,
            textInputAction: TextInputAction.done,
            onSubmitted: _loading ? null : (_) => _submit(),
            error: _fieldErrors['password'],
            onChanged: (field) {
              setState(() => _fieldErrors.remove(field));
            },
            suffix: TextButton(
              onPressed: _loading
                  ? null
                  : () => setState(() => _showPassword = !_showPassword),
              child: Text(_showPassword ? 'Hide' : 'Show'),
            ),
          ),
          if (registering) ...[
            const SizedBox(height: 8),
            _PasswordStrength(strong: passwordStrong),
          ],
          const SizedBox(height: 16),
          _AuthPrimaryButton(
            loading: _loading,
            label: registering ? 'Create account' : 'Login',
            onPressed: _loading ? null : _submit,
          ),
          const SizedBox(height: 14),
          _AuthStatusBox(message: _status),
        ],
      ),
    );
  }
}

String normalizeAuthEmail(String value) {
  return value.trim().toLowerCase();
}

Map<String, String> validateAuthFields({
  required String mode,
  String name = '',
  String gender = '',
  String age = '',
  String currentResidence = '',
  String birthday = '',
  String email = '',
  String password = '',
}) {
  final errors = <String, String>{};
  final registering = mode == 'register';

  if (registering && name.trim().length < 2) {
    errors['name'] = 'Name must be at least 2 characters.';
  }

  if (registering) {
    final normalizedGender = gender.trim();
    if (normalizedGender.isNotEmpty &&
        !_validGenderValues.contains(normalizedGender)) {
      errors['gender'] = 'Choose a valid gender option.';
    }

    final trimmedAge = age.trim();
    final numericAge = int.tryParse(trimmedAge);
    if (trimmedAge.isNotEmpty &&
        (numericAge == null || numericAge < 13 || numericAge > 120)) {
      errors['age'] = 'Age must be between 13 and 120.';
    }

    if (currentResidence.trim().isNotEmpty &&
        currentResidence.trim().length < 2) {
      errors['current_residence'] = 'Current residence country is required.';
    }

    final birthdayError = getBirthdayError(birthday, required: false);
    if (birthdayError.isNotEmpty) errors['birthday'] = birthdayError;
  }

  final emailError = getEmailError(email);
  if (emailError.isNotEmpty) errors['email'] = emailError;

  final passwordError = getPasswordError(password, strong: registering);
  if (passwordError.isNotEmpty) errors['password'] = passwordError;

  return errors;
}

String getEmailError(String value) {
  final email = normalizeAuthEmail(value);
  final emailPattern = RegExp(
    r'^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$',
    caseSensitive: false,
  );

  if (email.isEmpty) return 'Email is required.';
  if (!emailPattern.hasMatch(email)) {
    return 'Use a valid email like name@gmail.com or name@company.com.';
  }

  return '';
}

String getPasswordError(String value, {bool strong = false}) {
  final password = value;

  if (password.isEmpty) return 'Password is required.';
  if (!strong) return '';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!RegExp(r'[a-z]').hasMatch(password)) return 'Add a lowercase letter.';
  if (!RegExp(r'[A-Z]').hasMatch(password)) return 'Add an uppercase letter.';
  if (!RegExp(r'\d').hasMatch(password)) return 'Add a number.';
  if (!RegExp(r'[^A-Za-z0-9]').hasMatch(password)) return 'Add a symbol.';

  return '';
}

String getBirthdayError(String value, {bool required = true}) {
  final birthday = value.trim();
  if (birthday.isEmpty && !required) return '';
  if (birthday.isEmpty) return 'Birthday is required.';
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(birthday)) {
    return 'Choose a valid birthday.';
  }

  final parsed = DateTime.tryParse('${birthday}T00:00:00.000Z');
  if (parsed == null ||
      parsed.toUtc().toIso8601String().substring(0, 10) != birthday) {
    return 'Choose a valid birthday.';
  }

  final today = DateTime.now().toUtc();
  var userAge = today.year - parsed.year;
  final monthDiff = today.month - parsed.month;
  final dayDiff = today.day - parsed.day;
  if (monthDiff < 0 || (monthDiff == 0 && dayDiff < 0)) userAge -= 1;

  if (userAge < 13) return 'You must be at least 13 years old.';
  if (userAge > 120) return 'Choose a realistic birthday.';
  return '';
}

const _validGenderValues = {
  'male',
  'female',
  'non_binary',
  'prefer_not_to_say',
};

class _LoginShowcase extends StatelessWidget {
  const _LoginShowcase();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color.fromRGBO(255, 63, 127, 0.2),
            Color.fromRGBO(56, 189, 248, 0.08),
            Color(0xFF0F172A),
          ],
        ),
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(RtcRadius.panel),
      ),
      child: Column(
        children: [
          const _ShowcaseTopbar(),
          const SizedBox(height: 18),
          const _PhonePreview(),
          const SizedBox(height: 16),
          Row(
            children: const [
              Expanded(
                child: _ShowcaseStat(label: 'Latency', value: 'Low'),
              ),
              SizedBox(width: 10),
              Expanded(
                child: _ShowcaseStat(label: 'Rooms', value: 'Live'),
              ),
              SizedBox(width: 10),
              Expanded(
                child: _ShowcaseStat(label: 'Mode', value: 'Real'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ShowcaseTopbar extends StatelessWidget {
  const _ShowcaseTopbar();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const BrandMark(size: 48),
        const SizedBox(width: 12),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'TalkEachOther',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: RtcPalette.text,
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'Live video and music rooms',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: RtcPalette.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        const _OnlinePill(label: 'Online', live: false),
      ],
    );
  }
}

class _PhonePreview extends StatelessWidget {
  const _PhonePreview();

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 430),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF070B14),
        border: Border.all(color: Color.fromRGBO(255, 255, 255, 0.16)),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(0, 0, 0, 0.45),
            blurRadius: 80,
            offset: Offset(0, 30),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: const [
              Expanded(child: _PreviewTab(label: 'Hot', active: true)),
              SizedBox(width: 8),
              Expanded(child: _PreviewTab(label: 'Nearby')),
              SizedBox(width: 8),
              Expanded(child: _PreviewTab(label: 'New')),
            ],
          ),
          const SizedBox(height: 12),
          const _PreviewLiveCard(),
          const SizedBox(height: 10),
          Row(
            children: const [
              Expanded(
                child: _MiniLiveCard(
                  image: RtcAssets.soloLive,
                  type: 'Video Room',
                  title: 'Daily Standup',
                  seats: '8 seats',
                ),
              ),
              SizedBox(width: 10),
              Expanded(
                child: _MiniLiveCard(
                  image: RtcAssets.musicRoom,
                  type: 'Music Room',
                  title: 'Open Mic Lounge',
                  seats: '12 seats',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PreviewTab extends StatelessWidget {
  const _PreviewTab({required this.label, this.active = false});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
      decoration: BoxDecoration(
        color: active
            ? const Color.fromRGBO(255, 63, 127, 0.86)
            : const Color.fromRGBO(255, 255, 255, 0.06),
        borderRadius: BorderRadius.circular(7),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: RtcPalette.text,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _PreviewLiveCard extends StatelessWidget {
  const _PreviewLiveCard();

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1.05,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(RtcAssets.videoRoom, fit: BoxFit.cover),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color.fromRGBO(3, 7, 18, 0.06),
                    Color.fromRGBO(3, 7, 18, 0.86),
                  ],
                ),
              ),
            ),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [Color.fromRGBO(3, 7, 18, 0.5), Colors.transparent],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _OnlinePill(label: 'LIVE', live: true),
                  const Spacer(),
                  Row(
                    children: [
                      Container(
                        width: 54,
                        height: 54,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          color: const Color.fromRGBO(15, 23, 42, 0.82),
                          border: Border.all(
                            color: const Color.fromRGBO(255, 255, 255, 0.18),
                          ),
                          shape: BoxShape.circle,
                        ),
                        child: Image.asset(
                          RtcAssets.avatarAssets.first,
                          fit: BoxFit.cover,
                        ),
                      ),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'BuzzCast Studio',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: RtcPalette.text,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Video and music hosts on stage',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: RtcPalette.muted,
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color.fromRGBO(15, 23, 42, 0.72),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      children: [
                        Expanded(
                          child: Text(
                            '2.4K watching',
                            style: TextStyle(
                              color: RtcPalette.muted,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        Text(
                          'Native RTC',
                          style: TextStyle(
                            color: RtcPalette.muted,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniLiveCard extends StatelessWidget {
  const _MiniLiveCard({
    required this.image,
    required this.type,
    required this.title,
    required this.seats,
  });

  final String image;
  final String type;
  final String title;
  final String seats;

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1.35,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(image, fit: BoxFit.cover),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color.fromRGBO(3, 7, 18, 0.16),
                    Color.fromRGBO(3, 7, 18, 0.82),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    type,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: RtcPalette.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: RtcPalette.text,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    seats,
                    style: const TextStyle(
                      color: RtcPalette.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnlinePill extends StatelessWidget {
  const _OnlinePill({required this.label, required this.live});

  final String label;
  final bool live;

  @override
  Widget build(BuildContext context) {
    final dotColor = live ? RtcPalette.red : RtcPalette.mint;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(15, 23, 42, 0.72),
        border: Border.all(color: Color.fromRGBO(255, 255, 255, 0.16)),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: dotColor,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: dotColor.withValues(alpha: 0.5),
                  blurRadius: 18,
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: RtcPalette.text,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ShowcaseStat extends StatelessWidget {
  const _ShowcaseStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(255, 255, 255, 0.075),
        border: Border.all(color: Color.fromRGBO(255, 255, 255, 0.12)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: RtcPalette.muted,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: RtcPalette.text,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _AuthPanel extends StatelessWidget {
  const _AuthPanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color.fromRGBO(56, 189, 248, 0.08),
            Color.fromRGBO(255, 63, 127, 0.06),
          ],
        ),
        color: const Color(0xFF101827),
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(RtcRadius.panel),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(0, 0, 0, 0.54),
            blurRadius: 90,
            offset: Offset(0, 28),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _AuthPrimaryButton extends StatelessWidget {
  const _AuthPrimaryButton({
    required this.loading,
    required this.label,
    required this.onPressed,
  });

  final bool loading;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: onPressed == null ? 0.55 : 1,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [RtcPalette.hot, RtcPalette.hot2],
          ),
          border: Border.all(color: Color.fromRGBO(255, 255, 255, 0.14)),
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [
            BoxShadow(
              color: Color.fromRGBO(255, 63, 127, 0.2),
              blurRadius: 30,
              offset: Offset(0, 12),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: onPressed,
            child: SizedBox(
              width: double.infinity,
              height: 52,
              child: Center(
                child: Text(
                  loading ? 'Please wait...' : label,
                  style: const TextStyle(
                    color: RtcPalette.text,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthTextField extends StatelessWidget {
  const _AuthTextField({
    required this.controller,
    required this.field,
    required this.label,
    required this.onChanged,
    this.error,
    this.hintText,
    this.autofillHints,
    this.keyboardType,
    this.textInputAction,
    this.inputFormatters,
    this.obscureText = false,
    this.suffix,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String field;
  final String label;
  final ValueChanged<String> onChanged;
  final String? error;
  final String? hintText;
  final Iterable<String>? autofillHints;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final List<TextInputFormatter>? inputFormatters;
  final bool obscureText;
  final Widget? suffix;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofillHints: autofillHints,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      inputFormatters: inputFormatters,
      obscureText: obscureText,
      onSubmitted: onSubmitted,
      onChanged: (_) => onChanged(field),
      decoration: _authInputDecoration(
        label: label,
        hintText: hintText,
        error: error,
        suffix: suffix,
      ),
    );
  }
}

InputDecoration _authInputDecoration({
  required String label,
  String? hintText,
  String? error,
  Widget? suffix,
}) {
  return InputDecoration(
    labelText: label,
    hintText: hintText,
    errorText: error,
    suffixIcon: suffix,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(7),
      borderSide: const BorderSide(color: RtcPalette.lineStrong),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(7),
      borderSide: const BorderSide(color: RtcPalette.sky),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(7),
      borderSide: const BorderSide(color: RtcPalette.red),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(7),
      borderSide: const BorderSide(color: RtcPalette.red, width: 1.3),
    ),
  );
}

class _AuthInlineFields extends StatelessWidget {
  const _AuthInlineFields({required this.children, this.residence = false});

  final List<Widget> children;
  final bool residence;

  @override
  Widget build(BuildContext context) {
    final widths = residence ? const [1.0, 0.82] : const [1.0, 0.58];
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 380) {
          return Column(
            children: [
              children.first,
              const SizedBox(height: 12),
              children.last,
            ],
          );
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: (widths.first * 100).round(), child: children.first),
            const SizedBox(width: 10),
            Expanded(flex: (widths.last * 100).round(), child: children.last),
          ],
        );
      },
    );
  }
}

class _PasswordStrength extends StatelessWidget {
  const _PasswordStrength({required this.strong});

  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Text(
      strong
          ? 'Strong password'
          : 'Use 10+ characters with uppercase, lowercase, number, and symbol.',
      style: TextStyle(
        color: strong ? const Color(0xFFBBF7D0) : RtcPalette.muted,
        fontSize: 12,
        fontWeight: FontWeight.w800,
      ),
    );
  }
}

class _AuthStatusBox extends StatelessWidget {
  const _AuthStatusBox({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(15, 23, 42, 0.68),
        border: Border.all(color: const Color.fromRGBO(148, 163, 184, 0.18)),
        borderRadius: BorderRadius.circular(7),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: RtcPalette.soft,
          fontWeight: FontWeight.w700,
          height: RtcTypography.bodyHeight,
        ),
      ),
    );
  }
}

class _AuthTabs extends StatelessWidget {
  const _AuthTabs({required this.mode, required this.onChanged});

  final String mode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(255, 255, 255, 0.06),
        borderRadius: BorderRadius.circular(RtcRadius.control),
      ),
      child: Row(
        children: [
          _AuthTabButton(
            label: 'Login',
            selected: mode == 'login',
            onTap: () => onChanged('login'),
          ),
          const SizedBox(width: 8),
          _AuthTabButton(
            label: 'Register',
            selected: mode == 'register',
            onTap: () => onChanged('register'),
          ),
        ],
      ),
    );
  }
}

class _AuthTabButton extends StatelessWidget {
  const _AuthTabButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(7),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(7),
            gradient: selected
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [RtcPalette.hot, RtcPalette.hot2],
                  )
                : null,
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? RtcPalette.text : RtcPalette.soft,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ),
    );
  }
}
