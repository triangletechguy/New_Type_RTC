import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../ui/rtc_assets.dart';
import '../ui/rtc_mobile_ui.dart';

class SdkDocsScreen extends StatefulWidget {
  const SdkDocsScreen({super.key, required this.api, required this.onBack});

  final ApiClient api;
  final VoidCallback onBack;

  @override
  State<SdkDocsScreen> createState() => _SdkDocsScreenState();
}

class _SdkDocsScreenState extends State<SdkDocsScreen> {
  late Future<Map<String, dynamic>> _config;
  final _appKeyController = TextEditingController(text: 'app_demo_key');
  final _roomIdController = TextEditingController(text: 'room_42');
  final _userIdController = TextEditingController(text: 'external_user_123');
  final _tokenController = TextEditingController(text: 'rtc_token_from_server');

  String _activeCodeTab = 'Web';
  String _playgroundMode = 'video';

  @override
  void initState() {
    super.initState();
    _config = widget.api.rtcConfig();
  }

  @override
  void dispose() {
    _appKeyController.dispose();
    _roomIdController.dispose();
    _userIdController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final future = widget.api.rtcConfig();
    setState(() {
      _config = future;
    });
    await future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _refresh,
            child: FutureBuilder<Map<String, dynamic>>(
              future: _config,
              builder: (context, snapshot) {
                final config = snapshot.data ?? const <String, dynamic>{};
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    BrandHeader(
                      title: 'Developer Docs',
                      subtitle: 'Native RTC integration guide',
                      trailing: RtcIconButton(
                        icon: Icons.arrow_back,
                        tooltip: 'Rooms',
                        onPressed: widget.onBack,
                      ),
                    ),
                    const SizedBox(height: 14),
                    GlassPanel(
                      padding: EdgeInsets.zero,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.asset(
                          RtcAssets.brandAppScreenshots,
                          fit: BoxFit.cover,
                          height: 150,
                          width: double.infinity,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    _HeroPanel(config: config, snapshot: snapshot),
                    const SizedBox(height: 14),
                    _FlowPanel(),
                    const SizedBox(height: 14),
                    _CodeSamplesPanel(
                      activeTab: _activeCodeTab,
                      onChanged: (tab) => setState(() => _activeCodeTab = tab),
                    ),
                    const SizedBox(height: 14),
                    _PlaygroundPanel(
                      appKeyController: _appKeyController,
                      roomIdController: _roomIdController,
                      userIdController: _userIdController,
                      tokenController: _tokenController,
                      mode: _playgroundMode,
                      onTextChanged: () => setState(() {}),
                      onModeChanged: (mode) {
                        setState(() => _playgroundMode = mode);
                      },
                    ),
                    const SizedBox(height: 14),
                    _TokenPanel(),
                    const SizedBox(height: 14),
                    _RouteMapPanel(),
                    const SizedBox(height: 14),
                    _ReferencePanel(),
                    const SizedBox(height: 14),
                    _ReliabilityPanel(),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _HeroPanel extends StatelessWidget {
  const _HeroPanel({required this.config, required this.snapshot});

  final Map<String, dynamic> config;
  final AsyncSnapshot<Map<String, dynamic>> snapshot;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'SELF-HOSTED RTC INTEGRATION',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: RtcPalette.sky,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Company app credentials, shadow users, room APIs, short-lived RTC tokens, usage tracking, and SFU-ready media architecture.',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 14),
          if (snapshot.connectionState != ConnectionState.done)
            const LinearProgressIndicator(minHeight: 3)
          else if (snapshot.hasError)
            StatusPill(
              label: 'Attention',
              detail: apiErrorMessage(snapshot.error!),
              state: RtcStatusState.error,
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                MetricChip(
                  label: 'Signal',
                  value: config['signaling']?.toString() ?? 'Socket.IO',
                ),
                MetricChip(
                  label: 'Media',
                  value: config['media_mode']?.toString() ?? 'Native RTC',
                ),
                MetricChip(
                  label: 'Version',
                  value: config['version']?.toString() ?? 'v1.0',
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _FlowPanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'Build flow',
            title: 'Six-step integration path',
            detail:
                'This mirrors the web SDK guide from company app setup through billable RTC sessions.',
          ),
          const SizedBox(height: 12),
          ..._flowSteps.asMap().entries.map((entry) {
            final index = entry.key + 1;
            final step = entry.value;
            return _DocRow(
              title: '$index. ${step.title}',
              body: step.body,
              meta: step.meta,
            );
          }),
        ],
      ),
    );
  }
}

class _CodeSamplesPanel extends StatelessWidget {
  const _CodeSamplesPanel({required this.activeTab, required this.onChanged});

  final String activeTab;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final sample = _codeSamples[activeTab] ?? _codeSamples.values.first;
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'Samples',
            title: 'Tabbed SDK code samples',
            detail:
                'Use these same routes from web, React, server code, or event listeners.',
          ),
          const SizedBox(height: 12),
          RtcFilterBar(
            options: _codeSamples.keys.toList(),
            active: activeTab,
            onChanged: onChanged,
          ),
          const SizedBox(height: 12),
          _CodeBox(sample),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: const [
              MetricChip(label: 'Install', value: 'npm'),
              MetricChip(label: 'Auth', value: 'API key'),
              MetricChip(label: 'Token', value: 'JWT'),
            ],
          ),
        ],
      ),
    );
  }
}

class _PlaygroundPanel extends StatelessWidget {
  const _PlaygroundPanel({
    required this.appKeyController,
    required this.roomIdController,
    required this.userIdController,
    required this.tokenController,
    required this.mode,
    required this.onTextChanged,
    required this.onModeChanged,
  });

  final TextEditingController appKeyController;
  final TextEditingController roomIdController;
  final TextEditingController userIdController;
  final TextEditingController tokenController;
  final String mode;
  final VoidCallback onTextChanged;
  final ValueChanged<String> onModeChanged;

  @override
  Widget build(BuildContext context) {
    final payload =
        '''
{
  "app_key": "${appKeyController.text}",
  "room_id": "${roomIdController.text}",
  "external_user_id": "${userIdController.text}",
  "rtc_mode": "$mode",
  "token": "${tokenController.text}"
}''';

    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'Console',
            title: 'SDK Console payload',
            detail:
                'Draft the same join payload your client backend will mint into an RTC token.',
          ),
          const SizedBox(height: 12),
          _DocInput(
            controller: appKeyController,
            label: 'App key',
            icon: Icons.vpn_key_outlined,
            onChanged: onTextChanged,
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _DocInput(
                  controller: roomIdController,
                  label: 'Room id',
                  icon: Icons.meeting_room_outlined,
                  onChanged: onTextChanged,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _DocInput(
                  controller: userIdController,
                  label: 'External user',
                  icon: Icons.person_outline,
                  onChanged: onTextChanged,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _DocInput(
            controller: tokenController,
            label: 'RTC token',
            icon: Icons.lock_clock_outlined,
            onChanged: onTextChanged,
          ),
          const SizedBox(height: 10),
          RtcFilterBar(
            options: const ['video', 'audio', 'broadcast'],
            active: mode,
            onChanged: onModeChanged,
          ),
          const SizedBox(height: 12),
          _CodeBox(payload),
        ],
      ),
    );
  }
}

class _TokenPanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      key: const ValueKey('sdk-token-panel'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'Token contract',
            title: 'RTC token claims',
            detail:
                'Tokens bind tenant, app, user, room, role, permissions, billing fields, and expiry.',
          ),
          const SizedBox(height: 12),
          ..._tokenClaims.map((claim) {
            return _DocRow(
              title: claim.title,
              body: claim.body,
              meta: claim.meta,
            );
          }),
        ],
      ),
    );
  }
}

class _RouteMapPanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      key: const ValueKey('sdk-route-panel'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'Route map',
            title: 'Platform and client APIs',
            detail:
                'The Flutter docs expose the same admin and client endpoint map as the web SDK guide.',
          ),
          const SizedBox(height: 12),
          ..._routeGroups.map((group) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    group.title,
                    style: const TextStyle(
                      color: RtcPalette.text,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...group.rows.map((row) {
                    return _DocRow(
                      title: row.title,
                      body: row.body,
                      meta: row.meta,
                    );
                  }),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _ReferencePanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'Reference',
            title: 'Room types, SDK methods, events',
            detail:
                'Native docs include the practical API rows developers need while building mobile or web clients.',
          ),
          const SizedBox(height: 12),
          const _MiniTitle('Room types'),
          ..._roomTypes.map(
            (row) => _DocRow(title: row.title, body: row.body, meta: row.meta),
          ),
          const SizedBox(height: 8),
          const _MiniTitle('Client SDK methods'),
          ..._apiMethods.map(
            (row) => _DocRow(title: row.title, body: row.body, meta: row.meta),
          ),
          const SizedBox(height: 8),
          const _MiniTitle('Events'),
          ..._events.map(
            (row) => _DocRow(title: row.title, body: row.body, meta: row.meta),
          ),
        ],
      ),
    );
  }
}

class _ReliabilityPanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      key: const ValueKey('sdk-reliability-panel'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const RtcSectionHeader(
            eyebrow: 'Reliability',
            title: 'Errors, webhooks, media roadmap',
            detail:
                'These native reference tables match the web guide for backend handling and SFU readiness.',
          ),
          const SizedBox(height: 12),
          const _MiniTitle('Error codes'),
          ..._errorRows.map(
            (row) => _DocRow(title: row.title, body: row.body, meta: row.meta),
          ),
          const SizedBox(height: 8),
          const _MiniTitle('Webhooks'),
          ..._webhookRows.map(
            (row) => _DocRow(title: row.title, body: row.body, meta: row.meta),
          ),
          const SizedBox(height: 8),
          const _MiniTitle('Media upgrade path'),
          ..._mediaRows.map(
            (row) => _DocRow(title: row.title, body: row.body, meta: row.meta),
          ),
        ],
      ),
    );
  }
}

class _DocInput extends StatelessWidget {
  const _DocInput({
    required this.controller,
    required this.label,
    required this.icon,
    this.onChanged,
  });

  final TextEditingController controller;
  final String label;
  final IconData icon;
  final VoidCallback? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: (_) => onChanged?.call(),
      style: const TextStyle(
        color: RtcPalette.text,
        fontWeight: FontWeight.w800,
      ),
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, color: RtcPalette.muted),
        labelStyle: const TextStyle(
          color: RtcPalette.muted,
          fontWeight: FontWeight.w800,
        ),
        filled: true,
        fillColor: RtcPalette.hoverBg,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RtcRadius.control),
          borderSide: const BorderSide(color: RtcPalette.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RtcRadius.control),
          borderSide: const BorderSide(color: RtcPalette.focusBorder),
        ),
      ),
    );
  }
}

class _DocRow extends StatelessWidget {
  const _DocRow({required this.title, required this.body, required this.meta});

  final String title;
  final String body;
  final String meta;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RtcPalette.hoverBg,
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(RtcRadius.control),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                const SizedBox(height: 5),
                Text(
                  body,
                  style: const TextStyle(
                    color: RtcPalette.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          StatusPill(label: meta),
        ],
      ),
    );
  }
}

class _CodeBox extends StatelessWidget {
  const _CodeBox(this.code);

  final String code;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RtcPalette.bg.withValues(alpha: 0.72),
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(RtcRadius.control),
      ),
      child: SelectableText(
        code.trim(),
        style: const TextStyle(
          color: RtcPalette.soft,
          fontFamily: 'monospace',
          fontSize: 12,
          fontWeight: FontWeight.w800,
          height: 1.35,
        ),
      ),
    );
  }
}

class _MiniTitle extends StatelessWidget {
  const _MiniTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
          color: RtcPalette.sky,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _DocItem {
  const _DocItem(this.title, this.body, this.meta);

  final String title;
  final String body;
  final String meta;
}

class _DocGroup {
  const _DocGroup(this.title, this.rows);

  final String title;
  final List<_DocItem> rows;
}

const _flowSteps = [
  _DocItem(
    'Create company app',
    'Generate app_key, api_key, sdk_token, feature flags, and allowed origin policy from admin.',
    'Admin',
  ),
  _DocItem(
    'Sync free shadow user',
    'Client backend upserts external user identity before issuing an RTC token.',
    'Users',
  ),
  _DocItem(
    'Create or select room',
    'Create rooms through client APIs or use an admin-managed room id.',
    'Rooms',
  ),
  _DocItem(
    'Issue RTC token',
    'Server exchanges API key, app key, room, user, and permission payload for a short-lived token.',
    'Token',
  ),
  _DocItem(
    'Join signaling and media',
    'Client initializes signaling, WebRTC tracks, chat, and moderation actions.',
    'RTC',
  ),
  _DocItem(
    'Bill client company',
    'Session start/end and participant-minute records feed usage dashboards and invoices.',
    'Billing',
  ),
];

const _codeSamples = {
  'Web': '''
const rtc = new TalkEachOtherRTC({
  appKey: process.env.RTC_APP_KEY,
  token: await fetchRtcToken(roomId, externalUserId),
})

await rtc.authenticate()
await rtc.joinRoom({ roomId, audio: true, video: true })
rtc.on('remote-track', ({ stream }) => attachVideo(stream))
''',
  'React': '''
useEffect(() => {
  const client = createRtcClient({ appKey, token })
  client.joinRoom({ roomId, audio: true, video: mode === 'video' })
  client.on('room-message', setLatestMessage)
  return () => client.leaveRoom()
}, [appKey, token, roomId, mode])
''',
  'Server': '''
app.post('/rtc/token', requireUser, async (req, res) => {
  const token = await rtc.issueToken({
    app_key: process.env.RTC_APP_KEY,
    external_user_id: req.user.id,
    room_id: req.body.room_id,
    role: 'participant',
  })
  res.json({ token })
})
''',
  'Events': '''
rtc.on('peer-joined', showParticipant)
rtc.on('peer-left', removeParticipant)
rtc.on('remote-track', attachRemoteTrack)
rtc.on('room-message', appendChatMessage)
rtc.on('message-unsent', removeChatMessage)
rtc.on('moderation', applyModerationEvent)
''',
};

const _tokenClaims = [
  _DocItem(
    'tenant_id',
    'Client company that owns the app and billable room usage.',
    'required',
  ),
  _DocItem(
    'app_id / app_key',
    'Generated SDK app identity used to scope credentials.',
    'required',
  ),
  _DocItem(
    'external_user_id',
    'Stable user id from the client company product.',
    'required',
  ),
  _DocItem(
    'room_id',
    'Room to join, create, or moderate through RTC signaling.',
    'required',
  ),
  _DocItem(
    'room_type / rtc_profile',
    'Audio, video, broadcast, one-to-one, or group media profile.',
    'media',
  ),
  _DocItem(
    'role / permissions',
    'Participant, host, moderator, message, mute, or screen-share permissions.',
    'access',
  ),
  _DocItem(
    'billing fields',
    'Session and participant-minute attribution for company invoices.',
    'billing',
  ),
  _DocItem(
    'exp / iat',
    'Short-lived expiry and issued-at claims for replay protection.',
    'security',
  ),
];

const _routeGroups = [
  _DocGroup('Platform Admin APIs', [
    _DocItem(
      'GET /admin/overview',
      'Dashboard, companies, plans, apps, rooms, usage, and health payload.',
      'read',
    ),
    _DocItem(
      'POST /admin/client-apps',
      'Generate SDK app access for a client company.',
      'write',
    ),
    _DocItem(
      'PATCH /admin/plan-requests/:id',
      'Approve or reject package purchase requests.',
      'review',
    ),
    _DocItem(
      'POST /admin/rooms',
      'Create managed RTC rooms for client companies.',
      'rooms',
    ),
  ]),
  _DocGroup('Client Company APIs', [
    _DocItem(
      'GET /api/client/me',
      'Validate API key and load company/app scope.',
      'auth',
    ),
    _DocItem(
      'POST /api/client/users/sync',
      'Upsert shadow users from an external product.',
      'users',
    ),
    _DocItem(
      'POST /api/client/rooms',
      'Create company-owned rooms through backend API.',
      'rooms',
    ),
    _DocItem(
      'POST /api/client/rtc/token',
      'Mint a short-lived RTC token for a synced user and room.',
      'token',
    ),
  ]),
];

const _roomTypes = [
  _DocItem(
    'audio',
    'Audio room with chat and participant-minute billing.',
    'audio',
  ),
  _DocItem(
    'youtube_audio',
    'Audio room backed by shared YouTube playback.',
    'music',
  ),
  _DocItem(
    'one_to_one_audio',
    'Private audio call profile with two seats.',
    '1:1',
  ),
  _DocItem(
    'group_audio',
    'Multi-participant audio profile with host controls.',
    'group',
  ),
  _DocItem('video', 'Default video room with camera, mic, and chat.', 'video'),
  _DocItem(
    'one_to_one_video',
    'Private video call profile with two seats.',
    '1:1',
  ),
  _DocItem(
    'group_video',
    'Group video room with screen-share and moderation.',
    'group',
  ),
  _DocItem(
    'solo_live / pk_live',
    'Broadcast-style live rooms for creator scenarios.',
    'live',
  ),
];

const _apiMethods = [
  _DocItem(
    'authenticate()',
    'Validates app key, token, room scope, and permissions.',
    'auth',
  ),
  _DocItem(
    'joinRoom()',
    'Connects signaling, local media tracks, and room state.',
    'join',
  ),
  _DocItem(
    'setAudioEnabled()',
    'Mutes or unmutes microphone state for local and remote peers.',
    'media',
  ),
  _DocItem(
    'setVideoEnabled()',
    'Toggles camera track publishing when the room allows video.',
    'media',
  ),
  _DocItem(
    'sendMessage()',
    'Sends room chat events through signaling.',
    'chat',
  ),
  _DocItem(
    'leaveRoom()',
    'Ends participation and flushes usage tracking.',
    'billing',
  ),
];

const _events = [
  _DocItem(
    'peer-joined',
    'A participant joined the current RTC room.',
    'presence',
  ),
  _DocItem(
    'peer-left',
    'A participant left or disconnected from the room.',
    'presence',
  ),
  _DocItem(
    'remote-track',
    'A remote audio or video track is available for rendering.',
    'media',
  ),
  _DocItem(
    'room-message',
    'A chat message arrived for the active room.',
    'chat',
  ),
  _DocItem(
    'message-unsent',
    'A moderation action removed a prior chat message.',
    'moderation',
  ),
  _DocItem(
    'moderation',
    'Mute, kick, ban, or role events from host/admin actions.',
    'safety',
  ),
];

const _errorRows = [
  _DocItem(
    'invalid_api_key',
    'API key is missing, revoked, or not valid for this app.',
    '401',
  ),
  _DocItem(
    'company_suspended',
    'Client company cannot issue tokens or open sessions.',
    '403',
  ),
  _DocItem(
    'app_suspended',
    'SDK app credentials are disabled in admin.',
    '403',
  ),
  _DocItem(
    'origin_not_allowed',
    'Browser origin does not match configured allowed origins.',
    '403',
  ),
  _DocItem(
    'room_disabled',
    'Room exists but cannot accept new RTC sessions.',
    '409',
  ),
  _DocItem(
    'user_not_synced',
    'External user must be synced before token minting.',
    '422',
  ),
  _DocItem(
    'room_capacity_reached',
    'Room package or room type capacity has been reached.',
    '429',
  ),
];

const _webhookRows = [
  _DocItem(
    'room.started',
    'First participant opened a billable RTC session.',
    'room',
  ),
  _DocItem('room.ended', 'Room session ended and usage was finalized.', 'room'),
  _DocItem(
    'participant.joined',
    'Participant entered signaling/media session.',
    'presence',
  ),
  _DocItem(
    'participant.left',
    'Participant left and duration can be recorded.',
    'presence',
  ),
  _DocItem(
    'usage.updated',
    'Participant-minute usage changed for billing dashboards.',
    'usage',
  ),
  _DocItem(
    'billing.invoice_ready',
    'Company invoice summary is ready for review.',
    'billing',
  ),
];

const _mediaRows = [
  _DocItem(
    'MVP media',
    'Peer connection mesh for current native and web room flows.',
    'now',
  ),
  _DocItem(
    'Signaling scale',
    'Socket rooms, presence state, and reconnect handling.',
    'scale',
  ),
  _DocItem(
    'TURN reliability',
    'Credentials and relays for strict mobile networks.',
    'network',
  ),
  _DocItem(
    'SFU adapter',
    'Future mediasoup/livekit adapter behind same room token.',
    'future',
  ),
  _DocItem(
    'Admin metrics',
    'Quality, reconnect, participant, and usage monitors.',
    'ops',
  ),
];
