import 'dart:async';

import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';
import '../services/rtc_media_service.dart';
import '../services/signaling_service.dart';
import '../ui/rtc_mobile_ui.dart';

class LiveRoomScreen extends StatefulWidget {
  const LiveRoomScreen({
    super.key,
    required this.api,
    required this.user,
    required this.room,
  });

  final ApiClient api;
  final AppUser user;
  final Room room;

  @override
  State<LiveRoomScreen> createState() => _LiveRoomScreenState();
}

class _LiveRoomScreenState extends State<LiveRoomScreen> {
  final _media = RtcMediaService();
  final _signaling = SignalingService();
  final _events = <String>[];
  List<Map<String, dynamic>> _peers = const [];
  StreamSubscription<String>? _eventSub;
  StreamSubscription<List<Map<String, dynamic>>>? _peerSub;
  bool _joining = false;
  bool _joined = false;
  bool _micOn = true;
  bool _cameraOn = true;
  String _status = 'Ready to connect';

  @override
  void initState() {
    super.initState();
    _cameraOn = widget.room.supportsVideo;
    _eventSub = _signaling.events.listen((event) {
      if (!mounted) return;
      setState(() {
        _events.insert(0, event);
        if (_events.length > 12) _events.removeLast();
      });
    });
    _peerSub = _signaling.peers.listen((peers) {
      if (mounted) setState(() => _peers = peers);
    });
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    _peerSub?.cancel();
    _signaling.dispose();
    super.dispose();
  }

  Future<void> _join() async {
    setState(() {
      _joining = true;
      _status = 'Preparing media permissions...';
    });

    try {
      final video = widget.room.supportsVideo;
      await _media.requestPermissions(video: video);

      setState(() => _status = 'Joining backend room...');
      final joinData = await widget.api.joinRoom(widget.room.id, video: video);
      final rtc = Map<String, dynamic>.from(joinData['rtc'] as Map);
      final signalingRoom = rtc['signaling_room']?.toString() ?? '';
      if (signalingRoom.isEmpty) {
        throw StateError('Backend did not return rtc.signaling_room.');
      }

      setState(() => _status = 'Connecting signaling...');
      await _signaling.connect();
      await _signaling.joinRoom(
        signalingRoom: signalingRoom,
        databaseRoomId: widget.room.id,
        user: widget.user,
        video: video,
        micEnabled: rtc['mic_enabled'] != false,
        cameraEnabled: rtc['camera_enabled'] == true,
      );

      setState(() {
        _joined = true;
        _micOn = rtc['mic_enabled'] != false;
        _cameraOn = video && rtc['camera_enabled'] == true;
        _status = 'Connected to $signalingRoom';
      });
    } catch (error) {
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  void _leave() {
    _signaling.leaveRoom();
    setState(() {
      _joined = false;
      _peers = const [];
      _status = 'Left room';
      _events.insert(0, 'Left room');
    });
  }

  @override
  Widget build(BuildContext context) {
    final statusState = _joined
        ? RtcStatusState.good
        : _joining
        ? RtcStatusState.warning
        : _status.toLowerCase().contains('failed') ||
              _status.toLowerCase().contains('error') ||
              _status.toLowerCase().contains('unreachable')
        ? RtcStatusState.error
        : RtcStatusState.idle;

    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              BrandHeader(
                title: widget.room.name,
                subtitle: formatRoomType(widget.room.roomType),
                trailing: _IconShell(
                  tooltip: 'Back',
                  icon: Icons.arrow_back,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
              const SizedBox(height: 14),
              _StagePanel(
                room: widget.room,
                user: widget.user,
                peers: _peers,
                joined: _joined,
                joining: _joining,
                micOn: _micOn,
                cameraOn: _cameraOn,
                status: _status,
                statusState: statusState,
                onJoin: _joining || _joined ? null : _join,
                onLeave: _joined ? _leave : null,
                onToggleMic: _joined
                    ? () => setState(() => _micOn = !_micOn)
                    : null,
                onToggleCamera: _joined && widget.room.supportsVideo
                    ? () => setState(() => _cameraOn = !_cameraOn)
                    : null,
              ),
              const SizedBox(height: 14),
              _RoomInfoPanel(room: widget.room, peers: _peers, joined: _joined),
              const SizedBox(height: 14),
              _EventPanel(events: _events),
            ],
          ),
        ),
      ),
    );
  }
}

class _StagePanel extends StatelessWidget {
  const _StagePanel({
    required this.room,
    required this.user,
    required this.peers,
    required this.joined,
    required this.joining,
    required this.micOn,
    required this.cameraOn,
    required this.status,
    required this.statusState,
    required this.onJoin,
    required this.onLeave,
    required this.onToggleMic,
    required this.onToggleCamera,
  });

  final Room room;
  final AppUser user;
  final List<Map<String, dynamic>> peers;
  final bool joined;
  final bool joining;
  final bool micOn;
  final bool cameraOn;
  final String status;
  final RtcStatusState statusState;
  final VoidCallback? onJoin;
  final VoidCallback? onLeave;
  final VoidCallback? onToggleMic;
  final VoidCallback? onToggleCamera;

  @override
  Widget build(BuildContext context) {
    final tiles = [
      _StageTile(
        label: user.name,
        detail: joined
            ? cameraOn && room.supportsVideo
                  ? 'Camera ready'
                  : 'Mic ready'
            : 'Local preview',
        icon: room.supportsVideo ? Icons.videocam : Icons.mic,
        active: joined,
      ),
      ...peers
          .take(3)
          .map(
            (peer) => _StageTile(
              label: (peer['userName'] ?? peer['userId'] ?? 'Peer').toString(),
              detail: 'Remote peer',
              icon: Icons.person_outline,
              active: true,
            ),
          ),
    ];

    while (tiles.length < 4) {
      tiles.add(
        const _StageTile(
          label: 'Waiting',
          detail: 'Open seat',
          icon: Icons.chair_outlined,
          active: false,
        ),
      );
    }

    return Container(
      constraints: const BoxConstraints(minHeight: 520),
      decoration: BoxDecoration(
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(8),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: roomToneGradient(room, 0),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(0, 0, 0, 0.28),
            blurRadius: 34,
            offset: Offset(0, 18),
          ),
        ],
      ),
      child: Stack(
        children: [
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color.fromRGBO(8, 13, 25, 0.1),
                    Color.fromRGBO(8, 13, 25, 0.92),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                StatusPill(
                  label: joined
                      ? 'RTC connected'
                      : joining
                      ? 'Connecting RTC'
                      : 'RTC ready',
                  detail: status,
                  state: statusState,
                ),
                const SizedBox(height: 14),
                Text(
                  room.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    height: 1.03,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    MetricChip(
                      label: 'Mode',
                      value: room.supportsVideo ? 'Video' : 'Audio',
                    ),
                    MetricChip(label: 'Peers', value: '${peers.length}'),
                    MetricChip(label: 'Seats', value: '${room.maxMicCount}'),
                  ],
                ),
                const SizedBox(height: 18),
                GridView.count(
                  crossAxisCount: 2,
                  mainAxisSpacing: 10,
                  crossAxisSpacing: 10,
                  childAspectRatio: 1.04,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: tiles.take(4).toList(),
                ),
                const SizedBox(height: 16),
                GradientButton(
                  onPressed: onJoin,
                  icon: joining
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          joined ? Icons.check_circle : Icons.call,
                          color: Colors.white,
                        ),
                  child: Text(joined ? 'Joined' : 'Connect RTC'),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _ControlChip(
                      icon: micOn ? Icons.mic : Icons.mic_off,
                      label: micOn ? 'Mic on' : 'Mic off',
                      active: micOn,
                      onPressed: onToggleMic,
                    ),
                    _ControlChip(
                      icon: cameraOn ? Icons.videocam : Icons.videocam_off,
                      label: room.supportsVideo
                          ? cameraOn
                                ? 'Camera on'
                                : 'Camera off'
                          : 'Audio room',
                      active: cameraOn,
                      onPressed: onToggleCamera,
                    ),
                    _ControlChip(
                      icon: Icons.call_end,
                      label: 'Leave',
                      active: false,
                      danger: true,
                      onPressed: onLeave,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StageTile extends StatelessWidget {
  const _StageTile({
    required this.label,
    required this.detail,
    required this.icon,
    required this.active,
  });

  final String label;
  final String detail;
  final IconData icon;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Color.fromRGBO(15, 23, 42, active ? 0.72 : 0.36),
        border: Border.all(
          color: active
              ? const Color.fromRGBO(52, 211, 153, 0.26)
              : const Color.fromRGBO(148, 163, 184, 0.18),
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: active ? RtcPalette.mint : RtcPalette.muted),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                detail,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: RtcPalette.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ControlChip extends StatelessWidget {
  const _ControlChip({
    required this.icon,
    required this.label,
    required this.active,
    this.danger = false,
    this.onPressed,
  });

  final IconData icon;
  final String label;
  final bool active;
  final bool danger;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final color = danger
        ? const Color(0xFFFB7185)
        : active
        ? RtcPalette.mint
        : RtcPalette.muted;
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 18),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: BorderSide(color: color.withValues(alpha: 0.28)),
        backgroundColor: const Color.fromRGBO(8, 4, 24, 0.36),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
    );
  }
}

class _RoomInfoPanel extends StatelessWidget {
  const _RoomInfoPanel({
    required this.room,
    required this.peers,
    required this.joined,
  });

  final Room room;
  final List<Map<String, dynamic>> peers;
  final bool joined;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'RTC Diagnostics',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              MetricChip(label: 'Signal', value: joined ? 'Connected' : 'Idle'),
              MetricChip(label: 'Incoming', value: '0 kb/s'),
              MetricChip(label: 'Outgoing', value: '0 kb/s'),
              MetricChip(label: 'Loss', value: '0%'),
            ],
          ),
          const SizedBox(height: 14),
          if (peers.isEmpty)
            const Text(
              'No other connected peers yet.',
              style: TextStyle(
                color: RtcPalette.muted,
                fontWeight: FontWeight.w700,
              ),
            )
          else
            ...peers.map(
              (peer) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: StatusPill(
                  label: (peer['userName'] ?? peer['userId'] ?? 'Peer')
                      .toString(),
                  detail: (peer['socketId'] ?? 'connected').toString(),
                  state: RtcStatusState.good,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _EventPanel extends StatelessWidget {
  const _EventPanel({required this.events});

  final List<String> events;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Signaling Events',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          if (events.isEmpty)
            const Text(
              'Events will appear here after connecting.',
              style: TextStyle(
                color: RtcPalette.muted,
                fontWeight: FontWeight.w700,
              ),
            )
          else
            ...events.map(
              (event) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  event,
                  style: const TextStyle(
                    color: RtcPalette.soft,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _IconShell extends StatelessWidget {
  const _IconShell({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onPressed,
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: const Color.fromRGBO(255, 255, 255, 0.07),
            border: Border.all(
              color: const Color.fromRGBO(255, 255, 255, 0.12),
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: RtcPalette.soft, size: 20),
        ),
      ),
    );
  }
}
