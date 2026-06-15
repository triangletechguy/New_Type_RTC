import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';
import '../services/rtc_media_service.dart';
import '../services/rtc_peer_connection_service.dart';
import '../services/signaling_service.dart';
import '../ui/rtc_assets.dart';
import '../ui/rtc_mobile_ui.dart';

class LiveRoomScreen extends StatefulWidget {
  const LiveRoomScreen({
    super.key,
    required this.api,
    required this.user,
    required this.room,
    this.mediaService,
    this.peerCoordinator,
    this.signalingService,
    this.enableLocalPreview = true,
    this.autoConnect = false,
  });

  final ApiClient api;
  final AppUser user;
  final Room room;
  final RtcMediaService? mediaService;
  final RtcPeerCoordinator? peerCoordinator;
  final SignalingService? signalingService;
  final bool enableLocalPreview;
  final bool autoConnect;

  @override
  State<LiveRoomScreen> createState() => _LiveRoomScreenState();
}

class _LiveRoomScreenState extends State<LiveRoomScreen> {
  late final RtcMediaService _media;
  late final SignalingService _signaling;
  late final RtcPeerCoordinator _peerCoordinator;
  final _localRenderer = RTCVideoRenderer();
  final _roomPassword = TextEditingController();
  final _chatComposer = TextEditingController();
  final _events = <String>[];
  final _peers = <Map<String, dynamic>>[];
  final _chatMessages = <Map<String, dynamic>>[];
  final _moderatingUserIds = <int>{};
  final _remoteRenderers = <String, RTCVideoRenderer>{};
  final _peerStates = <String, String>{};
  StreamSubscription<String>? _eventSub;
  StreamSubscription<List<Map<String, dynamic>>>? _peerSub;
  StreamSubscription<RtcRemoteStream>? _remoteStreamSub;
  StreamSubscription<RtcPeerStateSnapshot>? _peerStateSub;
  StreamSubscription<Map<String, dynamic>>? _roomMessageSub;
  StreamSubscription<int>? _roomMessageDeletedSub;
  StreamSubscription<Map<String, dynamic>>? _moderationActionSub;
  StreamSubscription<Map<String, dynamic>>? _roomControlsUpdateSub;
  MediaStream? _localStream;
  bool _rendererReady = false;
  bool _joining = false;
  bool _joined = false;
  bool _leaving = false;
  bool _micOn = true;
  bool _cameraOn = false;
  bool _screenSharing = false;
  bool _mediaUpdating = false;
  bool _chatLoading = false;
  bool _chatSending = false;
  bool _controlsLoading = false;
  String _rtcMode = 'audio';
  String _connectStep = 'ready';
  String _status = 'Ready to join';
  String? _signalingRoom;
  String? _activePanel;
  Map<String, dynamic>? _roomControls;

  bool get _videoMode => _rtcMode == 'video' && widget.room.supportsVideo;

  @override
  void initState() {
    super.initState();
    _media = widget.mediaService ?? RtcMediaService();
    _signaling = widget.signalingService ?? SignalingService();
    _peerCoordinator = widget.peerCoordinator ?? RtcPeerConnectionService();
    unawaited(_peerCoordinator.attachSignaling(_signaling));
    _rtcMode = widget.room.supportsVideo ? 'video' : 'audio';
    _cameraOn = widget.room.supportsVideo;
    _eventSub = _signaling.events.listen(_addEvent);
    _peerSub = _signaling.peers.listen((peers) {
      if (!mounted) return;
      setState(() {
        _peers
          ..clear()
          ..addAll(peers);
      });
      if (_joined) unawaited(_peerCoordinator.syncPeers(peers));
    });
    _remoteStreamSub = _peerCoordinator.remoteStreams.listen((event) {
      unawaited(_handleRemoteStream(event));
    });
    _peerStateSub = _peerCoordinator.peerStates.listen((snapshot) {
      if (!mounted) return;
      setState(() => _peerStates[snapshot.socketId] = snapshot.state);
      _addEvent(
        '${_peerName({'socketId': snapshot.socketId})}: '
        '${snapshot.state}',
      );
    });
    _roomMessageSub = _signaling.roomMessages.listen(_upsertChatMessage);
    _roomMessageDeletedSub = _signaling.roomMessageDeleted.listen((messageId) {
      if (!mounted) return;
      setState(() {
        _chatMessages.removeWhere(
          (message) => _chatMessageId(message) == messageId,
        );
      });
    });
    _moderationActionSub = _signaling.moderationActions.listen((action) {
      unawaited(_handleModerationAction(action));
    });
    _roomControlsUpdateSub = _signaling.roomControlsUpdates.listen((controls) {
      if (!mounted) return;
      setState(() => _roomControls = controls);
    });
    if (widget.enableLocalPreview) _initializeRenderer();
    if (widget.autoConnect) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _join());
    }
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    _peerSub?.cancel();
    _remoteStreamSub?.cancel();
    _peerStateSub?.cancel();
    _roomMessageSub?.cancel();
    _roomMessageDeletedSub?.cancel();
    _moderationActionSub?.cancel();
    _roomControlsUpdateSub?.cancel();
    _roomPassword.dispose();
    _chatComposer.dispose();
    _stopLocalMedia();
    _disposeRemoteRenderers();
    unawaited(_peerCoordinator.dispose());
    if (_rendererReady) _localRenderer.dispose();
    _signaling.dispose();
    super.dispose();
  }

  Future<void> _initializeRenderer() async {
    try {
      await _localRenderer.initialize();
      if (mounted) setState(() => _rendererReady = true);
    } catch (error) {
      _addEvent('Local preview unavailable: $error');
    }
  }

  Future<void> _join() async {
    if (_joining || _joined) return;
    if (widget.room.isLocked && _roomPassword.text.trim().isEmpty) {
      setState(() {
        _status = 'Enter the room password before joining.';
        _activePanel = 'access';
      });
      return;
    }

    setState(() {
      _joining = true;
      _connectStep = 'media';
      _status = 'Preparing media permissions...';
    });

    try {
      final video = widget.room.supportsVideo && _rtcMode == 'video';
      await _openLocalMedia(video: video);

      setState(() {
        _connectStep = 'backend';
        _status = 'Joining backend room...';
      });
      final joinData = await widget.api.joinRoom(
        widget.room.id,
        video: video,
        micEnabled: _micOn,
        cameraEnabled: video && _cameraOn,
        password: _roomPassword.text,
      );
      final rtc = Map<String, dynamic>.from(joinData['rtc'] as Map? ?? {});
      final signalingRoom = rtc['signaling_room']?.toString() ?? '';
      if (signalingRoom.isEmpty) {
        throw StateError('Backend did not return rtc.signaling_room.');
      }

      setState(() {
        _connectStep = 'signaling';
        _status = 'Connecting signaling...';
      });
      await _signaling.connect();
      await _signaling.joinRoom(
        signalingRoom: signalingRoom,
        databaseRoomId: widget.room.id,
        user: widget.user,
        video: video,
        micEnabled: rtc['mic_enabled'] != false,
        cameraEnabled: rtc['camera_enabled'] == true,
      );
      unawaited(
        _signaling
            .requestPeers()
            .then((peers) {
              return _peerCoordinator.syncPeers(peers).then((_) => peers);
            })
            .catchError((error) {
              _addEvent(error);
              return <Map<String, dynamic>>[];
            }),
      );

      if (!mounted) return;
      setState(() {
        _joined = true;
        _connectStep = 'connected';
        _signalingRoom = signalingRoom;
        _micOn = rtc['mic_enabled'] != false;
        _cameraOn = video && rtc['camera_enabled'] == true;
        _screenSharing = false;
        _activePanel = null;
        _status = 'Connected to $signalingRoom';
      });
      _applyLocalMediaState();
      await _peerCoordinator.setLocalStream(_localStream, video: video);
      unawaited(_loadRoomMessages());
    } catch (error) {
      setState(() {
        _connectStep = 'ready';
        _status = apiErrorMessage(error);
      });
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  Future<void> _openLocalMedia({required bool video}) async {
    await _media.requestPermissions(video: video);
    if (!widget.enableLocalPreview) return;

    _stopLocalMedia();
    final stream = await _media.openLocalMedia(video: video);
    _localStream = stream;
    _applyLocalMediaState();
    await _peerCoordinator.setLocalStream(stream, video: video);
    if (_rendererReady) {
      _localRenderer.srcObject = stream;
    }
  }

  Future<void> _leave({bool popAfterLeave = false}) async {
    if (_leaving) return;
    setState(() {
      _leaving = true;
      _status = 'Leaving room...';
    });

    try {
      _signaling.leaveRoom();
      await _peerCoordinator.closeAll();
      final result = _joined
          ? await widget.api.leaveRoom(widget.room.id)
          : const <String, dynamic>{};
      final message =
          result['message']?.toString() ??
          (result['usage_logged'] == true
              ? 'Left room. Usage logged.'
              : 'Left room');
      if (!mounted) return;
      _stopLocalMedia();
      _disposeRemoteRenderers();
      setState(() {
        _joined = false;
        _connectStep = 'ready';
        _signalingRoom = null;
        _peers.clear();
        _peerStates.clear();
        _screenSharing = false;
        _status = message;
      });
      _addEvent(message);
      if (popAfterLeave && mounted) Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _joined = false;
        _connectStep = 'ready';
        _status = apiErrorMessage(error);
      });
      if (popAfterLeave) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _leaving = false);
    }
  }

  Future<void> _toggleMic() async {
    await _syncMediaState(micOn: !_micOn, cameraOn: _cameraOn);
  }

  Future<void> _toggleCamera() async {
    if (!_videoMode) return;
    await _syncMediaState(micOn: _micOn, cameraOn: !_cameraOn);
  }

  Future<void> _syncMediaState({
    required bool micOn,
    required bool cameraOn,
    bool? screenSharing,
  }) async {
    if (_mediaUpdating) return;
    final previousMic = _micOn;
    final previousCamera = _cameraOn;
    final previousScreen = _screenSharing;
    final nextScreen = screenSharing ?? _screenSharing;

    setState(() {
      _mediaUpdating = true;
      _micOn = micOn;
      _cameraOn = _videoMode && cameraOn;
      _screenSharing = nextScreen;
      _status = 'Saving media state...';
    });
    _applyLocalMediaState();

    try {
      if (_joined) {
        final data = await widget.api.updateRoomMediaState(
          widget.room.id,
          micEnabled: _micOn,
          cameraEnabled: _videoMode && _cameraOn,
          screenShared: _screenSharing,
        );
        final rtc = Map<String, dynamic>.from(data['rtc'] as Map? ?? {});
        final serverMic = rtc['mic_enabled'] != false;
        final serverCamera = _videoMode && rtc['camera_enabled'] == true;
        final serverScreen = rtc['screen_shared'] == true;
        setState(() {
          _micOn = serverMic;
          _cameraOn = serverCamera;
          _screenSharing = serverScreen;
        });
        _applyLocalMediaState();
        await _signaling
            .emitMediaState(
              video: _videoMode,
              micEnabled: serverMic,
              cameraEnabled: serverCamera,
              screenShared: serverScreen,
            )
            .catchError((error) {
              _addEvent('Media state saved; signaling sync failed: $error');
              return <String, dynamic>{};
            });
      }
      setState(() {
        _status = _micOn
            ? _cameraOn
                  ? 'Microphone and camera are live'
                  : 'Microphone is live'
            : 'Microphone muted';
      });
    } catch (error) {
      setState(() {
        _micOn = previousMic;
        _cameraOn = previousCamera;
        _screenSharing = previousScreen;
        _status = apiErrorMessage(error);
      });
      _applyLocalMediaState();
    } finally {
      if (mounted) setState(() => _mediaUpdating = false);
    }
  }

  void _togglePanel(String panel) {
    final opening = _activePanel != panel;
    setState(() => _activePanel = opening ? panel : null);
    if (opening && panel == 'chat') unawaited(_loadRoomMessages());
    if (opening && panel == 'ops') unawaited(_loadRoomControls(quiet: true));
  }

  Future<void> _loadRoomControls({bool quiet = false}) async {
    if (_controlsLoading) return;
    setState(() {
      _controlsLoading = true;
      if (!quiet) _status = 'Loading room controls...';
    });
    try {
      final controls = await widget.api.roomControls(widget.room.id);
      if (!mounted) return;
      setState(() {
        _roomControls = controls;
        if (!quiet) _status = 'Room controls loaded.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _roomControls = null;
        if (!quiet) {
          _status = 'Room controls failed: ${apiErrorMessage(error)}';
        }
      });
    } finally {
      if (mounted) setState(() => _controlsLoading = false);
    }
  }

  Future<void> _moderateParticipant(
    Map<String, dynamic> participant,
    String action,
  ) async {
    final targetUserId = _intValue(participant['user_id']);
    if (targetUserId == null || _moderatingUserIds.contains(targetUserId)) {
      return;
    }

    setState(() {
      _moderatingUserIds.add(targetUserId);
      _status = 'Applying moderation...';
    });

    try {
      final data = await widget.api.moderateRoomParticipant(
        widget.room.id,
        targetUserId,
        action: action,
      );
      final controls = _mapValue(data['controls']);
      if (!mounted) return;
      final message =
          '${_opsParticipantName(participant)} ${_moderationPastTense(action)}.';
      setState(() {
        if (controls != null) _roomControls = controls;
        _status = message;
      });
      _addEvent(message);
      if (controls == null) unawaited(_loadRoomControls(quiet: true));
    } catch (error) {
      if (!mounted) return;
      final message = 'Moderation failed: ${apiErrorMessage(error)}';
      setState(() => _status = message);
      _addEvent(message);
    } finally {
      if (mounted) {
        setState(() => _moderatingUserIds.remove(targetUserId));
      }
    }
  }

  Future<void> _handleModerationAction(Map<String, dynamic> payload) async {
    final controls = _mapValue(payload['controls']);
    final targetUserId = _intValue(
      payload['targetUserId'] ?? payload['target_user_id'],
    );
    final action = payload['action']?.toString() ?? '';

    if (mounted && controls != null) {
      setState(() => _roomControls = controls);
    }

    if (targetUserId != widget.user.id) return;

    if (action == 'mute_mic') {
      setState(() {
        _micOn = false;
        _status = 'A moderator muted your microphone';
      });
      _applyLocalMediaState();
      return;
    }

    if (action == 'disable_camera') {
      setState(() {
        _cameraOn = false;
        _status = 'A moderator paused your camera';
      });
      _applyLocalMediaState();
      return;
    }

    if (action == 'kick' || action == 'ban') {
      await _disconnectAfterModeration(
        action == 'ban'
            ? 'You were banned from this room.'
            : 'A moderator removed you from the room.',
      );
    }
  }

  Future<void> _disconnectAfterModeration(String message) async {
    _signaling.leaveRoom();
    await _peerCoordinator.closeAll();
    if (!mounted) return;
    _stopLocalMedia();
    _disposeRemoteRenderers();
    setState(() {
      _joined = false;
      _connectStep = 'ready';
      _signalingRoom = null;
      _peers.clear();
      _peerStates.clear();
      _screenSharing = false;
      _status = message;
    });
    _addEvent(message);
  }

  Future<void> _loadRoomMessages() async {
    if (_chatLoading || !widget.room.chatEnabled) return;
    setState(() => _chatLoading = true);
    try {
      final messages = await widget.api.roomMessages(widget.room.id);
      if (!mounted) return;
      setState(() {
        _chatMessages
          ..clear()
          ..addAll(messages);
      });
    } catch (error) {
      _addEvent('Chat load failed: ${apiErrorMessage(error)}');
    } finally {
      if (mounted) setState(() => _chatLoading = false);
    }
  }

  Future<void> _sendChatMessage() async {
    final body = _chatComposer.text.trim();
    if (body.isEmpty || _chatSending) return;
    if (!widget.room.chatEnabled) {
      setState(() => _status = 'Chat is disabled in this room.');
      return;
    }
    if (!_joined) {
      setState(() => _status = 'Join the room before sending chat.');
      return;
    }
    await _sendRoomMessage(body: body);
  }

  Future<void> _sendGift(String giftId, String label) async {
    if (_chatSending) return;
    if (!widget.room.giftEnabled) {
      setState(() => _status = 'Gifts are disabled in this room.');
      return;
    }
    if (!_joined) {
      setState(() => _status = 'Join the room before sending a gift.');
      return;
    }
    await _sendRoomMessage(body: label, messageType: 'gift', mediaUrl: giftId);
  }

  Future<void> _sendRoomMessage({
    required String body,
    String messageType = 'text',
    String mediaUrl = '',
  }) async {
    setState(() {
      _chatSending = true;
      _status = messageType == 'gift'
          ? 'Sending gift...'
          : 'Sending message...';
    });
    try {
      final data = await widget.api.sendRoomMessage(
        widget.room.id,
        body: body,
        messageType: messageType,
        mediaUrl: mediaUrl,
      );
      final rawMessage = data['chat_message'];
      if (rawMessage is Map) {
        final chatMessage = Map<String, dynamic>.from(rawMessage);
        _upsertChatMessage(chatMessage);
        if (data['realtime_broadcasted'] != true) {
          unawaited(
            _signaling.emitChatMessage(message: chatMessage).catchError((
              error,
            ) {
              _addEvent('Chat saved; realtime sync failed: $error');
              return <String, dynamic>{};
            }),
          );
        }
      }
      _chatComposer.clear();
      if (!mounted) return;
      setState(() {
        _activePanel = 'chat';
        _status = messageType == 'gift' ? 'Gift sent' : 'Message sent';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _chatSending = false);
    }
  }

  void _upsertChatMessage(Map<String, dynamic> message) {
    if (!mounted) return;
    setState(() {
      final id = _chatMessageId(message);
      final index = id == null
          ? -1
          : _chatMessages.indexWhere((item) => _chatMessageId(item) == id);
      if (index >= 0) {
        _chatMessages[index] = message;
      } else {
        _chatMessages.add(message);
      }
      if (_chatMessages.length > 80) {
        _chatMessages.removeRange(0, _chatMessages.length - 80);
      }
    });
  }

  void _applyLocalMediaState() {
    final stream = _localStream;
    if (stream == null) return;
    for (final track in stream.getAudioTracks()) {
      track.enabled = _micOn;
    }
    for (final track in stream.getVideoTracks()) {
      track.enabled = _cameraOn && _videoMode;
    }
  }

  void _stopLocalMedia() {
    final stream = _localStream;
    if (stream == null) return;
    for (final track in stream.getTracks()) {
      track.stop();
    }
    _localStream = null;
    if (_rendererReady) _localRenderer.srcObject = null;
  }

  Future<void> _handleRemoteStream(RtcRemoteStream event) async {
    if (event.stream == null) {
      await _removeRemoteRenderer(event.socketId);
      return;
    }

    final existing = _remoteRenderers[event.socketId];
    if (existing != null) {
      existing.srcObject = event.stream;
      if (mounted) setState(() {});
      return;
    }

    final renderer = RTCVideoRenderer();
    await renderer.initialize();
    renderer.srcObject = event.stream;
    if (!mounted) {
      renderer.srcObject = null;
      await renderer.dispose();
      return;
    }
    setState(() => _remoteRenderers[event.socketId] = renderer);
  }

  Future<void> _removeRemoteRenderer(String socketId) async {
    final renderer = _remoteRenderers.remove(socketId);
    if (renderer == null) return;
    renderer.srcObject = null;
    await renderer.dispose();
    if (mounted) setState(() {});
  }

  void _disposeRemoteRenderers() {
    final renderers = _remoteRenderers.values.toList();
    _remoteRenderers.clear();
    for (final renderer in renderers) {
      renderer.srcObject = null;
      unawaited(renderer.dispose());
    }
  }

  void _addEvent(Object event) {
    if (!mounted) return;
    setState(() {
      _events.insert(0, event.toString());
      if (_events.length > 12) _events.removeLast();
    });
  }

  @override
  Widget build(BuildContext context) {
    final statusState = _statusState();
    return PopScope(
      canPop: !_joined && !_leaving,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _joined) _leave(popAfterLeave: true);
      },
      child: RtcMobileFrame(
        backgroundColor: RtcPalette.stageBg,
        child: _LiveRoomBackdrop(
          child: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 18),
              children: [
                _LiveTopBar(
                  room: widget.room,
                  user: widget.user,
                  joined: _joined,
                  rtcMode: _rtcMode,
                  statusState: statusState,
                  peerCount: _peers.length,
                  onBack: () {
                    if (_joined) {
                      _leave(popAfterLeave: true);
                    } else {
                      Navigator.of(context).pop();
                    }
                  },
                  onOpenAccess: widget.room.isLocked
                      ? () => _togglePanel('access')
                      : null,
                  onOpenTools: () => _togglePanel('ops'),
                ),
                const SizedBox(height: 8),
                _LiveStagePanel(
                  room: widget.room,
                  user: widget.user,
                  localRenderer: _localRenderer,
                  rendererReady: _rendererReady,
                  peers: _peers,
                  chatMessages: _chatMessages,
                  remoteRenderers: _remoteRenderers,
                  peerStates: _peerStates,
                  joined: _joined,
                  joining: _joining,
                  leaving: _leaving,
                  mediaUpdating: _mediaUpdating,
                  micOn: _micOn,
                  cameraOn: _cameraOn,
                  screenSharing: _screenSharing,
                  rtcMode: _rtcMode,
                  connectStep: _connectStep,
                  status: _status,
                  onJoin: _joining || _joined ? null : _join,
                  onLeave: _joined || _joining ? () => _leave() : null,
                  onToggleMic: _joined && !_mediaUpdating ? _toggleMic : null,
                  onToggleCamera: _joined && _videoMode && !_mediaUpdating
                      ? _toggleCamera
                      : null,
                  onOpenTools: _togglePanel,
                ),
                if (_activePanel != null) ...[
                  const SizedBox(height: 10),
                  _LiveToolPanel(
                    panel: _activePanel!,
                    room: widget.room,
                    joined: _joined,
                    passwordController: _roomPassword,
                    chatController: _chatComposer,
                    chatMessages: _chatMessages,
                    chatLoading: _chatLoading,
                    chatSending: _chatSending,
                    roomControls: _roomControls,
                    controlsLoading: _controlsLoading,
                    moderatingUserIds: _moderatingUserIds,
                    screenSharing: _screenSharing,
                    status: _status,
                    onJoin: _joining || _joined ? null : _join,
                    onSendChat: _sendChatMessage,
                    onSendGift: widget.room.giftEnabled
                        ? () => _sendGift('applause', 'Applause')
                        : null,
                    onLoadControls: () => _loadRoomControls(),
                    onModerateParticipant: _moderateParticipant,
                    onToggleScreenSharing:
                        widget.room.screenShareEnabled &&
                            _joined &&
                            !_mediaUpdating
                        ? () => _syncMediaState(
                            micOn: _micOn,
                            cameraOn: _cameraOn,
                            screenSharing: !_screenSharing,
                          )
                        : null,
                  ),
                ],
                const SizedBox(height: 10),
                _RoomInfoPanel(
                  room: widget.room,
                  peers: _peers,
                  joined: _joined,
                  signalingRoom: _signalingRoom,
                ),
                const SizedBox(height: 10),
                _EventPanel(events: _events),
              ],
            ),
          ),
        ),
      ),
    );
  }

  RtcStatusState _statusState() {
    if (_joined) return RtcStatusState.good;
    if (_joining || _leaving || _mediaUpdating) return RtcStatusState.warning;
    final lower = _status.toLowerCase();
    if (lower.contains('failed') ||
        lower.contains('error') ||
        lower.contains('invalid') ||
        lower.contains('password') ||
        lower.contains('unreachable')) {
      return RtcStatusState.error;
    }
    return RtcStatusState.idle;
  }
}

class _LiveRoomBackdrop extends StatelessWidget {
  const _LiveRoomBackdrop({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFF18001F),
            RtcPalette.stagePlum,
            RtcPalette.stageWine,
            RtcPalette.stageBg,
          ],
          stops: [0, 0.32, 0.68, 1],
        ),
      ),
      child: Stack(
        children: [
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(0, -1.05),
                  radius: 0.82,
                  colors: [
                    Color.fromRGBO(255, 122, 69, 0.34),
                    Color.fromRGBO(255, 122, 69, 0),
                  ],
                ),
              ),
            ),
          ),
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [
                    Color.fromRGBO(0, 0, 0, 0.36),
                    Color.fromRGBO(0, 0, 0, 0),
                    Color.fromRGBO(0, 0, 0, 0.36),
                  ],
                ),
              ),
            ),
          ),
          Positioned.fill(child: child),
        ],
      ),
    );
  }
}

class _LiveTopBar extends StatelessWidget {
  const _LiveTopBar({
    required this.room,
    required this.user,
    required this.joined,
    required this.rtcMode,
    required this.statusState,
    required this.peerCount,
    required this.onBack,
    required this.onOpenAccess,
    required this.onOpenTools,
  });

  final Room room;
  final AppUser user;
  final bool joined;
  final String rtcMode;
  final RtcStatusState statusState;
  final int peerCount;
  final VoidCallback onBack;
  final VoidCallback? onOpenAccess;
  final VoidCallback onOpenTools;

  @override
  Widget build(BuildContext context) {
    final liveCount = joined ? peerCount + 1 : peerCount;
    final statusColor = switch (statusState) {
      RtcStatusState.good => RtcPalette.mint,
      RtcStatusState.warning => RtcPalette.amber,
      RtcStatusState.error => RtcPalette.red,
      RtcStatusState.idle => RtcPalette.soft,
    };
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 56),
      child: Row(
        children: [
          _LiveCircleIconButton(
            tooltip: 'Back',
            icon: Icons.chevron_left_rounded,
            onPressed: onBack,
            transparent: true,
            size: 36,
          ),
          const SizedBox(width: 4),
          InitialAvatar(user: user, size: 38),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  room.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: RtcPalette.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                    height: RtcTypography.tightHeight,
                  ),
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: statusColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 5),
                    Flexible(
                      child: Text(
                        '${joined ? 'Live' : 'Idle'} · ${_modeLabel(rtcMode)} · $liveCount',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color.fromRGBO(255, 255, 255, 0.72),
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (room.isLocked)
            _LiveCircleIconButton(
              tooltip: 'Room password',
              icon: Icons.lock_rounded,
              onPressed: onOpenAccess,
              size: 34,
            ),
          const SizedBox(width: 6),
          _LiveCircleIconButton(
            tooltip: 'Room tools',
            icon: Icons.more_horiz_rounded,
            onPressed: onOpenTools,
            size: 34,
          ),
        ],
      ),
    );
  }
}

class _LiveCircleIconButton extends StatelessWidget {
  const _LiveCircleIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.size = 38,
    this.transparent = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final double size;
  final bool transparent;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: transparent
            ? Colors.transparent
            : const Color.fromRGBO(0, 0, 0, 0.18),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(icon, color: RtcPalette.text, size: size * 0.62),
          ),
        ),
      ),
    );
  }
}

class _LiveStagePanel extends StatelessWidget {
  const _LiveStagePanel({
    required this.room,
    required this.user,
    required this.localRenderer,
    required this.rendererReady,
    required this.peers,
    required this.chatMessages,
    required this.remoteRenderers,
    required this.peerStates,
    required this.joined,
    required this.joining,
    required this.leaving,
    required this.mediaUpdating,
    required this.micOn,
    required this.cameraOn,
    required this.screenSharing,
    required this.rtcMode,
    required this.connectStep,
    required this.status,
    required this.onJoin,
    required this.onLeave,
    required this.onToggleMic,
    required this.onToggleCamera,
    required this.onOpenTools,
  });

  final Room room;
  final AppUser user;
  final RTCVideoRenderer localRenderer;
  final bool rendererReady;
  final List<Map<String, dynamic>> peers;
  final List<Map<String, dynamic>> chatMessages;
  final Map<String, RTCVideoRenderer> remoteRenderers;
  final Map<String, String> peerStates;
  final bool joined;
  final bool joining;
  final bool leaving;
  final bool mediaUpdating;
  final bool micOn;
  final bool cameraOn;
  final bool screenSharing;
  final String rtcMode;
  final String connectStep;
  final String status;
  final VoidCallback? onJoin;
  final VoidCallback? onLeave;
  final VoidCallback? onToggleMic;
  final VoidCallback? onToggleCamera;
  final ValueChanged<String> onOpenTools;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _LiveVideoCard(
          room: room,
          user: user,
          localRenderer: localRenderer,
          rendererReady: rendererReady,
          joined: joined,
          joining: joining,
          micOn: micOn,
          cameraOn: cameraOn,
          screenSharing: screenSharing,
          rtcMode: rtcMode,
          onJoin: onJoin,
        ),
        if (remoteRenderers.isNotEmpty) ...[
          const SizedBox(height: 8),
          _RemoteVideoStrip(
            peers: peers,
            remoteRenderers: remoteRenderers,
            peerStates: peerStates,
          ),
        ],
        const SizedBox(height: 12),
        _StageSeatGrid(
          room: room,
          user: user,
          peers: peers,
          peerStates: peerStates,
          joined: joined,
          micOn: micOn,
        ),
        const SizedBox(height: 10),
        _ConnectSteps(active: connectStep),
        const SizedBox(height: 10),
        _LiveGuideRow(room: room, joined: joined, onJoin: onJoin),
        const SizedBox(height: 10),
        _LiveCommentPreview(
          room: room,
          user: user,
          peers: peers,
          messages: chatMessages,
          status: status,
          joined: joined,
          micOn: micOn,
          cameraOn: cameraOn,
        ),
        const SizedBox(height: 12),
        _LiveControlBar(
          joined: joined,
          joining: joining,
          leaving: leaving,
          mediaUpdating: mediaUpdating,
          micOn: micOn,
          cameraOn: cameraOn,
          screenSharing: screenSharing,
          room: room,
          rtcMode: rtcMode,
          onLeave: onLeave,
          onToggleMic: onToggleMic,
          onToggleCamera: onToggleCamera,
          onOpenTools: onOpenTools,
        ),
      ],
    );
  }
}

class _LiveVideoCard extends StatelessWidget {
  const _LiveVideoCard({
    required this.room,
    required this.user,
    required this.localRenderer,
    required this.rendererReady,
    required this.joined,
    required this.joining,
    required this.micOn,
    required this.cameraOn,
    required this.screenSharing,
    required this.rtcMode,
    required this.onJoin,
  });

  final Room room;
  final AppUser user;
  final RTCVideoRenderer localRenderer;
  final bool rendererReady;
  final bool joined;
  final bool joining;
  final bool micOn;
  final bool cameraOn;
  final bool screenSharing;
  final String rtcMode;
  final VoidCallback? onJoin;

  @override
  Widget build(BuildContext context) {
    final showRenderer =
        joined && rendererReady && cameraOn && room.supportsVideo;
    final useAdminAvatar = RtcAssets.shouldUseAdminAvatar(user);
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (showRenderer)
              RTCVideoView(
                localRenderer,
                mirror: true,
                objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
              )
            else
              DecoratedBox(
                decoration: BoxDecoration(
                  image: DecorationImage(
                    image: RtcAssets.coverImageForRoom(room, 0),
                    fit: BoxFit.cover,
                    colorFilter: const ColorFilter.mode(
                      Color.fromRGBO(0, 0, 0, 0.32),
                      BlendMode.darken,
                    ),
                  ),
                ),
              ),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color.fromRGBO(0, 0, 0, 0.14),
                    Color.fromRGBO(0, 0, 0, 0.08),
                    Color.fromRGBO(0, 0, 0, 0.68),
                  ],
                ),
              ),
            ),
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          room.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: RtcPalette.text,
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                            height: RtcTypography.tightHeight,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Room ID: ${room.id}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color.fromRGBO(255, 255, 255, 0.66),
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _MiniMediaBadge(
                    icon: micOn ? Icons.mic : Icons.mic_off,
                    active: micOn,
                  ),
                  const SizedBox(width: 5),
                  _MiniMediaBadge(
                    icon: cameraOn ? Icons.videocam : Icons.videocam_off,
                    active: cameraOn,
                  ),
                ],
              ),
            ),
            if (!joined)
              Center(
                child: Material(
                  color: const Color(0xFFE31B1B),
                  borderRadius: BorderRadius.circular(13),
                  elevation: 10,
                  shadowColor: const Color.fromRGBO(0, 0, 0, 0.34),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(13),
                    onTap: onJoin,
                    child: SizedBox(
                      width: 64,
                      height: 50,
                      child: joining
                          ? const Center(
                              child: SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  color: RtcPalette.text,
                                  strokeWidth: 2,
                                ),
                              ),
                            )
                          : const Icon(
                              Icons.play_arrow_rounded,
                              color: RtcPalette.text,
                              size: 38,
                            ),
                    ),
                  ),
                ),
              ),
            Positioned(
              left: 14,
              right: 14,
              bottom: 12,
              child: Row(
                children: [
                  RtcAvatarToken(
                    label: user.name,
                    image: useAdminAvatar
                        ? null
                        : RtcAssets.avatarImageForUser(user),
                    asset: useAdminAvatar
                        ? RtcAssets.adminDashboardAvatar
                        : null,
                    size: 34,
                    borderRadius: RtcRadius.pill,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      screenSharing
                          ? 'Screen share stage'
                          : joined
                          ? '${user.name} · ${cameraOn ? 'camera' : rtcMode}'
                          : 'Tap to join room',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.text,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(RtcRadius.pill),
                      child: const LinearProgressIndicator(
                        value: 0.92,
                        minHeight: 4,
                        color: Color(0xFFFF160F),
                        backgroundColor: Color.fromRGBO(255, 255, 255, 0.22),
                      ),
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

class _RemoteVideoStrip extends StatelessWidget {
  const _RemoteVideoStrip({
    required this.peers,
    required this.remoteRenderers,
    required this.peerStates,
  });

  final List<Map<String, dynamic>> peers;
  final Map<String, RTCVideoRenderer> remoteRenderers;
  final Map<String, String> peerStates;

  @override
  Widget build(BuildContext context) {
    final tiles = peers
        .where((peer) {
          final socketId = peer['socketId']?.toString();
          return socketId != null && remoteRenderers.containsKey(socketId);
        })
        .map((peer) {
          final socketId = peer['socketId']!.toString();
          final peerRtcMode = peer['rtcMode']?.toString() ?? 'video';
          final peerMicOn = _signalBool(peer['micEnabled'], true);
          final peerCameraOn =
              peerRtcMode != 'audio' &&
              _signalBool(peer['cameraEnabled'], false);
          final peerScreen = _signalBool(peer['screenShared'], false);
          final label = _peerName(peer);
          return SizedBox(
            width: 154,
            height: 128,
            child: _ParticipantTile(
              label: label,
              detail:
                  peerStates[socketId] ??
                  (peerScreen
                      ? 'Screen'
                      : peerCameraOn
                      ? 'Camera'
                      : peerMicOn
                      ? 'Mic'
                      : 'Muted'),
              initials: _initials(label),
              icon: peerCameraOn || peerScreen ? Icons.videocam : Icons.person,
              active: true,
              micOn: peerMicOn,
              cameraOn: peerCameraOn || peerScreen,
              renderer: remoteRenderers[socketId],
            ),
          );
        })
        .toList();

    if (tiles.isEmpty) return const SizedBox.shrink();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final tile in tiles) ...[tile, const SizedBox(width: 8)],
        ],
      ),
    );
  }
}

class _StageSeatGrid extends StatelessWidget {
  const _StageSeatGrid({
    required this.room,
    required this.user,
    required this.peers,
    required this.peerStates,
    required this.joined,
    required this.micOn,
  });

  final Room room;
  final AppUser user;
  final List<Map<String, dynamic>> peers;
  final Map<String, String> peerStates;
  final bool joined;
  final bool micOn;

  @override
  Widget build(BuildContext context) {
    final visibleSeatCount = room.maxMicCount.clamp(4, 8).toInt();
    final useAdminAvatar = RtcAssets.shouldUseAdminAvatar(user);
    final seats = <Widget>[
      RtcStageSeat(
        number: 1,
        label: joined ? user.name : room.displayHost,
        state: joined
            ? micOn
                  ? RtcSeatState.speaking
                  : RtcSeatState.muted
            : RtcSeatState.occupied,
        image: joined && !useAdminAvatar
            ? RtcAssets.avatarImageForUser(user)
            : null,
        asset: joined && useAdminAvatar ? RtcAssets.adminDashboardAvatar : null,
      ),
    ];

    for (final peer in peers.take(visibleSeatCount - seats.length)) {
      final socketId = peer['socketId']?.toString();
      final label = _peerName(peer);
      final micEnabled = _signalBool(peer['micEnabled'], true);
      final stateLabel = socketId == null ? null : peerStates[socketId];
      seats.add(
        RtcStageSeat(
          number: seats.length + 1,
          label: label,
          state: !micEnabled
              ? RtcSeatState.muted
              : stateLabel?.toLowerCase().contains('connected') == true
              ? RtcSeatState.speaking
              : RtcSeatState.occupied,
        ),
      );
    }

    while (seats.length < visibleSeatCount) {
      seats.add(
        RtcStageSeat(
          number: seats.length + 1,
          label: 'Open seat',
          state: RtcSeatState.open,
        ),
      );
    }

    return GridView.count(
      crossAxisCount: 4,
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 0.72,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: seats,
    );
  }
}

class _LiveGuideRow extends StatelessWidget {
  const _LiveGuideRow({
    required this.room,
    required this.joined,
    required this.onJoin,
  });

  final Room room;
  final bool joined;
  final VoidCallback? onJoin;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
            decoration: BoxDecoration(
              color: const Color.fromRGBO(20, 0, 0, 0.76),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              room.description.isEmpty
                  ? 'Come on mic and chat together~'
                  : room.description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFFFFD06B),
                fontSize: 12,
                fontWeight: FontWeight.w800,
                height: 1.25,
              ),
            ),
          ),
        ),
        const SizedBox(width: 9),
        Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: joined ? null : onJoin,
            child: Container(
              width: 72,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: const Color.fromRGBO(255, 203, 47, 0.42),
                ),
                gradient: const LinearGradient(
                  colors: [Color(0xFFFFE17C), Color(0xFF7A1D15)],
                ),
              ),
              child: Icon(
                joined ? Icons.graphic_eq_rounded : Icons.mic_rounded,
                color: Colors.white,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _LiveCommentPreview extends StatelessWidget {
  const _LiveCommentPreview({
    required this.room,
    required this.user,
    required this.peers,
    required this.messages,
    required this.status,
    required this.joined,
    required this.micOn,
    required this.cameraOn,
  });

  final Room room;
  final AppUser user;
  final List<Map<String, dynamic>> peers;
  final List<Map<String, dynamic>> messages;
  final String status;
  final bool joined;
  final bool micOn;
  final bool cameraOn;

  @override
  Widget build(BuildContext context) {
    final firstPeer = peers.isEmpty ? null : peers.first;
    final recentMessages = _recentChatMessages(messages, 3);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (recentMessages.isEmpty)
          RtcChatBubble(
            sender: room.displayHost,
            message: room.chatEnabled
                ? joined
                      ? status
                      : 'Room is ready for live chat'
                : 'Chat is disabled',
            accent: RtcPalette.lobbyGold,
          )
        else
          ...recentMessages.map(
            (message) => RtcChatBubble(
              sender: _chatSenderName(message, user),
              message: _chatMessageText(message),
              mine: _isOwnChatMessage(message, user),
              accent: _chatMessageAccent(message),
            ),
          ),
        if (firstPeer != null)
          RtcChatBubble(
            sender: _peerName(firstPeer),
            message: 'joined the room',
            accent: RtcPalette.mint,
          ),
        if (joined)
          RtcChatBubble(
            sender: user.name,
            message:
                '${micOn ? 'Mic on' : 'Mic off'} · ${cameraOn ? 'Camera on' : 'Camera off'}',
            mine: true,
          ),
      ],
    );
  }
}

class _ConnectSteps extends StatelessWidget {
  const _ConnectSteps({required this.active});

  final String active;

  @override
  Widget build(BuildContext context) {
    final activeIndex = _connectSteps.indexWhere(
      (step) => step.value == active,
    );
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _connectSteps.asMap().entries.map((entry) {
        final done = activeIndex >= 0 && entry.key <= activeIndex;
        return _TinyStatusChip(
          label: entry.value.label,
          active: done,
          icon: done ? Icons.check : Icons.circle_outlined,
        );
      }).toList(),
    );
  }
}

class _ParticipantTile extends StatelessWidget {
  const _ParticipantTile({
    required this.label,
    required this.detail,
    required this.initials,
    required this.icon,
    required this.active,
    required this.micOn,
    required this.cameraOn,
    this.renderer,
  });

  final String label;
  final String detail;
  final String initials;
  final IconData icon;
  final bool active;
  final bool micOn;
  final bool cameraOn;
  final RTCVideoRenderer? renderer;

  @override
  Widget build(BuildContext context) {
    final showRenderer = renderer != null && cameraOn;
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Container(
        decoration: BoxDecoration(
          color: Color.fromRGBO(15, 23, 42, active ? 0.72 : 0.36),
          border: Border.all(
            color: active
                ? const Color.fromRGBO(52, 211, 153, 0.26)
                : const Color.fromRGBO(148, 163, 184, 0.18),
          ),
        ),
        child: Stack(
          children: [
            if (showRenderer)
              Positioned.fill(
                child: RTCVideoView(
                  renderer!,
                  objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                ),
              )
            else
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: active
                          ? const [Color(0xFF243B55), Color(0xFF141E30)]
                          : const [
                              Color.fromRGBO(15, 23, 42, 0.72),
                              Color.fromRGBO(2, 6, 23, 0.8),
                            ],
                    ),
                  ),
                  child: Center(
                    child: Text(
                      initials,
                      style: TextStyle(
                        color: active ? RtcPalette.text : RtcPalette.muted,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
              ),
            Positioned(
              top: 10,
              left: 10,
              child: Icon(
                icon,
                color: active ? RtcPalette.mint : RtcPalette.muted,
                size: 18,
              ),
            ),
            Positioned(
              right: 8,
              top: 8,
              child: Wrap(
                spacing: 4,
                children: [
                  _MiniMediaBadge(
                    icon: micOn ? Icons.mic : Icons.mic_off,
                    active: micOn,
                  ),
                  _MiniMediaBadge(
                    icon: cameraOn ? Icons.videocam : Icons.videocam_off,
                    active: cameraOn,
                  ),
                ],
              ),
            ),
            Positioned(
              left: 10,
              right: 10,
              bottom: 10,
              child: Column(
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
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniMediaBadge extends StatelessWidget {
  const _MiniMediaBadge({required this.icon, required this.active});

  final IconData icon;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 26,
      height: 26,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: RtcPalette.panelScrim.withValues(alpha: 0.7),
        border: Border.all(color: active ? RtcPalette.mint : RtcPalette.line),
        shape: BoxShape.circle,
      ),
      child: Icon(
        icon,
        color: active ? RtcPalette.mint : RtcPalette.muted,
        size: 14,
      ),
    );
  }
}

class _LiveControlBar extends StatelessWidget {
  const _LiveControlBar({
    required this.joined,
    required this.joining,
    required this.leaving,
    required this.mediaUpdating,
    required this.micOn,
    required this.cameraOn,
    required this.screenSharing,
    required this.room,
    required this.rtcMode,
    required this.onLeave,
    required this.onToggleMic,
    required this.onToggleCamera,
    required this.onOpenTools,
  });

  final bool joined;
  final bool joining;
  final bool leaving;
  final bool mediaUpdating;
  final bool micOn;
  final bool cameraOn;
  final bool screenSharing;
  final Room room;
  final String rtcMode;
  final VoidCallback? onLeave;
  final VoidCallback? onToggleMic;
  final VoidCallback? onToggleCamera;
  final ValueChanged<String> onOpenTools;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              RtcStageActionButton(
                icon: micOn ? Icons.mic : Icons.mic_off,
                label: mediaUpdating
                    ? 'Saving'
                    : micOn
                    ? 'Mic on'
                    : 'Mic off',
                active: micOn,
                onPressed: onToggleMic,
              ),
              const SizedBox(width: 8),
              RtcStageActionButton(
                icon: cameraOn ? Icons.videocam : Icons.videocam_off,
                label: rtcMode == 'video'
                    ? cameraOn
                          ? 'Camera on'
                          : 'Camera off'
                    : 'Audio room',
                active: cameraOn,
                onPressed: onToggleCamera,
              ),
              const SizedBox(width: 8),
              RtcStageActionButton(
                icon: Icons.graphic_eq,
                label: 'Audio',
                onPressed: () => onOpenTools('audio'),
              ),
              const SizedBox(width: 8),
              RtcStageActionButton(
                icon: Icons.auto_awesome,
                label: 'Beauty',
                onPressed: rtcMode == 'video'
                    ? () => onOpenTools('beauty')
                    : null,
              ),
              const SizedBox(width: 8),
              RtcStageActionButton(
                icon: screenSharing
                    ? Icons.stop_screen_share_outlined
                    : Icons.screen_share_outlined,
                label: 'Share',
                active: screenSharing,
                onPressed: room.screenShareEnabled
                    ? () => onOpenTools('screen')
                    : null,
              ),
              const SizedBox(width: 8),
              RtcStageActionButton(
                icon: Icons.admin_panel_settings_outlined,
                label: 'Ops',
                onPressed: () => onOpenTools('ops'),
              ),
              const SizedBox(width: 8),
              RtcStageActionButton(
                icon: Icons.shield_outlined,
                label: 'Guard',
                active: room.aiSecurityEnabled,
                onPressed: () => onOpenTools('guard'),
              ),
              const SizedBox(width: 8),
              RtcStageActionButton(
                icon: Icons.chat_bubble_outline,
                label: 'Chat',
                active: room.chatEnabled,
                onPressed: () => onOpenTools('chat'),
              ),
              if (joined || joining || leaving) ...[
                const SizedBox(width: 8),
                RtcStageActionButton(
                  icon: Icons.call_end,
                  label: leaving ? 'Leaving' : 'Leave',
                  destructive: true,
                  onPressed: onLeave,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _LiveToolPanel extends StatelessWidget {
  const _LiveToolPanel({
    required this.panel,
    required this.room,
    required this.joined,
    required this.passwordController,
    required this.chatController,
    required this.chatMessages,
    required this.chatLoading,
    required this.chatSending,
    required this.roomControls,
    required this.controlsLoading,
    required this.moderatingUserIds,
    required this.screenSharing,
    required this.status,
    required this.onJoin,
    required this.onSendChat,
    required this.onSendGift,
    required this.onLoadControls,
    required this.onModerateParticipant,
    required this.onToggleScreenSharing,
  });

  final String panel;
  final Room room;
  final bool joined;
  final TextEditingController passwordController;
  final TextEditingController chatController;
  final List<Map<String, dynamic>> chatMessages;
  final bool chatLoading;
  final bool chatSending;
  final Map<String, dynamic>? roomControls;
  final bool controlsLoading;
  final Set<int> moderatingUserIds;
  final bool screenSharing;
  final String status;
  final VoidCallback? onJoin;
  final VoidCallback onSendChat;
  final VoidCallback? onSendGift;
  final VoidCallback onLoadControls;
  final void Function(Map<String, dynamic> participant, String action)
  onModerateParticipant;
  final VoidCallback? onToggleScreenSharing;

  @override
  Widget build(BuildContext context) {
    final title = switch (panel) {
      'access' => 'Room Access',
      'audio' => 'Audio Effects',
      'beauty' => 'Beauty & Background',
      'screen' => 'Screen Share',
      'ops' => 'Room Ops',
      'guard' => 'Guard',
      'chat' => 'Live Chat',
      _ => 'Room Tools',
    };

    return RtcActionSheetPanel(
      title: title,
      subtitle: _toolDetail(panel, room, joined),
      children: [
        if (panel == 'access')
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: passwordController,
                obscureText: true,
                keyboardType: TextInputType.visiblePassword,
                style: const TextStyle(
                  color: RtcPalette.lobbyInk,
                  fontWeight: FontWeight.w800,
                ),
                decoration: InputDecoration(
                  labelText: 'Room password',
                  prefixIcon: const Icon(Icons.key_rounded),
                  filled: true,
                  fillColor: const Color(0xFFF8FAFC),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
              if (!joined && status.trim().isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  status,
                  style: const TextStyle(
                    color: RtcPalette.lobbyMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
              const SizedBox(height: 10),
              GradientButton(
                onPressed: joined ? null : onJoin,
                icon: const Icon(Icons.login_rounded, color: Colors.white),
                child: Text(joined ? 'Joined' : 'Join room'),
              ),
            ],
          )
        else if (panel == 'screen')
          RtcSheetActionTile(
            icon: screenSharing
                ? Icons.stop_screen_share_outlined
                : Icons.screen_share_outlined,
            title: screenSharing ? 'Stop sharing' : 'Start screen share',
            subtitle: room.screenShareEnabled
                ? 'Presenter tools are available.'
                : 'Screen share is turned off.',
            onTap: onToggleScreenSharing,
            trailing: Icon(
              screenSharing
                  ? Icons.check_circle_rounded
                  : Icons.chevron_right_rounded,
              color: screenSharing
                  ? RtcPalette.lobbyTealDark
                  : RtcPalette.lobbyMuted,
            ),
          )
        else if (panel == 'chat')
          _ChatPreview(
            room: room,
            joined: joined,
            controller: chatController,
            messages: chatMessages,
            loading: chatLoading,
            sending: chatSending,
            onSend: onSendChat,
            onSendGift: onSendGift,
          )
        else if (panel == 'ops')
          _RoomOpsPanel(
            controls: roomControls,
            loading: controlsLoading,
            moderatingUserIds: moderatingUserIds,
            onRefresh: onLoadControls,
            onModerate: onModerateParticipant,
          )
        else
          ..._toolChips(panel, room).map(
            (chip) => RtcSheetActionTile(
              icon: _toolPanelIcon(panel),
              title: chip.label,
              subtitle: chip.value,
              onTap: null,
              trailing: RtcMiniBadge(
                label: chip.value,
                color: RtcPalette.lobbyTealDark,
                subtle: true,
              ),
            ),
          ),
      ],
    );
  }
}

class _ChatPreview extends StatelessWidget {
  const _ChatPreview({
    required this.room,
    required this.joined,
    required this.controller,
    required this.messages,
    required this.loading,
    required this.sending,
    required this.onSend,
    required this.onSendGift,
  });

  final Room room;
  final bool joined;
  final TextEditingController controller;
  final List<Map<String, dynamic>> messages;
  final bool loading;
  final bool sending;
  final VoidCallback onSend;
  final VoidCallback? onSendGift;

  @override
  Widget build(BuildContext context) {
    final visibleMessages = _recentChatMessages(messages, 6);
    final enabled = joined && room.chatEnabled && !sending;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RtcSheetActionTile(
          icon: Icons.chat_bubble_outline,
          title: room.chatEnabled
              ? loading
                    ? 'Loading messages'
                    : visibleMessages.isEmpty
                    ? 'No messages yet'
                    : '${visibleMessages.length} recent messages'
              : 'Chat is disabled',
          subtitle: joined
              ? 'Room comments are live.'
              : 'Join room to participate.',
          onTap: null,
          trailing: RtcMiniBadge(
            label: sending
                ? 'Sending'
                : room.chatEnabled && joined
                ? 'Live'
                : 'Idle',
            color: room.chatEnabled && joined
                ? RtcPalette.lobbyTealDark
                : RtcPalette.lobbySoft,
            subtle: true,
          ),
        ),
        const SizedBox(height: 10),
        Container(
          constraints: const BoxConstraints(maxHeight: 240),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: RtcPalette.stageBg,
            borderRadius: BorderRadius.circular(12),
          ),
          child: SingleChildScrollView(
            child: Column(
              children: [
                if (loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                else if (visibleMessages.isEmpty)
                  RtcChatBubble(
                    sender: room.displayHost,
                    message: room.chatEnabled
                        ? 'Say hi when you join the room.'
                        : 'Chat is disabled',
                    accent: RtcPalette.lobbyGold,
                  )
                else
                  ...visibleMessages.map(
                    (message) => RtcChatBubble(
                      sender: _chatSenderName(message),
                      message: _chatMessageText(message),
                      mine: false,
                      accent: _chatMessageAccent(message),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        RtcChatComposer(
          controller: controller,
          onSend: onSend,
          onGift: onSendGift,
          enabled: enabled,
          hintText: room.chatEnabled
              ? joined
                    ? 'Message this room'
                    : 'Join room to chat'
              : 'Chat is disabled',
        ),
      ],
    );
  }
}

class _RoomOpsPanel extends StatelessWidget {
  const _RoomOpsPanel({
    required this.controls,
    required this.loading,
    required this.moderatingUserIds,
    required this.onRefresh,
    required this.onModerate,
  });

  final Map<String, dynamic>? controls;
  final bool loading;
  final Set<int> moderatingUserIds;
  final VoidCallback onRefresh;
  final void Function(Map<String, dynamic> participant, String action)
  onModerate;

  @override
  Widget build(BuildContext context) {
    final data = controls;
    if (data == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Center(
                child: SizedBox.square(
                  dimension: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
          RtcSheetActionTile(
            icon: Icons.admin_panel_settings_outlined,
            title: 'Room controls',
            subtitle: 'Available to the room owner, admins, and moderators.',
            onTap: loading ? null : onRefresh,
            trailing: Icon(
              loading ? Icons.hourglass_top_rounded : Icons.refresh_rounded,
              color: RtcPalette.lobbyTealDark,
            ),
          ),
        ],
      );
    }

    final participants = _mapList(data['participants']);
    final role = data['role']?.toString() ?? 'member';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            RtcMiniBadge(
              label: role,
              color: RtcPalette.lobbyTealDark,
              subtle: true,
            ),
            const SizedBox(width: 8),
            RtcMiniBadge(
              label:
                  '${participants.length} active participant${participants.length == 1 ? '' : 's'}',
              color: RtcPalette.lobbySoft,
              subtle: true,
            ),
            const Spacer(),
            if (loading)
              const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              IconButton(
                tooltip: 'Refresh controls',
                onPressed: onRefresh,
                icon: const Icon(
                  Icons.refresh_rounded,
                  color: RtcPalette.lobbyTealDark,
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        if (participants.isEmpty)
          const Text(
            'No active participants yet.',
            style: TextStyle(
              color: RtcPalette.lobbySoft,
              fontWeight: FontWeight.w800,
            ),
          )
        else
          ...participants.map(
            (participant) => _OpsParticipantTile(
              participant: participant,
              busy: moderatingUserIds.contains(
                _intValue(participant['user_id']),
              ),
              onModerate: onModerate,
            ),
          ),
      ],
    );
  }
}

class _OpsParticipantTile extends StatelessWidget {
  const _OpsParticipantTile({
    required this.participant,
    required this.busy,
    required this.onModerate,
  });

  final Map<String, dynamic> participant;
  final bool busy;
  final void Function(Map<String, dynamic> participant, String action)
  onModerate;

  @override
  Widget build(BuildContext context) {
    final canModerate = _signalBool(participant['can_moderate']);
    final role = participant['role_in_room']?.toString() ?? 'end_user';
    final enabled = canModerate && !busy;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        border: Border.all(color: RtcPalette.lobbyLine),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              RtcAvatarToken(
                label: _opsParticipantName(participant),
                image: _opsParticipantAvatar(participant),
                size: 34,
                borderRadius: RtcRadius.pill,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _opsParticipantName(participant),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbyInk,
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$role · ${_signalBool(participant['mic_enabled']) ? 'mic on' : 'mic off'} · ${_signalBool(participant['camera_enabled']) ? 'cam on' : 'cam off'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbySoft,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              if (busy)
                const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else if (!canModerate)
                const Icon(
                  Icons.lock_outline_rounded,
                  color: RtcPalette.lobbyMuted,
                  size: 18,
                ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _OpsActionButton(
                label: 'Mute',
                onPressed: enabled
                    ? () => onModerate(participant, 'mute_mic')
                    : null,
              ),
              _OpsActionButton(
                label: 'Camera',
                onPressed: enabled
                    ? () => onModerate(participant, 'disable_camera')
                    : null,
              ),
              _OpsActionButton(
                label: 'Kick',
                destructive: true,
                onPressed: enabled
                    ? () => onModerate(participant, 'kick')
                    : null,
              ),
              _OpsActionButton(
                label: 'Ban',
                destructive: true,
                onPressed: enabled
                    ? () => onModerate(participant, 'ban')
                    : null,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _OpsActionButton extends StatelessWidget {
  const _OpsActionButton({
    required this.label,
    required this.onPressed,
    this.destructive = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive ? RtcPalette.red : RtcPalette.lobbyTealDark;
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: BorderSide(color: color.withValues(alpha: 0.3)),
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
      ),
      child: Text(label),
    );
  }
}

class _RoomInfoPanel extends StatelessWidget {
  const _RoomInfoPanel({
    required this.room,
    required this.peers,
    required this.joined,
    required this.signalingRoom,
  });

  final Room room;
  final List<Map<String, dynamic>> peers;
  final bool joined;
  final String? signalingRoom;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      color: RtcPalette.stagePanel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RtcSectionHeader(
            eyebrow: 'ROOM STATUS',
            title: 'Participants',
            detail: room.description.isEmpty
                ? room.displayHost
                : room.description,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              MetricChip(label: 'Signal', value: joined ? 'Connected' : 'Idle'),
              MetricChip(label: 'Room ID', value: '${room.id}'),
              MetricChip(label: 'Host', value: room.displayHost),
              MetricChip(label: 'Region', value: room.displayRegion),
              MetricChip(label: 'Socket', value: signalingRoom ?? '-'),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: room.featureTags
                .map((tag) => _TinyStatusChip(label: tag, active: true))
                .toList(),
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
                  label: _peerName(peer),
                  detail:
                      '${_signalBool(peer['micEnabled'], true) ? 'mic on' : 'mic off'} · ${_signalBool(peer['cameraEnabled'], false) ? 'cam on' : 'cam off'}',
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
      color: RtcPalette.stagePanel,
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
              'No signaling events yet.',
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

class _TinyStatusChip extends StatelessWidget {
  const _TinyStatusChip({required this.label, required this.active, this.icon});

  final String label;
  final bool active;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: active ? RtcPalette.hoverBg : RtcPalette.panelGlass,
        border: Border.all(
          color: active ? RtcPalette.hoverBorder : RtcPalette.line,
        ),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(
              icon,
              size: 13,
              color: active ? RtcPalette.mint : RtcPalette.muted,
            ),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: TextStyle(
              color: active ? RtcPalette.text : RtcPalette.muted,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ConnectStep {
  const _ConnectStep({required this.value, required this.label});

  final String value;
  final String label;
}

class _ToolChip {
  const _ToolChip(this.label, this.value);

  final String label;
  final String value;
}

List<Map<String, dynamic>> _recentChatMessages(
  List<Map<String, dynamic>> messages,
  int count,
) {
  final visible = messages
      .where((message) => !_signalBool(message['is_deleted']))
      .toList(growable: false);
  final start = visible.length > count ? visible.length - count : 0;
  return visible.sublist(start);
}

List<Map<String, dynamic>> _mapList(Object? value) {
  return value is List
      ? value
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList()
      : <Map<String, dynamic>>[];
}

Map<String, dynamic>? _mapValue(Object? value) {
  return value is Map ? Map<String, dynamic>.from(value) : null;
}

int? _intValue(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '');
}

String _opsParticipantName(Map<String, dynamic> participant) {
  return (participant['user_name'] ??
          participant['userName'] ??
          participant['user_id'] ??
          'Participant')
      .toString();
}

ImageProvider? _opsParticipantAvatar(Map<String, dynamic> participant) {
  final value =
      (participant['user_avatar_url'] ?? participant['userAvatarUrl'] ?? '')
          .toString()
          .trim();
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return NetworkImage(value);
  }
  if (value.startsWith('assets/')) return AssetImage(value);
  return null;
}

String _moderationPastTense(String action) {
  return switch (action) {
    'mute_mic' => 'muted',
    'disable_camera' => 'camera paused',
    'kick' => 'removed',
    'ban' => 'banned',
    _ => 'moderated',
  };
}

int? _chatMessageId(Map<String, dynamic> message) {
  final value = message['id'];
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '');
}

String _chatSenderName(Map<String, dynamic> message, [AppUser? currentUser]) {
  if (currentUser != null && _isOwnChatMessage(message, currentUser)) {
    return currentUser.name;
  }
  return (message['sender_name'] ??
          message['senderName'] ??
          message['sender_id'] ??
          'Room')
      .toString();
}

bool _isOwnChatMessage(Map<String, dynamic> message, AppUser user) {
  final senderId = message['sender_id'] ?? message['senderId'];
  return senderId?.toString() == user.id.toString();
}

String _chatMessageText(Map<String, dynamic> message) {
  final type = (message['message_type'] ?? message['messageType'] ?? 'text')
      .toString();
  final body = (message['message_body'] ?? message['messageBody'] ?? '')
      .toString()
      .trim();
  return switch (type) {
    'gift' => body.isEmpty ? 'sent a gift' : '$body gift sent',
    'image' => body.isEmpty ? 'sent a photo' : body,
    'voice' => body.isEmpty ? 'sent a voice message' : body,
    'system' => body.isEmpty ? 'System message' : body,
    _ => body.isEmpty ? 'Message' : body,
  };
}

Color _chatMessageAccent(Map<String, dynamic> message) {
  final type = (message['message_type'] ?? message['messageType'] ?? 'text')
      .toString();
  return switch (type) {
    'gift' => RtcPalette.lobbyGold,
    'system' => RtcPalette.amber,
    'image' || 'voice' => RtcPalette.sky,
    _ => RtcPalette.chatPurple,
  };
}

const _connectSteps = [
  _ConnectStep(value: 'ready', label: 'Ready'),
  _ConnectStep(value: 'media', label: 'Media'),
  _ConnectStep(value: 'backend', label: 'Room'),
  _ConnectStep(value: 'signaling', label: 'Signal'),
  _ConnectStep(value: 'connected', label: 'Live'),
];

String _modeLabel(String rtcMode) => rtcMode == 'video' ? 'Video' : 'Audio';

String _peerName(Map<String, dynamic> peer) {
  return (peer['userName'] ?? peer['name'] ?? peer['userId'] ?? 'Peer')
      .toString();
}

String _initials(String value) {
  final parts = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first[0].toUpperCase();
  return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
}

bool _signalBool(Object? value, [bool fallback = false]) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final normalized = value?.toString().trim().toLowerCase();
  if (normalized == null || normalized.isEmpty) return fallback;
  if (const {'true', '1', 'yes', 'on'}.contains(normalized)) return true;
  if (const {'false', '0', 'no', 'off'}.contains(normalized)) return false;
  return fallback;
}

String _toolDetail(String panel, Room room, bool joined) {
  return switch (panel) {
    'access' => 'Private and password room entry.',
    'audio' => 'Noise cancellation and voice presets.',
    'beauty' => 'Camera effects and background options.',
    'screen' =>
      room.screenShareEnabled
          ? 'Presenter tools are available.'
          : 'Screen share is turned off.',
    'ops' => joined ? 'Active participant controls.' : 'Room controls.',
    'guard' =>
      room.aiSecurityEnabled ? 'Moderation layer active.' : 'Guard off.',
    'chat' => room.chatEnabled ? 'Room comments.' : 'Comments off.',
    _ => 'Room tools.',
  };
}

IconData _toolPanelIcon(String panel) {
  return switch (panel) {
    'audio' => Icons.graphic_eq_rounded,
    'beauty' => Icons.auto_awesome_rounded,
    'screen' => Icons.screen_share_outlined,
    'ops' => Icons.admin_panel_settings_outlined,
    'guard' => Icons.shield_outlined,
    'chat' => Icons.chat_bubble_outline,
    _ => Icons.tune_rounded,
  };
}

List<_ToolChip> _toolChips(String panel, Room room) {
  return switch (panel) {
    'audio' => const [
      _ToolChip('Noise', 'Ready'),
      _ToolChip('Voice', 'Natural'),
      _ToolChip('Mode', 'Mic stage'),
    ],
    'beauty' => const [
      _ToolChip('Filter', 'Normal'),
      _ToolChip('Mirror', 'Ready'),
      _ToolChip('Background', 'Ready'),
    ],
    'ops' => [
      _ToolChip('Owner', room.displayHost),
      _ToolChip('Seats', room.maxMicCount.toString()),
      _ToolChip('Access', formatPrivacy(room.privacyType)),
    ],
    'guard' => [
      _ToolChip('Guard', room.aiSecurityEnabled ? 'Active' : 'Off'),
      _ToolChip('Chat', room.chatEnabled ? 'On' : 'Off'),
      _ToolChip('Gifts', room.giftEnabled ? 'On' : 'Off'),
    ],
    _ => const [],
  };
}
