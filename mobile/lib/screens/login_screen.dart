import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../theme/buzzcast_theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onLoggedIn});

  final ApiClient api;
  final Future<void> Function() onLoggedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController(text: 'Test User');
  final _email = TextEditingController(text: 'admin@gmail.com');
  final _password = TextEditingController(text: 'admin@gmail.com');
  bool _loading = false;
  bool _showPassword = false;
  bool _registering = false;
  String _status =
      'Use admin@gmail.com or admin@accenture.com with password admin@gmail.com.';

  bool get _passwordStrong {
    final value = _password.text;
    return value.length >= 10 &&
        RegExp('[a-z]').hasMatch(value) &&
        RegExp('[A-Z]').hasMatch(value) &&
        RegExp(r'\d').hasMatch(value) &&
        RegExp(r'[^A-Za-z0-9]').hasMatch(value);
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _switchMode(bool registering) {
    setState(() {
      _registering = registering;
      _status = registering
          ? 'Create a host profile for video rooms, music rooms, and live chat.'
          : 'Use admin@gmail.com or admin@accenture.com with password admin@gmail.com.';
    });
  }

  Future<void> _checkHealth() async {
    setState(() {
      _loading = true;
      _status = 'Checking backend...';
    });
    try {
      final health = await widget.api.health();
      if (!mounted) return;
      setState(
        () => _status = health['message']?.toString() ?? 'Backend is healthy.',
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      setState(() => _status = 'Please fix the highlighted login details.');
      return;
    }

    setState(() {
      _loading = true;
      _status = _registering ? 'Creating account...' : 'Logging in...';
    });

    try {
      if (_registering) {
        await widget.api.register(
          name: _name.text.trim(),
          email: _email.text.trim().toLowerCase(),
          password: _password.text,
        );
      } else {
        await widget.api.login(
          _email.text.trim().toLowerCase(),
          _password.text,
        );
      }
      await widget.onLoggedIn();
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BuzzColors.feedBackground,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 470),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                const _LoginShowcase(),
                const SizedBox(height: 16),
                _AuthCard(
                  formKey: _formKey,
                  name: _name,
                  email: _email,
                  password: _password,
                  loading: _loading,
                  registering: _registering,
                  showPassword: _showPassword,
                  passwordStrong: _passwordStrong,
                  status: _status,
                  onModeChanged: _switchMode,
                  onSubmit: _submit,
                  onHealthCheck: _checkHealth,
                  onPasswordVisibilityChanged: () {
                    setState(() => _showPassword = !_showPassword);
                  },
                  onPasswordChanged: () => setState(() {}),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LoginShowcase extends StatelessWidget {
  const _LoginShowcase();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        color: const Color(0xFF0F172A),
        border: Border.all(color: Colors.white.withValues(alpha: .09)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            BuzzColors.hot.withValues(alpha: .22),
            const Color(0xFF0F172A),
            BuzzColors.sky.withValues(alpha: .10),
          ],
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const _ImageMark(),
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
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      'Live video and music rooms',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Color(0xFFA8B3C7),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFF111827).withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: .14),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: BuzzColors.mint,
                        borderRadius: BorderRadius.circular(99),
                        boxShadow: [
                          BoxShadow(
                            color: BuzzColors.mint.withValues(alpha: .7),
                            blurRadius: 14,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Text(
                      'Online',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF070B14),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white.withValues(alpha: .14)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: .35),
                  blurRadius: 38,
                  offset: const Offset(0, 18),
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
                const _HeroLivePreview(),
                const SizedBox(height: 10),
                const Row(
                  children: [
                    Expanded(
                      child: _MiniLiveCard(
                        asset: BuzzAssets.soloLive,
                        type: 'Video Room',
                        title: 'Daily Standup',
                        seats: '8 seats',
                      ),
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: _MiniLiveCard(
                        asset: BuzzAssets.musicRoom,
                        type: 'Music Room',
                        title: 'Open Mic Lounge',
                        seats: '12 seats',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          const Row(
            children: [
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

class _AuthCard extends StatelessWidget {
  const _AuthCard({
    required this.formKey,
    required this.name,
    required this.email,
    required this.password,
    required this.loading,
    required this.registering,
    required this.showPassword,
    required this.passwordStrong,
    required this.status,
    required this.onModeChanged,
    required this.onSubmit,
    required this.onHealthCheck,
    required this.onPasswordVisibilityChanged,
    required this.onPasswordChanged,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController name;
  final TextEditingController email;
  final TextEditingController password;
  final bool loading;
  final bool registering;
  final bool showPassword;
  final bool passwordStrong;
  final String status;
  final ValueChanged<bool> onModeChanged;
  final VoidCallback onSubmit;
  final VoidCallback onHealthCheck;
  final VoidCallback onPasswordVisibilityChanged;
  final VoidCallback onPasswordChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .08),
            blurRadius: 26,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Form(
        key: formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Welcome back',
              style: TextStyle(
                color: BuzzColors.teal,
                fontSize: 12,
                fontWeight: FontWeight.w900,
                letterSpacing: .6,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Enter video and music rooms',
              style: TextStyle(
                color: BuzzColors.feedText,
                fontSize: 28,
                height: 1.05,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Sign in or create a host profile for live RTC rooms, chat, and creator flows.',
              style: TextStyle(
                color: BuzzColors.mutedText,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _AuthTab(
                      label: 'Login',
                      active: !registering,
                      onTap: () => onModeChanged(false),
                    ),
                  ),
                  Expanded(
                    child: _AuthTab(
                      label: 'Register',
                      active: registering,
                      onTap: () => onModeChanged(true),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (registering) ...[
              const _FieldLabel('Name'),
              _BuzzTextField(
                controller: name,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.name],
                validator: (value) {
                  if ((value ?? '').trim().length < 2) {
                    return 'Name must be at least 2 characters.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
            ],
            const _FieldLabel('Email'),
            _BuzzTextField(
              controller: email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.email],
              validator: (value) {
                final text = (value ?? '').trim();
                if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(text)) {
                  return 'Use a valid email address.';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            const _FieldLabel('Password'),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _BuzzTextField(
                    controller: password,
                    obscureText: !showPassword,
                    textInputAction: TextInputAction.done,
                    autofillHints: [
                      registering
                          ? AutofillHints.newPassword
                          : AutofillHints.password,
                    ],
                    onChanged: (_) => onPasswordChanged(),
                    onSubmitted: (_) => loading ? null : onSubmit(),
                    validator: (value) {
                      final text = value ?? '';
                      if (text.isEmpty) return 'Password is required.';
                      if (registering && !passwordStrong) {
                        return 'Use 10+ chars with upper, lower, number, symbol.';
                      }
                      return null;
                    },
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  height: 48,
                  child: OutlinedButton(
                    onPressed: onPasswordVisibilityChanged,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: BuzzColors.green,
                      side: BorderSide(
                        color: BuzzColors.green.withValues(alpha: .3),
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: Text(showPassword ? 'Hide' : 'Show'),
                  ),
                ),
              ],
            ),
            if (registering) ...[
              const SizedBox(height: 8),
              Text(
                passwordStrong
                    ? 'Strong password'
                    : 'Use 10+ characters with uppercase, lowercase, number, and symbol.',
                style: TextStyle(
                  color: passwordStrong
                      ? BuzzColors.green
                      : BuzzColors.mutedText,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: loading ? null : onSubmit,
              icon: loading
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Icon(registering ? Icons.person_add_alt_1 : Icons.login),
              label: Text(
                loading
                    ? 'Please wait...'
                    : registering
                    ? 'Create account'
                    : 'Login',
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: loading ? null : onHealthCheck,
              icon: const Icon(Icons.monitor_heart_outlined),
              label: const Text('Check backend'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
                foregroundColor: BuzzColors.feedText,
                side: const BorderSide(color: Color(0xFFE2E8F0)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Text(
                status,
                style: const TextStyle(
                  color: BuzzColors.mutedText,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeroLivePreview extends StatelessWidget {
  const _HeroLivePreview();

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: .86,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(BuzzAssets.videoRoom, fit: BoxFit.cover),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: .08),
                    Colors.black.withValues(alpha: .26),
                    Colors.black.withValues(alpha: .86),
                  ],
                ),
              ),
            ),
            Positioned(
              top: 14,
              left: 14,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFF111827).withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: .16),
                  ),
                ),
                child: const Row(
                  children: [
                    _LiveDot(),
                    SizedBox(width: 6),
                    Text(
                      'LIVE',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Positioned(
              left: 14,
              right: 14,
              bottom: 68,
              child: Row(
                children: [
                  ClipOval(
                    child: Image.asset(
                      BuzzAssets.avatarForIndex(0),
                      width: 54,
                      height: 54,
                      fit: BoxFit.cover,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'talk-each-other Studio',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          'Video and music hosts on stage',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Color(0xFFA8B3C7),
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              left: 14,
              right: 14,
              bottom: 14,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A).withValues(alpha: .74),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '2.4K watching',
                      style: TextStyle(
                        color: Color(0xFFA8B3C7),
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      'Native RTC',
                      style: TextStyle(
                        color: Color(0xFFA8B3C7),
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
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
    required this.asset,
    required this.type,
    required this.title,
    required this.seats,
  });

  final String asset;
  final String type;
  final String title;
  final String seats;

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1.15,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(asset, fit: BoxFit.cover),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: .08),
                    Colors.black.withValues(alpha: .82),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    type,
                    style: const TextStyle(
                      color: Color(0xFFA8B3C7),
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    seats,
                    style: const TextStyle(
                      color: Color(0xFFA8B3C7),
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

class _PreviewTab extends StatelessWidget {
  const _PreviewTab({required this.label, this.active = false});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: active
            ? BuzzColors.hot.withValues(alpha: .86)
            : Colors.white.withValues(alpha: .06),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _AuthTab extends StatelessWidget {
  const _AuthTab({
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        foregroundColor: active ? Colors.white : BuzzColors.mutedText,
        backgroundColor: active ? BuzzColors.hot : Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      child: Text(label, style: const TextStyle(fontWeight: FontWeight.w900)),
    );
  }
}

class _BuzzTextField extends StatelessWidget {
  const _BuzzTextField({
    required this.controller,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.autofillHints,
    this.validator,
    this.onSubmitted,
    this.onChanged,
  });

  final TextEditingController controller;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool obscureText;
  final Iterable<String>? autofillHints;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      obscureText: obscureText,
      autofillHints: autofillHints,
      validator: validator,
      onFieldSubmitted: onSubmitted,
      onChanged: onChanged,
      decoration: InputDecoration(
        isDense: true,
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 13,
          vertical: 15,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: BuzzColors.sky),
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Text(
        label,
        style: const TextStyle(
          color: BuzzColors.feedText,
          fontSize: 13,
          fontWeight: FontWeight.w900,
        ),
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
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .075),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: .12)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFFA8B3C7),
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ImageMark extends StatelessWidget {
  const _ImageMark();

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 48,
        height: 48,
        color: Colors.white,
        padding: const EdgeInsets.all(3),
        child: Image.asset(BuzzAssets.creator, fit: BoxFit.cover),
      ),
    );
  }
}

class _LiveDot extends StatelessWidget {
  const _LiveDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: const Color(0xFFEF4444),
        borderRadius: BorderRadius.circular(99),
        boxShadow: const [BoxShadow(color: Color(0xFFEF4444), blurRadius: 14)],
      ),
    );
  }
}
