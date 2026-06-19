import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

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
  final _quickChatFocus = FocusNode();
  final _imagePicker = ImagePicker();
  final _scrollController = ScrollController();
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
  StreamSubscription<int>? _roomHistoryClearedSub;
  StreamSubscription<Map<String, dynamic>>? _moderationActionSub;
  StreamSubscription<Map<String, dynamic>>? _roomControlsUpdateSub;
  StreamSubscription<Map<String, dynamic>>? _stageJoinRequestSub;
  StreamSubscription<Map<String, dynamic>>? _stageRequestCancellationSub;
  StreamSubscription<Map<String, dynamic>>? _stagePermissionSub;
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
  bool _quickChatOpen = false;
  bool _canPublishStage = false;
  bool _stageRequestsEnabled = true;
  bool _stageRequestSending = false;
  double _roomAudioVolume = 0.72;
  String _rtcMode = 'audio';
  String _status = 'Ready to join';
  String _stageRole = 'audience';
  String _stageRequestStatus = '';
  String? _activePanel;
  bool _youTubeConnected = false;
  bool _youTubeOpening = false;
  String _youTubeTab = 'music';
  String _youTubeFilter = 'All';
  Map<String, dynamic>? _roomControls;
  Map<String, dynamic>? _ownStageRequest;
  _YouTubeChoice? _selectedYouTube;
  final _stageActionIds = <int>{};

  bool get _videoMode => _rtcMode == 'video' && widget.room.supportsVideo;
  bool get _isRoomOwner =>
      widget.room.ownerId != 0 && widget.room.ownerId == widget.user.id;

  @override
  void initState() {
    super.initState();
    _media = widget.mediaService ?? RtcMediaService();
    _signaling = widget.signalingService ?? SignalingService();
    _peerCoordinator = widget.peerCoordinator ?? RtcPeerConnectionService();
    unawaited(_peerCoordinator.attachSignaling(_signaling));
    _rtcMode = 'audio';
    _cameraOn = false;
    _eventSub = _signaling.events.listen(_addEvent);
    _peerSub = _signaling.peers.listen((peers) {
      if (!mounted) return;
      final socketIds = peers.map(_peerSocketId).whereType<String>().toSet();
      final staleRendererIds = _remoteRenderers.keys
          .where((socketId) => !socketIds.contains(socketId))
          .toList();
      setState(() {
        _peers
          ..clear()
          ..addAll(peers);
        _peerStates.removeWhere((socketId, _) => !socketIds.contains(socketId));
      });
      for (final socketId in staleRendererIds) {
        unawaited(_removeRemoteRenderer(socketId));
      }
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
      _removeChatMessage(messageId);
      _addEvent('Chat message removed.');
    });
    _roomHistoryClearedSub = _signaling.roomHistoryCleared.listen((roomId) {
      if (roomId != widget.room.id || !mounted) return;
      setState(() => _chatMessages.clear());
      _addEvent('Chat history cleared.');
    });
    _moderationActionSub = _signaling.moderationActions.listen((action) {
      unawaited(_handleModerationAction(action));
    });
    _roomControlsUpdateSub = _signaling.roomControlsUpdates.listen((controls) {
      if (!mounted) return;
      setState(() => _roomControls = controls);
    });
    _stageJoinRequestSub = _signaling.stageJoinRequests.listen((request) {
      if (!mounted) return;
      setState(() {
        _roomControls = _upsertStageRequest(_roomControls, request);
        _status = '${_stageRequestName(request)} wants to join the mic stage.';
      });
    });
    _stageRequestCancellationSub = _signaling.stageJoinRequestCancellations
        .listen((payload) {
          if (!mounted) return;
          setState(() {
            _roomControls = _removeStageRequest(_roomControls, payload);
            _status = 'Stage request cancelled.';
          });
        });
    _stagePermissionSub = _signaling.stagePermissionUpdates.listen((payload) {
      unawaited(_handleStagePermissionUpdate(payload));
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
    _roomHistoryClearedSub?.cancel();
    _moderationActionSub?.cancel();
    _roomControlsUpdateSub?.cancel();
    _stageJoinRequestSub?.cancel();
    _stageRequestCancellationSub?.cancel();
    _stagePermissionSub?.cancel();
    _roomPassword.dispose();
    _chatComposer.dispose();
    _quickChatFocus.dispose();
    _scrollController.dispose();
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
      _status = 'Joining backend room...';
    });

    try {
      final video = widget.room.supportsVideo && _rtcMode == 'video';
      final requestedMic = _micOn;
      final requestedCamera = video && _cameraOn;
      final shouldPreflightMedia =
          _isRoomOwner && (requestedMic || requestedCamera);

      if (shouldPreflightMedia) {
        setState(() {
          _status = requestedCamera
              ? 'Checking microphone and camera permissions...'
              : 'Checking microphone permission...';
        });
        await _media.requestPermissions(video: requestedCamera);
      }

      setState(() {
        _status = 'Joining backend room...';
      });

      final joinData = await widget.api.joinRoom(
        widget.room.id,
        video: video,
        micEnabled: requestedMic,
        cameraEnabled: requestedCamera,
        password: _roomPassword.text,
      );
      final rtc = Map<String, dynamic>.from(joinData['rtc'] as Map? ?? {});
      final signalingRoom = rtc['signaling_room']?.toString() ?? '';
      if (signalingRoom.isEmpty) {
        throw StateError('Backend did not return rtc.signaling_room.');
      }
      final stageAccess = _stageAccessFromRtc(rtc);
      final canPublishStage = _signalBool(stageAccess['canPublish']);
      final serverMic = canPublishStage && rtc['mic_enabled'] != false;
      final serverCamera =
          canPublishStage && video && rtc['camera_enabled'] == true;
      final stageRequest = _mapValue(rtc['stage_request']);

      setState(() {
        _stageRole = stageAccess['role']?.toString() ?? 'audience';
        _canPublishStage = canPublishStage;
        _stageRequestsEnabled = _signalBool(
          stageAccess['requestsEnabled'],
          true,
        );
        _stageRequestStatus = canPublishStage
            ? ''
            : stageRequest == null
            ? ''
            : 'pending';
        _ownStageRequest = stageRequest;
        _micOn = serverMic;
        _cameraOn = serverCamera;
        _screenSharing = false;
      });

      if (canPublishStage) {
        setState(() {
          _status = 'Preparing approved stage media...';
        });
        await _openLocalMedia(
          camera: serverCamera,
          permissionsReady:
              shouldPreflightMedia && (!serverCamera || requestedCamera),
        );
      } else {
        _stopLocalMedia();
        await _peerCoordinator.setLocalStream(null, video: false);
      }

      setState(() {
        _status = 'Connecting live room...';
      });
      await _signaling.connect();
      await _signaling.joinRoom(
        signalingRoom: signalingRoom,
        databaseRoomId: widget.room.id,
        user: widget.user,
        video: video,
        micEnabled: serverMic,
        cameraEnabled: serverCamera,
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
        _micOn = serverMic;
        _cameraOn = serverCamera;
        _screenSharing = false;
        _activePanel = null;
        _status = canPublishStage
            ? 'You are on stage.'
            : 'Entered as audience. Ask the owner to join.';
      });
      _applyLocalMediaState();
      await _peerCoordinator.setLocalStream(_localStream, video: serverCamera);
      unawaited(_loadRoomMessages());
    } catch (error) {
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  Future<void> _openLocalMedia({
    required bool camera,
    bool permissionsReady = false,
  }) async {
    if (!permissionsReady) await _media.requestPermissions(video: camera);
    if (!widget.enableLocalPreview) return;

    _stopLocalMedia();
    final stream = await _media.openLocalMedia(video: camera);
    _localStream = stream;
    _applyLocalMediaState();
    await _peerCoordinator.setLocalStream(stream, video: camera);
    if (_rendererReady) {
      _localRenderer.srcObject = stream;
    }
  }

  Future<void> _ensureLocalStageMedia({required bool camera}) async {
    if (!widget.enableLocalPreview) {
      await _peerCoordinator.setLocalStream(_localStream, video: camera);
      return;
    }

    final stream = _localStream;
    final hasAudio = stream?.getAudioTracks().isNotEmpty == true;
    final hasVideo = stream?.getVideoTracks().isNotEmpty == true;
    if (hasAudio && (!camera || hasVideo)) {
      await _peerCoordinator.setLocalStream(stream, video: camera);
      return;
    }

    await _openLocalMedia(camera: camera);
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
        _peers.clear();
        _peerStates.clear();
        _screenSharing = false;
        _canPublishStage = false;
        _stageRole = 'audience';
        _stageRequestStatus = '';
        _ownStageRequest = null;
        _status = message;
      });
      _addEvent(message);
      if (popAfterLeave && mounted) Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _joined = false;
        _status = apiErrorMessage(error);
        _canPublishStage = false;
        _stageRole = 'audience';
        _stageRequestStatus = '';
        _ownStageRequest = null;
      });
      if (popAfterLeave) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _leaving = false);
    }
  }

  Future<void> _toggleMic() async {
    if (!_canPublishStage) {
      await _requestStageJoin();
      return;
    }
    await _syncMediaState(micOn: !_micOn, cameraOn: _cameraOn);
  }

  Future<void> _syncMediaState({
    required bool micOn,
    required bool cameraOn,
    bool? screenSharing,
  }) async {
    if (_mediaUpdating) return;
    final previousMic = _micOn;
    final previousCamera = _cameraOn;
    final previousRtcMode = _rtcMode;
    final previousScreen = _screenSharing;
    final nextScreen = screenSharing ?? _screenSharing;
    final nextRtcMode = widget.room.supportsVideo && cameraOn
        ? 'video'
        : 'audio';
    final nextCameraOn = nextRtcMode == 'video' && cameraOn;
    final wantsToPublish = micOn || nextCameraOn || nextScreen;

    if (wantsToPublish && !_canPublishStage) {
      await _requestStageJoin();
      return;
    }

    setState(() {
      _mediaUpdating = true;
      _rtcMode = nextRtcMode;
      _micOn = micOn;
      _cameraOn = nextCameraOn;
      _screenSharing = nextScreen;
      _status = 'Saving media state...';
    });
    _applyLocalMediaState();

    try {
      if (wantsToPublish) {
        await _ensureLocalStageMedia(camera: nextCameraOn);
      }
      if (_joined) {
        final data = await widget.api.updateRoomMediaState(
          widget.room.id,
          micEnabled: _micOn,
          cameraEnabled: nextCameraOn,
          screenShared: _screenSharing,
        );
        final rtc = Map<String, dynamic>.from(data['rtc'] as Map? ?? {});
        final serverMic = rtc['mic_enabled'] != false;
        final serverCamera =
            widget.room.supportsVideo && rtc['camera_enabled'] == true;
        final serverRtcMode = serverCamera ? 'video' : 'audio';
        final serverScreen = rtc['screen_shared'] == true;
        final stageAccess = _stageAccessFromRtc(rtc);
        setState(() {
          _rtcMode = serverRtcMode;
          _micOn = serverMic;
          _cameraOn = serverCamera;
          _screenSharing = serverScreen;
          _stageRole = stageAccess['role']?.toString() ?? _stageRole;
          _canPublishStage = _signalBool(
            stageAccess['canPublish'],
            _canPublishStage,
          );
          _stageRequestsEnabled = _signalBool(
            stageAccess['requestsEnabled'],
            _stageRequestsEnabled,
          );
        });
        _applyLocalMediaState();
        await _signaling
            .emitMediaState(
              video: serverRtcMode == 'video',
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
        _rtcMode = previousRtcMode;
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

  Future<void> _requestStageJoin() async {
    if (_stageRequestSending) return;
    if (!_joined) {
      setState(() => _status = 'Enter the room before requesting to join.');
      return;
    }
    if (_canPublishStage) {
      setState(() => _status = 'You already have permission to join.');
      return;
    }
    if (!_stageRequestsEnabled) {
      setState(() => _status = 'Stage requests are closed for this room.');
      return;
    }

    setState(() {
      _stageRequestSending = true;
      _stageRequestStatus = 'pending';
      _status = 'Sending request to the room owner...';
    });

    try {
      final data = await widget.api.createStageRequest(
        widget.room.id,
        requestedMic: true,
        requestedCamera: _videoMode,
        requestedRtcMode: _rtcMode,
      );
      final request = _mapValue(data['request']);
      if (!mounted) return;
      setState(() {
        _ownStageRequest = request;
        _stageRequestStatus = 'pending';
        _status = 'Request sent. Waiting for owner approval.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _ownStageRequest = null;
        _stageRequestStatus = '';
        _status = apiErrorMessage(error);
      });
    } finally {
      if (mounted) setState(() => _stageRequestSending = false);
    }
  }

  Future<void> _cancelStageJoinRequest() async {
    if (_stageRequestSending) return;
    final requestId = _intValue(_ownStageRequest?['id']);
    if (requestId == null) {
      setState(() {
        _ownStageRequest = null;
        _stageRequestStatus = '';
        _status = 'Stage request cleared.';
      });
      return;
    }

    setState(() {
      _stageRequestSending = true;
      _status = 'Cancelling stage request...';
    });

    try {
      await widget.api.cancelStageRequest(widget.room.id, requestId);
      if (!mounted) return;
      setState(() {
        _ownStageRequest = null;
        _stageRequestStatus = '';
        _status = 'Stage request cancelled.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _stageRequestSending = false);
    }
  }

  Future<void> _handleStagePermissionUpdate(
    Map<String, dynamic> payload,
  ) async {
    final controls = _mapValue(payload['controls']);
    final targetUserId = _intValue(
      payload['targetUserId'] ?? payload['target_user_id'],
    );
    final approved = _signalBool(payload['approved']);
    final action = payload['action']?.toString() ?? '';

    if (mounted && controls != null) {
      setState(() => _roomControls = controls);
    }

    if (targetUserId != widget.user.id) {
      if (mounted && action.isNotEmpty) {
        setState(() => _status = 'Stage permission updated.');
      }
      return;
    }

    final participant = _mapValue(payload['participant']);
    final stageAccess = _stageAccessFromParticipant(participant);
    final nextCanPublish = approved && _signalBool(stageAccess['canPublish']);

    if (!nextCanPublish) {
      if (!mounted) return;
      setState(() {
        _canPublishStage = false;
        _stageRole = 'audience';
        _stageRequestStatus = '';
        _ownStageRequest = null;
        _micOn = false;
        _cameraOn = false;
        _screenSharing = false;
        _status = approved
            ? 'Stage permission removed.'
            : 'Room owner declined the stage request.';
      });
      _applyLocalMediaState();
      await _peerCoordinator.setLocalStream(null, video: false);
      return;
    }

    if (!mounted) return;
    setState(() {
      _canPublishStage = true;
      _stageRole = stageAccess['role']?.toString() ?? 'speaker';
      _stageRequestsEnabled = _signalBool(
        stageAccess['requestsEnabled'],
        _stageRequestsEnabled,
      );
      _stageRequestStatus = '';
      _ownStageRequest = null;
      _status = 'Owner approved. Starting stage media...';
    });
    await _syncMediaState(micOn: true, cameraOn: _videoMode);
  }

  Future<void> _applyStagePermission(
    Map<String, dynamic> request,
    bool approve,
  ) async {
    final requestId = _intValue(request['id']);
    final userId = _intValue(
      request['userId'] ?? request['user_id'] ?? request['requester_user_id'],
    );
    final actionKey = requestId ?? userId;
    if (actionKey == null || _stageActionIds.contains(actionKey)) return;

    setState(() {
      _stageActionIds.add(actionKey);
      _status = approve ? 'Approving stage request...' : 'Declining request...';
    });

    try {
      final data = requestId != null
          ? await widget.api.respondToStageRequest(
              widget.room.id,
              requestId,
              approve: approve,
            )
          : await widget.api.updateParticipantStagePermission(
              widget.room.id,
              userId!,
              approve: approve,
            );
      final controls = _mapValue(data['controls']);
      if (!mounted) return;
      setState(() {
        if (controls != null) {
          _roomControls = controls;
        } else {
          _roomControls = _removeStageRequest(_roomControls, request);
        }
        _status = approve
            ? '${_stageRequestName(request)} can join the stage.'
            : '${_stageRequestName(request)} remains audience.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) {
        setState(() => _stageActionIds.remove(actionKey));
      }
    }
  }

  void _togglePanel(String panel) {
    if (panel == 'quick-chat') {
      _openQuickChat();
      return;
    }
    final opening = _activePanel != panel;
    setState(() {
      _activePanel = opening ? panel : null;
      _quickChatOpen = false;
    });
    _quickChatFocus.unfocus();
    if (opening && panel == 'chat' && _chatMessages.isEmpty) {
      unawaited(_loadRoomMessages());
    }
    if (opening && panel == 'ops') unawaited(_loadRoomControls(quiet: true));
    if (opening) _scrollPanelIntoView();
  }

  Future<void> _showRoomMenuSheet() async {
    if (_activePanel != null || _quickChatOpen) {
      setState(() {
        _activePanel = null;
        _quickChatOpen = false;
      });
      _quickChatFocus.unfocus();
    }

    if (_roomControls == null && !_controlsLoading) {
      unawaited(_loadRoomControls(quiet: true));
    }

    final action = await showModalBottomSheet<_RoomMenuAction>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: const Color.fromRGBO(0, 0, 0, 0.16),
      builder: (context) => _RoomMenuActionSheet(
        room: widget.room,
        controls: _roomControls,
        loading: _controlsLoading,
      ),
    );
    if (!mounted || action == null) return;
    await _handleRoomMenuAction(action);
  }

  Future<void> _handleRoomMenuAction(_RoomMenuAction action) async {
    switch (action) {
      case _RoomMenuAction.micCount:
        await _changeRoomMicCount();
        break;
      case _RoomMenuAction.lock:
        await _toggleRoomLock();
        break;
      case _RoomMenuAction.password:
        await _changeRoomPassword();
        break;
      case _RoomMenuAction.theme:
        await _changeRoomTheme();
        break;
      case _RoomMenuAction.share:
        await _copyRoomInvite();
        break;
      case _RoomMenuAction.admin:
        _togglePanel('ops');
        break;
      case _RoomMenuAction.clearComments:
        await _clearRoomComments();
        break;
      case _RoomMenuAction.gatherFollowers:
        await _copyRoomInvite(
          statusMessage: 'Follower invite copied.',
          eventMessage: 'Follower invite copied.',
        );
        break;
    }
  }

  Future<void> _copyRoomInvite({
    String statusMessage = 'Room invite copied.',
    String eventMessage = 'Room invite copied.',
  }) async {
    final invite = [
      widget.room.name,
      if (widget.room.description.trim().isNotEmpty) widget.room.description,
      'Room ID: ${widget.room.id}',
    ].join('\n');
    await Clipboard.setData(ClipboardData(text: invite));
    if (!mounted) return;
    setState(() => _status = statusMessage);
    _addEvent(eventMessage);
  }

  void _openQuickChat() {
    if (!widget.room.chatEnabled) {
      setState(() => _status = 'Chat is disabled in this room.');
      return;
    }
    setState(() {
      _activePanel = null;
      _quickChatOpen = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _quickChatFocus.requestFocus();
      SystemChannels.textInput.invokeMethod<void>('TextInput.show');
    });
  }

  void _scrollPanelIntoView() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
    });
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

  Future<void> _saveRoomControls({
    required String saving,
    required String done,
    required Future<Map<String, dynamic>> Function() request,
  }) async {
    if (_controlsLoading) return;
    setState(() {
      _controlsLoading = true;
      _status = saving;
    });

    try {
      final controls = await request();
      if (!mounted) return;
      setState(() {
        _roomControls = controls;
        _status = done;
      });
      _addEvent(done);
    } catch (error) {
      if (!mounted) return;
      final message = apiErrorMessage(error);
      setState(() => _status = message);
      _addEvent(message);
    } finally {
      if (mounted) setState(() => _controlsLoading = false);
    }
  }

  Future<void> _changeRoomMicCount() async {
    final room = _mapValue(_roomControls?['room']);
    final current =
        _intValue(room?['max_mic_count']) ?? widget.room.maxMicCount;
    final package = _mapValue(_roomControls?['package']);
    final allowedCounts = _intList(package?['allowed_mic_counts']);
    final maxPackageMic = _intValue(package?['max_mic_count']) ?? 20;
    final planName = package?['plan_name']?.toString() ?? 'Current package';
    final options = _micLayoutOptions(
      allowedCounts: allowedCounts,
      current: current,
      maxPackageMic: maxPackageMic,
    );
    final nextValue = await Navigator.of(context).push<int>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (context) =>
            _MicCountChooserScreen(current: current, options: options),
      ),
    );
    if (nextValue == null) return;
    if (nextValue < 1 || nextValue > maxPackageMic) {
      setState(
        () => _status = '$planName allows up to $maxPackageMic mic seats.',
      );
      return;
    }

    await _saveRoomControls(
      saving: 'Saving mic seat count...',
      done: 'Mic seat count updated.',
      request: () =>
          widget.api.updateRoomControls(widget.room.id, maxMicCount: nextValue),
    );
  }

  Future<void> _toggleRoomLock() async {
    final room = _mapValue(_roomControls?['room']);
    final privacy =
        room?['privacy_type']?.toString() ?? widget.room.privacyType;
    if (privacy == 'password') {
      await _saveRoomControls(
        saving: 'Unlocking room...',
        done: 'Room unlocked.',
        request: () => widget.api.updateRoomControls(
          widget.room.id,
          privacyType: 'public',
        ),
      );
      return;
    }

    await _changeRoomPassword();
  }

  Future<void> _changeRoomPassword() async {
    final controller = TextEditingController();
    final password = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Password'),
        content: TextField(
          controller: controller,
          autofocus: true,
          obscureText: true,
          keyboardType: TextInputType.visiblePassword,
          decoration: const InputDecoration(labelText: 'Room password'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) => controller.dispose());
    if (password == null) return;
    if (password.length < 4) {
      setState(() => _status = 'Room password must be at least 4 characters.');
      return;
    }

    await _saveRoomControls(
      saving: 'Saving room password...',
      done: 'Room password updated.',
      request: () => widget.api.updateRoomControls(
        widget.room.id,
        privacyType: 'password',
        password: password,
      ),
    );
  }

  Future<void> _changeRoomTheme() async {
    final theme = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Theme'),
        children: [
          for (final option in const ['neon', 'midnight', 'studio', 'mint'])
            SimpleDialogOption(
              onPressed: () => Navigator.of(context).pop(option),
              child: Text(option),
            ),
        ],
      ),
    );
    if (theme == null) return;

    await _saveRoomControls(
      saving: 'Saving room theme...',
      done: 'Room theme updated.',
      request: () =>
          widget.api.updateRoomControls(widget.room.id, theme: theme),
    );
  }

  Future<void> _toggleRoomSeat(Map<String, dynamic> seat) async {
    final seatNumber = _intValue(seat['seat_number']);
    if (seatNumber == null) return;
    final locked = _signalBool(seat['locked']);
    await _saveRoomControls(
      saving: locked ? 'Unlocking mic seat...' : 'Locking mic seat...',
      done: locked ? 'Mic seat unlocked.' : 'Mic seat locked.',
      request: () => widget.api.updateRoomSeat(
        widget.room.id,
        seatNumber,
        locked: !locked,
      ),
    );
  }

  Future<void> _toggleAllRoomSeats(bool locked) async {
    await _saveRoomControls(
      saving: locked
          ? 'Locking all mic seats...'
          : 'Unlocking all mic seats...',
      done: locked ? 'All mic seats locked.' : 'All mic seats unlocked.',
      request: () =>
          widget.api.updateAllRoomSeats(widget.room.id, locked: locked),
    );
  }

  Future<void> _assignRoomAdmin() async {
    final users = _mapList(_roomControls?['assignable_users']);
    final roles = _mapList(_roomControls?['roles']);
    final assignedUserIds = roles
        .map((role) => _intValue(role['user_id']))
        .whereType<int>()
        .toSet();
    final availableUsers = users
        .where((user) {
          final userId = _intValue(user['id']);
          return userId != null && !assignedUserIds.contains(userId);
        })
        .take(24)
        .toList();
    if (availableUsers.isEmpty) {
      setState(() => _status = 'No users available to assign as room admin.');
      return;
    }

    final selectedUser = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Admin'),
        children: [
          for (final user in availableUsers)
            SimpleDialogOption(
              onPressed: () => Navigator.of(context).pop(user),
              child: Text(
                user['name']?.toString() ??
                    user['email']?.toString() ??
                    'User #${user['id']}',
              ),
            ),
        ],
      ),
    );
    final userId = _intValue(selectedUser?['id']);
    if (userId == null) return;

    await _saveRoomControls(
      saving: 'Assigning room admin...',
      done: 'Room admin assigned.',
      request: () =>
          widget.api.assignRoomRole(widget.room.id, userId, role: 'admin'),
    );
  }

  Future<void> _removeRoomRole(Map<String, dynamic> role) async {
    final userId = _intValue(role['user_id']);
    if (userId == null) return;

    await _saveRoomControls(
      saving: 'Removing room admin...',
      done: 'Room admin removed.',
      request: () => widget.api.removeRoomRole(widget.room.id, userId),
    );
  }

  Future<void> _clearRoomComments() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear comments history'),
        content: const Text('This removes the visible room comments history.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Clear'),
          ),
        ],
      ),
    );
    if (confirmed != true || _controlsLoading) return;

    setState(() {
      _controlsLoading = true;
      _status = 'Clearing room comments...';
    });
    try {
      await widget.api.clearRoomMessages(widget.room.id);
      if (!mounted) return;
      setState(() {
        _chatMessages.clear();
        _status = 'Room comments history cleared.';
      });
      _addEvent('Room comments history cleared.');
    } catch (error) {
      if (!mounted) return;
      final message = apiErrorMessage(error);
      setState(() => _status = message);
      _addEvent(message);
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
        _status = 'A room admin muted your microphone';
      });
      _applyLocalMediaState();
      return;
    }

    if (action == 'disable_camera') {
      setState(() {
        _cameraOn = false;
        _status = 'A room admin paused your camera';
      });
      _applyLocalMediaState();
      return;
    }

    if (action == 'kick' || action == 'ban') {
      await _disconnectAfterModeration(
        action == 'ban'
            ? 'You were banned from this room.'
            : 'A room admin removed you from the room.',
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
      if (mounted) {
        setState(() => _chatLoading = false);
        if (_activePanel == 'chat') _scrollPanelIntoView();
      }
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

  Future<void> _sendReaction(String reaction) async {
    if (_chatSending) return;
    if (!widget.room.chatEnabled) {
      setState(() => _status = 'Chat is disabled in this room.');
      return;
    }
    if (!_joined) {
      setState(() => _status = 'Join the room before sending a reaction.');
      return;
    }
    await _sendRoomMessage(body: reaction);
  }

  Future<void> _sendPictureMessage() async {
    if (_chatSending) return;
    if (!widget.room.chatEnabled) {
      setState(() => _status = 'Chat is disabled in this room.');
      return;
    }
    if (!_joined) {
      setState(() => _status = 'Join the room before sending a picture.');
      return;
    }
    final image = await _imagePicker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 78,
      maxWidth: 1600,
      maxHeight: 1600,
    );
    if (image == null) {
      if (mounted) _quickChatFocus.requestFocus();
      return;
    }
    final bytes = await image.readAsBytes();
    if (bytes.length > 3.7 * 1024 * 1024) {
      if (!mounted) return;
      setState(() => _status = 'Photo must be smaller than 5 MB.');
      _quickChatFocus.requestFocus();
      return;
    }
    final mediaUrl =
        'data:${_imageMimeType(image.name)};base64,${base64Encode(bytes)}';
    await _sendRoomMessage(
      body: 'Photo shared',
      messageType: 'image',
      mediaUrl: mediaUrl,
    );
  }

  void _selectYouTubeVideo(_YouTubeChoice video) {
    setState(() {
      _youTubeConnected = true;
      _youTubeTab = video.tab;
      _selectedYouTube = video;
      _status = video.tab == 'music'
          ? 'Playing YouTube Music: ${video.title}'
          : 'Playing YouTube video: ${video.title}';
      _activePanel = null;
    });
  }

  void _connectYouTube() {
    setState(() {
      _youTubeConnected = true;
      _youTubeTab = 'music';
      _youTubeFilter = 'All';
      _status = 'YouTube connected. Music is ready for this room.';
    });
  }

  void _changeYouTubeTab(String tab) {
    setState(() {
      _youTubeConnected = true;
      _youTubeTab = tab;
      _youTubeFilter = 'All';
      _status = tab == 'music'
          ? 'YouTube Music is ready.'
          : 'YouTube video is ready.';
    });
  }

  void _changeYouTubeFilter(String filter) {
    setState(() {
      _youTubeConnected = true;
      _youTubeFilter = filter;
    });
  }

  Future<void> _openYouTubeSearch() async {
    final query = _youTubeTab == 'music'
        ? 'YouTube Music live room mix'
        : 'YouTube live room music video';
    final uri = Uri.https('www.youtube.com', '/results', {
      'search_query': query,
    });
    await _openYouTubeUri(
      uri,
      fallbackStatus: 'Could not open YouTube search.',
    );
  }

  Future<void> _openSelectedYouTube() async {
    final selected = _selectedYouTube;
    if (selected == null) {
      _togglePanel('youtube');
      return;
    }
    await _openYouTubeChoice(selected);
  }

  Future<void> _openYouTubeChoice(_YouTubeChoice choice) async {
    await _openYouTubeUri(
      Uri.parse(choice.url),
      successStatus: 'Opened ${choice.title} in YouTube.',
      fallbackStatus: 'Could not open ${choice.title}.',
    );
  }

  Future<void> _openYouTubeUri(
    Uri uri, {
    String successStatus = 'Opening YouTube...',
    String fallbackStatus = 'Could not open YouTube.',
  }) async {
    setState(() {
      _youTubeConnected = true;
      _youTubeOpening = true;
      _status = 'Opening YouTube...';
    });
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) throw Exception('No app can open $uri');
      if (mounted) setState(() => _status = successStatus);
    } catch (_) {
      if (mounted) {
        setState(() {
          _status = '$fallbackStatus Check YouTube or browser availability.';
        });
      }
    } finally {
      if (mounted) setState(() => _youTubeOpening = false);
    }
  }

  Future<void> _sendRoomMessage({
    required String body,
    String messageType = 'text',
    String mediaUrl = '',
  }) async {
    setState(() {
      _chatSending = true;
      _status = 'Sending message...';
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
        if (!_quickChatOpen) _activePanel = 'chat';
        _status = 'Message sent';
      });
      if (_quickChatOpen) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _quickChatFocus.requestFocus();
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _chatSending = false);
    }
  }

  Future<void> _deleteChatMessage(Map<String, dynamic> message) async {
    final messageId = _chatMessageId(message);
    if (messageId == null || _chatSending) return;
    if (!_isOwnChatMessage(message, widget.user)) {
      setState(() => _status = 'Only your own messages can be unsent.');
      return;
    }

    setState(() {
      _chatSending = true;
      _status = 'Unsending message...';
    });

    try {
      final data = await widget.api.deleteRoomMessage(messageId);
      _removeChatMessage(messageId);
      if (data['realtime_broadcasted'] != true) {
        unawaited(
          _signaling.emitChatMessageDeleted(messageId: messageId).catchError((
            error,
          ) {
            _addEvent('Message unsent; realtime sync failed: $error');
            return <String, dynamic>{};
          }),
        );
      }
      if (!mounted) return;
      setState(() {
        _activePanel = 'chat';
        _status = data['deleted_for_everyone'] == false
            ? 'Message hidden from your chat.'
            : 'Message unsent.';
      });
      _addEvent('Message unsent.');
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

  void _removeChatMessage(int messageId) {
    if (!mounted) return;
    setState(() {
      _chatMessages.removeWhere(
        (message) => _chatMessageId(message) == messageId,
      );
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
      canPop: !_joined && !_leaving && !_quickChatOpen && _activePanel == null,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (_quickChatOpen) {
          setState(() => _quickChatOpen = false);
          _quickChatFocus.unfocus();
          return;
        }
        if (_activePanel != null) {
          setState(() => _activePanel = null);
          return;
        }
        if (_joined) _leave(popAfterLeave: true);
      },
      child: RtcMobileFrame(
        backgroundColor: RtcPalette.stageBg,
        child: _LiveRoomBackdrop(
          child: SafeArea(
            child: Stack(
              children: [
                Positioned.fill(
                  child: ListView(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 76),
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
                        onOpenTools: _showRoomMenuSheet,
                      ),
                      const SizedBox(height: 8),
                      _LiveStatusRail(
                        room: widget.room,
                        joined: _joined,
                        canPublishStage: _canPublishStage,
                        micOn: _micOn,
                        cameraOn: _cameraOn,
                        screenSharing: _screenSharing,
                        peerCount: _peers.length,
                        chatCount: _chatMessages.length,
                        stageRequestStatus: _stageRequestStatus,
                        status: _status,
                        onOpenTools: _togglePanel,
                      ),
                      const SizedBox(height: 8),
                      _LiveStagePanel(
                        room: widget.room,
                        user: widget.user,
                        roomControls: _roomControls,
                        peers: _peers,
                        chatMessages: _chatMessages,
                        peerStates: _peerStates,
                        selectedYouTube: _selectedYouTube,
                        youTubeConnected: _youTubeConnected,
                        youTubeOpening: _youTubeOpening,
                        joined: _joined,
                        joining: _joining,
                        micOn: _micOn,
                        cameraOn: _cameraOn,
                        canPublishStage: _canPublishStage,
                        stageRequestStatus: _stageRequestStatus,
                        stageRequestsEnabled: _stageRequestsEnabled,
                        stageRequestSending: _stageRequestSending,
                        status: _status,
                        onJoin: _joining || _joined ? null : _join,
                        onToggleMic:
                            _joined && !_mediaUpdating && !_stageRequestSending
                            ? _toggleMic
                            : null,
                        onRequestStage: _joined && !_canPublishStage
                            ? _requestStageJoin
                            : null,
                        onCancelStageRequest: _joined && !_canPublishStage
                            ? _cancelStageJoinRequest
                            : null,
                        onSelectYouTube: () => _togglePanel('youtube'),
                        onOpenYouTube: _openSelectedYouTube,
                      ),
                      if (_activePanel != null) ...[
                        const SizedBox(height: 10),
                        _LiveToolPanel(
                          panel: _activePanel!,
                          room: widget.room,
                          user: widget.user,
                          joined: _joined,
                          passwordController: _roomPassword,
                          chatController: _chatComposer,
                          chatMessages: _chatMessages,
                          chatLoading: _chatLoading,
                          chatSending: _chatSending,
                          audioVolume: _roomAudioVolume,
                          roomControls: _roomControls,
                          controlsLoading: _controlsLoading,
                          moderatingUserIds: _moderatingUserIds,
                          screenSharing: _screenSharing,
                          canPublishStage: _canPublishStage,
                          stageActionIds: _stageActionIds,
                          status: _status,
                          onJoin: _joining || _joined ? null : _join,
                          onSendChat: _sendChatMessage,
                          onSendReaction: _sendReaction,
                          onSendPicture: _sendPictureMessage,
                          onChangeAudioVolume: (value) =>
                              setState(() => _roomAudioVolume = value),
                          youtubeConnected: _youTubeConnected,
                          youtubeOpening: _youTubeOpening,
                          youtubeTab: _youTubeTab,
                          youtubeFilter: _youTubeFilter,
                          onConnectYouTube: _connectYouTube,
                          onChangeYouTubeTab: _changeYouTubeTab,
                          onChangeYouTubeFilter: _changeYouTubeFilter,
                          onOpenYouTubeSearch: _openYouTubeSearch,
                          onOpenYouTubeChoice: _openYouTubeChoice,
                          onSelectYouTube: _selectYouTubeVideo,
                          onDeleteChatMessage: _deleteChatMessage,
                          onLoadControls: () => _loadRoomControls(),
                          onChangeRoomMicCount: _changeRoomMicCount,
                          onToggleRoomLock: _toggleRoomLock,
                          onChangeRoomPassword: _changeRoomPassword,
                          onChangeRoomTheme: _changeRoomTheme,
                          onToggleRoomSeat: _toggleRoomSeat,
                          onToggleAllRoomSeats: _toggleAllRoomSeats,
                          onAssignRoomAdmin: _assignRoomAdmin,
                          onRemoveRoomRole: _removeRoomRole,
                          onClearRoomComments: _clearRoomComments,
                          onModerateParticipant: _moderateParticipant,
                          onToggleScreenSharing:
                              widget.room.screenShareEnabled &&
                                  _joined &&
                                  _canPublishStage &&
                                  !_mediaUpdating
                              ? () => _syncMediaState(
                                  micOn: _micOn,
                                  cameraOn: _cameraOn,
                                  screenSharing: !_screenSharing,
                                )
                              : null,
                          onApplyStagePermission: _applyStagePermission,
                        ),
                      ],
                    ],
                  ),
                ),
                if (!_quickChatOpen)
                  Positioned(
                    left: 10,
                    right: 10,
                    bottom: 8,
                    child: _LiveControlBar(
                      joined: _joined,
                      mediaUpdating: _mediaUpdating,
                      micOn: _micOn,
                      audioVolume: _roomAudioVolume,
                      room: widget.room,
                      canPublishStage: _canPublishStage,
                      stageRequestStatus: _stageRequestStatus,
                      stageRequestsEnabled: _stageRequestsEnabled,
                      stageRequestSending: _stageRequestSending,
                      onToggleMic:
                          _joined && !_mediaUpdating && !_stageRequestSending
                          ? _toggleMic
                          : null,
                      onRequestStage: _joined && !_canPublishStage
                          ? _requestStageJoin
                          : null,
                      onCancelStageRequest: _joined && !_canPublishStage
                          ? _cancelStageJoinRequest
                          : null,
                      onOpenTools: (panel) {
                        if (panel == 'ops') {
                          unawaited(_showRoomMenuSheet());
                          return;
                        }
                        _togglePanel(panel);
                      },
                    ),
                  ),
                if (_quickChatOpen)
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 180),
                    curve: Curves.easeOutCubic,
                    left: 8,
                    right: 8,
                    bottom: MediaQuery.viewInsetsOf(context).bottom + 8,
                    child: _QuickChatComposer(
                      room: widget.room,
                      joined: _joined,
                      controller: _chatComposer,
                      focusNode: _quickChatFocus,
                      sending: _chatSending,
                      onSend: _sendChatMessage,
                      onAttach: _sendPictureMessage,
                      onOpenMenu: _showRoomMenuSheet,
                    ),
                  ),
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
            Color(0xFF220A3F),
            Color(0xFF5822A0),
            Color(0xFF36105F),
            Color(0xFF180719),
          ],
          stops: [0, 0.32, 0.68, 1],
        ),
      ),
      child: Stack(
        children: [
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
    return Container(
      padding: const EdgeInsets.fromLTRB(6, 6, 6, 7),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        gradient: const LinearGradient(
          colors: [Color(0xFF36110B), Color(0xFF8A2416)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(0, 0, 0, 0.22),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          _LiveCircleIconButton(
            tooltip: 'Back',
            icon: Icons.chevron_left_rounded,
            onPressed: onBack,
            transparent: true,
            size: 34,
          ),
          const SizedBox(width: 5),
          InitialAvatar(user: user, size: 40),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  room.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: RtcPalette.text,
                    fontSize: 14,
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
                        'ID:${room.id} · ${joined ? 'Live' : 'Ready'} · ${_modeLabel(rtcMode)} · $liveCount',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color.fromRGBO(255, 255, 255, 0.76),
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
              size: 32,
            ),
          const SizedBox(width: 5),
          _LiveCircleIconButton(
            tooltip: 'Share room',
            icon: Icons.ios_share_rounded,
            onPressed: onOpenTools,
            size: 32,
          ),
          const SizedBox(width: 5),
          _LiveCircleIconButton(
            tooltip: 'Room menu',
            icon: Icons.more_horiz_rounded,
            onPressed: onOpenTools,
            size: 32,
          ),
          const SizedBox(width: 5),
          _LiveCircleIconButton(
            tooltip: 'Leave room',
            icon: Icons.power_settings_new_rounded,
            onPressed: onBack,
            size: 32,
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

class _LiveStatusRail extends StatelessWidget {
  const _LiveStatusRail({
    required this.room,
    required this.joined,
    required this.canPublishStage,
    required this.micOn,
    required this.cameraOn,
    required this.screenSharing,
    required this.peerCount,
    required this.chatCount,
    required this.stageRequestStatus,
    required this.status,
    required this.onOpenTools,
  });

  final Room room;
  final bool joined;
  final bool canPublishStage;
  final bool micOn;
  final bool cameraOn;
  final bool screenSharing;
  final int peerCount;
  final int chatCount;
  final String stageRequestStatus;
  final String status;
  final ValueChanged<String> onOpenTools;

  @override
  Widget build(BuildContext context) {
    final roleLabel = !joined
        ? 'Not joined'
        : canPublishStage
        ? 'On stage'
        : stageRequestStatus == 'pending'
        ? 'Request pending'
        : 'Audience';
    final mediaLabel = !joined
        ? 'Idle'
        : canPublishStage
        ? '${micOn ? 'Mic on' : 'Mic off'} · ${cameraOn ? 'Cam on' : 'Cam off'}'
        : 'Receive-only';
    final participantCount = peerCount + (joined ? 1 : 0);
    final railStatus = room.isLocked && !joined
        ? 'Locked room · access required'
        : status;

    final lowerStatus = railStatus.toLowerCase();
    final showInlineError =
        lowerStatus.contains('permission') ||
        lowerStatus.contains('failed') ||
        lowerStatus.contains('unreachable') ||
        lowerStatus.contains('invalid');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 29,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              _LiveMiniCommandChip(
                icon: Icons.refresh_rounded,
                label: 'Refresh',
                detail: railStatus,
                onTap: () => onOpenTools('chat'),
              ),
              _LiveMiniCommandChip(
                icon: Icons.graphic_eq_rounded,
                label: 'Voice',
                detail: mediaLabel,
                active: joined && (micOn || cameraOn),
                onTap: () => onOpenTools('audio'),
              ),
              _LiveMiniCommandChip(
                icon: Icons.playlist_play_rounded,
                label: 'Play List',
                detail: roleLabel,
                onTap: () => onOpenTools(
                  _supportsYouTubeRoom(room) ? 'youtube' : 'audio',
                ),
              ),
              _LiveMiniCommandChip(
                icon: Icons.groups_2_outlined,
                label: '$participantCount',
                detail: 'participants',
                active: peerCount > 0,
              ),
              _LiveMiniCommandChip(
                icon: Icons.chat_bubble_outline_rounded,
                label: room.chatEnabled ? '$chatCount chat' : 'Chat off',
                detail: room.chatEnabled ? 'live chat' : 'disabled',
                active: room.chatEnabled && chatCount > 0,
                onTap: room.chatEnabled ? () => onOpenTools('chat') : null,
              ),
              if (screenSharing)
                const _LiveMiniCommandChip(
                  icon: Icons.screen_share_outlined,
                  label: 'Sharing',
                  detail: 'screen',
                  active: true,
                ),
            ],
          ),
        ),
        if (showInlineError) ...[
          const SizedBox(height: 6),
          Text(
            railStatus,
            style: const TextStyle(
              color: RtcPalette.red,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ],
    );
  }
}

class _LiveMiniCommandChip extends StatelessWidget {
  const _LiveMiniCommandChip({
    required this.icon,
    required this.label,
    required this.detail,
    this.active = false,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String detail;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: detail,
      child: Padding(
        padding: const EdgeInsets.only(right: 6),
        child: Material(
          color: active
              ? const Color.fromRGBO(255, 255, 255, 0.14)
              : const Color.fromRGBO(0, 0, 0, 0.24),
          borderRadius: BorderRadius.circular(5),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(5),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
              decoration: BoxDecoration(
                border: Border.all(
                  color: const Color.fromRGBO(255, 255, 255, 0.14),
                ),
                borderRadius: BorderRadius.circular(5),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    icon,
                    size: 13,
                    color: active ? RtcPalette.mint : Colors.white,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                      height: 1,
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

class _LiveStagePanel extends StatelessWidget {
  const _LiveStagePanel({
    required this.room,
    required this.user,
    required this.roomControls,
    required this.peers,
    required this.chatMessages,
    required this.peerStates,
    required this.selectedYouTube,
    required this.youTubeConnected,
    required this.youTubeOpening,
    required this.joined,
    required this.joining,
    required this.micOn,
    required this.cameraOn,
    required this.canPublishStage,
    required this.stageRequestStatus,
    required this.stageRequestsEnabled,
    required this.stageRequestSending,
    required this.status,
    required this.onJoin,
    required this.onToggleMic,
    required this.onRequestStage,
    required this.onCancelStageRequest,
    required this.onSelectYouTube,
    required this.onOpenYouTube,
  });

  final Room room;
  final AppUser user;
  final Map<String, dynamic>? roomControls;
  final List<Map<String, dynamic>> peers;
  final List<Map<String, dynamic>> chatMessages;
  final Map<String, String> peerStates;
  final _YouTubeChoice? selectedYouTube;
  final bool youTubeConnected;
  final bool youTubeOpening;
  final bool joined;
  final bool joining;
  final bool micOn;
  final bool cameraOn;
  final bool canPublishStage;
  final String stageRequestStatus;
  final bool stageRequestsEnabled;
  final bool stageRequestSending;
  final String status;
  final VoidCallback? onJoin;
  final VoidCallback? onToggleMic;
  final VoidCallback? onRequestStage;
  final VoidCallback? onCancelStageRequest;
  final VoidCallback onSelectYouTube;
  final VoidCallback onOpenYouTube;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_supportsYouTubeRoom(room)) ...[
          _LiveYouTubeStage(
            video: selectedYouTube,
            connected: youTubeConnected,
            opening: youTubeOpening,
            onSelect: onSelectYouTube,
            onOpen: onOpenYouTube,
          ),
          const SizedBox(height: 10),
        ],
        _LiveVoiceRoomHeader(
          room: room,
          user: user,
          peerCount: peers.length,
          joined: joined,
          joining: joining,
          micOn: micOn,
          cameraOn: cameraOn,
          canPublishStage: canPublishStage,
          onJoin: onJoin,
        ),
        const SizedBox(height: 10),
        _StageSeatGrid(
          room: room,
          user: user,
          roomControls: roomControls,
          peers: peers,
          peerStates: peerStates,
          joined: joined,
          micOn: micOn,
          canPublishStage: canPublishStage,
          onJoin: onJoin,
          onToggleMic: onToggleMic,
        ),
        const SizedBox(height: 10),
        _LiveGuideRow(
          room: room,
          joined: joined,
          canPublishStage: canPublishStage,
          stageRequestStatus: stageRequestStatus,
          stageRequestsEnabled: stageRequestsEnabled,
          stageRequestSending: stageRequestSending,
          onJoin: onJoin,
          onRequestStage: onRequestStage,
          onCancelStageRequest: onCancelStageRequest,
        ),
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
          canPublishStage: canPublishStage,
        ),
      ],
    );
  }
}

class _LiveYouTubeStage extends StatelessWidget {
  const _LiveYouTubeStage({
    required this.video,
    required this.connected,
    required this.opening,
    required this.onSelect,
    required this.onOpen,
  });

  final _YouTubeChoice? video;
  final bool connected;
  final bool opening;
  final VoidCallback onSelect;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final selected = video;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onSelect,
        child: Container(
          height: 140,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.1)),
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF321333), Color(0xFF130814)],
            ),
            boxShadow: const [
              BoxShadow(
                color: Color.fromRGBO(0, 0, 0, 0.24),
                blurRadius: 16,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (selected != null)
                Image.asset(selected.asset, fit: BoxFit.cover)
              else
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(
                      center: Alignment(0, -0.25),
                      radius: 0.92,
                      colors: [
                        Color.fromRGBO(255, 172, 78, 0.28),
                        Color.fromRGBO(90, 22, 78, 0.48),
                        Color.fromRGBO(9, 4, 20, 0.9),
                      ],
                    ),
                  ),
                ),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Color.fromRGBO(0, 0, 0, 0.18),
                      Color.fromRGBO(0, 0, 0, 0.5),
                    ],
                  ),
                ),
              ),
              Center(
                child: selected == null
                    ? Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Padding(
                            padding: EdgeInsets.symmetric(horizontal: 24),
                            child: Text(
                              connected
                                  ? 'Choose YouTube music or video to play for this room'
                                  : 'Connect YouTube to choose room music or video',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                height: 1.2,
                              ),
                            ),
                          ),
                          const SizedBox(height: 14),
                          _YouTubeSelectButton(
                            label: connected
                                ? 'Select video/music'
                                : 'Connect YouTube',
                            onPressed: onSelect,
                          ),
                        ],
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 46,
                            height: 46,
                            decoration: const BoxDecoration(
                              color: Color.fromRGBO(255, 255, 255, 0.9),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.play_arrow_rounded,
                              color: Color(0xFFFF1F1F),
                              size: 34,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            child: Text(
                              selected.title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w900,
                                height: 1.12,
                              ),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _YouTubeSelectButton(
                                label: 'Change',
                                onPressed: onSelect,
                              ),
                              _YouTubeSelectButton(
                                label: opening ? 'Opening...' : 'Open YouTube',
                                onPressed: opening ? null : onOpen,
                              ),
                            ],
                          ),
                        ],
                      ),
              ),
              if (selected != null)
                Positioned(
                  left: 10,
                  bottom: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.58),
                      borderRadius: BorderRadius.circular(5),
                    ),
                    child: Text(
                      selected.duration,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _YouTubeSelectButton extends StatelessWidget {
  const _YouTubeSelectButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.smart_display_rounded, size: 17),
      label: Text(label),
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF3B1B22),
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      ),
    );
  }
}

class _LiveVoiceRoomHeader extends StatelessWidget {
  const _LiveVoiceRoomHeader({
    required this.room,
    required this.user,
    required this.peerCount,
    required this.joined,
    required this.joining,
    required this.micOn,
    required this.cameraOn,
    required this.canPublishStage,
    required this.onJoin,
  });

  final Room room;
  final AppUser user;
  final int peerCount;
  final bool joined;
  final bool joining;
  final bool micOn;
  final bool cameraOn;
  final bool canPublishStage;
  final VoidCallback? onJoin;

  @override
  Widget build(BuildContext context) {
    final groupCount = room.activeParticipants + peerCount + (joined ? 1 : 0);
    final statusText = joined
        ? canPublishStage
              ? (micOn ? 'You can talk now' : 'Mic is muted')
              : 'Listening. Tap a seat to talk'
        : 'Join voice room to listen and chat';
    return Row(
      children: [
        Container(
          height: 28,
          padding: const EdgeInsets.symmetric(horizontal: 9),
          decoration: BoxDecoration(
            color: const Color.fromRGBO(86, 53, 166, 0.72),
            borderRadius: BorderRadius.circular(RtcRadius.pill),
            border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.2)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                cameraOn ? Icons.videocam_off_rounded : Icons.group_rounded,
                color: Colors.white,
                size: 14,
              ),
              const SizedBox(width: 5),
              Text(
                'Group $groupCount',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            statusText,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color.fromRGBO(255, 255, 255, 0.72),
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const SizedBox(width: 8),
        _VoiceAudienceAvatar(label: room.displayHost, active: true),
        const SizedBox(width: 5),
        _VoiceAudienceAvatar(label: user.name, active: joined),
        const SizedBox(width: 5),
        Material(
          color: const Color.fromRGBO(255, 255, 255, 0.14),
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: joined || joining ? null : onJoin,
            child: SizedBox(
              width: 30,
              height: 30,
              child: Icon(
                joining ? Icons.hourglass_top_rounded : Icons.chevron_right,
                color: Colors.white,
                size: 19,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _VoiceAudienceAvatar extends StatelessWidget {
  const _VoiceAudienceAvatar({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 28,
      height: 28,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: active
            ? const Color.fromRGBO(255, 255, 255, 0.92)
            : const Color.fromRGBO(255, 255, 255, 0.22),
        border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.24)),
      ),
      child: Text(
        _initials(label),
        style: TextStyle(
          color: active ? const Color(0xFF40215F) : Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _StageSeatGrid extends StatelessWidget {
  const _StageSeatGrid({
    required this.room,
    required this.user,
    required this.roomControls,
    required this.peers,
    required this.peerStates,
    required this.joined,
    required this.micOn,
    required this.canPublishStage,
    required this.onJoin,
    required this.onToggleMic,
  });

  final Room room;
  final AppUser user;
  final Map<String, dynamic>? roomControls;
  final List<Map<String, dynamic>> peers;
  final Map<String, String> peerStates;
  final bool joined;
  final bool micOn;
  final bool canPublishStage;
  final VoidCallback? onJoin;
  final VoidCallback? onToggleMic;

  @override
  Widget build(BuildContext context) {
    final visibleSeatCount = _stageSeatCountFor(room, roomControls);
    final lockedSeatNumbers = _lockedStageSeatNumbers(roomControls);
    final useAdminAvatar = RtcAssets.shouldUseAdminAvatar(user);
    final seats = <Widget>[];
    if (!joined || canPublishStage) {
      seats.add(
        _ReferenceStageSeat(
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
          asset: joined && useAdminAvatar
              ? RtcAssets.adminDashboardAvatar
              : null,
          onTap: joined && canPublishStage ? onToggleMic : onJoin,
        ),
      );
    } else {
      seats.add(
        _ReferenceStageSeat(
          number: 1,
          label: room.displayHost,
          state: RtcSeatState.occupied,
        ),
      );
    }

    final stagePeers = peers
        .where(_peerCanPublish)
        .take((visibleSeatCount - seats.length).clamp(0, visibleSeatCount));
    for (final peer in stagePeers) {
      final socketId = peer['socketId']?.toString();
      final label = _peerName(peer);
      final micEnabled = _signalBool(peer['micEnabled'], true);
      final stateLabel = socketId == null ? null : peerStates[socketId];
      seats.add(
        _ReferenceStageSeat(
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
      final seatNumber = seats.length + 1;
      final locked = lockedSeatNumbers.contains(seatNumber);
      seats.add(
        _ReferenceStageSeat(
          number: seatNumber,
          label: locked ? 'Locked seat' : 'Open seat',
          state: locked ? RtcSeatState.locked : RtcSeatState.open,
          onTap: locked
              ? null
              : joined
              ? onToggleMic
              : onJoin,
        ),
      );
    }

    return GridView.count(
      crossAxisCount: 4,
      mainAxisSpacing: 9,
      crossAxisSpacing: 9,
      childAspectRatio: 0.88,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: seats,
    );
  }
}

int _stageSeatCountFor(Room room, Map<String, dynamic>? controls) {
  final controlRoom = _mapValue(controls?['room']);
  final fromControls = _intValue(controlRoom?['max_mic_count']);
  final fromSeatSummary = _intValue(
    _mapValue(controls?['seat_summary'])?['total_count'],
  );
  final count = fromControls ?? fromSeatSummary ?? room.maxMicCount;
  return count.clamp(1, 20);
}

Set<int> _lockedStageSeatNumbers(Map<String, dynamic>? controls) {
  final seats = _mapList(controls?['seats']);
  return seats
      .where((seat) => _signalBool(seat['locked']))
      .map((seat) => _intValue(seat['seat_number']))
      .whereType<int>()
      .toSet();
}

class _ReferenceStageSeat extends StatelessWidget {
  const _ReferenceStageSeat({
    required this.number,
    required this.label,
    required this.state,
    this.image,
    this.asset,
    this.onTap,
  });

  final int number;
  final String label;
  final RtcSeatState state;
  final ImageProvider? image;
  final String? asset;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final occupied =
        state == RtcSeatState.occupied ||
        state == RtcSeatState.speaking ||
        state == RtcSeatState.muted;
    final active = state == RtcSeatState.speaking;
    final locked = state == RtcSeatState.locked;
    final open = state == RtcSeatState.open;
    return Semantics(
      button: onTap != null,
      label: occupied ? label : 'Seat $number',
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(4, 7, 4, 6),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: locked
                    ? const [Color(0xFF8560B6), Color(0xFF5C368F)]
                    : active
                    ? const [Color(0xFFFFC84A), Color(0xFF8E2E2C)]
                    : open
                    ? const [Color(0xFF8B5FD0), Color(0xFF5F35A0)]
                    : const [Color(0xFFA96FE0), Color(0xFF6D3AA2)],
              ),
              border: Border.all(
                color: locked
                    ? const Color.fromRGBO(255, 255, 255, 0.18)
                    : open
                    ? const Color.fromRGBO(255, 255, 255, 0.28)
                    : const Color.fromRGBO(255, 218, 115, 0.46),
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color.fromRGBO(0, 0, 0, 0.2),
                  blurRadius: 12,
                  offset: Offset(0, 5),
                ),
              ],
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color.fromRGBO(255, 255, 255, 0.13),
                    border: Border.all(
                      color: open
                          ? const Color.fromRGBO(255, 255, 255, 0.32)
                          : const Color.fromRGBO(255, 255, 255, 0.22),
                    ),
                  ),
                  child: occupied
                      ? RtcAvatarToken(
                          label: label,
                          image: image,
                          asset: asset,
                          size: 36,
                          borderRadius: RtcRadius.pill,
                        )
                      : Icon(
                          locked ? Icons.lock_rounded : Icons.mic_none_rounded,
                          size: 18,
                          color: const Color.fromRGBO(255, 255, 255, 0.78),
                        ),
                ),
                const SizedBox(height: 5),
                Text(
                  occupied ? label : 'No.$number',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color.fromRGBO(255, 255, 255, 0.78),
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    height: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LiveGuideRow extends StatelessWidget {
  const _LiveGuideRow({
    required this.room,
    required this.joined,
    required this.canPublishStage,
    required this.stageRequestStatus,
    required this.stageRequestsEnabled,
    required this.stageRequestSending,
    required this.onJoin,
    required this.onRequestStage,
    required this.onCancelStageRequest,
  });

  final Room room;
  final bool joined;
  final bool canPublishStage;
  final String stageRequestStatus;
  final bool stageRequestsEnabled;
  final bool stageRequestSending;
  final VoidCallback? onJoin;
  final VoidCallback? onRequestStage;
  final VoidCallback? onCancelStageRequest;

  @override
  Widget build(BuildContext context) {
    final pending = stageRequestStatus == 'pending';
    final action = !joined
        ? onJoin
        : canPublishStage
        ? null
        : pending
        ? onCancelStageRequest
        : stageRequestsEnabled
        ? onRequestStage
        : null;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF145B54), Color(0xFF2D6A2A)],
              ),
              borderRadius: BorderRadius.circular(3),
              border: Border.all(
                color: const Color.fromRGBO(0, 255, 204, 0.18),
              ),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.campaign_rounded,
                  color: Color(0xFF9CF7D6),
                  size: 14,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    room.description.isEmpty
                        ? 'Room notice: violators will be banned.'
                        : room.description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFFFFD06B),
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      height: 1.1,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 9),
        Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: stageRequestSending ? null : action,
            child: Container(
              width: 72,
              height: 56,
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
                stageRequestSending
                    ? Icons.hourglass_top_rounded
                    : !joined
                    ? Icons.login_rounded
                    : canPublishStage
                    ? Icons.graphic_eq_rounded
                    : pending
                    ? Icons.close_rounded
                    : Icons.record_voice_over_rounded,
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
    required this.canPublishStage,
  });

  final Room room;
  final AppUser user;
  final List<Map<String, dynamic>> peers;
  final List<Map<String, dynamic>> messages;
  final String status;
  final bool joined;
  final bool micOn;
  final bool cameraOn;
  final bool canPublishStage;

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
            message: canPublishStage
                ? '${micOn ? 'Mic on' : 'Mic off'} · ${cameraOn ? 'Camera on' : 'Camera off'}'
                : 'Audience · watching and listening',
            mine: true,
          ),
      ],
    );
  }
}

class _LiveControlBar extends StatelessWidget {
  const _LiveControlBar({
    required this.joined,
    required this.mediaUpdating,
    required this.micOn,
    required this.audioVolume,
    required this.room,
    required this.canPublishStage,
    required this.stageRequestStatus,
    required this.stageRequestsEnabled,
    required this.stageRequestSending,
    required this.onToggleMic,
    required this.onRequestStage,
    required this.onCancelStageRequest,
    required this.onOpenTools,
  });

  final bool joined;
  final bool mediaUpdating;
  final bool micOn;
  final double audioVolume;
  final Room room;
  final bool canPublishStage;
  final String stageRequestStatus;
  final bool stageRequestsEnabled;
  final bool stageRequestSending;
  final VoidCallback? onToggleMic;
  final VoidCallback? onRequestStage;
  final VoidCallback? onCancelStageRequest;
  final ValueChanged<String> onOpenTools;

  @override
  Widget build(BuildContext context) {
    final audienceMode = joined && !canPublishStage;
    final pending = stageRequestStatus == 'pending';
    final requestAction = pending ? onCancelStageRequest : onRequestStage;
    final micAction = audienceMode
        ? stageRequestSending || !stageRequestsEnabled && !pending
              ? null
              : requestAction
        : onToggleMic;
    final micIcon = audienceMode
        ? pending
              ? Icons.hourglass_top_rounded
              : Icons.record_voice_over_rounded
        : micOn
        ? Icons.mic
        : Icons.mic_off;
    final micTooltip = audienceMode
        ? pending
              ? 'Cancel mic request'
              : 'Request mic'
        : mediaUpdating
        ? 'Saving microphone'
        : micOn
        ? 'Turn microphone off'
        : 'Turn microphone on';
    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(18, 7, 33, 0.78),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.08)),
      ),
      child: Row(
        children: [
          _LiveBottomIconButton(
            tooltip: 'Room audio volume ${(audioVolume * 100).round()}%',
            icon: audioVolume == 0
                ? Icons.volume_off_rounded
                : audioVolume < 0.5
                ? Icons.volume_down_rounded
                : Icons.volume_up_rounded,
            active: audioVolume > 0,
            onPressed: () => onOpenTools('audio'),
          ),
          const SizedBox(width: 8),
          _LiveBottomIconButton(
            tooltip: micTooltip,
            icon: micIcon,
            active: micOn || pending,
            onPressed: mediaUpdating ? null : micAction,
          ),
          const SizedBox(width: 8),
          _LiveBottomIconButton(
            tooltip: room.chatEnabled ? 'Open live chat' : 'Live chat off',
            icon: Icons.chat_bubble_rounded,
            onPressed: room.chatEnabled
                ? () => onOpenTools('quick-chat')
                : null,
          ),
          const SizedBox(width: 8),
          _LiveBottomIconButton(
            tooltip: 'Open emoji',
            icon: Icons.emoji_emotions_rounded,
            onPressed: () => onOpenTools('emoji'),
          ),
          const Spacer(),
          _LiveBottomIconButton(
            tooltip: 'Open room menu',
            icon: Icons.menu_rounded,
            onPressed: () => onOpenTools('ops'),
          ),
        ],
      ),
    );
  }
}

class _LiveBottomIconButton extends StatelessWidget {
  const _LiveBottomIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.active = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final color = active ? RtcPalette.mint : Colors.white;
    return Tooltip(
      message: tooltip,
      child: Opacity(
        opacity: onPressed == null ? 0.42 : 1,
        child: Material(
          color: active
              ? const Color.fromRGBO(39, 215, 170, 0.16)
              : const Color.fromRGBO(255, 255, 255, 0.08),
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onPressed,
            child: SizedBox.square(
              dimension: 36,
              child: Icon(icon, color: color, size: 22),
            ),
          ),
        ),
      ),
    );
  }
}

class _QuickChatComposer extends StatelessWidget {
  const _QuickChatComposer({
    required this.room,
    required this.joined,
    required this.controller,
    required this.focusNode,
    required this.sending,
    required this.onSend,
    required this.onAttach,
    required this.onOpenMenu,
  });

  final Room room;
  final bool joined;
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool sending;
  final VoidCallback onSend;
  final VoidCallback onAttach;
  final VoidCallback onOpenMenu;

  @override
  Widget build(BuildContext context) {
    final enabled = joined && room.chatEnabled && !sending;
    return Material(
      color: Colors.white,
      elevation: 10,
      shadowColor: Colors.black.withValues(alpha: 0.22),
      borderRadius: BorderRadius.circular(6),
      child: Container(
        height: 44,
        padding: const EdgeInsets.fromLTRB(6, 5, 6, 5),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: const Color.fromRGBO(15, 23, 42, 0.08)),
        ),
        child: Row(
          children: [
            IconButton(
              tooltip: 'Send picture',
              onPressed: enabled ? onAttach : null,
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints.tightFor(width: 34, height: 34),
              icon: const Icon(
                Icons.image_outlined,
                color: RtcPalette.lobbyMuted,
                size: 22,
              ),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                enabled: enabled,
                autofocus: true,
                textInputAction: TextInputAction.send,
                onSubmitted: enabled ? (_) => onSend() : null,
                style: const TextStyle(
                  color: RtcPalette.lobbyInk,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
                decoration: InputDecoration(
                  hintText: room.chatEnabled
                      ? joined
                            ? 'Type a message...'
                            : 'Join room to chat'
                      : 'Chat is disabled',
                  hintStyle: const TextStyle(
                    color: Color(0xFFCBD5E1),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                  filled: true,
                  fillColor: const Color(0xFFF8FAFC),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 11,
                    vertical: 9,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(5),
                    borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(5),
                    borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(5),
                    borderSide: const BorderSide(color: RtcPalette.lobbyGold),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),
            FilledButton(
              onPressed: enabled ? onSend : null,
              style: FilledButton.styleFrom(
                backgroundColor: RtcPalette.lobbyGold,
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFE2E8F0),
                disabledForegroundColor: const Color(0xFF94A3B8),
                visualDensity: VisualDensity.compact,
                minimumSize: const Size(52, 32),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(5),
                ),
                textStyle: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
              child: Text(sending ? '...' : 'Send'),
            ),
            const SizedBox(width: 4),
            IconButton(
              tooltip: 'Open room menu',
              onPressed: onOpenMenu,
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints.tightFor(width: 34, height: 34),
              icon: const Icon(
                Icons.menu_rounded,
                color: RtcPalette.lobbyInk,
                size: 24,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LiveToolPanel extends StatelessWidget {
  const _LiveToolPanel({
    required this.panel,
    required this.room,
    required this.user,
    required this.joined,
    required this.passwordController,
    required this.chatController,
    required this.chatMessages,
    required this.chatLoading,
    required this.chatSending,
    required this.audioVolume,
    required this.roomControls,
    required this.controlsLoading,
    required this.moderatingUserIds,
    required this.screenSharing,
    required this.canPublishStage,
    required this.stageActionIds,
    required this.status,
    required this.onJoin,
    required this.onSendChat,
    required this.onSendReaction,
    required this.onSendPicture,
    required this.onChangeAudioVolume,
    required this.youtubeConnected,
    required this.youtubeOpening,
    required this.youtubeTab,
    required this.youtubeFilter,
    required this.onConnectYouTube,
    required this.onChangeYouTubeTab,
    required this.onChangeYouTubeFilter,
    required this.onOpenYouTubeSearch,
    required this.onOpenYouTubeChoice,
    required this.onSelectYouTube,
    required this.onDeleteChatMessage,
    required this.onLoadControls,
    required this.onChangeRoomMicCount,
    required this.onToggleRoomLock,
    required this.onChangeRoomPassword,
    required this.onChangeRoomTheme,
    required this.onToggleRoomSeat,
    required this.onToggleAllRoomSeats,
    required this.onAssignRoomAdmin,
    required this.onRemoveRoomRole,
    required this.onClearRoomComments,
    required this.onModerateParticipant,
    required this.onToggleScreenSharing,
    required this.onApplyStagePermission,
  });

  final String panel;
  final Room room;
  final AppUser user;
  final bool joined;
  final TextEditingController passwordController;
  final TextEditingController chatController;
  final List<Map<String, dynamic>> chatMessages;
  final bool chatLoading;
  final bool chatSending;
  final double audioVolume;
  final Map<String, dynamic>? roomControls;
  final bool controlsLoading;
  final Set<int> moderatingUserIds;
  final bool screenSharing;
  final bool canPublishStage;
  final Set<int> stageActionIds;
  final String status;
  final VoidCallback? onJoin;
  final VoidCallback onSendChat;
  final ValueChanged<String> onSendReaction;
  final VoidCallback onSendPicture;
  final ValueChanged<double> onChangeAudioVolume;
  final bool youtubeConnected;
  final bool youtubeOpening;
  final String youtubeTab;
  final String youtubeFilter;
  final VoidCallback onConnectYouTube;
  final ValueChanged<String> onChangeYouTubeTab;
  final ValueChanged<String> onChangeYouTubeFilter;
  final VoidCallback onOpenYouTubeSearch;
  final ValueChanged<_YouTubeChoice> onOpenYouTubeChoice;
  final ValueChanged<_YouTubeChoice> onSelectYouTube;
  final void Function(Map<String, dynamic> message) onDeleteChatMessage;
  final VoidCallback onLoadControls;
  final VoidCallback onChangeRoomMicCount;
  final VoidCallback onToggleRoomLock;
  final VoidCallback onChangeRoomPassword;
  final VoidCallback onChangeRoomTheme;
  final void Function(Map<String, dynamic> seat) onToggleRoomSeat;
  final ValueChanged<bool> onToggleAllRoomSeats;
  final VoidCallback onAssignRoomAdmin;
  final void Function(Map<String, dynamic> role) onRemoveRoomRole;
  final VoidCallback onClearRoomComments;
  final void Function(Map<String, dynamic> participant, String action)
  onModerateParticipant;
  final VoidCallback? onToggleScreenSharing;
  final void Function(Map<String, dynamic> request, bool approve)
  onApplyStagePermission;

  @override
  Widget build(BuildContext context) {
    final title = switch (panel) {
      'access' => 'Room Access',
      'audio' => 'Audio Volume',
      'emoji' => 'Emoji',
      'youtube' => 'YouTube',
      'beauty' => 'Filters',
      'screen' => 'Screen Share',
      'ops' => 'Room Admin Controls',
      'guard' => 'Safety',
      'chat' => 'Live Chat',
      _ => 'Room Menu',
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
            subtitle: !canPublishStage
                ? 'Owner approval is required.'
                : room.screenShareEnabled
                ? 'Presenter tools are available.'
                : 'Screen share is turned off.',
            onTap: canPublishStage ? onToggleScreenSharing : null,
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
            user: user,
            joined: joined,
            controller: chatController,
            messages: chatMessages,
            loading: chatLoading,
            sending: chatSending,
            onSend: onSendChat,
            onSendPicture: onSendPicture,
            onDeleteMessage: onDeleteChatMessage,
          )
        else if (panel == 'audio')
          _AudioVolumePanel(value: audioVolume, onChanged: onChangeAudioVolume)
        else if (panel == 'emoji')
          _EmojiPanel(onReaction: onSendReaction)
        else if (panel == 'youtube')
          _YouTubePickerPanel(
            connected: youtubeConnected,
            opening: youtubeOpening,
            activeTab: youtubeTab,
            activeFilter: youtubeFilter,
            onConnect: onConnectYouTube,
            onTabChanged: onChangeYouTubeTab,
            onFilterChanged: onChangeYouTubeFilter,
            onSearch: onOpenYouTubeSearch,
            onOpen: onOpenYouTubeChoice,
            onSelect: onSelectYouTube,
          )
        else if (panel == 'ops')
          _RoomOpsPanel(
            controls: roomControls,
            loading: controlsLoading,
            moderatingUserIds: moderatingUserIds,
            stageActionIds: stageActionIds,
            onRefresh: onLoadControls,
            onChangeMicCount: onChangeRoomMicCount,
            onToggleRoomLock: onToggleRoomLock,
            onChangePassword: onChangeRoomPassword,
            onChangeTheme: onChangeRoomTheme,
            onToggleSeat: onToggleRoomSeat,
            onToggleAllSeats: onToggleAllRoomSeats,
            onAssignAdmin: onAssignRoomAdmin,
            onRemoveRole: onRemoveRoomRole,
            onClearComments: onClearRoomComments,
            onModerate: onModerateParticipant,
            onApplyStagePermission: onApplyStagePermission,
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

enum _RoomMenuAction {
  micCount,
  lock,
  password,
  theme,
  share,
  admin,
  clearComments,
  gatherFollowers,
}

class _RoomMenuActionSheet extends StatelessWidget {
  const _RoomMenuActionSheet({
    required this.room,
    required this.controls,
    required this.loading,
  });

  final Room room;
  final Map<String, dynamic>? controls;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final roomControls = _mapValue(controls?['room']);
    final privacy =
        roomControls?['privacy_type']?.toString() ?? room.privacyType;
    final locked = roomControls == null ? room.isLocked : privacy == 'password';
    final bottom = MediaQuery.paddingOf(context).bottom;
    final items = [
      const _RoomMenuItemData(
        action: _RoomMenuAction.micCount,
        icon: Icons.mic_none_rounded,
        label: 'Number of Mic',
        color: Color(0xFFD66DE8),
      ),
      _RoomMenuItemData(
        action: _RoomMenuAction.lock,
        icon: locked ? Icons.lock_open_rounded : Icons.lock_outline_rounded,
        label: locked ? 'Unlock' : 'Lock room',
        color: const Color(0xFFE8A15D),
      ),
      const _RoomMenuItemData(
        action: _RoomMenuAction.password,
        icon: Icons.key_rounded,
        label: 'Password',
        color: Color(0xFF65C6E6),
      ),
      const _RoomMenuItemData(
        action: _RoomMenuAction.theme,
        icon: Icons.palette_outlined,
        label: 'Theme',
        color: Color(0xFF9D7AEF),
      ),
      const _RoomMenuItemData(
        action: _RoomMenuAction.share,
        icon: Icons.share_rounded,
        label: 'Share',
        color: Color(0xFFEBA067),
      ),
      const _RoomMenuItemData(
        action: _RoomMenuAction.admin,
        icon: Icons.group_add_outlined,
        label: 'Admin',
        color: Color(0xFF5EC6D6),
      ),
      const _RoomMenuItemData(
        action: _RoomMenuAction.clearComments,
        icon: Icons.delete_sweep_outlined,
        label: 'Clear comments history',
        color: Color(0xFFE57D96),
      ),
      const _RoomMenuItemData(
        action: _RoomMenuAction.gatherFollowers,
        icon: Icons.campaign_outlined,
        label: 'Gather followers',
        color: Color(0xFFE4C34D),
      ),
    ];

    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(maxWidth: 520),
        padding: EdgeInsets.fromLTRB(12, 8, 12, bottom + 8),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
          boxShadow: [
            BoxShadow(
              color: Color.fromRGBO(0, 0, 0, 0.22),
              blurRadius: 22,
              offset: Offset(0, -8),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (loading)
                const Padding(
                  padding: EdgeInsets.only(top: 2, bottom: 4),
                  child: SizedBox(
                    width: 20,
                    height: 2,
                    child: LinearProgressIndicator(
                      minHeight: 2,
                      color: RtcPalette.lobbyTealDark,
                      backgroundColor: Color(0xFFE9F4F1),
                    ),
                  ),
                ),
              for (final item in items)
                _RoomMenuActionTile(
                  item: item,
                  onTap: () => Navigator.of(context).pop(item.action),
                ),
              _RoomMenuCancelTile(onTap: () => Navigator.of(context).pop()),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoomMenuItemData {
  const _RoomMenuItemData({
    required this.action,
    required this.icon,
    required this.label,
    required this.color,
  });

  final _RoomMenuAction action;
  final IconData icon;
  final String label;
  final Color color;
}

class _RoomMenuActionTile extends StatelessWidget {
  const _RoomMenuActionTile({required this.item, required this.onTap});

  final _RoomMenuItemData item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: item.label,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 42,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SizedBox(
                width: 36,
                child: Icon(item.icon, color: item.color, size: 19),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 178,
                child: Text(
                  item.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF1F2937),
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    height: 1,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoomMenuCancelTile extends StatelessWidget {
  const _RoomMenuCancelTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: const SizedBox(
        height: 38,
        child: Center(
          child: Text(
            'Cancel',
            style: TextStyle(
              color: Color(0xFF9CA3AF),
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}

class _MicCountChooserScreen extends StatefulWidget {
  const _MicCountChooserScreen({required this.current, required this.options});

  final int current;
  final List<_MicLayoutOption> options;

  @override
  State<_MicCountChooserScreen> createState() => _MicCountChooserScreenState();
}

class _MicCountChooserScreenState extends State<_MicCountChooserScreen> {
  late _MicLayoutOption _selected;

  @override
  void initState() {
    super.initState();
    _selected = widget.options.firstWhere(
      (option) => option.count == widget.current,
      orElse: () => widget.options.first,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        centerTitle: true,
        leading: IconButton(
          tooltip: 'Back',
          icon: const Icon(Icons.chevron_left_rounded, size: 30),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text(
          'Choose number of mic',
          style: TextStyle(
            color: Color(0xFF111827),
            fontSize: 15,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final previewHeight = (constraints.maxHeight * 0.48).clamp(
                    230.0,
                    330.0,
                  );
                  return Column(
                    children: [
                      const SizedBox(height: 18),
                      Expanded(
                        child: Center(
                          child: SizedBox(
                            width: previewHeight * 0.56,
                            height: previewHeight,
                            child: _MicLayoutPhonePreview(
                              option: _selected,
                              large: true,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(
                        height: 148,
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 14),
                          scrollDirection: Axis.horizontal,
                          itemCount: widget.options.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 12),
                          itemBuilder: (context, index) {
                            final option = widget.options[index];
                            return _MicLayoutThumbnail(
                              option: option,
                              selected: identical(option, _selected),
                              onTap: () => setState(() => _selected = option),
                            );
                          },
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(36, 10, 36, 22),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(RtcRadius.pill),
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFFB323), Color(0xFFF59E0B)],
                  ),
                ),
                child: FilledButton(
                  onPressed: () => Navigator.of(context).pop(_selected.count),
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(46),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RtcRadius.pill),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  child: const Text('Use'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MicLayoutThumbnail extends StatelessWidget {
  const _MicLayoutThumbnail({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final _MicLayoutOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: option.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(7),
        child: SizedBox(
          width: 74,
          child: Column(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    width: 66,
                    height: 106,
                    padding: const EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      color: selected
                          ? RtcPalette.lobbyTealDark
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: _MicLayoutPhonePreview(option: option),
                  ),
                  if (selected)
                    const Positioned(
                      right: -5,
                      bottom: -5,
                      child: _MicLayoutCheckmark(),
                    ),
                ],
              ),
              const SizedBox(height: 9),
              Text(
                option.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF1F2937),
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MicLayoutCheckmark extends StatelessWidget {
  const _MicLayoutCheckmark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        color: RtcPalette.lobbyTeal,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
      ),
      child: const Icon(Icons.check_rounded, color: Colors.white, size: 12),
    );
  }
}

class _MicLayoutPhonePreview extends StatelessWidget {
  const _MicLayoutPhonePreview({required this.option, this.large = false});

  final _MicLayoutOption option;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final colors = option.colors;
    final columns = option.count <= 8
        ? 4
        : option.count <= 16
        ? 4
        : 5;
    final seatCount = option.count.clamp(1, 20);
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(large ? 12 : 5),
        border: Border.all(
          color: large
              ? const Color(0xFFE5E7EB)
              : const Color.fromRGBO(17, 24, 39, 0.16),
          width: large ? 1.5 : 0.6,
        ),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: colors,
        ),
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: _MicPreviewAtmosphere(variant: option.variant),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(
              large ? 10 : 4,
              large ? 10 : 4,
              large ? 10 : 4,
              large ? 8 : 4,
            ),
            child: Column(
              children: [
                _MicPreviewHeader(large: large),
                SizedBox(height: large ? 10 : 4),
                Expanded(
                  child: GridView.builder(
                    padding: EdgeInsets.zero,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: large ? 8 : 3,
                      crossAxisSpacing: large ? 8 : 3,
                    ),
                    itemCount: seatCount,
                    itemBuilder: (context, index) {
                      return _MicPreviewSeat(index: index, large: large);
                    },
                  ),
                ),
                SizedBox(height: large ? 8 : 3),
                _MicPreviewFooter(large: large),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MicPreviewAtmosphere extends StatelessWidget {
  const _MicPreviewAtmosphere({required this.variant});

  final int variant;

  @override
  Widget build(BuildContext context) {
    final warm = variant.isEven;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: warm
              ? const Alignment(0.8, -0.6)
              : const Alignment(-0.7, 0.1),
          radius: 0.95,
          colors: warm
              ? const [
                  Color.fromRGBO(255, 198, 76, 0.34),
                  Color.fromRGBO(130, 54, 190, 0.18),
                  Color.fromRGBO(0, 0, 0, 0),
                ]
              : const [
                  Color.fromRGBO(40, 212, 255, 0.26),
                  Color.fromRGBO(69, 32, 158, 0.22),
                  Color.fromRGBO(0, 0, 0, 0),
                ],
        ),
      ),
    );
  }
}

class _MicPreviewHeader extends StatelessWidget {
  const _MicPreviewHeader({required this.large});

  final bool large;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: large ? 18 : 7,
          height: large ? 18 : 7,
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            color: Color(0xFFFFD36B),
          ),
        ),
        SizedBox(width: large ? 6 : 2),
        Expanded(
          child: Container(
            height: large ? 8 : 3,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.72),
              borderRadius: BorderRadius.circular(RtcRadius.pill),
            ),
          ),
        ),
        SizedBox(width: large ? 6 : 2),
        Icon(
          Icons.more_horiz_rounded,
          size: large ? 15 : 6,
          color: Colors.white.withValues(alpha: 0.84),
        ),
      ],
    );
  }
}

class _MicPreviewSeat extends StatelessWidget {
  const _MicPreviewSeat({required this.index, required this.large});

  final int index;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final avatarColors = const [
      Color(0xFFFFD166),
      Color(0xFF52D6C5),
      Color(0xFFFF8FAB),
      Color(0xFFB8F2E6),
      Color(0xFF9AD1FF),
    ];
    final color = avatarColors[index % avatarColors.length];
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : large
            ? 26.0
            : 8.0;
        final height = constraints.maxHeight.isFinite
            ? constraints.maxHeight
            : large
            ? 32.0
            : 8.0;
        final labelHeight = large ? 6.0 : 0.0;
        final availableHeight = (height - labelHeight).clamp(4.0, height);
        final maxCircle = availableHeight < width ? availableHeight : width;
        final circleSize = (large ? 26.0 : 7.0)
            .clamp(4.0, maxCircle < 4.0 ? 4.0 : maxCircle)
            .toDouble();

        return Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: circleSize,
              height: circleSize,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color,
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.76),
                  width: large ? 1.4 : 0.35,
                ),
              ),
              child: Icon(
                index == 0 ? Icons.mic_rounded : Icons.person_rounded,
                color: const Color.fromRGBO(54, 22, 80, 0.82),
                size: large ? circleSize * 0.5 : circleSize * 0.46,
              ),
            ),
            if (large) ...[
              const SizedBox(height: 3),
              Container(
                width: 24,
                height: 3,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.54),
                  borderRadius: BorderRadius.circular(RtcRadius.pill),
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _MicPreviewFooter extends StatelessWidget {
  const _MicPreviewFooter({required this.large});

  final bool large;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: List.generate(5, (index) {
        return Container(
          width: large ? 12 : 5,
          height: large ? 12 : 5,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: index == 4
                ? const Color(0xFFFFC928)
                : Colors.white.withValues(alpha: 0.82),
          ),
        );
      }),
    );
  }
}

class _MicLayoutOption {
  const _MicLayoutOption({
    required this.count,
    required this.variant,
    required this.colors,
  });

  final int count;
  final int variant;
  final List<Color> colors;

  String get label => '$count people';
}

List<_MicLayoutOption> _micLayoutOptions({
  required List<int> allowedCounts,
  required int current,
  required int maxPackageMic,
}) {
  final source = allowedCounts.isNotEmpty
      ? allowedCounts
      : const [8, 12, 15, 20];
  final options = <_MicLayoutOption>[];
  for (final count in source) {
    if (count < 1 || count > maxPackageMic) continue;
    options.add(_micLayoutOption(count, options.length));
  }
  if (current > 0 &&
      current <= maxPackageMic &&
      !options.any((option) => option.count == current)) {
    options.insert(0, _micLayoutOption(current, 0));
  }
  if (options.isEmpty) {
    options.add(_micLayoutOption(maxPackageMic.clamp(1, 20), 0));
  }
  return options;
}

_MicLayoutOption _micLayoutOption(int count, int variant) {
  const palettes = [
    [Color(0xFF29116D), Color(0xFF9D31F3)],
    [Color(0xFF1E0A5F), Color(0xFF8018D8)],
    [Color(0xFF0E315C), Color(0xFF1B76A4)],
    [Color(0xFF2E3443), Color(0xFF9CA3AF)],
    [Color(0xFF161B54), Color(0xFF4120A6)],
  ];
  return _MicLayoutOption(
    count: count,
    variant: variant,
    colors: palettes[variant % palettes.length],
  );
}

class _AudioVolumePanel extends StatelessWidget {
  const _AudioVolumePanel({required this.value, required this.onChanged});

  final double value;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    final percent = (value * 100).round().clamp(0, 100);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RtcSheetActionTile(
          icon: value == 0
              ? Icons.volume_off_rounded
              : value < 0.5
              ? Icons.volume_down_rounded
              : Icons.volume_up_rounded,
          title: 'Room audio',
          subtitle: 'Music and video listening volume.',
          onTap: null,
          trailing: RtcMiniBadge(
            label: '$percent%',
            color: RtcPalette.lobbyTealDark,
            subtle: true,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: RtcPalette.lobbyLine),
          ),
          child: Row(
            children: [
              IconButton(
                tooltip: value == 0 ? 'Unmute room audio' : 'Mute room audio',
                onPressed: () => onChanged(value == 0 ? 0.72 : 0),
                icon: Icon(
                  value == 0
                      ? Icons.volume_off_rounded
                      : Icons.volume_mute_rounded,
                ),
              ),
              Expanded(
                child: Slider(
                  value: value.clamp(0, 1),
                  onChanged: onChanged,
                  activeColor: RtcPalette.lobbyTealDark,
                  inactiveColor: const Color(0xFFDDE7E7),
                ),
              ),
              SizedBox(
                width: 40,
                child: Text(
                  '$percent%',
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    color: RtcPalette.lobbyInk,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
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

class _EmojiPanel extends StatelessWidget {
  const _EmojiPanel({required this.onReaction});

  final ValueChanged<String> onReaction;

  static const _reactions = [
    _ReactionChoice('😊', 'Smile'),
    _ReactionChoice('🥳', 'Party'),
    _ReactionChoice('😘', 'Kiss'),
    _ReactionChoice('🤗', 'Hug'),
    _ReactionChoice('😎', 'Cool'),
    _ReactionChoice('🙏', 'Thanks'),
    _ReactionChoice('👏', 'Clap'),
    _ReactionChoice('😂', 'Laugh'),
    _ReactionChoice('😢', 'Sad'),
    _ReactionChoice('🤩', 'Wow'),
    _ReactionChoice('👍', 'Like'),
    _ReactionChoice('💬', 'Chat'),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RtcSheetActionTile(
          icon: Icons.emoji_emotions_outlined,
          title: 'Free reactions',
          subtitle: 'Available for every room member.',
          onTap: null,
          trailing: const RtcMiniBadge(
            label: 'Free',
            color: RtcPalette.lobbyTealDark,
            subtle: true,
          ),
        ),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 4,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          children: [
            for (final reaction in _reactions)
              Material(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => onReaction(reaction.emoji),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        reaction.emoji,
                        style: const TextStyle(fontSize: 25, height: 1),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        reaction.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: RtcPalette.lobbyInk,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _YouTubePickerPanel extends StatelessWidget {
  const _YouTubePickerPanel({
    required this.connected,
    required this.opening,
    required this.activeTab,
    required this.activeFilter,
    required this.onConnect,
    required this.onTabChanged,
    required this.onFilterChanged,
    required this.onSearch,
    required this.onOpen,
    required this.onSelect,
  });

  final bool connected;
  final bool opening;
  final String activeTab;
  final String activeFilter;
  final VoidCallback onConnect;
  final ValueChanged<String> onTabChanged;
  final ValueChanged<String> onFilterChanged;
  final VoidCallback onSearch;
  final ValueChanged<_YouTubeChoice> onOpen;
  final ValueChanged<_YouTubeChoice> onSelect;

  static const music = [
    _YouTubeChoice(
      title: 'Live Music Room Mix',
      detail: 'YouTube Music room playlist',
      asset: 'assets/rtc/rooms/music-room.png',
      duration: '24:12',
      url: 'https://music.youtube.com/search?q=Live%20Music%20Room%20Mix',
      tab: 'music',
      tags: ['All', 'Music', 'Live'],
    ),
    _YouTubeChoice(
      title: 'Bengali Chill Music Set',
      detail: 'Bangla music for room listening',
      asset: 'assets/rtc/rooms/stage-moods.png',
      duration: '31:20',
      url: 'https://music.youtube.com/search?q=Bengali%20Chill%20Music%20Set',
      tab: 'music',
      tags: ['All', 'Music', 'Bengali'],
    ),
    _YouTubeChoice(
      title: 'Morning Lo-Fi Focus',
      detail: 'Soft music for chat rooms',
      asset: 'assets/rtc/rooms/video-room.png',
      duration: '42:00',
      url: 'https://music.youtube.com/search?q=Morning%20Lo-Fi%20Focus',
      tab: 'music',
      tags: ['All', 'Music'],
    ),
  ];

  static const videos = [
    _YouTubeChoice(
      title: 'Popular 90s Hit Playlist',
      detail: 'Music video playlist',
      asset: 'assets/rtc/rooms/video-room.png',
      duration: '36:08',
      url:
          'https://www.youtube.com/results?search_query=Popular%2090s%20Hit%20Playlist',
      tab: 'video',
      tags: ['All', 'Music'],
    ),
    _YouTubeChoice(
      title: 'Live Music Room Mix',
      detail: 'Room music video collection',
      asset: 'assets/rtc/rooms/music-room.png',
      duration: '24:12',
      url:
          'https://www.youtube.com/results?search_query=Live%20Music%20Room%20Mix',
      tab: 'video',
      tags: ['All', 'Music', 'Live'],
    ),
    _YouTubeChoice(
      title: 'Stage Mood Playlist',
      detail: 'Background room video',
      asset: 'assets/rtc/rooms/stage-moods.png',
      duration: '18:45',
      url:
          'https://www.youtube.com/results?search_query=Stage%20Mood%20Playlist',
      tab: 'video',
      tags: ['All'],
    ),
  ];

  static const filters = ['All', 'Music', 'Bengali', 'Live'];

  @override
  Widget build(BuildContext context) {
    final choices = activeTab == 'music' ? music : videos;
    final visibleChoices = activeFilter == 'All'
        ? choices
        : choices
              .where((choice) => choice.tags.contains(activeFilter))
              .toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: _YouTubeTab(
                label: 'Music',
                active: activeTab == 'music',
                onTap: connected ? () => onTabChanged('music') : null,
              ),
            ),
            Expanded(
              child: _YouTubeTab(
                label: 'Video',
                active: activeTab == 'video',
                onTap: connected ? () => onTabChanged('video') : null,
              ),
            ),
            IconButton(
              tooltip: 'Search YouTube',
              onPressed: connected && !opening ? onSearch : null,
              icon: const Icon(Icons.search_rounded),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (!connected) ...[
          RtcSheetActionTile(
            icon: Icons.smart_display_outlined,
            title: 'Connect YouTube',
            subtitle: 'Enable YouTube Music and video picks for this room.',
            onTap: onConnect,
            trailing: const Icon(
              Icons.link_rounded,
              color: RtcPalette.lobbyTealDark,
            ),
          ),
          const SizedBox(height: 12),
          GradientButton(
            onPressed: onConnect,
            icon: const Icon(Icons.play_circle_rounded, color: Colors.white),
            child: const Text('Connect YouTube'),
          ),
          const SizedBox(height: 6),
          const Text(
            'After connecting, Music and Video tabs can be used from this room.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: RtcPalette.lobbyMuted,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
        if (connected) ...[
          Row(
            children: [
              const Icon(Icons.smart_display, color: Color(0xFFFF1F1F)),
              const SizedBox(width: 6),
              const Text(
                'YouTube',
                style: TextStyle(
                  color: RtcPalette.lobbyInk,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const Spacer(),
              RtcMiniBadge(
                label: activeTab == 'music' ? 'Room music' : 'Room video',
                color: RtcPalette.lobbyTealDark,
                subtle: true,
              ),
            ],
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final filter in filters)
                  _YouTubeFilterChip(
                    label: filter,
                    active: activeFilter == filter,
                    onTap: () => onFilterChanged(filter),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          RtcSheetActionTile(
            icon: activeTab == 'music'
                ? Icons.library_music_outlined
                : Icons.video_library_outlined,
            title: activeTab == 'music'
                ? 'Music room-ready tracks'
                : 'Room video picks',
            subtitle: opening
                ? 'Opening YouTube...'
                : 'Select for the room, or open directly in YouTube.',
            onTap: null,
            trailing: RtcMiniBadge(
              label: '${visibleChoices.length}',
              color: RtcPalette.lobbyTealDark,
              subtle: true,
            ),
          ),
          const SizedBox(height: 10),
          for (final video in visibleChoices) ...[
            _YouTubeVideoTile(
              video: video,
              opening: opening,
              onSelect: onSelect,
              onOpen: onOpen,
            ),
            const SizedBox(height: 10),
          ],
        ],
      ],
    );
  }
}

class _YouTubeTab extends StatelessWidget {
  const _YouTubeTab({required this.label, this.active = false, this.onTap});

  final String label;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      key: ValueKey('youtube-tab-${label.toLowerCase()}'),
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              Text(
                label,
                style: TextStyle(
                  color: active ? RtcPalette.lobbyInk : RtcPalette.lobbyMuted,
                  fontSize: 14,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              Container(
                width: 38,
                height: 2,
                decoration: BoxDecoration(
                  color: active ? RtcPalette.lobbyGold : Colors.transparent,
                  borderRadius: BorderRadius.circular(RtcRadius.pill),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _YouTubeFilterChip extends StatelessWidget {
  const _YouTubeFilterChip({
    required this.label,
    this.active = false,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Material(
        color: active ? RtcPalette.lobbyInk : const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(RtcRadius.pill),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: Text(
              label,
              style: TextStyle(
                color: active ? Colors.white : RtcPalette.lobbyInk,
                fontSize: 12,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _YouTubeVideoTile extends StatelessWidget {
  const _YouTubeVideoTile({
    required this.video,
    required this.opening,
    required this.onSelect,
    required this.onOpen,
  });

  final _YouTubeChoice video;
  final bool opening;
  final ValueChanged<_YouTubeChoice> onSelect;
  final ValueChanged<_YouTubeChoice> onOpen;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF8FAFC),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onSelect(video),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Stack(
                  children: [
                    Image.asset(
                      video.asset,
                      width: 112,
                      height: 70,
                      fit: BoxFit.cover,
                    ),
                    Positioned(
                      right: 5,
                      bottom: 5,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.72),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          video.duration,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      video.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbyInk,
                        fontSize: 13,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      video.detail,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbyMuted,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Open in YouTube',
                onPressed: opening ? null : () => onOpen(video),
                icon: const Icon(
                  Icons.open_in_new_rounded,
                  color: RtcPalette.lobbyMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ChatPreview extends StatelessWidget {
  const _ChatPreview({
    required this.room,
    required this.user,
    required this.joined,
    required this.controller,
    required this.messages,
    required this.loading,
    required this.sending,
    required this.onSend,
    required this.onSendPicture,
    required this.onDeleteMessage,
  });

  final Room room;
  final AppUser user;
  final bool joined;
  final TextEditingController controller;
  final List<Map<String, dynamic>> messages;
  final bool loading;
  final bool sending;
  final VoidCallback onSend;
  final VoidCallback onSendPicture;
  final void Function(Map<String, dynamic> message) onDeleteMessage;

  @override
  Widget build(BuildContext context) {
    final visibleMessages = _recentChatMessages(messages, 3);
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
          constraints: const BoxConstraints(maxHeight: 170),
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
                    (message) => _ChatMessageRow(
                      message: message,
                      user: user,
                      sending: sending,
                      onDelete: onDeleteMessage,
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
          onAttach: onSendPicture,
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

class _ChatMessageRow extends StatelessWidget {
  const _ChatMessageRow({
    required this.message,
    required this.user,
    required this.sending,
    required this.onDelete,
  });

  final Map<String, dynamic> message;
  final AppUser user;
  final bool sending;
  final void Function(Map<String, dynamic> message) onDelete;

  @override
  Widget build(BuildContext context) {
    final mine = _isOwnChatMessage(message, user);
    final messageId = _chatMessageId(message);
    final imageProvider = _chatImageProvider(message);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: mine
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          RtcChatBubble(
            sender: _chatSenderName(message, user),
            message: _chatMessageText(message),
            mine: mine,
            accent: _chatMessageAccent(message),
          ),
          if (imageProvider != null) ...[
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image(
                image: imageProvider,
                width: 184,
                height: 110,
                fit: BoxFit.cover,
              ),
            ),
          ],
          if (mine && messageId != null)
            TextButton.icon(
              onPressed: sending ? null : () => onDelete(message),
              icon: const Icon(Icons.undo_rounded, size: 14),
              label: const Text('Unsend'),
              style: TextButton.styleFrom(
                foregroundColor: RtcPalette.lobbyTealDark,
                visualDensity: VisualDensity.compact,
                textStyle: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _RoomOpsPanel extends StatelessWidget {
  const _RoomOpsPanel({
    required this.controls,
    required this.loading,
    required this.moderatingUserIds,
    required this.stageActionIds,
    required this.onRefresh,
    required this.onChangeMicCount,
    required this.onToggleRoomLock,
    required this.onChangePassword,
    required this.onChangeTheme,
    required this.onToggleSeat,
    required this.onToggleAllSeats,
    required this.onAssignAdmin,
    required this.onRemoveRole,
    required this.onClearComments,
    required this.onModerate,
    required this.onApplyStagePermission,
  });

  final Map<String, dynamic>? controls;
  final bool loading;
  final Set<int> moderatingUserIds;
  final Set<int> stageActionIds;
  final VoidCallback onRefresh;
  final VoidCallback onChangeMicCount;
  final VoidCallback onToggleRoomLock;
  final VoidCallback onChangePassword;
  final VoidCallback onChangeTheme;
  final void Function(Map<String, dynamic> seat) onToggleSeat;
  final ValueChanged<bool> onToggleAllSeats;
  final VoidCallback onAssignAdmin;
  final void Function(Map<String, dynamic> role) onRemoveRole;
  final VoidCallback onClearComments;
  final void Function(Map<String, dynamic> participant, String action)
  onModerate;
  final void Function(Map<String, dynamic> request, bool approve)
  onApplyStagePermission;

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
            title: 'Room admin controls',
            subtitle: 'Available to room owners and room admins.',
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
    final stageRequests = _mapList(data['stage_requests']);
    final seats = _mapList(data['seats']);
    final roles = _mapList(data['roles']);
    final room = _mapValue(data['room']);
    final package = _mapValue(data['package']);
    final seatSummary = _mapValue(data['seat_summary']);
    final role = _roomRoleLabel(data['role']);
    final micCount = _intValue(room?['max_mic_count']) ?? seats.length;
    final packageName = package?['plan_name']?.toString() ?? 'Current package';
    final lifecycle = package?['room_lifecycle']?.toString() ?? 'permanent';
    final maxAdmins = _intValue(package?['max_room_admins']);
    final assignedAdmins =
        _intValue(package?['assigned_room_admins']) ?? roles.length;
    final remainingAdminSlots = _intValue(
      package?['remaining_room_admin_slots'],
    );
    final maxMicCount = _intValue(package?['max_mic_count']);
    final privacy = room?['privacy_type']?.toString() ?? 'public';
    final theme = room?['theme']?.toString() ?? 'default';
    final lockedSeatCount =
        _intValue(seatSummary?['locked_count']) ??
        seats.where((seat) => _signalBool(seat['locked'])).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  RtcMiniBadge(
                    label: role,
                    color: RtcPalette.lobbyTealDark,
                    subtle: true,
                  ),
                  RtcMiniBadge(
                    label:
                        '${participants.length} active participant${participants.length == 1 ? '' : 's'}',
                    color: RtcPalette.lobbySoft,
                    subtle: true,
                  ),
                  RtcMiniBadge(
                    label: packageName,
                    color: RtcPalette.lobbyMint,
                    subtle: true,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
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
        RtcSheetActionTile(
          icon: Icons.mic_external_on_outlined,
          title: 'Number of Mic',
          subtitle: maxMicCount == null
              ? '$micCount mic seat${micCount == 1 ? '' : 's'} in this $lifecycle room.'
              : '$micCount of $maxMicCount mic seats in this $lifecycle room.',
          onTap: loading ? null : onChangeMicCount,
          trailing: RtcMiniBadge(
            label: '$micCount',
            color: RtcPalette.lobbyTealDark,
            subtle: true,
          ),
        ),
        RtcSheetActionTile(
          icon: privacy == 'password'
              ? Icons.lock_open_rounded
              : Icons.lock_outline_rounded,
          title: privacy == 'password' ? 'Unlock' : 'Lock room',
          subtitle: privacy == 'password'
              ? 'Remove the room password gate.'
              : 'Protect this room with a password.',
          onTap: loading ? null : onToggleRoomLock,
        ),
        RtcSheetActionTile(
          icon: Icons.key_rounded,
          title: 'Password',
          subtitle: privacy == 'password'
              ? 'Change the current room password.'
              : 'Set a password to make the room locked.',
          onTap: loading ? null : onChangePassword,
        ),
        RtcSheetActionTile(
          icon: Icons.palette_outlined,
          title: 'Theme',
          subtitle: theme == 'default' ? 'Choose room theme.' : theme,
          onTap: loading ? null : onChangeTheme,
        ),
        RtcSheetActionTile(
          icon: Icons.admin_panel_settings_outlined,
          title: 'Admin',
          subtitle: maxAdmins == null || maxAdmins == 0
              ? '$assignedAdmins room admin/moderator${assignedAdmins == 1 ? '' : 's'} assigned.'
              : '$assignedAdmins of $maxAdmins admin slots used${remainingAdminSlots == null ? '' : ' · $remainingAdminSlots open'}.',
          onTap: loading ? null : onAssignAdmin,
        ),
        RtcSheetActionTile(
          icon: Icons.delete_sweep_outlined,
          title: 'Clear comments history',
          subtitle: 'Remove visible comments without deleting the room.',
          destructive: true,
          onTap: loading ? null : onClearComments,
        ),
        const SizedBox(height: 8),
        RtcSheetActionTile(
          icon: Icons.event_seat_outlined,
          title: 'Mic seat locks',
          subtitle:
              '$lockedSeatCount locked · ${seats.length - lockedSeatCount} open',
          onTap: null,
          trailing: const Icon(
            Icons.lock_outline_rounded,
            color: RtcPalette.lobbyTealDark,
          ),
        ),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            RtcCompactActionButton(
              label: 'Lock All',
              icon: Icons.lock_rounded,
              onPressed: loading ? null : () => onToggleAllSeats(true),
            ),
            RtcCompactActionButton(
              label: 'Unlock All',
              icon: Icons.lock_open_rounded,
              onPressed: loading ? null : () => onToggleAllSeats(false),
            ),
            for (final seat in seats)
              RtcCompactActionButton(
                label:
                    'No.${_intValue(seat['seat_number']) ?? seats.indexOf(seat) + 1}',
                icon: _signalBool(seat['locked'])
                    ? Icons.lock_rounded
                    : Icons.lock_open_rounded,
                onPressed: loading ? null : () => onToggleSeat(seat),
              ),
          ],
        ),
        if (roles.isNotEmpty) ...[
          const SizedBox(height: 12),
          ...roles.map(
            (roomRole) => _RoomRoleTile(
              role: roomRole,
              loading: loading,
              onRemove: onRemoveRole,
            ),
          ),
        ],
        const SizedBox(height: 8),
        if (stageRequests.isNotEmpty) ...[
          RtcSheetActionTile(
            icon: Icons.record_voice_over_rounded,
            title:
                '${stageRequests.length} stage request${stageRequests.length == 1 ? '' : 's'}',
            subtitle: 'Approve only people who should speak or use camera.',
            onTap: null,
            trailing: const Icon(
              Icons.notifications_active_rounded,
              color: RtcPalette.lobbyTealDark,
            ),
          ),
          const SizedBox(height: 8),
          ...stageRequests.map(
            (request) => _StageRequestTile(
              request: request,
              busy: stageActionIds.contains(_stageRequestActionKey(request)),
              onApply: onApplyStagePermission,
            ),
          ),
          const SizedBox(height: 8),
        ],
        if (participants.isEmpty)
          const RtcInlineNotice(
            icon: Icons.groups_2_outlined,
            title: 'No active participants yet.',
            detail: 'People will appear here after they join the room.',
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

class _RoomRoleTile extends StatelessWidget {
  const _RoomRoleTile({
    required this.role,
    required this.loading,
    required this.onRemove,
  });

  final Map<String, dynamic> role;
  final bool loading;
  final void Function(Map<String, dynamic> role) onRemove;

  @override
  Widget build(BuildContext context) {
    final roleName = _roomRoleLabel(role['role']);
    final name =
        role['user_name']?.toString() ??
        role['user_email']?.toString() ??
        'User #${role['user_id']}';
    return RtcParticipantTile(
      label: name,
      detail: roleName,
      image: _opsParticipantAvatar(role),
      locked: role['role']?.toString() == 'owner',
      actions: [
        if (role['role']?.toString() != 'owner')
          RtcCompactActionButton(
            label: 'Remove',
            icon: Icons.remove_circle_outline,
            destructive: true,
            onPressed: loading ? null : () => onRemove(role),
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
    final role = _roomRoleLabel(participant['role_in_room']);
    final enabled = canModerate && !busy;
    return RtcParticipantTile(
      label: _opsParticipantName(participant),
      detail:
          '$role · ${_signalBool(participant['mic_enabled']) ? 'mic on' : 'mic off'} · ${_signalBool(participant['camera_enabled']) ? 'cam on' : 'cam off'}',
      image: _opsParticipantAvatar(participant),
      busy: busy,
      locked: !canModerate,
      actions: [
        RtcCompactActionButton(
          label: 'Mute',
          onPressed: enabled ? () => onModerate(participant, 'mute_mic') : null,
        ),
        RtcCompactActionButton(
          label: 'Camera',
          onPressed: enabled
              ? () => onModerate(participant, 'disable_camera')
              : null,
        ),
        RtcCompactActionButton(
          label: 'Kick',
          destructive: true,
          onPressed: enabled ? () => onModerate(participant, 'kick') : null,
        ),
        RtcCompactActionButton(
          label: 'Ban',
          destructive: true,
          onPressed: enabled ? () => onModerate(participant, 'ban') : null,
        ),
      ],
    );
  }
}

class _StageRequestTile extends StatelessWidget {
  const _StageRequestTile({
    required this.request,
    required this.busy,
    required this.onApply,
  });

  final Map<String, dynamic> request;
  final bool busy;
  final void Function(Map<String, dynamic> request, bool approve) onApply;

  @override
  Widget build(BuildContext context) {
    final name = _stageRequestName(request);
    final wantsCamera = _signalBool(
      request['requested_camera'] ?? request['requestedCamera'],
    );
    final wantsMic = _signalBool(
      request['requested_mic'] ?? request['requestedMic'],
      true,
    );
    final detail =
        '${wantsMic ? 'mic' : 'listen'} · ${wantsCamera ? 'camera' : 'audio'}';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        border: Border.all(color: const Color(0xFFFBBF24)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.record_voice_over_rounded,
                color: RtcPalette.lobbyTealDark,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
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
                      detail,
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
                ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              RtcCompactActionButton(
                label: 'Approve',
                onPressed: busy ? null : () => onApply(request, true),
              ),
              RtcCompactActionButton(
                label: 'Decline',
                destructive: true,
                onPressed: busy ? null : () => onApply(request, false),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ToolChip {
  const _ToolChip(this.label, this.value);

  final String label;
  final String value;
}

class _ReactionChoice {
  const _ReactionChoice(this.emoji, this.label);

  final String emoji;
  final String label;
}

class _YouTubeChoice {
  const _YouTubeChoice({
    required this.title,
    required this.detail,
    required this.asset,
    required this.duration,
    required this.url,
    required this.tab,
    this.tags = const ['All'],
  });

  final String title;
  final String detail;
  final String asset;
  final String duration;
  final String url;
  final String tab;
  final List<String> tags;
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

List<int> _intList(Object? value) {
  if (value is! List) return const [];
  return value
      .map(_intValue)
      .whereType<int>()
      .where((count) => count > 0)
      .toSet()
      .toList()
    ..sort();
}

Map<String, dynamic>? _mapValue(Object? value) {
  return value is Map ? Map<String, dynamic>.from(value) : null;
}

Map<String, dynamic> _stageAccessFromRtc(Map<String, dynamic> rtc) {
  final access = _mapValue(rtc['stage_access']);
  final role = access?['role']?.toString() ?? 'audience';
  final canPublish = _signalBool(
    access?['can_publish'] ?? access?['canPublish'],
    _roomRoleCanPublish(role),
  );
  return {
    'role': role,
    'canPublish': canPublish,
    'requestsEnabled': _signalBool(
      access?['requests_enabled'] ?? access?['requestsEnabled'],
      true,
    ),
    'status':
        access?['status']?.toString() ?? (canPublish ? 'approved' : 'audience'),
  };
}

Map<String, dynamic> _stageAccessFromParticipant(
  Map<String, dynamic>? participant,
) {
  final access = _mapValue(participant?['stage_access']);
  final role =
      access?['role']?.toString() ??
      participant?['role_in_room']?.toString() ??
      participant?['stageRole']?.toString() ??
      'audience';
  final canPublish = _signalBool(
    access?['can_publish'] ??
        access?['canPublish'] ??
        participant?['can_publish'] ??
        participant?['canPublish'],
    _roomRoleCanPublish(role),
  );
  return {
    'role': role,
    'canPublish': canPublish,
    'requestsEnabled': _signalBool(
      access?['requests_enabled'] ?? access?['requestsEnabled'],
      true,
    ),
    'status':
        access?['status']?.toString() ?? (canPublish ? 'approved' : 'audience'),
  };
}

bool _roomRoleCanPublish(String role) {
  return const {
    'owner',
    'admin',
    'moderator',
    'speaker',
  }.contains(role.trim().toLowerCase());
}

bool _peerCanPublish(Map<String, dynamic> peer) {
  final role =
      (peer['stageRole'] ?? peer['stage_role'] ?? peer['role_in_room'] ?? '')
          .toString();
  return _signalBool(peer['canPublish'] ?? peer['can_publish']) ||
      _roomRoleCanPublish(role);
}

Map<String, dynamic>? _upsertStageRequest(
  Map<String, dynamic>? controls,
  Map<String, dynamic> request,
) {
  if (controls == null) return controls;
  final next = Map<String, dynamic>.from(controls);
  final requests = _mapList(next['stage_requests']);
  final key = _stageRequestActionKey(request);
  final index = requests.indexWhere(
    (item) => _stageRequestActionKey(item) == key,
  );
  if (index >= 0) {
    requests[index] = request;
  } else {
    requests.insert(0, request);
  }
  next['stage_requests'] = requests;
  return next;
}

Map<String, dynamic>? _removeStageRequest(
  Map<String, dynamic>? controls,
  Map<String, dynamic> request,
) {
  if (controls == null) return controls;
  final next = Map<String, dynamic>.from(controls);
  final key = _stageRequestActionKey(request);
  final userId = _intValue(
    request['userId'] ?? request['user_id'] ?? request['requester_user_id'],
  );
  next['stage_requests'] = _mapList(next['stage_requests']).where((item) {
    final itemKey = _stageRequestActionKey(item);
    final itemUserId = _intValue(
      item['userId'] ?? item['user_id'] ?? item['requester_user_id'],
    );
    if (key != null && itemKey == key) return false;
    if (userId != null && itemUserId == userId) return false;
    return true;
  }).toList();
  return next;
}

int? _stageRequestActionKey(Map<String, dynamic> request) {
  return _intValue(
        request['id'] ?? request['requestId'] ?? request['request_id'],
      ) ??
      _intValue(
        request['userId'] ?? request['user_id'] ?? request['requester_user_id'],
      );
}

String _stageRequestName(Map<String, dynamic> request) {
  return (request['userName'] ??
          request['user_name'] ??
          request['requester_name'] ??
          request['requesterUserName'] ??
          request['userId'] ??
          request['user_id'] ??
          request['requester_user_id'] ??
          'Participant')
      .toString();
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
  return RtcAssets.imageProviderFromValue(value);
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

String _roomRoleLabel(Object? role) {
  return switch (role?.toString()) {
    'owner' => 'Room owner',
    'admin' || 'room_admin' => 'Room admin',
    'moderator' => 'Room moderator',
    'speaker' => 'Speaker',
    'end_user' || 'audience' => 'Audience',
    final value when value != null && value.trim().isNotEmpty => value,
    _ => 'Participant',
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
    'gift' => body.isEmpty ? 'sent a reaction' : body,
    'image' => body.isEmpty ? 'sent a photo' : body,
    'voice' => body.isEmpty ? 'sent a voice message' : body,
    'system' => body.isEmpty ? 'System message' : body,
    _ => body.isEmpty ? 'Message' : body,
  };
}

ImageProvider? _chatImageProvider(Map<String, dynamic> message) {
  final type = (message['message_type'] ?? message['messageType'] ?? 'text')
      .toString();
  if (type != 'image') return null;
  final mediaUrl = (message['media_url'] ?? message['mediaUrl'] ?? '')
      .toString()
      .trim();
  if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
    return NetworkImage(mediaUrl);
  }
  if (mediaUrl.startsWith('assets/')) return AssetImage(mediaUrl);
  if (mediaUrl.startsWith('data:image/')) {
    final commaIndex = mediaUrl.indexOf(',');
    if (commaIndex > 0) {
      try {
        return MemoryImage(base64Decode(mediaUrl.substring(commaIndex + 1)));
      } on FormatException {
        return const AssetImage('assets/rtc/rooms/video-room.png');
      }
    }
  }
  return const AssetImage('assets/rtc/rooms/video-room.png');
}

String _imageMimeType(String fileName) {
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

Color _chatMessageAccent(Map<String, dynamic> message) {
  final type = (message['message_type'] ?? message['messageType'] ?? 'text')
      .toString();
  return switch (type) {
    'system' => RtcPalette.amber,
    'image' || 'voice' => RtcPalette.sky,
    _ => RtcPalette.chatPurple,
  };
}

String _modeLabel(String rtcMode) => rtcMode == 'video' ? 'Video' : 'Audio';

String _peerName(Map<String, dynamic> peer) {
  return (peer['userName'] ??
          peer['user_name'] ??
          peer['name'] ??
          peer['userId'] ??
          peer['user_id'] ??
          'Peer')
      .toString();
}

String? _peerSocketId(Map<String, dynamic> peer) {
  final text = (peer['socketId'] ?? peer['socket_id'])?.toString().trim();
  return text == null || text.isEmpty ? null : text;
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
    'audio' => 'Music and video listening volume.',
    'emoji' => 'Quick room reactions.',
    'youtube' => 'Select music or video for this room.',
    'beauty' => 'Camera filters and background options.',
    'screen' =>
      room.screenShareEnabled
          ? 'Presenter tools are available.'
          : 'Screen share is turned off.',
    'ops' => joined ? 'Host controls and stage requests.' : 'Host controls.',
    'guard' =>
      room.aiSecurityEnabled ? 'Safety tools are active.' : 'Safety tools off.',
    'chat' => room.chatEnabled ? 'Room comments.' : 'Comments off.',
    _ => 'Room menu.',
  };
}

IconData _toolPanelIcon(String panel) {
  return switch (panel) {
    'audio' => Icons.graphic_eq_rounded,
    'emoji' => Icons.emoji_emotions_outlined,
    'youtube' => Icons.smart_display_outlined,
    'beauty' => Icons.auto_awesome_rounded,
    'screen' => Icons.screen_share_outlined,
    'ops' => Icons.admin_panel_settings_outlined,
    'guard' => Icons.shield_outlined,
    'chat' => Icons.chat_bubble_outline,
    _ => Icons.tune_rounded,
  };
}

bool _supportsYouTubeRoom(Room room) {
  return room.supportsVideo ||
      musicRoomTypes.contains(room.roomType) ||
      liveRoomTypes.contains(room.roomType);
}

List<_ToolChip> _toolChips(String panel, Room room) {
  return switch (panel) {
    'audio' => const [
      _ToolChip('Noise', 'Ready'),
      _ToolChip('Voice', 'Natural'),
      _ToolChip('Mode', 'Mic stage'),
    ],
    'emoji' => const [
      _ToolChip('Smile', 'Ready'),
      _ToolChip('Love', 'Ready'),
      _ToolChip('Clap', 'Ready'),
      _ToolChip('Wow', 'Ready'),
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
      _ToolChip('Safety', room.aiSecurityEnabled ? 'Active' : 'Off'),
      _ToolChip('Chat', room.chatEnabled ? 'On' : 'Off'),
      _ToolChip('Stage', 'Native RTC'),
    ],
    _ => const [],
  };
}
