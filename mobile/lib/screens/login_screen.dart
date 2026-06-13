import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../services/api_client.dart';
import '../ui/rtc_mobile_ui.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onLoggedIn});

  final ApiClient api;
  final Future<void> Function() onLoggedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String _status = 'Not connected';

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _checkHealth() async {
    setState(() {
      _loading = true;
      _status = 'Checking backend...';
    });
    try {
      final health = await widget.api.health();
      setState(
        () => _status = health['message']?.toString() ?? 'Backend is healthy.',
      );
    } catch (error) {
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _login() async {
    setState(() {
      _loading = true;
      _status = 'Signing in...';
    });
    try {
      await widget.api.login(_email.text.trim(), _password.text);
      await widget.onLoggedIn();
    } catch (error) {
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: ListView(
                padding: const EdgeInsets.all(18),
                shrinkWrap: true,
                children: [
                  GlassPanel(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const BrandHeader(
                          title: 'talk-each-other',
                          subtitle: 'RTC service platform',
                        ),
                        const SizedBox(height: 22),
                        Text(
                          'Live video and music rooms',
                          style: Theme.of(context).textTheme.headlineMedium
                              ?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w900,
                                height: 1.05,
                              ),
                        ),
                        const SizedBox(height: 10),
                        const Text(
                          'Log in to join rooms, chat, connect RTC, and manage your profile.',
                          style: TextStyle(
                            color: RtcPalette.muted,
                            fontWeight: FontWeight.w700,
                            height: 1.35,
                          ),
                        ),
                        const SizedBox(height: 18),
                        const Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            MetricChip(label: 'Signal', value: 'Socket.IO'),
                            MetricChip(label: 'Media', value: 'Native RTC'),
                            MetricChip(label: 'Rooms', value: 'Live'),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  GlassPanel(
                    padding: const EdgeInsets.all(18),
                    child: AutofillGroup(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Sign in',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            AppConfig.apiBaseUrl,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: RtcPalette.muted,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 18),
                          TextField(
                            controller: _email,
                            autofillHints: const [AutofillHints.email],
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Email',
                              prefixIcon: Icon(Icons.mail_outline),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _password,
                            autofillHints: const [AutofillHints.password],
                            obscureText: true,
                            onSubmitted: (_) => _loading ? null : _login(),
                            decoration: const InputDecoration(
                              labelText: 'Password',
                              prefixIcon: Icon(Icons.lock_outline),
                            ),
                          ),
                          const SizedBox(height: 16),
                          GradientButton(
                            onPressed: _loading ? null : _login,
                            icon: _loading
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(Icons.login, color: Colors.white),
                            child: const Text('Sign in'),
                          ),
                          const SizedBox(height: 10),
                          GhostButton(
                            onPressed: _loading ? null : _checkHealth,
                            icon: Icons.monitor_heart_outlined,
                            label: 'Check backend',
                          ),
                          const SizedBox(height: 16),
                          StatusPill(
                            label: _status.contains('successfully')
                                ? 'Backend connected'
                                : _loading
                                ? 'Working'
                                : 'Status',
                            detail: _status,
                            state:
                                _status.contains('unreachable') ||
                                    _status.contains('failed')
                                ? RtcStatusState.error
                                : _status.contains('successfully') ||
                                      _status.contains('healthy')
                                ? RtcStatusState.good
                                : _loading
                                ? RtcStatusState.warning
                                : RtcStatusState.idle,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
