import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../navigation/app_routes.dart';
import '../services/api_client.dart';
import '../ui/rtc_assets.dart';
import '../ui/rtc_mobile_ui.dart';

class RoomListScreen extends StatefulWidget {
  const RoomListScreen({
    super.key,
    required this.api,
    required this.user,
    required this.onLoggedOut,
    this.onOpenProfile,
    this.onOpenSettings,
    this.onOpenAdmin,
    this.onOpenSdk,
  });

  final ApiClient api;
  final AppUser user;
  final Future<void> Function() onLoggedOut;
  final VoidCallback? onOpenProfile;
  final VoidCallback? onOpenSettings;
  final VoidCallback? onOpenAdmin;
  final VoidCallback? onOpenSdk;

  @override
  State<RoomListScreen> createState() => _RoomListScreenState();
}

class _RoomListScreenState extends State<RoomListScreen> {
  final _search = TextEditingController();
  late Future<List<Room>> _rooms;
  String _activeFeed = 'for_you';
  String _activeType = 'all';
  String _activePrivacy = 'all';
  String _activeSort = 'active';
  String _query = '';
  int? _deletingRoomId;

  @override
  void initState() {
    super.initState();
    _rooms = _loadRooms();
    _search.addListener(() {
      setState(() => _query = _search.text.trim().toLowerCase());
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<List<Room>> _loadRooms() {
    return widget.api.rooms(
      feed: _activeFeed,
      type: _activeType,
      privacy: _activePrivacy,
      sort: _activeSort,
      search: _query,
    );
  }

  Future<void> _refresh() async {
    final future = _loadRooms();
    setState(() => _rooms = future);
    await future;
  }

  void _changeFeed(_FeedTab tab) {
    final future = widget.api.rooms(
      feed: tab.value,
      type: _activeType,
      privacy: _activePrivacy,
      sort: tab.sort,
      search: _query,
    );
    setState(() {
      _activeFeed = tab.value;
      _activeSort = tab.sort;
      _rooms = future;
    });
  }

  void _changeType(String value) {
    final future = widget.api.rooms(
      feed: _activeFeed,
      type: value,
      privacy: _activePrivacy,
      sort: _activeSort,
      search: _query,
    );
    setState(() {
      _activeType = value;
      _rooms = future;
    });
  }

  void _changePrivacy(String value) {
    final future = widget.api.rooms(
      feed: _activeFeed,
      type: _activeType,
      privacy: value,
      sort: _activeSort,
      search: _query,
    );
    setState(() {
      _activePrivacy = value;
      _rooms = future;
    });
  }

  void _changeSort(String value) {
    final future = widget.api.rooms(
      feed: _activeFeed,
      type: _activeType,
      privacy: _activePrivacy,
      sort: value,
      search: _query,
    );
    setState(() {
      _activeSort = value;
      _rooms = future;
    });
  }

  Future<void> _logout() async {
    await widget.api.logout();
    await widget.onLoggedOut();
  }

  void _openRoom(Room room) {
    Navigator.of(context).pushNamed<void>(
      AppRoutes.liveRoom,
      arguments: LiveRoomRouteArgs(
        api: widget.api,
        user: widget.user,
        room: room,
        autoConnect: true,
      ),
    );
  }

  Future<void> _openCreateRoomSheet() async {
    final result = await showModalBottomSheet<_CreateRoomResult>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      enableDrag: false,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) =>
          _CreateRoomSheet(api: widget.api, user: widget.user),
    );

    if (!mounted || result == null) return;
    await _refresh();
    if (mounted && result.openRoom) _openRoom(result.room);
  }

  Future<void> _deleteRoom(Room room) async {
    if (room.ownerId != widget.user.id || _deletingRoomId != null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: RtcPalette.surface,
        title: const Text('Delete room'),
        content: Text(
          'Delete ${room.name}? This removes it from the live feed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _deletingRoomId = room.id);
    try {
      await widget.api.deleteRoom(room.id);
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(apiErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _deletingRoomId = null);
    }
  }

  void _handleBottomNav(_MobileNavAction action) {
    switch (action) {
      case _MobileNavAction.live:
        _returnToLiveFeed();
      case _MobileNavAction.profile:
        final onOpenProfile = widget.onOpenProfile;
        if (onOpenProfile != null) {
          onOpenProfile();
        } else {
          _showRailMessage('Profile is not available in this session.');
        }
      case _MobileNavAction.settings:
        final onOpenSettings = widget.onOpenSettings;
        if (onOpenSettings != null) {
          onOpenSettings();
        } else {
          _showRailMessage('Settings are not available in this session.');
        }
      case _MobileNavAction.help:
        final onOpenSdk = widget.onOpenSdk;
        if (onOpenSdk != null) {
          onOpenSdk();
        } else {
          _showRailMessage('Help is not available in this session.');
        }
    }
  }

  void _returnToLiveFeed() {
    _search.clear();
    final future = widget.api.rooms(
      feed: 'for_you',
      type: 'all',
      privacy: 'all',
      sort: 'active',
      search: '',
    );
    setState(() {
      _activeFeed = 'for_you';
      _activeType = 'all';
      _activePrivacy = 'all';
      _activeSort = 'active';
      _query = '';
      _rooms = future;
    });
  }

  void _showRailMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  List<Room> _visibleRooms(List<Room> rooms) {
    final visible = rooms.where((room) {
      if (!room.matchesTypeFilter(_activeType)) return false;
      if (!room.matchesPrivacyFilter(_activePrivacy)) return false;
      if (!room.matchesSearch(_query)) return false;
      if (_activeFeed == 'following') {
        return room.ownerFollowed || room.ownerId == widget.user.id;
      }
      return true;
    }).toList();

    visible.sort(_compareRooms);
    return visible;
  }

  int _compareRooms(Room a, Room b) {
    return switch (_activeSort) {
      'name' => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
      'oldest' => _dateValue(a.createdAt).compareTo(_dateValue(b.createdAt)),
      'newest' => _dateValue(b.createdAt).compareTo(_dateValue(a.createdAt)),
      _ =>
        b.activeParticipants.compareTo(a.activeParticipants) != 0
            ? b.activeParticipants.compareTo(a.activeParticipants)
            : _dateValue(b.createdAt).compareTo(_dateValue(a.createdAt)),
    };
  }

  @override
  Widget build(BuildContext context) {
    return RtcMobileFrame(
      backgroundColor: RtcPalette.lobbyBg,
      bottomNavigation: _MobileBottomNav(
        user: widget.user,
        onSelected: _handleBottomNav,
      ),
      child: SafeArea(
        top: false,
        child: FutureBuilder<List<Room>>(
          future: _rooms,
          builder: (context, snapshot) {
            final rooms = snapshot.data ?? const <Room>[];
            final visibleRooms = _visibleRooms(rooms);
            final activeFeed = _feedTabForValue(_activeFeed);
            final totalParticipants = rooms.fold<int>(
              0,
              (sum, room) => sum + room.activeParticipants,
            );

            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                key: const ValueKey('room_lobby_scroll'),
                padding: const EdgeInsets.only(bottom: 18),
                children: [
                  _MobileLobbyHero(
                    user: widget.user,
                    feed: activeFeed,
                    roomCount: rooms.length,
                    shownCount: visibleRooms.length,
                    participantCount: totalParticipants,
                    actions: _HeaderActions(
                      user: widget.user,
                      onProfile: widget.onOpenProfile,
                      onSettings: widget.onOpenSettings,
                      onAdmin: widget.onOpenAdmin,
                      onSdk: widget.onOpenSdk,
                      onRefresh: _refresh,
                      onLogout: _logout,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                    child: _FeedTabs(
                      active: _activeFeed,
                      onChanged: _changeFeed,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                    child: _SearchBox(
                      controller: _search,
                      onSubmitted: (_) => _refresh(),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                    child: _FilterControls(
                      type: _activeType,
                      privacy: _activePrivacy,
                      sort: _activeSort,
                      onTypeChanged: _changeType,
                      onPrivacyChanged: _changePrivacy,
                      onSortChanged: _changeSort,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                    child: _CreateRoomButton(onPressed: _openCreateRoomSheet),
                  ),
                  const SizedBox(height: 12),
                  if (snapshot.connectionState != ConnectionState.done)
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 12),
                      child: RtcLoadingPanel(label: 'Loading rooms...'),
                    )
                  else if (snapshot.hasError)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: RtcMessagePanel(
                        icon: Icons.cloud_off,
                        title: 'Could not load rooms',
                        detail: apiErrorMessage(snapshot.error!),
                        actionLabel: 'Retry',
                        onAction: _refresh,
                      ),
                    )
                  else if (visibleRooms.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: RtcMessagePanel(
                        icon: Icons.meeting_room_outlined,
                        title: rooms.isEmpty
                            ? 'No active rooms'
                            : 'No matching rooms',
                        detail: rooms.isEmpty
                            ? 'Create the first live room for this feed.'
                            : 'Try another room name, host, or room type.',
                        actionLabel: rooms.isEmpty
                            ? 'Create room'
                            : 'Reset filters',
                        onAction: rooms.isEmpty
                            ? _openCreateRoomSheet
                            : () async {
                                _search.clear();
                                final future = widget.api.rooms();
                                setState(() {
                                  _activeFeed = 'for_you';
                                  _activeType = 'all';
                                  _activePrivacy = 'all';
                                  _activeSort = 'active';
                                  _query = '';
                                  _rooms = future;
                                });
                                await future;
                              },
                      ),
                    )
                  else ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: _FeedSummary(
                        total: rooms.length,
                        shown: visibleRooms.length,
                        status: '${activeFeed.label} · $_activeSort',
                      ),
                    ),
                    const SizedBox(height: 10),
                    ...visibleRooms.asMap().entries.map(
                      (entry) => Padding(
                        padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                        child: _RoomCard(
                          room: entry.value,
                          index: entry.key,
                          featured: entry.key == 0,
                          canDelete: entry.value.ownerId == widget.user.id,
                          deleting: _deletingRoomId == entry.value.id,
                          onDelete: () => _deleteRoom(entry.value),
                          onTap: () => _openRoom(entry.value),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _CreateRoomResult {
  const _CreateRoomResult({required this.room, required this.openRoom});

  final Room room;
  final bool openRoom;
}

class _CreateRoomDraft {
  const _CreateRoomDraft({
    required this.name,
    required this.roomType,
    required this.privacyType,
    required this.maxMicCount,
  });

  final String name;
  final String roomType;
  final String privacyType;
  final int maxMicCount;
}

class _CreateRoomSheet extends StatefulWidget {
  const _CreateRoomSheet({required this.api, required this.user});

  final ApiClient api;
  final AppUser user;

  @override
  State<_CreateRoomSheet> createState() => _CreateRoomSheetState();
}

class _CreateRoomSheetState extends State<_CreateRoomSheet> {
  late final TextEditingController _name;
  final _description = TextEditingController(text: _defaultRoomDescription);
  final _profileImage = TextEditingController();
  final _password = TextEditingController();
  final _seats = TextEditingController(text: '8');
  String _roomType = 'video';
  String _privacyType = 'public';
  String _theme = _defaultRoomTheme;
  bool _chatEnabled = true;
  bool _giftEnabled = false;
  bool _screenShareEnabled = false;
  bool _aiSecurityEnabled = false;
  bool _creating = false;
  String _status = 'Choose room details and go live.';
  Map<String, String> _errors = const {};
  _CreateRoomDraft? _pendingDraft;
  Room? _createdRoom;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController();
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _profileImage.dispose();
    _password.dispose();
    _seats.dispose();
    super.dispose();
  }

  void _close({bool openRoom = false}) {
    final room = _createdRoom;
    Navigator.of(context).pop(
      room == null ? null : _CreateRoomResult(room: room, openRoom: openRoom),
    );
  }

  void _updateRoomType(String value) {
    final maxSeats = _maxSeatsForRoomType(value);
    final currentSeats = int.tryParse(_seats.text.trim()) ?? 0;
    setState(() {
      _roomType = value;
      if (currentSeats < 1 || currentSeats > maxSeats) {
        _seats.text = _defaultSeatsForRoomType(value).toString();
      }
      _clearError('room_type');
      _clearError('max_mic_count');
    });
  }

  void _updatePrivacy(String value) {
    setState(() {
      _privacyType = value;
      _clearError('privacy_type');
      if (value != 'password') {
        _password.clear();
        _clearError('password');
      }
    });
  }

  void _updateFeature(String field, bool value) {
    setState(() {
      switch (field) {
        case 'chat_enabled':
          _chatEnabled = value;
          break;
        case 'gift_enabled':
          _giftEnabled = value;
          break;
        case 'screen_share_enabled':
          _screenShareEnabled = value;
          break;
        case 'ai_security_enabled':
          _aiSecurityEnabled = value;
          break;
      }
    });
  }

  void _clearError(String field) {
    if (!_errors.containsKey(field) && !_errors.containsKey('submit')) return;
    final next = {..._errors}
      ..remove(field)
      ..remove('submit');
    _errors = next;
  }

  Future<void> _create() async {
    final submitName = _name.text.trim().isEmpty
        ? _defaultLiveRoomName(widget.user.name)
        : _name.text.trim();
    final submitForm = _RoomFormValues(
      name: submitName,
      description: _description.text,
      profileImage: _profileImage.text,
      roomType: _roomType,
      privacyType: _privacyType,
      password: _password.text,
      maxMicCount: _seats.text,
    );
    final nextErrors = _validateRoomForm(submitForm);

    if (nextErrors.isNotEmpty) {
      setState(() {
        _errors = nextErrors;
        _status = 'Please fix the highlighted room details.';
      });
      return;
    }

    final seats = _normalizedRoomSeatCount(_seats.text, _roomType);
    final draft = _CreateRoomDraft(
      name: submitName,
      roomType: _roomType,
      privacyType: _privacyType,
      maxMicCount: seats,
    );

    setState(() {
      _creating = true;
      _createdRoom = null;
      _pendingDraft = draft;
      _errors = const {};
      _status = 'Preparing $submitName...';
    });

    try {
      final room = await widget.api.createRoom(
        name: submitName,
        description: _description.text.trim(),
        profileImage: _profileImage.text.trim(),
        roomType: _roomType,
        privacyType: _privacyType,
        password: _password.text.trim(),
        maxMicCount: seats,
        theme: _theme,
        chatEnabled: _chatEnabled,
        giftEnabled: _giftEnabled,
        screenShareEnabled: _screenShareEnabled,
        aiSecurityEnabled: _aiSecurityEnabled,
      );
      if (!mounted) return;
      _password.clear();
      setState(() {
        _createdRoom = room;
        _pendingDraft = null;
        _status = 'Created room #${room.id}. Open it when ready.';
      });
    } catch (error) {
      final submitMessage = apiErrorMessage(error);
      setState(() {
        _pendingDraft = null;
        _errors = {..._roomFormErrorsFromApi(error), 'submit': submitMessage};
        _status = submitMessage;
      });
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  void _createAnother() {
    setState(() {
      _createdRoom = null;
      _status = 'Choose room details and go live.';
      _errors = const {};
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    final maxSeats = _maxSeatsForRoomType(_roomType);
    final launchPreview = _createdRoom == null
        ? _pendingDraft
        : _CreateRoomDraft(
            name: _createdRoom!.name,
            roomType: _createdRoom!.roomType,
            privacyType: _createdRoom!.privacyType,
            maxMicCount: _createdRoom!.maxMicCount,
          );

    return Padding(
      padding: EdgeInsets.fromLTRB(12, 12, 12, bottomInset + 12),
      child: GlassPanel(
        padding: const EdgeInsets.all(16),
        color: const Color.fromRGBO(15, 23, 42, 0.98),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: BrandHeader(
                      title: 'Create Live Room',
                      subtitle: 'Host panel',
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: _creating ? null : _close,
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _name,
                textInputAction: TextInputAction.next,
                onChanged: (_) => setState(() => _clearError('name')),
                decoration: const InputDecoration(
                  labelText: 'Room name',
                  hintText: 'Enterprise Live Room',
                  prefixIcon: Icon(Icons.live_tv_outlined),
                ).copyWith(errorText: _errors['name']),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _description,
                maxLines: 3,
                minLines: 2,
                maxLength: 700,
                onChanged: (_) => setState(() => _clearError('description')),
                decoration: const InputDecoration(
                  labelText: 'Description',
                  prefixIcon: Icon(Icons.subject),
                ).copyWith(errorText: _errors['description']),
              ),
              const SizedBox(height: 12),
              _CreateFieldLabel(label: 'Room Type'),
              _CreateChoiceGrid(
                options: _roomTypeChoices,
                active: _roomType,
                onChanged: _updateRoomType,
              ),
              const SizedBox(height: 12),
              _CreateFieldLabel(label: 'Privacy'),
              _CreateChoiceGrid(
                options: _privacyChoices,
                active: _privacyType,
                onChanged: _updatePrivacy,
              ),
              if (_privacyType == 'password') ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  keyboardType: TextInputType.visiblePassword,
                  textInputAction: TextInputAction.next,
                  onChanged: (_) => setState(() => _clearError('password')),
                  decoration: const InputDecoration(
                    labelText: 'Password',
                    prefixIcon: Icon(Icons.key),
                  ).copyWith(errorText: _errors['password']),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 104,
                    child: TextField(
                      controller: _seats,
                      keyboardType: TextInputType.number,
                      onChanged: (_) =>
                          setState(() => _clearError('max_mic_count')),
                      decoration: InputDecoration(
                        labelText: 'Stage Seats',
                        helperText: 'Max $maxSeats',
                      ).copyWith(errorText: _errors['max_mic_count']),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _theme,
                      decoration: const InputDecoration(
                        labelText: 'Theme',
                        prefixIcon: Icon(Icons.palette_outlined),
                      ),
                      dropdownColor: RtcPalette.surface2,
                      items: _themeOptions
                          .map(
                            (option) => DropdownMenuItem(
                              value: option.value,
                              child: Text(option.label),
                            ),
                          )
                          .toList(),
                      onChanged: (value) {
                        if (value != null) setState(() => _theme = value);
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _profileImage,
                keyboardType: TextInputType.url,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Profile image URL',
                  prefixIcon: Icon(Icons.image_outlined),
                ),
              ),
              const SizedBox(height: 12),
              _CreateFieldLabel(label: 'Room Features'),
              const SizedBox(height: 8),
              _FeatureToggleGrid(
                values: {
                  'chat_enabled': _chatEnabled,
                  'gift_enabled': _giftEnabled,
                  'screen_share_enabled': _screenShareEnabled,
                  'ai_security_enabled': _aiSecurityEnabled,
                },
                onChanged: _updateFeature,
              ),
              const SizedBox(height: 14),
              StatusPill(
                label: _creating ? 'Working' : 'Status',
                detail: _status,
                state:
                    _status.toLowerCase().contains('error') ||
                        _status.toLowerCase().contains('must') ||
                        _status.toLowerCase().contains('need')
                    ? RtcStatusState.error
                    : _creating
                    ? RtcStatusState.warning
                    : RtcStatusState.idle,
              ),
              if (_errors['submit'] != null) ...[
                const SizedBox(height: 8),
                Text(
                  _errors['submit']!,
                  style: const TextStyle(
                    color: RtcPalette.red,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
              if (launchPreview != null) ...[
                const SizedBox(height: 14),
                _RoomLaunchSummary(
                  draft: launchPreview,
                  room: _createdRoom,
                  pending: _creating,
                  onOpen: _createdRoom == null
                      ? null
                      : () => _close(openRoom: true),
                  onCreateAnother: _createdRoom == null ? null : _createAnother,
                ),
              ],
              const SizedBox(height: 14),
              GradientButton(
                onPressed: _creating ? null : _create,
                icon: _creating
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: RtcPalette.text,
                        ),
                      )
                    : const Icon(Icons.add, color: RtcPalette.text),
                child: const Text('Create Live Room'),
              ),
              if (_createdRoom != null) ...[
                const SizedBox(height: 10),
                GhostButton(
                  onPressed: () => _close(openRoom: false),
                  icon: Icons.check_circle_outline,
                  label: 'Done',
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _CreateFieldLabel extends StatelessWidget {
  const _CreateFieldLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: const TextStyle(
        color: RtcPalette.soft,
        fontSize: 12,
        fontWeight: FontWeight.w900,
      ),
    );
  }
}

class _CreateChoiceGrid extends StatelessWidget {
  const _CreateChoiceGrid({
    required this.options,
    required this.active,
    required this.onChanged,
  });

  final List<_CreateOption> options;
  final String active;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: options.map((option) {
        final selected = option.value == active;
        return ChoiceChip(
          selected: selected,
          label: Text(option.label),
          onSelected: (_) => onChanged(option.value),
          selectedColor: const Color.fromRGBO(56, 189, 248, 0.2),
          backgroundColor: RtcPalette.hoverBg,
          side: BorderSide(
            color: selected
                ? const Color.fromRGBO(56, 189, 248, 0.48)
                : RtcPalette.line,
          ),
          labelStyle: TextStyle(
            color: selected ? RtcPalette.text : RtcPalette.soft,
            fontWeight: FontWeight.w900,
          ),
        );
      }).toList(),
    );
  }
}

class _FeatureToggleGrid extends StatelessWidget {
  const _FeatureToggleGrid({required this.values, required this.onChanged});

  final Map<String, bool> values;
  final void Function(String field, bool value) onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: _featureOptions.map((option) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Container(
            decoration: BoxDecoration(
              color: RtcPalette.hoverBg,
              border: Border.all(color: RtcPalette.line),
              borderRadius: BorderRadius.circular(RtcRadius.control),
            ),
            child: Material(
              color: Colors.transparent,
              child: SwitchListTile(
                dense: true,
                value: values[option.value] ?? false,
                onChanged: (value) => onChanged(option.value, value),
                activeThumbColor: RtcPalette.sky,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                title: Text(
                  option.label,
                  style: const TextStyle(
                    color: RtcPalette.text,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                subtitle: Text(
                  option.detail,
                  style: const TextStyle(
                    color: RtcPalette.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _RoomLaunchSummary extends StatelessWidget {
  const _RoomLaunchSummary({
    required this.draft,
    required this.room,
    required this.pending,
    required this.onOpen,
    required this.onCreateAnother,
  });

  final _CreateRoomDraft draft;
  final Room? room;
  final bool pending;
  final VoidCallback? onOpen;
  final VoidCallback? onCreateAnother;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: const EdgeInsets.all(12),
      color: RtcPalette.panelGlass.withValues(alpha: 0.82),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          StatusPill(
            label: pending ? 'Creating' : 'Ready to open',
            state: pending ? RtcStatusState.warning : RtcStatusState.good,
          ),
          const SizedBox(height: 10),
          Text(
            draft.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: RtcPalette.text,
              fontWeight: FontWeight.w900,
              height: RtcTypography.tightHeight,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              MetricChip(
                label: 'Room ID',
                value: room == null ? 'Creating...' : room!.id.toString(),
              ),
              MetricChip(
                label: 'Room Type',
                value: roomTypeMeta(draft.roomType).label,
              ),
              MetricChip(
                label: 'Privacy',
                value: formatPrivacy(draft.privacyType),
              ),
              MetricChip(
                label: 'Seats',
                value: _getSeatLabel(draft.roomType, draft.maxMicCount),
              ),
            ],
          ),
          if (room != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: GradientButton(
                    onPressed: onOpen,
                    icon: const Icon(Icons.login, color: RtcPalette.text),
                    child: const Text('Open room'),
                  ),
                ),
                const SizedBox(width: 10),
                RtcIconButton(
                  tooltip: 'Create another',
                  icon: Icons.add,
                  onPressed: onCreateAnother,
                  size: 44,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _HeaderActions extends StatelessWidget {
  const _HeaderActions({
    required this.user,
    required this.onProfile,
    required this.onSettings,
    required this.onAdmin,
    required this.onSdk,
    required this.onRefresh,
    required this.onLogout,
  });

  final AppUser user;
  final VoidCallback? onProfile;
  final VoidCallback? onSettings;
  final VoidCallback? onAdmin;
  final VoidCallback? onSdk;
  final VoidCallback onRefresh;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(RtcRadius.brand),
          onTap: onProfile,
          child: InitialAvatar(user: user, size: 40),
        ),
        const SizedBox(width: 6),
        if (onAdmin != null) ...[
          RtcIconButton(
            tooltip: 'Admin Dashboard',
            icon: Icons.admin_panel_settings_outlined,
            onPressed: onAdmin!,
          ),
          const SizedBox(width: 6),
        ],
        if (onSettings != null) ...[
          RtcIconButton(
            tooltip: 'Settings',
            icon: Icons.settings_outlined,
            onPressed: onSettings!,
          ),
          const SizedBox(width: 6),
        ],
        if (onSdk != null) ...[
          RtcIconButton(
            tooltip: 'Developer Docs',
            icon: Icons.integration_instructions_outlined,
            onPressed: onSdk!,
          ),
          const SizedBox(width: 6),
        ],
        RtcIconButton(
          tooltip: 'Refresh',
          icon: Icons.refresh,
          onPressed: onRefresh,
        ),
        const SizedBox(width: 6),
        RtcIconButton(
          tooltip: 'Sign out',
          icon: Icons.logout,
          onPressed: onLogout,
        ),
      ],
    );
  }
}

class _MobileLobbyHero extends StatelessWidget {
  const _MobileLobbyHero({
    required this.user,
    required this.feed,
    required this.roomCount,
    required this.shownCount,
    required this.participantCount,
    required this.actions,
  });

  final AppUser user;
  final _FeedTab feed;
  final int roomCount;
  final int shownCount;
  final int participantCount;
  final Widget actions;

  @override
  Widget build(BuildContext context) {
    return RtcLobbyHero(
      title: 'TalkEachOther',
      subtitle:
          '${compactNumber(shownCount)}/${compactNumber(roomCount)} rooms · ${compactNumber(participantCount)} live',
      leading: InitialAvatar(user: user, size: 48),
      background: const AssetImage(RtcAssets.smartMobileHeroBg),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: RtcPalette.lobbySurface,
              borderRadius: BorderRadius.circular(14),
              boxShadow: const [
                BoxShadow(
                  color: Color.fromRGBO(15, 23, 42, 0.1),
                  blurRadius: 18,
                  offset: Offset(0, 8),
                ),
              ],
            ),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.asset(
                    RtcAssets.videoRoom,
                    width: 58,
                    height: 58,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        feed.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: RtcPalette.lobbyInk,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                          height: 1.1,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        feed.detail,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF8B8B8B),
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, color: RtcPalette.lobbyGold),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: actions,
          ),
        ],
      ),
    );
  }
}

class _CreateRoomButton extends StatelessWidget {
  const _CreateRoomButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: ElevatedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.add),
        label: const Text('Create room'),
        style: ElevatedButton.styleFrom(
          backgroundColor: RtcPalette.lobbyTealDark,
          foregroundColor: Colors.white,
          elevation: 0,
          textStyle: const TextStyle(fontWeight: FontWeight.w900),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }
}

enum _MobileNavAction { live, profile, settings, help }

class _MobileBottomNav extends StatelessWidget {
  const _MobileBottomNav({required this.user, required this.onSelected});

  final AppUser user;
  final ValueChanged<_MobileNavAction> onSelected;

  @override
  Widget build(BuildContext context) {
    final useAdminAvatar = RtcAssets.shouldUseAdminAvatar(user);
    return RtcMobileBottomNav(
      activeIndex: 0,
      onChanged: (index) => onSelected(_MobileNavAction.values[index]),
      items: [
        const RtcMobileBottomNavItem(asset: RtcAssets.railLive, label: 'Live'),
        RtcMobileBottomNavItem(
          asset: useAdminAvatar ? RtcAssets.adminDashboardAvatar : null,
          image: useAdminAvatar ? null : RtcAssets.avatarImageForUser(user),
          label: 'Me',
        ),
        const RtcMobileBottomNavItem(
          asset: RtcAssets.settingsIcon,
          label: 'Settings',
        ),
        const RtcMobileBottomNavItem(
          asset: RtcAssets.feedbackHelpIcon,
          label: 'Help',
        ),
      ],
    );
  }
}

class _FeedTabs extends StatelessWidget {
  const _FeedTabs({required this.active, required this.onChanged});

  final String active;
  final ValueChanged<_FeedTab> onChanged;

  @override
  Widget build(BuildContext context) {
    final activeIndex = _feedTabs.indexWhere((tab) => tab.value == active);
    return RtcCompactTabs(
      tabs: _feedTabs.map((tab) => tab.mobileLabel).toList(),
      activeIndex: activeIndex < 0 ? 1 : activeIndex,
      onChanged: (index) => onChanged(_feedTabs[index]),
    );
  }
}

class _SearchBox extends StatelessWidget {
  const _SearchBox({required this.controller, required this.onSubmitted});

  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.text,
      textInputAction: TextInputAction.search,
      onSubmitted: onSubmitted,
      cursorColor: RtcPalette.lobbyTealDark,
      style: const TextStyle(
        color: RtcPalette.lobbyInk,
        fontWeight: FontWeight.w800,
      ),
      decoration: InputDecoration(
        hintText: 'Search room or host',
        hintStyle: const TextStyle(
          color: RtcPalette.lobbyMuted,
          fontWeight: FontWeight.w700,
        ),
        prefixIcon: const Icon(Icons.search, color: RtcPalette.lobbySoft),
        filled: true,
        fillColor: RtcPalette.lobbySurface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 13,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(color: RtcPalette.lobbyLine),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(
            color: RtcPalette.lobbyTealDark,
            width: 1.4,
          ),
        ),
      ),
    );
  }
}

class _FilterControls extends StatelessWidget {
  const _FilterControls({
    required this.type,
    required this.privacy,
    required this.sort,
    required this.onTypeChanged,
    required this.onPrivacyChanged,
    required this.onSortChanged,
  });

  final String type;
  final String privacy;
  final String sort;
  final ValueChanged<String> onTypeChanged;
  final ValueChanged<String> onPrivacyChanged;
  final ValueChanged<String> onSortChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: RtcPalette.lobbySurface,
        border: Border.all(color: RtcPalette.lobbyLine),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.05),
            blurRadius: 16,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          SizedBox(
            height: 36,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _typeFilters.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final option = _typeFilters[index];
                return _MobileFilterChip(
                  label: option.label,
                  selected: option.value == type,
                  onTap: () => onTypeChanged(option.value),
                );
              },
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _LightDropdown(
                  label: 'Access',
                  value: privacy,
                  options: _privacyFilters,
                  onChanged: onPrivacyChanged,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _LightDropdown(
                  label: 'Sort',
                  value: sort,
                  options: _sortOptions,
                  onChanged: onSortChanged,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MobileFilterChip extends StatelessWidget {
  const _MobileFilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? RtcPalette.lobbyMint : const Color(0xFFF5F7F8),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 13),
          decoration: BoxDecoration(
            border: Border.all(
              color: selected ? RtcPalette.lobbyTealDark : Colors.transparent,
            ),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? RtcPalette.lobbyTealDark : RtcPalette.lobbySoft,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ),
    );
  }
}

class _LightDropdown extends StatelessWidget {
  const _LightDropdown({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<_FilterOption> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      dropdownColor: RtcPalette.lobbySurface,
      iconEnabledColor: RtcPalette.lobbySoft,
      style: const TextStyle(
        color: RtcPalette.lobbyInk,
        fontSize: 13,
        fontWeight: FontWeight.w800,
      ),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(
          color: RtcPalette.lobbySoft,
          fontWeight: FontWeight.w800,
        ),
        filled: true,
        fillColor: const Color(0xFFF8FAFB),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: RtcPalette.lobbyLine),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(
            color: RtcPalette.lobbyTealDark,
            width: 1.4,
          ),
        ),
      ),
      items: options
          .map(
            (option) => DropdownMenuItem(
              value: option.value,
              child: Text(
                option.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          )
          .toList(),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
    );
  }
}

class _FeedSummary extends StatelessWidget {
  const _FeedSummary({
    required this.total,
    required this.shown,
    required this.status,
  });

  final int total;
  final int shown;
  final String status;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            '$shown of $total rooms · $status',
            style: const TextStyle(
              color: RtcPalette.lobbySoft,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    );
  }
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({
    required this.room,
    required this.index,
    required this.onTap,
    required this.onDelete,
    this.featured = false,
    this.canDelete = false,
    this.deleting = false,
  });

  final Room room;
  final int index;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final bool featured;
  final bool canDelete;
  final bool deleting;

  @override
  Widget build(BuildContext context) {
    final tags = <String>[
      if (featured) 'Featured',
      formatPrivacy(room.privacyType),
      if (room.displayRegion.isNotEmpty) room.displayRegion,
      ...room.featureTags.take(1),
    ];

    return RtcLobbyRoomRow(
      title: room.name,
      subtitle: room.displayHost,
      image: RtcAssets.coverImageForRoom(room, index),
      badge: room.roomTypeLabel,
      tags: tags,
      liveCount: room.activeParticipants,
      locked: room.isLocked,
      onTap: onTap,
      trailing: canDelete
          ? SizedBox.square(
              dimension: 38,
              child: IconButton(
                tooltip: deleting ? 'Deleting room' : 'Delete room',
                padding: EdgeInsets.zero,
                onPressed: deleting ? null : onDelete,
                icon: deleting
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: RtcPalette.lobbyTealDark,
                        ),
                      )
                    : const Icon(
                        Icons.delete_outline,
                        color: RtcPalette.red,
                        size: 22,
                      ),
              ),
            )
          : null,
    );
  }
}

class _FeedTab {
  const _FeedTab({
    required this.value,
    required this.label,
    required this.mobileLabel,
    required this.sort,
    required this.detail,
  });

  final String value;
  final String label;
  final String mobileLabel;
  final String sort;
  final String detail;
}

class _FilterOption {
  const _FilterOption({required this.value, required this.label});

  final String value;
  final String label;
}

class _CreateOption {
  const _CreateOption({
    required this.value,
    required this.label,
    this.detail = '',
  });

  final String value;
  final String label;
  final String detail;
}

class _RoomFormValues {
  const _RoomFormValues({
    required this.name,
    required this.description,
    required this.profileImage,
    required this.roomType,
    required this.privacyType,
    required this.password,
    required this.maxMicCount,
  });

  final String name;
  final String description;
  final String profileImage;
  final String roomType;
  final String privacyType;
  final String password;
  final String maxMicCount;
}

const _defaultRoomTheme = 'neon';
const _defaultRoomDescription =
    'A hosted room for live video, music, chat, and creator collaboration.';
const _maxRoomSeats = 20;
const _oneToOneRoomSeats = 2;

const _roomTypeChoices = [
  _CreateOption(value: 'audio', label: 'Music Room'),
  _CreateOption(value: 'youtube_audio', label: 'YouTube Audio'),
  _CreateOption(value: 'one_to_one_audio', label: '1:1 Voice'),
  _CreateOption(value: 'video', label: 'Video Room'),
  _CreateOption(value: 'one_to_one_video', label: '1:1 Video'),
  _CreateOption(value: 'group_audio', label: 'Group Music'),
  _CreateOption(value: 'group_video', label: 'Group Video'),
  _CreateOption(value: 'solo_live', label: 'Solo Live'),
  _CreateOption(value: 'pk_live', label: 'PK Live'),
];

const _privacyChoices = [
  _CreateOption(value: 'public', label: 'Public'),
  _CreateOption(value: 'private', label: 'Private'),
  _CreateOption(value: 'password', label: 'Password'),
];

const _themeOptions = [
  _CreateOption(value: 'neon', label: 'Neon'),
  _CreateOption(value: 'midnight', label: 'Midnight'),
  _CreateOption(value: 'studio', label: 'Studio'),
  _CreateOption(value: 'mint', label: 'Mint'),
];

const _featureOptions = [
  _CreateOption(value: 'chat_enabled', label: 'Chat', detail: 'Live messages'),
  _CreateOption(
    value: 'gift_enabled',
    label: 'Gifts',
    detail: 'Room reactions',
  ),
  _CreateOption(
    value: 'screen_share_enabled',
    label: 'Screen share',
    detail: 'Presenter tools',
  ),
  _CreateOption(
    value: 'ai_security_enabled',
    label: 'Guard',
    detail: 'Moderation layer',
  ),
];

const _feedTabs = [
  _FeedTab(
    value: 'following',
    label: 'Following',
    mobileLabel: 'Mine',
    sort: 'active',
    detail: 'rooms from you and followed hosts are first.',
  ),
  _FeedTab(
    value: 'for_you',
    label: 'For You',
    mobileLabel: 'Popular',
    sort: 'active',
    detail: 'popular rooms are ready to join.',
  ),
  _FeedTab(
    value: 'explore',
    label: 'Explore',
    mobileLabel: 'Explore',
    sort: 'active',
    detail: 'discover live rooms across categories.',
  ),
  _FeedTab(
    value: 'nearby',
    label: 'Nearby',
    mobileLabel: 'Nearby',
    sort: 'active',
    detail: 'nearby hosts and regional rooms appear here.',
  ),
  _FeedTab(
    value: 'latest',
    label: 'Latest',
    mobileLabel: 'Latest',
    sort: 'newest',
    detail: 'newly-created rooms appear first.',
  ),
  _FeedTab(
    value: 'global',
    label: 'Global',
    mobileLabel: 'Global',
    sort: 'active',
    detail: 'global public and password rooms are available.',
  ),
];

const _typeFilters = [
  _FilterOption(value: 'all', label: 'All types'),
  _FilterOption(value: 'live', label: 'Live'),
  _FilterOption(value: 'video', label: 'Video'),
  _FilterOption(value: 'music', label: 'Music'),
  _FilterOption(value: 'pk', label: 'PK'),
];

const _privacyFilters = [
  _FilterOption(value: 'all', label: 'All access'),
  _FilterOption(value: 'public', label: 'Public'),
  _FilterOption(value: 'private', label: 'Private'),
  _FilterOption(value: 'password', label: 'Password'),
];

const _sortOptions = [
  _FilterOption(value: 'newest', label: 'Newest'),
  _FilterOption(value: 'active', label: 'Most active'),
  _FilterOption(value: 'name', label: 'Name'),
  _FilterOption(value: 'oldest', label: 'Oldest'),
];

_FeedTab _feedTabForValue(String value) {
  return _feedTabs.firstWhere(
    (tab) => tab.value == value,
    orElse: () => _feedTabs[1],
  );
}

String _defaultLiveRoomName(String displayName) {
  final ownerName = displayName.trim();
  return ownerName.isEmpty ? 'Enterprise Live Room' : '$ownerName Live Room';
}

bool _isOneToOneRoom(String roomType) {
  return roomType == 'one_to_one_audio' || roomType == 'one_to_one_video';
}

int _maxSeatsForRoomType(String roomType) {
  return _isOneToOneRoom(roomType) ? _oneToOneRoomSeats : _maxRoomSeats;
}

int _defaultSeatsForRoomType(String roomType) {
  if (_isOneToOneRoom(roomType)) return _oneToOneRoomSeats;
  if (roomType == 'solo_live') return 1;
  return 8;
}

int _normalizedRoomSeatCount(String value, String roomType) {
  final seats = int.tryParse(value.trim());
  if (seats == null) return _defaultSeatsForRoomType(roomType);
  return seats.clamp(1, _maxSeatsForRoomType(roomType));
}

String _getSeatLabel(String roomType, int count) {
  final label = _isOneToOneRoom(roomType)
      ? 'call seat'
      : musicRoomTypes.contains(roomType)
      ? 'music seat'
      : 'stage seat';
  return '$count $label${count == 1 ? '' : 's'}';
}

Map<String, String> _validateRoomForm(_RoomFormValues form) {
  final errors = <String, String>{};
  final name = form.name.trim();
  final password = form.password.trim();
  final maxMicCount = int.tryParse(form.maxMicCount.trim());
  final maxAllowedSeats = _maxSeatsForRoomType(form.roomType);

  if (name.isEmpty) errors['name'] = 'Room name is required.';
  if (name.isNotEmpty && name.length < 3) {
    errors['name'] = 'Use at least 3 characters.';
  }
  if (name.length > 150) {
    errors['name'] = 'Keep the room name under 150 characters.';
  }
  if (form.description.length > 700) {
    errors['description'] = 'Keep the description under 700 characters.';
  }
  if (maxMicCount == null || maxMicCount < 1 || maxMicCount > maxAllowedSeats) {
    errors['max_mic_count'] = _isOneToOneRoom(form.roomType)
        ? 'Choose 1 or 2 call seats.'
        : 'Choose 1 to $_maxRoomSeats mic seats.';
  }
  if (form.privacyType == 'password' && password.length < 4) {
    errors['password'] = 'Use at least 4 characters.';
  }

  return errors;
}

Map<String, String> _roomFormErrorsFromApi(Object error) {
  if (error is! DioException) return const {};
  final data = error.response?.data;
  if (data is! Map) return const {};
  final errors = data['errors'];
  if (errors is! Map) return const {};
  return errors.map((key, value) {
    final message = value is List && value.isNotEmpty
        ? value.first.toString()
        : value.toString();
    return MapEntry(key.toString(), message);
  });
}

String compactNumber(num value) {
  final number = value.toDouble();
  if (number >= 1000000) {
    return '${(number / 1000000).toStringAsFixed(1)}M';
  }
  if (number >= 1000) {
    final precision = number >= 10000 ? 0 : 1;
    return '${(number / 1000).toStringAsFixed(precision)}K';
  }
  return number.truncate().toString();
}

String formatRoomDate(String value) {
  final date = DateTime.tryParse(value);
  if (date == null) return 'New';
  final now = DateTime.now();
  final diff = now.difference(date.toLocal());
  if (diff.inMinutes < 1) return 'Now';
  if (diff.inHours < 1) return '${diff.inMinutes}m ago';
  if (diff.inDays < 1) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return '${date.month}/${date.day}/${date.year}';
}

int _dateValue(String value) {
  return DateTime.tryParse(value)?.millisecondsSinceEpoch ?? 0;
}
