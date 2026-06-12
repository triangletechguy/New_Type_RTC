import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';
import '../services/rtc_connection_service.dart';
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
  final _rtc = RtcConnectionService();
  final _message = TextEditingController();
  final _events = <String>[];
  final _chatLines = <String>[];
  final _seenChatMessageIds = <int>{};
  List<Map<String, dynamic>> _peers = const [];
  Map<String, MediaStream> _remoteStreams = const {};
  Map<String, String> _peerStates = const {};
  MediaStream? _localStream;
  StreamSubscription<String>? _eventSub;
  StreamSubscription<String>? _rtcEventSub;
  StreamSubscription<List<Map<String, dynamic>>>? _peerSub;
  StreamSubscription<Map<String, MediaStream>>? _remoteStreamSub;
  StreamSubscription<Map<String, String>>? _peerStateSub;
  StreamSubscription<Map<String, dynamic>>? _chatSub;
  bool _joining = false;
  bool _joined = false;
  bool _micOn = true;
  bool _cameraOn = false;
  bool _videoMode = false;
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
    _chatSub = _signaling.chatMessages.listen((payload) {
      final eventName = payload['event']?.toString() ?? '';
      if (eventName == 'deleted' || eventName == 'unsent') {
        _addSystemLine('A chat message was removed.');
        return;
      }
      final message = payload['message'];
      if (message is Map) {
        _addChatMessage(Map<String, dynamic>.from(message));
      }
    });
    _rtcEventSub = _rtc.events.listen((event) {
      if (!mounted) return;
      setState(() {
        _events.insert(0, event);
        if (_events.length > 8) _events.removeLast();
        _status = event;
      });
    });
    _remoteStreamSub = _rtc.remoteStreams.listen((streams) {
      if (mounted) setState(() => _remoteStreams = streams);
    });
    _peerStateSub = _rtc.peerStates.listen((states) {
      if (mounted) setState(() => _peerStates = states);
    });
  }

  @override
  void dispose() {
    _message.dispose();
    _eventSub?.cancel();
    _rtcEventSub?.cancel();
    _peerSub?.cancel();
    _remoteStreamSub?.cancel();
    _peerStateSub?.cancel();
    _chatSub?.cancel();
    if (_joined) {
      unawaited(widget.api.leaveRoom(widget.room.id).catchError((_) {}));
    }
    unawaited(_media.stopMediaStream(_localStream).catchError((_) {}));
    unawaited(_rtc.dispose().catchError((_) {}));
    _signaling.dispose();
    super.dispose();
  }

  Future<void> _join({bool? videoOverride}) async {
    if (_joining || _joined) return;
    final video = videoOverride ?? widget.room.supportsVideo;
    var backendJoined = false;
    MediaStream? openedStream;

    setState(() {
      _joining = true;
      _status = 'Joining backend room...';
    });

    try {
      final joinData = await widget.api.joinRoom(widget.room.id, video: video);
      backendJoined = true;
      final rtc = joinData['rtc'] is Map
          ? Map<String, dynamic>.from(joinData['rtc'] as Map)
          : <String, dynamic>{};
      final signalingRoom = rtc['signaling_room']?.toString() ?? '';
      if (signalingRoom.isEmpty) {
        throw StateError('Backend did not return rtc.signaling_room.');
      }
      final joinedRtcMode = rtc['rtc_mode']?.toString() == 'audio'
          ? 'audio'
          : 'video';
      final useVideo = joinedRtcMode == 'video';

      setState(() {
        _status = useVideo
            ? 'Preparing camera and microphone...'
            : 'Preparing microphone...';
        _videoMode = useVideo;
      });

      await _media.requestPermissions(video: useVideo);
      openedStream = await _media.openLocalMedia(video: useVideo);

      if (!useVideo) {
        for (final track in openedStream.getVideoTracks()) {
          await track.stop();
          await openedStream.removeTrack(track);
        }
      }

      final micEnabled =
          rtc['mic_enabled'] != false &&
          openedStream.getAudioTracks().isNotEmpty;
      final cameraEnabled =
          useVideo &&
          rtc['camera_enabled'] == true &&
          openedStream.getVideoTracks().isNotEmpty;

      for (final track in openedStream.getAudioTracks()) {
        track.enabled = micEnabled;
      }
      for (final track in openedStream.getVideoTracks()) {
        track.enabled = cameraEnabled;
      }

      if (micEnabled != (rtc['mic_enabled'] != false) ||
          cameraEnabled != (useVideo && rtc['camera_enabled'] == true)) {
        await widget.api.updateRoomMediaState(
          widget.room.id,
          micEnabled: micEnabled,
          cameraEnabled: cameraEnabled,
        );
      }

      setState(() {
        _localStream = openedStream;
        _micOn = micEnabled;
        _cameraOn = cameraEnabled;
        _status = 'Loading RTC network config...';
      });

      final rtcConfig = await widget.api.rtcConfig();

      setState(() => _status = 'Connecting signaling...');
      await _signaling.connect();
      await _rtc.start(
        signaling: _signaling,
        localStream: openedStream,
        rtcMode: joinedRtcMode,
        iceServers: _iceServersFromConfig(rtcConfig),
        iceTransportPolicy:
            rtcConfig['iceTransportPolicy']?.toString() ?? 'all',
        localSocketId: _signaling.socketId,
      );

      final signalingJoin = await _signaling.joinRoom(
        signalingRoom: signalingRoom,
        databaseRoomId: widget.room.id,
        user: widget.user,
        video: useVideo,
        micEnabled: micEnabled,
        cameraEnabled: cameraEnabled,
      );
      _rtc.setLocalSocketId(
        signalingJoin['socketId']?.toString() ?? _signaling.socketId,
      );

      final existingUsers = signalingJoin['users'] is List
          ? (signalingJoin['users'] as List)
                .whereType<Map>()
                .map((peer) => Map<String, dynamic>.from(peer))
                .toList()
          : <Map<String, dynamic>>[];
      await _rtc.negotiateExistingPeers(existingUsers);
      unawaited(_loadRecentMessages());

      setState(() {
        _joined = true;
        _status = existingUsers.isEmpty
            ? 'Connected to $signalingRoom'
            : 'Connected to ${existingUsers.length} peer${existingUsers.length == 1 ? '' : 's'}';
      });
    } catch (error) {
      if (backendJoined) {
        unawaited(widget.api.leaveRoom(widget.room.id).catchError((_) {}));
      }
      _signaling.leaveRoom();
      unawaited(_rtc.closeAll().catchError((_) {}));
      if (openedStream != null) {
        unawaited(_media.stopMediaStream(openedStream).catchError((_) {}));
      }
      setState(() {
        _localStream = null;
        _remoteStreams = const {};
        _peerStates = const {};
        _status = apiErrorMessage(error);
      });
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  List<Map<String, dynamic>> _iceServersFromConfig(
    Map<String, dynamic> config,
  ) {
    final iceServers = config['iceServers'];
    if (iceServers is! List) return const [];
    return iceServers
        .whereType<Map>()
        .map((server) => Map<String, dynamic>.from(server))
        .toList();
  }

  Future<void> _loadRecentMessages() async {
    try {
      final messages = await widget.api.roomMessages(widget.room.id, limit: 30);
      if (!mounted) return;
      setState(() {
        _chatLines.clear();
        _seenChatMessageIds.clear();
        for (final message in messages) {
          _rememberChatMessage(message);
        }
      });
    } catch (error) {
      _addSystemLine('Chat history unavailable: ${apiErrorMessage(error)}');
    }
  }

  void _addChatMessage(Map<String, dynamic> message) {
    if (!mounted) return;
    setState(() => _rememberChatMessage(message));
  }

  void _rememberChatMessage(Map<String, dynamic> message) {
    final messageId = _asInt(message['id']);
    if (messageId > 0 && !_seenChatMessageIds.add(messageId)) return;
    _chatLines.insert(0, _formatChatMessage(message));
    if (_chatLines.length > 20) _chatLines.removeLast();
  }

  void _addSystemLine(String message) {
    if (!mounted) return;
    setState(() {
      _events.insert(0, 'System: $message');
      if (_events.length > 8) _events.removeLast();
    });
  }

  String _formatChatMessage(Map<String, dynamic> message) {
    final sender =
        (message['sender_name'] ??
                message['user_name'] ??
                message['name'] ??
                'Guest')
            .toString();
    final body = (message['message_body'] ?? message['body'] ?? '').toString();
    return '$sender: $body';
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
    unawaited(_sendLocalMessageAsync());
  }

  Future<void> _sendLocalMessageAsync() async {
    final message = _message.text.trim();
    if (message.isEmpty) return;

    if (!_joined) {
      _showToast('Join the room before sending chat.');
      return;
    }

    _message.clear();
    setState(() => _status = 'Sending message...');

    try {
      final chatMessage = await widget.api.sendRoomMessage(
        widget.room.id,
        message,
      );
      _addChatMessage(chatMessage);
      if (mounted) setState(() => _status = 'Message sent');
    } catch (error) {
      if (!mounted) return;
      _message.text = message;
      setState(() => _status = apiErrorMessage(error));
    }
  }

  Future<void> _toggleMic() async {
    if (!_joined) {
      _showToast('Join the room first.');
      return;
    }

    final nextMicOn = !_micOn;
    setState(() => _micOn = nextMicOn);
    await _rtc.setAudioEnabled(nextMicOn);
    await _syncMediaState();
  }

  Future<void> _toggleCamera() async {
    if (!_joined || !_videoMode) {
      _showToast(_videoMode ? 'Join the room first.' : 'Video is off here.');
      return;
    }

    var nextCameraOn = !_cameraOn;
    final stream = _localStream;
    if (nextCameraOn && (stream == null || stream.getVideoTracks().isEmpty)) {
      MediaStream? cameraStream;
      try {
        setState(() => _status = 'Starting camera...');
        await _media.requestPermissions(video: true);
        cameraStream = await _media.openLocalMedia(video: true);
        for (final audioTrack in cameraStream.getAudioTracks()) {
          await audioTrack.stop();
          await cameraStream.removeTrack(audioTrack);
        }
        final videoTracks = cameraStream.getVideoTracks();
        if (videoTracks.isEmpty) {
          throw StateError('Camera did not return a video track.');
        }
        final videoTrack = videoTracks.first;
        videoTrack.enabled = true;
        if (_localStream != null) {
          await _rtc.addLocalTrack(videoTrack);
        }
        setState(() => _localStream = _localStream ?? cameraStream);
      } catch (error) {
        if (cameraStream != null) {
          unawaited(_media.stopMediaStream(cameraStream).catchError((_) {}));
        }
        nextCameraOn = false;
        if (mounted) setState(() => _status = apiErrorMessage(error));
      }
    }

    setState(() => _cameraOn = nextCameraOn);
    await _rtc.setVideoEnabled(nextCameraOn);
    await _syncMediaState();
  }

  Future<void> _syncMediaState() async {
    try {
      await widget.api.updateRoomMediaState(
        widget.room.id,
        micEnabled: _micOn,
        cameraEnabled: _videoMode && _cameraOn,
      );
      await _signaling.emitMediaState(
        micEnabled: _micOn,
        cameraEnabled: _videoMode && _cameraOn,
        rtcMode: _videoMode ? 'video' : 'audio',
      );
      if (mounted) setState(() => _status = 'Media state updated');
    } catch (error) {
      if (mounted) setState(() => _status = apiErrorMessage(error));
    }
  }

  int _asInt(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '') ?? 0;
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
                if (_joined || _joining || _localStream != null) ...[
                  _LiveMediaStrip(
                    localStream: _localStream,
                    remoteStreams: _remoteStreams,
                    peerStates: _peerStates,
                    joined: _joined,
                    videoMode: _videoMode,
                    micOn: _micOn,
                    cameraOn: _cameraOn,
                    onToggleMic: () => unawaited(_toggleMic()),
                    onToggleCamera: () => unawaited(_toggleCamera()),
                  ),
                  const SizedBox(height: 12),
                ],
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
                  micOn: _micOn,
                  onTap: () => _join(videoOverride: false),
                ),
                const SizedBox(height: 12),
                _ConnectionCard(
                  status: _status,
                  joined: _joined,
                  joining: _joining,
                  peerCount: _remoteStreams.length > _peers.length
                      ? _remoteStreams.length
                      : _peers.length,
                ),
                const SizedBox(height: 12),
                _LiveComments(
                  room: room,
                  user: widget.user,
                  events: [..._chatLines, ..._events],
                ),
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

class _LiveMediaStrip extends StatelessWidget {
  const _LiveMediaStrip({
    required this.localStream,
    required this.remoteStreams,
    required this.peerStates,
    required this.joined,
    required this.videoMode,
    required this.micOn,
    required this.cameraOn,
    required this.onToggleMic,
    required this.onToggleCamera,
  });

  final MediaStream? localStream;
  final Map<String, MediaStream> remoteStreams;
  final Map<String, String> peerStates;
  final bool joined;
  final bool videoMode;
  final bool micOn;
  final bool cameraOn;
  final VoidCallback onToggleMic;
  final VoidCallback onToggleCamera;

  @override
  Widget build(BuildContext context) {
    final remoteEntries = remoteStreams.entries.toList();

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: .22),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: .10)),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 150,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: 1 + (remoteEntries.isEmpty ? 1 : remoteEntries.length),
              separatorBuilder: (_, _) => const SizedBox(width: 10),
              itemBuilder: (context, index) {
                if (index == 0) {
                  return _RtcVideoTile(
                    stream: localStream,
                    label: 'You',
                    state: joined ? (micOn ? 'live' : 'muted') : 'joining',
                    mirror: true,
                    showVideo: videoMode && cameraOn,
                    fallbackIcon: micOn
                        ? Icons.person_rounded
                        : Icons.mic_off_rounded,
                  );
                }

                if (remoteEntries.isEmpty) {
                  return const _RtcVideoTile(
                    stream: null,
                    label: 'Peer',
                    state: 'waiting',
                    mirror: false,
                    showVideo: false,
                    fallbackIcon: Icons.person_search_rounded,
                  );
                }

                final entry = remoteEntries[index - 1];
                final socketId = entry.key;
                return _RtcVideoTile(
                  stream: entry.value,
                  label: 'Peer ${_shortSocket(socketId)}',
                  state: peerStates[socketId] ?? 'connected',
                  mirror: false,
                  showVideo: true,
                  fallbackIcon: Icons.person_rounded,
                );
              },
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _MediaControlButton(
                  icon: micOn ? Icons.mic_rounded : Icons.mic_off_rounded,
                  label: micOn ? 'Mic on' : 'Muted',
                  active: micOn,
                  onTap: onToggleMic,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MediaControlButton(
                  icon: cameraOn
                      ? Icons.videocam_rounded
                      : Icons.videocam_off_rounded,
                  label: videoMode
                      ? cameraOn
                            ? 'Camera on'
                            : 'Camera off'
                      : 'Audio room',
                  active: videoMode && cameraOn,
                  onTap: onToggleCamera,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MediaControlButton extends StatelessWidget {
  const _MediaControlButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        height: 42,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active
              ? BuzzColors.green.withValues(alpha: .88)
              : Colors.white.withValues(alpha: .08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withValues(alpha: .10)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: Colors.white, size: 19),
            const SizedBox(width: 7),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RtcVideoTile extends StatefulWidget {
  const _RtcVideoTile({
    required this.stream,
    required this.label,
    required this.state,
    required this.mirror,
    required this.showVideo,
    required this.fallbackIcon,
  });

  final MediaStream? stream;
  final String label;
  final String state;
  final bool mirror;
  final bool showVideo;
  final IconData fallbackIcon;

  @override
  State<_RtcVideoTile> createState() => _RtcVideoTileState();
}

class _RtcVideoTileState extends State<_RtcVideoTile> {
  final _renderer = RTCVideoRenderer();
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  @override
  void didUpdateWidget(covariant _RtcVideoTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.stream != widget.stream && _ready) {
      _renderer.srcObject = widget.stream;
    }
  }

  @override
  void dispose() {
    _renderer.srcObject = null;
    unawaited(_renderer.dispose());
    super.dispose();
  }

  Future<void> _initialize() async {
    await _renderer.initialize();
    if (!mounted) return;
    _renderer.srcObject = widget.stream;
    setState(() => _ready = true);
  }

  @override
  Widget build(BuildContext context) {
    final hasVideo =
        widget.showVideo &&
        _ready &&
        (widget.stream?.getVideoTracks().isNotEmpty ?? false);

    return SizedBox(
      width: 132,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Stack(
          fit: StackFit.expand,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .08),
                border: Border.all(color: Colors.white.withValues(alpha: .08)),
              ),
              child: hasVideo
                  ? RTCVideoView(
                      _renderer,
                      mirror: widget.mirror,
                      objectFit:
                          RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                    )
                  : Center(
                      child: Icon(
                        widget.fallbackIcon,
                        color: const Color(0xFFDDE6F8),
                        size: 38,
                      ),
                    ),
            ),
            Positioned(
              left: 8,
              right: 8,
              bottom: 8,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: .48),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      widget.state,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFFA8B3C7),
                        fontSize: 10,
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
    required this.micOn,
    required this.onTap,
  });

  final bool joining;
  final bool joined;
  final bool micOn;
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
            Icon(
              micOn ? Icons.mic_rounded : Icons.mic_off_rounded,
              color: BuzzColors.yellow,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                joined
                    ? micOn
                          ? 'You are on mic. Chat together~'
                          : 'Your mic is muted.'
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

String _shortSocket(String socketId) {
  return socketId.length <= 6 ? socketId : socketId.substring(0, 6);
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
