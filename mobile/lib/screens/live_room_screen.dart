import 'dart:async';

import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';
import '../services/rtc_media_service.dart';
import '../services/signaling_service.dart';
import '../theme/buzzcast_theme.dart';

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
  final _message = TextEditingController();
  final _events = <String>[];
  List<Map<String, dynamic>> _peers = const [];
  StreamSubscription<String>? _eventSub;
  StreamSubscription<List<Map<String, dynamic>>>? _peerSub;
  bool _joining = false;
  bool _joined = false;
  String _status = 'Ready to connect';

  @override
  void initState() {
    super.initState();
    _eventSub = _signaling.events.listen((event) {
      if (!mounted) return;
      setState(() {
        _events.insert(0, event);
        if (_events.length > 8) _events.removeLast();
      });
    });
    _peerSub = _signaling.peers.listen((peers) {
      if (mounted) setState(() => _peers = peers);
    });
  }

  @override
  void dispose() {
    _message.dispose();
    _eventSub?.cancel();
    _peerSub?.cancel();
    _signaling.dispose();
    super.dispose();
  }

  Future<void> _join({bool? videoOverride}) async {
    if (_joining || _joined) return;
    final video = videoOverride ?? widget.room.supportsVideo;

    setState(() {
      _joining = true;
      _status = 'Preparing media permissions...';
    });

    try {
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
        cameraEnabled: video && rtc['camera_enabled'] == true,
      );

      setState(() {
        _joined = true;
        _status = 'Connected to $signalingRoom';
      });
    } catch (error) {
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  void _showToast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: BuzzColors.green,
      ),
    );
  }

  void _sendLocalMessage() {
    final message = _message.text.trim();
    if (message.isEmpty) return;
    setState(() {
      _events.insert(0, 'You: $message');
      if (_events.length > 8) _events.removeLast();
      _message.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final room = widget.room;
    final seatCount = room.supportsVideo ? 12 : 8;
    final memberCount = room.activeParticipants > 0
        ? room.activeParticipants
        : room.maxMicCount;

    return Scaffold(
      backgroundColor: BuzzColors.roomDark,
      body: Stack(
        children: [
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: 260,
            child: Image.asset(
              BuzzAssets.coverForRoom(room),
              fit: BoxFit.cover,
              color: Colors.black.withValues(alpha: .48),
              colorBlendMode: BlendMode.darken,
            ),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    BuzzColors.roomPanel.withValues(alpha: .08),
                    BuzzColors.roomDark.withValues(alpha: .92),
                    BuzzColors.roomDark,
                  ],
                  stops: const [.08, .46, 1],
                ),
              ),
            ),
          ),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
              children: [
                _LiveHeader(
                  room: room,
                  memberCount: memberCount,
                  onBack: () => Navigator.of(context).pop(),
                  onShare: () => _showToast('Room link ready to share.'),
                  onTools: () => _showToast('Room tools open after joining.'),
                ),
                const SizedBox(height: 10),
                _MemberBadges(room: room, memberCount: memberCount),
                const SizedBox(height: 10),
                _RoomActions(
                  joining: _joining,
                  joined: _joined,
                  supportsVideo: room.supportsVideo,
                  onVoice: () => _join(videoOverride: false),
                  onVideo: () => _join(videoOverride: true),
                  onPlaylist: () => _showToast('Playlist opens after joining.'),
                  onTools: () =>
                      _showToast('Moderation tools are coming here.'),
                ),
                const SizedBox(height: 10),
                _StageSummary(room: room),
                const SizedBox(height: 12),
                _SeatGrid(
                  count: seatCount,
                  joined: _joined,
                  joining: _joining,
                  onPrimarySeat: () => _join(videoOverride: false),
                  onLockedSeat: () => _showToast('This mic seat is locked.'),
                ),
                const SizedBox(height: 10),
                const Align(alignment: Alignment.centerLeft, child: _PkBadge()),
                const SizedBox(height: 10),
                _MicLine(
                  joining: _joining,
                  joined: _joined,
                  onTap: () => _join(videoOverride: false),
                ),
                const SizedBox(height: 12),
                _ConnectionCard(
                  status: _status,
                  joined: _joined,
                  joining: _joining,
                  peerCount: _peers.length,
                ),
                const SizedBox(height: 12),
                _LiveComments(room: room, user: widget.user, events: _events),
                const SizedBox(height: 12),
                _Composer(
                  controller: _message,
                  onSend: _sendLocalMessage,
                  onVoice: () => _showToast('Voice message ready.'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LiveHeader extends StatelessWidget {
  const _LiveHeader({
    required this.room,
    required this.memberCount,
    required this.onBack,
    required this.onShare,
    required this.onTools,
  });

  final Room room;
  final int memberCount;
  final VoidCallback onBack;
  final VoidCallback onShare;
  final VoidCallback onTools;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 48),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: BuzzColors.roomDark.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: .08)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .18),
            blurRadius: 26,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Row(
        children: [
          _RoundIconButton(icon: Icons.arrow_back_ios_new, onTap: onBack),
          const SizedBox(width: 6),
          ClipOval(child: _RoomAvatar(room: room, size: 40)),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  room.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  'ID:${room.id} - $memberCount',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFA8B3C7),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          _RoundIconButton(icon: Icons.ios_share_rounded, onTap: onShare),
          const SizedBox(width: 6),
          _RoundIconButton(icon: Icons.more_horiz, onTap: onTools),
          const SizedBox(width: 6),
          _RoundIconButton(icon: Icons.power_settings_new, onTap: onBack),
        ],
      ),
    );
  }
}

class _MemberBadges extends StatelessWidget {
  const _MemberBadges({required this.room, required this.memberCount});

  final Room room;
  final int memberCount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _DarkPill(label: 'Group ${300 + (room.id % 90)}'),
              _DarkPill(label: room.country.isEmpty ? 'Global' : room.country),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var index = 0; index < 3; index++)
                Align(
                  widthFactor: .72,
                  child: ClipOval(
                    child: Image.asset(
                      BuzzAssets.avatarForIndex(index + room.id),
                      width: 28,
                      height: 28,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
              const SizedBox(width: 6),
              Text(
                '$memberCount',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const Icon(Icons.chevron_right, color: Colors.white, size: 18),
            ],
          ),
        ),
      ],
    );
  }
}

class _RoomActions extends StatelessWidget {
  const _RoomActions({
    required this.joining,
    required this.joined,
    required this.supportsVideo,
    required this.onVoice,
    required this.onVideo,
    required this.onPlaylist,
    required this.onTools,
  });

  final bool joining;
  final bool joined;
  final bool supportsVideo;
  final VoidCallback onVoice;
  final VoidCallback onVideo;
  final VoidCallback onPlaylist;
  final VoidCallback onTools;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _ActionChipButton(
            label: joined
                ? 'Joined'
                : joining
                ? 'Joining'
                : 'Voice',
            onTap: joining || joined ? null : onVoice,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ActionChipButton(
            label: supportsVideo ? 'Video' : 'Audio',
            onTap: joining || joined || !supportsVideo ? null : onVideo,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ActionChipButton(label: 'Playlist', onTap: onPlaylist),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ActionChipButton(label: 'Tools', onTap: onTools),
        ),
      ],
    );
  }
}

class _StageSummary extends StatelessWidget {
  const _StageSummary({required this.room});

  final Room room;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 86),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white.withValues(alpha: .10)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            BuzzColors.mint.withValues(alpha: .22),
            Colors.white.withValues(alpha: .13),
            Colors.white.withValues(alpha: .05),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .24),
            blurRadius: 44,
            offset: const Offset(0, 18),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 58,
            height: 58,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: BuzzColors.green,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Text(
              room.name.trim().isEmpty
                  ? 'T'
                  : room.name.trim()[0].toUpperCase(),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 28,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  room.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'Room ID: ${room.id}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFA8B3C7),
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.graphic_eq, color: BuzzColors.yellow, size: 34),
        ],
      ),
    );
  }
}

class _SeatGrid extends StatelessWidget {
  const _SeatGrid({
    required this.count,
    required this.joined,
    required this.joining,
    required this.onPrimarySeat,
    required this.onLockedSeat,
  });

  final int count;
  final bool joined;
  final bool joining;
  final VoidCallback onPrimarySeat;
  final VoidCallback onLockedSeat;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
      ),
      itemBuilder: (context, index) {
        final active = index == 0;
        return InkWell(
          onTap: active ? onPrimarySeat : onLockedSeat,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            decoration: BoxDecoration(
              color: active
                  ? BuzzColors.green.withValues(alpha: .88)
                  : Colors.white.withValues(alpha: .08),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withValues(alpha: .10)),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (active && joining)
                  const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                else
                  Icon(
                    active
                        ? joined
                              ? Icons.check_circle
                              : Icons.mic_rounded
                        : Icons.lock_rounded,
                    color: active ? Colors.white : const Color(0xFFB7C0D4),
                  ),
                const SizedBox(height: 8),
                Text(
                  'No.${index + 1}',
                  style: const TextStyle(
                    color: Color(0xFFDDE6F8),
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _MicLine extends StatelessWidget {
  const _MicLine({
    required this.joining,
    required this.joined,
    required this.onTap,
  });

  final bool joining;
  final bool joined;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: joining || joined ? null : onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .08),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: Colors.white.withValues(alpha: .10)),
        ),
        child: Row(
          children: [
            const Icon(Icons.mic_rounded, color: BuzzColors.yellow),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                joined
                    ? 'You are on mic. Chat together~'
                    : 'Come on mic and chat together~',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({
    required this.status,
    required this.joined,
    required this.joining,
    required this.peerCount,
  });

  final String status;
  final bool joined;
  final bool joining;
  final int peerCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: .10)),
      ),
      child: Row(
        children: [
          Icon(
            joined
                ? Icons.wifi_tethering
                : joining
                ? Icons.sync
                : Icons.wifi_tethering_off,
            color: joined ? BuzzColors.mint : const Color(0xFFA8B3C7),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  joined ? 'RTC connected' : 'RTC ready',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  '$status${joined ? ' - $peerCount peer${peerCount == 1 ? '' : 's'}' : ''}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
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
    );
  }
}

class _LiveComments extends StatelessWidget {
  const _LiveComments({
    required this.room,
    required this.user,
    required this.events,
  });

  final Room room;
  final AppUser user;
  final List<String> events;

  @override
  Widget build(BuildContext context) {
    final messages = events.isEmpty
        ? [
            'Owner ${room.ownerName}: Welcome to the room.',
            '${user.name}: Ready to join.',
            'System: Respect each other and keep chat friendly.',
          ]
        : events;

    return Column(
      children: [
        for (final message in messages)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipOval(
                  child: Image.asset(
                    BuzzAssets.avatarForIndex(message.hashCode),
                    width: 34,
                    height: 34,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: .18),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      message,
                      style: const TextStyle(
                        color: Color(0xFFE8EEF8),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.onSend,
    required this.onVoice,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final VoidCallback onVoice;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _RoundIconButton(icon: Icons.keyboard_voice, onTap: onVoice, size: 42),
        const SizedBox(width: 8),
        Expanded(
          child: TextField(
            controller: controller,
            textInputAction: TextInputAction.send,
            onSubmitted: (_) => onSend(),
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'Say hi...',
              hintStyle: const TextStyle(color: Color(0xFFA8B3C7)),
              filled: true,
              fillColor: Colors.white.withValues(alpha: .08),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 12,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        _RoundIconButton(icon: Icons.send_rounded, onTap: onSend, size: 42),
      ],
    );
  }
}

class _RoomAvatar extends StatelessWidget {
  const _RoomAvatar({required this.room, required this.size});

  final Room room;
  final double size;

  @override
  Widget build(BuildContext context) {
    final imageUrl = room.profileImage.trim().isNotEmpty
        ? room.profileImage.trim()
        : room.ownerAvatarUrl.trim();
    if (imageUrl.startsWith('http')) {
      return Image.network(
        imageUrl,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => _FallbackRoomAvatar(room: room, size: size),
      );
    }
    return _FallbackRoomAvatar(room: room, size: size);
  }
}

class _FallbackRoomAvatar extends StatelessWidget {
  const _FallbackRoomAvatar({required this.room, required this.size});

  final Room room;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      BuzzAssets.avatarForIndex(room.id),
      width: size,
      height: size,
      fit: BoxFit.cover,
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({
    required this.icon,
    required this.onTap,
    this.size = 36,
  });

  final IconData icon;
  final VoidCallback onTap;
  final double size;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .10),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: Colors.white, size: size * .52),
      ),
    );
  }
}

class _ActionChipButton extends StatelessWidget {
  const _ActionChipButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: onTap,
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 38),
        padding: const EdgeInsets.symmetric(horizontal: 6),
        backgroundColor: Colors.white.withValues(alpha: .12),
        disabledBackgroundColor: Colors.white.withValues(alpha: .08),
        foregroundColor: Colors.white,
        disabledForegroundColor: const Color(0xFFA8B3C7),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
      ),
    );
  }
}

class _DarkPill extends StatelessWidget {
  const _DarkPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _PkBadge extends StatelessWidget {
  const _PkBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: BuzzColors.hot,
        borderRadius: BorderRadius.circular(999),
        boxShadow: [
          BoxShadow(
            color: BuzzColors.hot.withValues(alpha: .35),
            blurRadius: 20,
          ),
        ],
      ),
      child: const Text(
        'PK',
        style: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w900,
          letterSpacing: .8,
        ),
      ),
    );
  }
}
