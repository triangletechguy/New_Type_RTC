import 'dart:async';

import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';
import '../services/rtc_media_service.dart';
import '../services/signaling_service.dart';

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
  String _status = 'Ready';

  @override
  void initState() {
    super.initState();
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
        _status = 'Connected to $signalingRoom';
      });
    } catch (error) {
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(widget.room.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        child: Icon(
                          widget.room.supportsVideo
                              ? Icons.videocam
                              : Icons.mic,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.room.roomType,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            Text(
                              widget.room.description.isEmpty
                                  ? widget.room.privacyType
                                  : widget.room.description,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: _joining || _joined ? null : _join,
                    icon: _joining
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(_joined ? Icons.check_circle : Icons.call),
                    label: Text(_joined ? 'Joined' : 'Join room'),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    _status,
                    style: TextStyle(color: colors.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Peers', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_peers.isEmpty)
            const Text('No other connected peers yet.')
          else
            ..._peers.map(
              (peer) => ListTile(
                leading: const Icon(Icons.person_outline),
                title: Text(
                  (peer['userName'] ?? peer['userId'] ?? 'Peer').toString(),
                ),
                subtitle: Text((peer['socketId'] ?? '').toString()),
              ),
            ),
          const SizedBox(height: 16),
          Text(
            'Signaling Events',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          if (_events.isEmpty)
            const Text('Events will appear here after connecting.')
          else
            ..._events.map((event) => Text('- $event')),
        ],
      ),
    );
  }
}
