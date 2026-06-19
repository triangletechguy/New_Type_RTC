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
  });

  final ApiClient api;
  final AppUser user;
  final Future<void> Function() onLoggedOut;
  final VoidCallback? onOpenProfile;
  final VoidCallback? onOpenSettings;
  final VoidCallback? onOpenAdmin;

  @override
  State<RoomListScreen> createState() => _RoomListScreenState();
}

class _RoomListScreenState extends State<RoomListScreen> {
  final _search = TextEditingController();
  final _messageInput = TextEditingController();
  late Future<List<Room>> _rooms;
  Future<List<Map<String, dynamic>>>? _messageContacts;
  Future<List<Map<String, dynamic>>>? _activeConversation;
  _MobileNavAction _activeNav = _MobileNavAction.live;
  String _mobileRoomGroup = 'recently';
  String _activeSettings = 'account';
  String _activeFeed = 'for_you';
  String _activeType = 'all';
  String _activePrivacy = 'all';
  String _activeSort = 'active';
  String _query = '';
  String _settingsStatus = 'Changes are applied immediately for this session.';
  String _messageStatus = '';
  bool _searchOpen = false;
  int? _activeContactId;
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
    _messageInput.dispose();
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
    setState(() {
      _rooms = future;
    });
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
      _activeNav = _MobileNavAction.live;
      _activeFeed = tab.value;
      _activeSort = tab.sort;
      _mobileRoomGroup = switch (tab.value) {
        'following' => 'follow',
        'global' => 'group',
        _ => 'recently',
      };
      _rooms = future;
    });
  }

  void _changeMobileRoomGroup(String value) {
    final feed = switch (value) {
      'follow' => _feedTabForValue('following'),
      'group' => _feedTabForValue('global'),
      _ => _feedTabForValue('for_you'),
    };
    _changeFeed(feed);
    setState(() => _mobileRoomGroup = value);
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
    setState(() => _activeNav = action);
    if (action == _MobileNavAction.live) {
      _returnToLiveFeed();
    } else if (action == _MobileNavAction.message) {
      _loadMessageContacts();
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
      _activeNav = _MobileNavAction.live;
      _activeFeed = 'for_you';
      _activeType = 'all';
      _activePrivacy = 'all';
      _activeSort = 'active';
      _mobileRoomGroup = 'recently';
      _query = '';
      _rooms = future;
    });
  }

  void _loadMessageContacts() {
    _messageContacts = widget.api.directMessageContacts();
  }

  void _openConversation(Map<String, dynamic> contact) {
    final peerId = _mapInt(contact['peer_id'] ?? contact['id']);
    if (peerId == null) return;
    setState(() {
      _activeContactId = peerId;
      _activeConversation = widget.api.directMessages(peerId);
      _messageStatus = '';
    });
  }

  Future<void> _sendDirectMessage() async {
    final peerId = _activeContactId;
    final body = _messageInput.text.trim();
    if (peerId == null || body.isEmpty) return;

    setState(() => _messageStatus = 'Sending...');
    try {
      await widget.api.sendDirectMessage(peerId, body: body);
      _messageInput.clear();
      setState(() {
        _activeConversation = widget.api.directMessages(peerId);
        _messageContacts = widget.api.directMessageContacts();
        _messageStatus = '';
      });
    } catch (error) {
      setState(() => _messageStatus = apiErrorMessage(error));
    }
  }

  void _updateSettingsStatus(String message) {
    setState(() => _settingsStatus = message);
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
        active: _activeNav,
        onSelected: _handleBottomNav,
      ),
      child: switch (_activeNav) {
        _MobileNavAction.live => _buildLiveTab(),
        _MobileNavAction.help => _HelpTab(
          onSubmitFeedback: () {
            _showRailMessage('Feedback form is coming soon.');
          },
        ),
        _MobileNavAction.settings => _SettingsTab(
          active: _activeSettings,
          status: _settingsStatus,
          onChanged: (value) => setState(() => _activeSettings = value),
          onStatus: _updateSettingsStatus,
        ),
        _MobileNavAction.message => _MessageTab(
          user: widget.user,
          contactsFuture: _messageContacts ??= widget.api
              .directMessageContacts(),
          activeContactId: _activeContactId,
          conversationFuture: _activeConversation,
          input: _messageInput,
          status: _messageStatus,
          onOpenContact: _openConversation,
          onSend: _sendDirectMessage,
        ),
        _MobileNavAction.profile => _MeTab(
          user: widget.user,
          onEditProfile: widget.onOpenProfile,
          onLogout: _logout,
        ),
      },
    );
  }

  Widget _buildLiveTab() {
    return SafeArea(
      top: false,
      child: FutureBuilder<List<Room>>(
        future: _rooms,
        builder: (context, snapshot) {
          final rooms = snapshot.data ?? const <Room>[];
          final visibleRooms = _visibleRooms(rooms);
          final featuredRoom = _featuredRoom(rooms);

          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              key: const ValueKey('room_lobby_scroll'),
              padding: const EdgeInsets.only(bottom: 18),
              children: [
                _MobileHomeHero(
                  user: widget.user,
                  activeFeed: _activeFeed,
                  featuredRoom: featuredRoom,
                  onOpenRoom: _openRoom,
                  onFeedChanged: (value) =>
                      _changeFeed(_feedTabForValue(value)),
                  onHome: _returnToLiveFeed,
                  onSearch: () => setState(() {
                    _searchOpen = !_searchOpen;
                    _query = _search.text.trim().toLowerCase();
                  }),
                  search: _search,
                  searchOpen: _searchOpen,
                  onSearchSubmitted: (_) => _refresh(),
                ),
                _MobileRoomGroupTabs(
                  active: _mobileRoomGroup,
                  onChanged: _changeMobileRoomGroup,
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 12, 10, 0),
                  child: _FilterControls(
                    type: _activeType,
                    privacy: _activePrivacy,
                    sort: _activeSort,
                    onTypeChanged: _changeType,
                    onPrivacyChanged: _changePrivacy,
                    onSortChanged: _changeSort,
                  ),
                ),
                if (snapshot.connectionState == ConnectionState.done &&
                    !snapshot.hasError &&
                    visibleRooms.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 10, 10, 0),
                    child: _FeedScopeSummary(
                      feed: _feedTabForValue(_activeFeed),
                      rooms: visibleRooms,
                      query: _query,
                    ),
                  ),
                const SizedBox(height: 10),
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
                                _mobileRoomGroup = 'recently';
                                _query = '';
                                _rooms = future;
                              });
                              await future;
                            },
                    ),
                  )
                else
                  ...visibleRooms.asMap().entries.map(
                    (entry) => Padding(
                      padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
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
            ),
          );
        },
      ),
    );
  }

  Room? _featuredRoom(List<Room> rooms) {
    if (_activeFeed == 'following') {
      return rooms
          .where((room) => room.ownerFollowed || room.ownerId == widget.user.id)
          .firstOrNull;
    }
    return rooms.where((room) => room.ownerId == widget.user.id).firstOrNull ??
        rooms.firstOrNull;
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
        giftEnabled: false,
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

class _MobileHomeHero extends StatelessWidget {
  const _MobileHomeHero({
    required this.user,
    required this.activeFeed,
    required this.featuredRoom,
    required this.onOpenRoom,
    required this.onFeedChanged,
    required this.onHome,
    required this.onSearch,
    required this.search,
    required this.searchOpen,
    required this.onSearchSubmitted,
  });

  final AppUser user;
  final String activeFeed;
  final Room? featuredRoom;
  final ValueChanged<Room> onOpenRoom;
  final ValueChanged<String> onFeedChanged;
  final VoidCallback onHome;
  final VoidCallback onSearch;
  final TextEditingController search;
  final bool searchOpen;
  final ValueChanged<String> onSearchSubmitted;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Container(
      padding: EdgeInsets.fromLTRB(10, top + 10, 10, 10),
      decoration: const BoxDecoration(
        image: DecorationImage(
          image: AssetImage(RtcAssets.smartMobileHeroBg),
          fit: BoxFit.cover,
          alignment: Alignment.topCenter,
        ),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 78,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned(
                  left: -10,
                  top: -8,
                  child: Image.asset(
                    RtcAssets.smartGoatHeader,
                    width: 82,
                    height: 72,
                    fit: BoxFit.contain,
                  ),
                ),
                Positioned(
                  left: 26,
                  bottom: 3,
                  child: _RoundAssetButton(
                    asset: RtcAssets.smartHomeIcon,
                    tooltip: 'Home',
                    onTap: onHome,
                  ),
                ),
                Positioned(
                  left: 78,
                  right: 56,
                  bottom: 8,
                  child: _HeroFeedTabs(
                    active: activeFeed,
                    onChanged: onFeedChanged,
                  ),
                ),
                Positioned(
                  right: 0,
                  bottom: 3,
                  child: _RoundAssetButton(
                    asset: RtcAssets.smartSearchIcon,
                    tooltip: 'Search',
                    onTap: onSearch,
                  ),
                ),
              ],
            ),
          ),
          if (searchOpen) ...[
            const SizedBox(height: 8),
            _SearchBox(controller: search, onSubmitted: onSearchSubmitted),
          ],
          const SizedBox(height: 8),
          _FeaturedRoomCard(
            room: featuredRoom,
            user: user,
            ribbon: activeFeed == 'following' ? 'Follow' : 'Mine',
            onTap: featuredRoom == null
                ? null
                : () => onOpenRoom(featuredRoom!),
          ),
        ],
      ),
    );
  }
}

class _RoundAssetButton extends StatelessWidget {
  const _RoundAssetButton({
    required this.asset,
    required this.tooltip,
    required this.onTap,
  });

  final String asset;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.white.withValues(alpha: 0.48),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.7)),
            ),
            child: Image.asset(asset, width: 25, height: 25),
          ),
        ),
      ),
    );
  }
}

class _HeroFeedTabs extends StatelessWidget {
  const _HeroFeedTabs({required this.active, required this.onChanged});

  final String active;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    const tabs = [
      _FilterOption(value: 'following', label: 'Mine'),
      _FilterOption(value: 'for_you', label: 'Popular'),
      _FilterOption(value: 'explore', label: 'Explore'),
    ];
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: tabs.map((tab) {
        final selected = active == tab.value;
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => onChanged(tab.value),
          child: SizedBox(
            height: 36,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Text(
                  tab.label,
                  style: TextStyle(
                    color: RtcPalette.lobbyInk,
                    fontWeight: FontWeight.w900,
                    fontSize: 15,
                    height: 1,
                  ),
                ),
                const SizedBox(height: 6),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  width: selected ? 18 : 0,
                  height: 2,
                  decoration: BoxDecoration(
                    color: RtcPalette.lobbyInk,
                    borderRadius: BorderRadius.circular(RtcRadius.pill),
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _FeaturedRoomCard extends StatelessWidget {
  const _FeaturedRoomCard({
    required this.room,
    required this.user,
    required this.ribbon,
    required this.onTap,
  });

  final Room? room;
  final AppUser user;
  final String ribbon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final title = room?.name ?? '${_displayName(user)} Live Room';
    final type = room == null ? 'Live Video Room' : room!.roomTypeLabel;
    final image = room == null
        ? RtcAssets.avatarImageForUser(user)
        : RtcAssets.coverImageForRoom(room!, room!.id);
    final count = room?.activeParticipants ?? 0;

    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(9),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(9),
        child: Ink(
          height: 82,
          decoration: BoxDecoration(
            color: RtcPalette.lobbySurface,
            borderRadius: BorderRadius.circular(9),
            boxShadow: const [
              BoxShadow(
                color: Color.fromRGBO(15, 23, 42, 0.08),
                blurRadius: 18,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: Stack(
              children: [
                Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    children: [
                      RtcAvatarToken(label: title, image: image, size: 60),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: RtcPalette.lobbyInk,
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                                height: 1,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Row(
                              children: [
                                Image.asset(
                                  RtcAssets.smartBars,
                                  width: 18,
                                  height: 18,
                                ),
                                const SizedBox(width: 5),
                                Image.asset(
                                  RtcAssets.smartGroupIcon,
                                  width: 18,
                                  height: 18,
                                ),
                                const SizedBox(width: 3),
                                Text(
                                  compactNumber(count),
                                  style: const TextStyle(
                                    color: RtcPalette.lobbySoft,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Image.asset(
                                  RtcAssets.smartLockIcon,
                                  width: 17,
                                  height: 17,
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              type,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: RtcPalette.lobbyTealDark,
                                fontSize: 11,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  right: -34,
                  top: -1,
                  child: Transform.rotate(
                    angle: 0.78,
                    child: Container(
                      width: 94,
                      height: 25,
                      alignment: Alignment.center,
                      color: const Color(0xFFFF6686),
                      child: Text(
                        ribbon,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
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

class _MobileRoomGroupTabs extends StatelessWidget {
  const _MobileRoomGroupTabs({required this.active, required this.onChanged});

  final String active;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    const tabs = [
      _FilterOption(value: 'recently', label: 'Recently'),
      _FilterOption(value: 'follow', label: 'Follow'),
      _FilterOption(value: 'group', label: 'Group'),
    ];
    return Container(
      height: 56,
      color: Colors.white,
      child: Row(
        children: tabs.map((tab) {
          final selected = active == tab.value;
          return Expanded(
            child: InkWell(
              onTap: () => onChanged(tab.value),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    tab.label,
                    style: const TextStyle(
                      color: RtcPalette.lobbyInk,
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    width: selected ? 18 : 0,
                    height: 2.5,
                    decoration: BoxDecoration(
                      color: RtcPalette.lobbyInk,
                      borderRadius: BorderRadius.circular(RtcRadius.pill),
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _FeedScopeSummary extends StatelessWidget {
  const _FeedScopeSummary({
    required this.feed,
    required this.rooms,
    required this.query,
  });

  final _FeedTab feed;
  final List<Room> rooms;
  final String query;

  @override
  Widget build(BuildContext context) {
    final activeParticipants = rooms.fold<int>(
      0,
      (total, room) => total + room.activeParticipants,
    );
    final videoRooms = rooms.where((room) => room.supportsVideo).length;
    final lockedRooms = rooms
        .where((room) => room.isLocked || room.isPrivate)
        .length;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RtcPalette.lobbySurface,
        border: Border.all(color: RtcPalette.lobbyLine),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: RtcPalette.lobbyMint,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: const Icon(
                  Icons.auto_awesome_rounded,
                  color: RtcPalette.lobbyTealDark,
                  size: 18,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${feed.mobileLabel} rooms',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbyInk,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        height: 1,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      query.isEmpty ? feed.detail : 'Filtered by "$query".',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbySoft,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _FeedMetricTile(
                  label: 'Rooms',
                  value: compactNumber(rooms.length),
                  icon: Icons.meeting_room_outlined,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _FeedMetricTile(
                  label: 'Live now',
                  value: compactNumber(activeParticipants),
                  icon: Icons.graphic_eq_rounded,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _FeedMetricTile(
                  label: 'Video',
                  value: compactNumber(videoRooms),
                  icon: Icons.videocam_outlined,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _FeedMetricTile(
                  label: 'Locked',
                  value: compactNumber(lockedRooms),
                  icon: Icons.lock_outline_rounded,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FeedMetricTile extends StatelessWidget {
  const _FeedMetricTile({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 58),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: RtcPalette.lobbyBg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 16, color: RtcPalette.lobbyTealDark),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: RtcPalette.lobbyInk,
              fontSize: 13,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: RtcPalette.lobbySoft,
              fontSize: 10,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
        ],
      ),
    );
  }
}

enum _MobileNavAction { live, help, settings, message, profile }

class _MobileBottomNav extends StatelessWidget {
  const _MobileBottomNav({required this.active, required this.onSelected});

  final _MobileNavAction active;
  final ValueChanged<_MobileNavAction> onSelected;

  @override
  Widget build(BuildContext context) {
    final activeIndex = _MobileNavAction.values.indexOf(active);
    return RtcMobileBottomNav(
      activeIndex: activeIndex < 0 ? 0 : activeIndex,
      onChanged: (index) => onSelected(_MobileNavAction.values[index]),
      items: [
        const RtcMobileBottomNavItem(
          icon: Icons.video_camera_back_outlined,
          label: 'Live',
        ),
        const RtcMobileBottomNavItem(
          asset: RtcAssets.feedbackHelpIcon,
          label: 'Help',
        ),
        const RtcMobileBottomNavItem(
          asset: RtcAssets.settingsIcon,
          label: 'Settings',
        ),
        const RtcMobileBottomNavItem(
          icon: Icons.chat_bubble_outline_rounded,
          label: 'Message',
        ),
        const RtcMobileBottomNavItem(
          icon: Icons.person_outline_rounded,
          label: 'Me',
        ),
      ],
    );
  }
}

class _HelpTab extends StatelessWidget {
  const _HelpTab({required this.onSubmitFeedback});

  final VoidCallback onSubmitFeedback;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 18),
        children: [
          _LightHeroPanel(
            eyebrow: 'SUPPORT CENTER',
            title: 'Feedback and Help',
            detail:
                'Find room, chat, account, and safety answers, then send a report if something still needs attention.',
            actions: const [
              _HeroMetric(label: 'Records', value: '0'),
              _HeroMetric(label: 'Submit feedback', value: ''),
            ],
          ),
          const SizedBox(height: 28),
          const Row(
            children: [
              Expanded(
                child: _HelpStatCard(title: 'Help', detail: '5 guides'),
              ),
              SizedBox(width: 10),
              Expanded(
                child: _HelpStatCard(title: 'FAQ', detail: '14 answers'),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const _HelpStatCard(title: 'Records', detail: '0 saved'),
          const SizedBox(height: 16),
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _popularHelp.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final item = _popularHelp[index];
                return _PillButton(label: item.title, active: index == 0);
              },
            ),
          ),
          const SizedBox(height: 22),
          _WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'POPULAR GUIDE',
                  style: TextStyle(
                    color: RtcPalette.lobbyTealDark,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  _popularHelp.first.title,
                  style: const TextStyle(
                    color: RtcPalette.lobbyInk,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  _popularHelp.first.body,
                  style: const TextStyle(
                    color: RtcPalette.lobbySoft,
                    fontSize: 14,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () {},
                        child: const Text('Browse FAQ'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: onSubmitFeedback,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: RtcPalette.lobbyTealDark,
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('Report a problem'),
                      ),
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

class _SettingsTab extends StatelessWidget {
  const _SettingsTab({
    required this.active,
    required this.status,
    required this.onChanged,
    required this.onStatus,
  });

  final String active;
  final String status;
  final ValueChanged<String> onChanged;
  final ValueChanged<String> onStatus;

  @override
  Widget build(BuildContext context) {
    final activeMeta = _settingsNav.firstWhere(
      (item) => item.value == active,
      orElse: () => _settingsNav.first,
    );
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 16, 12, 18),
        children: [
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _settingsNav.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final item = _settingsNav[index];
                return _SettingsChip(
                  item: item,
                  active: item.value == active,
                  onTap: () => onChanged(item.value),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          _WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  activeMeta.label,
                  style: const TextStyle(
                    color: RtcPalette.lobbyInk,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  status,
                  style: const TextStyle(
                    color: RtcPalette.lobbySoft,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 18),
                _SettingsContent(active: active, onStatus: onStatus),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsContent extends StatelessWidget {
  const _SettingsContent({required this.active, required this.onStatus});

  final String active;
  final ValueChanged<String> onStatus;

  @override
  Widget build(BuildContext context) {
    final rows = switch (active) {
      'privacy' => const [
        _SettingsRowData('Who can send me a message', 'Everyone'),
        _SettingsRowData('Private live invitation', 'Allowed'),
        _SettingsRowData('Blacklist', 'Open'),
        _SettingsRowData('Live broadcast you are not interested in', 'Show'),
      ],
      'content' => const [
        _SettingsRowData('Restricted Mode', 'Choose'),
        _SettingsRowData('Warning Mode', 'Selected'),
        _SettingsRowData('All Modes', 'Choose'),
      ],
      'language' => const [
        _SettingsRowData('Current language', 'English'),
        _SettingsRowData('Spanish', 'Choose'),
        _SettingsRowData('French', 'Choose'),
        _SettingsRowData('Korean', 'Choose'),
      ],
      'region' => const [
        _SettingsRowData('Region', 'United States'),
        _SettingsRowData('Nearby rooms', 'Enabled'),
      ],
      'terms' => const [
        _SettingsRowData('Terms of Service', 'Open'),
        _SettingsRowData('Privacy Policy', 'Open'),
        _SettingsRowData('Child Safety Policy', 'Open'),
        _SettingsRowData('Anti-Bullying Policy', 'Open'),
      ],
      _ => const [
        _SettingsRowData('Binding cell phone', 'Bind cell phone'),
        _SettingsRowData('Binding email', 'Bound'),
        _SettingsRowData('Set login password', 'Set'),
        _SettingsRowData('Devices Logged In', 'Alerts on'),
      ],
    };
    final details = switch (active) {
      'privacy' => const [
        'Controls the personal inbox and room chat shortcuts.',
        'Allow hosts to invite you into private live rooms.',
        'Blocked users are controlled from the chat user menu.',
        'Filtered from your feed.',
      ],
      'content' => const [
        'Hide potentially sensitive content.',
        'Show a warning before sensitive rooms open.',
        'Show all room content that is available to your account.',
      ],
      'language' => const [
        'Choose the language used by mobile account screens.',
        'Translate mobile account copy.',
        'Translate mobile account copy.',
        'Translate mobile account copy.',
      ],
      'region' => const [
        'Choose the region used by mobile account screens.',
        'Nearby hosts and regional rooms appear in the feed.',
      ],
      'terms' => const [
        'Production terms and service rules.',
        'How account and room data is handled.',
        'Safety standards for younger users.',
        'Community behavior policy.',
      ],
      _ => const [
        'Recommended for account recovery and high-value account changes.',
        'Used for login recovery and security notices.',
        'Protect this account when signing in on a new device.',
        'Show alerts when a new device logs in.',
      ],
    };

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: RtcPalette.lobbyLine),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: List.generate(rows.length, (index) {
          final row = rows[index];
          return _SettingsLightRow(
            title: row.title,
            detail: details[index],
            trailing: row.trailing,
            last: index == rows.length - 1,
            onTap: () => onStatus('${row.title} updated.'),
          );
        }),
      ),
    );
  }
}

class _MessageTab extends StatelessWidget {
  const _MessageTab({
    required this.user,
    required this.contactsFuture,
    required this.activeContactId,
    required this.conversationFuture,
    required this.input,
    required this.status,
    required this.onOpenContact,
    required this.onSend,
  });

  final AppUser user;
  final Future<List<Map<String, dynamic>>> contactsFuture;
  final int? activeContactId;
  final Future<List<Map<String, dynamic>>>? conversationFuture;
  final TextEditingController input;
  final String status;
  final ValueChanged<Map<String, dynamic>> onOpenContact;
  final Future<void> Function() onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: contactsFuture,
        builder: (context, contactsSnapshot) {
          final contacts =
              contactsSnapshot.data ?? const <Map<String, dynamic>>[];
          if (activeContactId == null && contacts.isNotEmpty) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              onOpenContact(contacts.first);
            });
          }
          final activeContact = contacts
              .where(
                (contact) => _mapInt(contact['peer_id']) == activeContactId,
              )
              .firstOrNull;

          return Column(
            children: [
              _MessageHeader(contact: activeContact),
              Expanded(
                child: activeContact == null
                    ? _MessageContactList(
                        loading:
                            contactsSnapshot.connectionState !=
                            ConnectionState.done,
                        contacts: contacts,
                        onOpen: onOpenContact,
                      )
                    : _ConversationBody(
                        user: user,
                        contact: activeContact,
                        conversationFuture: conversationFuture,
                      ),
              ),
              if (status.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
                  child: Text(
                    status,
                    style: const TextStyle(
                      color: RtcPalette.lobbySoft,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              _DirectMessageComposer(input: input, onSend: onSend),
            ],
          );
        },
      ),
    );
  }
}

class _MeTab extends StatelessWidget {
  const _MeTab({
    required this.user,
    required this.onEditProfile,
    required this.onLogout,
  });

  final AppUser user;
  final VoidCallback? onEditProfile;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    final birthday = _dateOnly(user.birthday).isEmpty
        ? 'Not set'
        : _dateOnly(user.birthday);
    final rows = [
      _SettingsRowData('Name', _displayName(user)),
      _SettingsRowData('Gender', _genderLabel(user.gender)),
      _SettingsRowData('Age', user.age?.toString() ?? 'Not set'),
      _SettingsRowData('Birthday', birthday),
      _SettingsRowData('Email', user.email.isEmpty ? 'Not set' : user.email),
      _SettingsRowData(
        'Current Residence',
        user.currentResidence.isEmpty ? 'Not set' : user.currentResidence,
      ),
    ];

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 14, 12, 18),
        children: [
          _ProfileSummaryCard(user: user),
          const SizedBox(height: 12),
          _WhitePanel(
            padding: EdgeInsets.zero,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(14, 14, 14, 10),
                  child: Text(
                    'Profile',
                    style: TextStyle(
                      color: RtcPalette.lobbyInk,
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                ...rows.map(
                  (row) => _ProfileLightRow(
                    label: row.title,
                    value: row.trailing,
                    last: row == rows.last,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: onEditProfile,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RtcPalette.lobbyTealDark,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(46),
                  ),
                  child: const Text('Edit profile'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton(
                  onPressed: onLogout,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: const Color(0xFF991B1B),
                    minimumSize: const Size.fromHeight(46),
                  ),
                  child: const Text('Sign out'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LightHeroPanel extends StatelessWidget {
  const _LightHeroPanel({
    required this.eyebrow,
    required this.title,
    required this.detail,
    this.actions = const [],
  });

  final String eyebrow;
  final String title;
  final String detail;
  final List<_HeroMetric> actions;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF6EDBC9), Color(0xFFE7DE66)],
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            eyebrow,
            style: const TextStyle(
              color: RtcPalette.lobbyTealDark,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            title,
            style: const TextStyle(
              color: RtcPalette.lobbyInk,
              fontSize: 22,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            detail,
            style: const TextStyle(
              color: Color(0xFF24575D),
              fontSize: 13,
              fontWeight: FontWeight.w600,
              height: 1.35,
            ),
          ),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 18),
            Row(
              children: actions
                  .map(
                    (action) => Expanded(
                      child: Container(
                        height: 40,
                        margin: EdgeInsets.only(
                          right: action == actions.last ? 0 : 8,
                        ),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: action.value.isEmpty
                              ? RtcPalette.bg
                              : Colors.white.withValues(alpha: 0.72),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              action.label,
                              style: TextStyle(
                                color: action.value.isEmpty
                                    ? Colors.white
                                    : RtcPalette.lobbyInk,
                                fontSize: 12,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            if (action.value.isNotEmpty)
                              Text(
                                action.value,
                                style: const TextStyle(
                                  color: RtcPalette.lobbySoft,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }
}

class _HeroMetric {
  const _HeroMetric({required this.label, required this.value});

  final String label;
  final String value;
}

class _WhitePanel extends StatelessWidget {
  const _WhitePanel({
    required this.child,
    this.padding = const EdgeInsets.all(14),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: RtcPalette.lobbyLine),
        borderRadius: BorderRadius.circular(12),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.06),
            blurRadius: 22,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _HelpStatCard extends StatelessWidget {
  const _HelpStatCard({required this.title, required this.detail});

  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return _WhitePanel(
      child: SizedBox(
        height: 58,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: RtcPalette.lobbyInk,
                fontSize: 15,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              detail,
              style: const TextStyle(
                color: RtcPalette.lobbySoft,
                fontSize: 12,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PillButton extends StatelessWidget {
  const _PillButton({required this.label, this.active = false});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        color: active ? RtcPalette.lobbyTealDark : const Color(0xFFF4F7F8),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: active ? Colors.white : RtcPalette.lobbySoft,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _SettingsChip extends StatelessWidget {
  const _SettingsChip({
    required this.item,
    required this.active,
    required this.onTap,
  });

  final _SettingsNavItem item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? RtcPalette.lobbyTealDark : Colors.white,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            border: Border.all(color: RtcPalette.lobbyLine),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 10,
                backgroundColor: active
                    ? Colors.white.withValues(alpha: 0.18)
                    : const Color(0xFFF4F7F8),
                child: Text(
                  item.icon,
                  style: TextStyle(
                    color: active ? Colors.white : RtcPalette.lobbySoft,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                item.label,
                style: TextStyle(
                  color: active ? Colors.white : RtcPalette.lobbyInk,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SettingsLightRow extends StatelessWidget {
  const _SettingsLightRow({
    required this.title,
    required this.detail,
    required this.trailing,
    required this.last,
    required this.onTap,
  });

  final String title;
  final String detail;
  final String trailing;
  final bool last;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: last
              ? null
              : const Border(bottom: BorderSide(color: RtcPalette.lobbyLine)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: RtcPalette.lobbyInk,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    detail,
                    style: const TextStyle(
                      color: RtcPalette.lobbySoft,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: RtcPalette.lobbyMint,
                borderRadius: BorderRadius.circular(RtcRadius.pill),
              ),
              child: Text(
                trailing,
                textAlign: TextAlign.right,
                style: const TextStyle(
                  color: RtcPalette.lobbyTealDark,
                  fontSize: 12,
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

class _MessageHeader extends StatelessWidget {
  const _MessageHeader({required this.contact});

  final Map<String, dynamic>? contact;

  @override
  Widget build(BuildContext context) {
    final name = _mapString(contact?['peer_name'] ?? contact?['name']);
    final peerId = _mapInt(contact?['peer_id']);
    return Container(
      height: 64,
      margin: const EdgeInsets.fromLTRB(12, 14, 12, 8),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: const BoxDecoration(color: Colors.white),
      child: Row(
        children: [
          const CircleAvatar(
            radius: 18,
            backgroundColor: Color(0xFF4F46E5),
            child: Icon(Icons.arrow_back, color: Colors.white, size: 18),
          ),
          const SizedBox(width: 10),
          RtcAvatarToken(
            label: name.isEmpty ? 'Message' : name,
            image: _contactImage(contact),
            size: 42,
            borderRadius: RtcRadius.pill,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              name.isEmpty ? 'Messages' : name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: RtcPalette.lobbyInk,
                fontSize: 17,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          if (peerId != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: RtcPalette.lobbyMint,
                borderRadius: BorderRadius.circular(RtcRadius.pill),
              ),
              child: const Text(
                'Mutual follow',
                style: TextStyle(
                  color: RtcPalette.lobbyTealDark,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          const SizedBox(width: 8),
          const CircleAvatar(
            radius: 18,
            backgroundColor: Color(0xFFF8FAFB),
            child: Icon(Icons.more_horiz, color: RtcPalette.lobbyInk),
          ),
        ],
      ),
    );
  }
}

class _MessageContactList extends StatelessWidget {
  const _MessageContactList({
    required this.loading,
    required this.contacts,
    required this.onOpen,
  });

  final bool loading;
  final List<Map<String, dynamic>> contacts;
  final ValueChanged<Map<String, dynamic>> onOpen;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (contacts.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'No follower messages yet.',
            style: TextStyle(
              color: RtcPalette.lobbySoft,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
      itemCount: contacts.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final contact = contacts[index];
        final name = _mapString(contact['peer_name']);
        final last = contact['last_message'];
        return _WhitePanel(
          padding: const EdgeInsets.all(10),
          child: ListTile(
            onTap: () => onOpen(contact),
            contentPadding: EdgeInsets.zero,
            leading: RtcAvatarToken(
              label: name,
              image: _contactImage(contact),
              size: 44,
              borderRadius: RtcRadius.pill,
            ),
            title: Text(
              name,
              style: const TextStyle(
                color: RtcPalette.lobbyInk,
                fontWeight: FontWeight.w900,
              ),
            ),
            subtitle: Text(
              _messageBody(
                last is Map ? last : null,
                fallback: 'No messages yet',
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        );
      },
    );
  }
}

class _ConversationBody extends StatelessWidget {
  const _ConversationBody({
    required this.user,
    required this.contact,
    required this.conversationFuture,
  });

  final AppUser user;
  final Map<String, dynamic> contact;
  final Future<List<Map<String, dynamic>>>? conversationFuture;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: conversationFuture,
      builder: (context, snapshot) {
        final messages = snapshot.data ?? const <Map<String, dynamic>>[];
        return ListView(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 18),
          children: [
            Container(
              margin: const EdgeInsets.only(bottom: 18),
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              decoration: BoxDecoration(
                color: RtcPalette.lobbyMint,
                borderRadius: BorderRadius.circular(RtcRadius.pill),
              ),
              child: const Text(
                'You follow each other. Private messages are open.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: RtcPalette.lobbyTealDark,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            if (snapshot.connectionState != ConnectionState.done)
              const Center(child: CircularProgressIndicator())
            else if (messages.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No messages with this user yet.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: RtcPalette.lobbySoft,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              )
            else
              ...messages.map(
                (message) => _DirectMessageBubble(
                  message: message,
                  mine: _mapInt(message['sender_id']) == user.id,
                  contact: contact,
                  user: user,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _DirectMessageBubble extends StatelessWidget {
  const _DirectMessageBubble({
    required this.message,
    required this.mine,
    required this.contact,
    required this.user,
  });

  final Map<String, dynamic> message;
  final bool mine;
  final Map<String, dynamic> contact;
  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final name = mine ? 'You' : _mapString(contact['peer_name']);
    final avatar = mine
        ? RtcAssets.avatarImageForUser(user)
        : _contactImage(contact);
    return Padding(
      padding: EdgeInsets.only(
        left: mine ? 58 : 0,
        right: mine ? 0 : 58,
        bottom: 14,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisAlignment: mine
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        children: [
          if (!mine) ...[
            RtcAvatarToken(
              label: name,
              image: avatar,
              size: 34,
              borderRadius: RtcRadius.pill,
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: mine ? const Color(0xFFDDFCE6) : Colors.white,
                border: Border.all(
                  color: mine ? const Color(0xFF86EFAC) : Colors.transparent,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          color: RtcPalette.lobbySoft,
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _messageTime(message),
                        style: const TextStyle(
                          color: RtcPalette.lobbyMuted,
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _messageBody(message),
                    style: const TextStyle(
                      color: RtcPalette.lobbyInk,
                      fontSize: 14,
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (mine) ...[
            const SizedBox(width: 8),
            RtcAvatarToken(
              label: name,
              image: avatar,
              size: 34,
              borderRadius: RtcRadius.pill,
            ),
          ],
        ],
      ),
    );
  }
}

class _DirectMessageComposer extends StatelessWidget {
  const _DirectMessageComposer({required this.input, required this.onSend});

  final TextEditingController input;
  final Future<void> Function() onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.08),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: RtcPalette.lobbyGold,
            child: Icon(Icons.circle, color: Colors.white),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: input,
              minLines: 1,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Type a message...',
                filled: true,
                fillColor: const Color(0xFFF8FAFB),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none,
                ),
              ),
              style: const TextStyle(color: RtcPalette.lobbyInk),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: onSend,
            style: IconButton.styleFrom(
              backgroundColor: const Color(0xFFF7CE8A),
              foregroundColor: Colors.white,
            ),
            icon: const Icon(Icons.send_rounded),
          ),
        ],
      ),
    );
  }
}

class _ProfileSummaryCard extends StatelessWidget {
  const _ProfileSummaryCard({required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF68D9C7), Color(0xFFE5DE65)],
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(3),
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: RtcAvatarToken(
              label: _displayName(user),
              image: RtcAssets.avatarImageForUser(user),
              size: 70,
              borderRadius: RtcRadius.pill,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _displayName(user),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: RtcPalette.lobbyInk,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'ID:${user.id}',
                  style: const TextStyle(
                    color: RtcPalette.lobbyInk,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  children: [
                    _TinyProfilePill(user.age?.toString() ?? '--'),
                    _TinyProfilePill(_genderLabel(user.gender)),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Email ${user.email}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: RtcPalette.lobbyInk,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  user.currentResidence.isEmpty
                      ? 'Not set'
                      : user.currentResidence,
                  style: const TextStyle(
                    color: RtcPalette.lobbyInk,
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

class _TinyProfilePill extends StatelessWidget {
  const _TinyProfilePill(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF6B63FF),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _ProfileLightRow extends StatelessWidget {
  const _ProfileLightRow({
    required this.label,
    required this.value,
    required this.last,
  });

  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: RtcPalette.lobbyLine)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: RtcPalette.lobbySoft,
                fontSize: 13,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: RtcPalette.lobbyInk,
                fontSize: 14,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
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
    return Row(
      children: [
        Expanded(
          child: _LightDropdown(
            value: type,
            options: _typeFilters,
            onChanged: onTypeChanged,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _LightDropdown(
            value: privacy,
            options: _privacyFilters,
            onChanged: onPrivacyChanged,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _LightDropdown(
            value: sort,
            options: _sortOptions,
            onChanged: onSortChanged,
          ),
        ),
      ],
    );
  }
}

class _LightDropdown extends StatelessWidget {
  const _LightDropdown({
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String value;
  final List<_FilterOption> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 42,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: RtcPalette.lobbyLine),
        borderRadius: BorderRadius.circular(8),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          dropdownColor: RtcPalette.lobbySurface,
          iconEnabledColor: RtcPalette.lobbyInk,
          style: const TextStyle(
            color: RtcPalette.lobbyInk,
            fontSize: 13,
            fontWeight: FontWeight.w900,
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
        ),
      ),
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
    final meta = room.roomTypeLabel;
    final mediaLabel = room.supportsVideo ? 'Video' : 'Audio';
    final mediaIcon = room.supportsVideo
        ? Icons.videocam_rounded
        : Icons.mic_rounded;
    final privacyLabel = _roomAccessLabel(room);
    final liveLabel = room.activeParticipants > 0 ? 'LIVE NOW' : 'READY';
    final featureChips = _roomFeatureChips(room);

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        onLongPress: canDelete && !deleting ? onDelete : null,
        child: Container(
          constraints: const BoxConstraints(minHeight: 116),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            border: Border.all(
              color: featured ? RtcPalette.lobbyTeal : RtcPalette.lobbyLine,
              width: featured ? 1.2 : 1,
            ),
            borderRadius: BorderRadius.circular(12),
            boxShadow: const [
              BoxShadow(
                color: Color.fromRGBO(15, 23, 42, 0.07),
                blurRadius: 18,
                offset: Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 92,
                height: 92,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    RtcAvatarToken(
                      label: room.name,
                      image: RtcAssets.coverImageForRoom(room, index),
                      size: 92,
                      borderRadius: 10,
                    ),
                    Positioned(
                      left: 6,
                      top: 6,
                      child: _RoomStatusChip(
                        label: liveLabel,
                        active: room.activeParticipants > 0,
                      ),
                    ),
                    Positioned(
                      left: 6,
                      bottom: 6,
                      child: _RoomIconChip(icon: mediaIcon, label: mediaLabel),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            room.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: RtcPalette.lobbyInk,
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                              height: 1.05,
                            ),
                          ),
                        ),
                        if (featured) ...[
                          const SizedBox(width: 6),
                          const _RoomMiniBadge(label: 'Featured'),
                        ],
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.person_rounded,
                          color: RtcPalette.lobbySoft,
                          size: 14,
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            room.displayHost,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: RtcPalette.lobbySoft,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            room.displayRegion,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.right,
                            style: const TextStyle(
                              color: RtcPalette.lobbyMuted,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 7),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            meta,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: RtcPalette.lobbyTealDark,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          privacyLabel,
                          style: const TextStyle(
                            color: RtcPalette.lobbySoft,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: featureChips
                          .map((chip) => _RoomFeatureChip(chip: chip))
                          .toList(),
                    ),
                    if (room.activeParticipantPreviews.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      _ParticipantPreviewRow(room: room),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 52,
                child: Column(
                  children: [
                    Container(
                      width: 48,
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: RtcPalette.lobbyMint,
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Column(
                        children: [
                          const Icon(
                            Icons.graphic_eq_rounded,
                            color: RtcPalette.lobbyTealDark,
                            size: 16,
                          ),
                          const SizedBox(height: 3),
                          Text(
                            compactNumber(room.activeParticipants),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: RtcPalette.lobbyInk,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                              height: 1,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Icon(
                      Icons.chevron_right_rounded,
                      color: RtcPalette.lobbyMuted,
                      size: 24,
                    ),
                    if (canDelete) ...[
                      const SizedBox(height: 6),
                      Tooltip(
                        message: deleting ? 'Deleting' : 'Delete room',
                        child: InkWell(
                          borderRadius: BorderRadius.circular(18),
                          onTap: deleting ? null : onDelete,
                          child: SizedBox.square(
                            dimension: 34,
                            child: deleting
                                ? const Padding(
                                    padding: EdgeInsets.all(9),
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: RtcPalette.lobbyTealDark,
                                    ),
                                  )
                                : const Icon(
                                    Icons.delete_outline_rounded,
                                    color: RtcPalette.lobbyMuted,
                                    size: 18,
                                  ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoomStatusChip extends StatelessWidget {
  const _RoomStatusChip({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: active
            ? RtcPalette.hot.withValues(alpha: 0.92)
            : RtcPalette.lobbyInk.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 9,
          fontWeight: FontWeight.w900,
          height: 1,
        ),
      ),
    );
  }
}

class _RoomIconChip extends StatelessWidget {
  const _RoomIconChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: RtcPalette.lobbyInk),
          const SizedBox(width: 3),
          Text(
            label,
            style: const TextStyle(
              color: RtcPalette.lobbyInk,
              fontSize: 9,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
        ],
      ),
    );
  }
}

class _RoomMiniBadge extends StatelessWidget {
  const _RoomMiniBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: BoxDecoration(
        color: RtcPalette.lobbyGoldSoft,
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: RtcPalette.lobbyInk,
          fontSize: 9,
          fontWeight: FontWeight.w900,
          height: 1,
        ),
      ),
    );
  }
}

class _RoomFeatureChip extends StatelessWidget {
  const _RoomFeatureChip({required this.chip});

  final _RoomFeature chip;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: chip.color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
        border: Border.all(color: chip.color.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(chip.icon, size: 12, color: chip.color),
          const SizedBox(width: 4),
          Text(
            chip.label,
            style: TextStyle(
              color: chip.color,
              fontSize: 10,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
        ],
      ),
    );
  }
}

class _ParticipantPreviewRow extends StatelessWidget {
  const _ParticipantPreviewRow({required this.room});

  final Room room;

  @override
  Widget build(BuildContext context) {
    final previews = room.activeParticipantPreviews.take(3).toList();
    return Row(
      children: [
        SizedBox(
          width: previews.length <= 1 ? 24 : 24 + (previews.length - 1) * 16,
          height: 24,
          child: Stack(
            children: [
              for (final entry in previews.asMap().entries)
                Positioned(
                  left: entry.key * 16,
                  child: Container(
                    width: 24,
                    height: 24,
                    padding: const EdgeInsets.all(1.5),
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: ClipOval(
                      child: RtcAvatarToken(
                        label: entry.value.name,
                        image: _participantImage(entry.value, entry.key),
                        size: 21,
                        borderRadius: 99,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            '${compactNumber(room.activeParticipantPreviews.length)} active on stage',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: RtcPalette.lobbyMuted,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

class _RoomFeature {
  const _RoomFeature({
    required this.label,
    required this.icon,
    required this.color,
  });

  final String label;
  final IconData icon;
  final Color color;
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

class _PopularHelpItem {
  const _PopularHelpItem({
    required this.id,
    required this.title,
    required this.body,
  });

  final String id;
  final String title;
  final String body;
}

class _SettingsNavItem {
  const _SettingsNavItem({
    required this.value,
    required this.label,
    required this.icon,
  });

  final String value;
  final String label;
  final String icon;
}

class _SettingsRowData {
  const _SettingsRowData(this.title, this.trailing);

  final String title;
  final String trailing;
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

const _popularHelp = [
  _PopularHelpItem(
    id: 'create-room',
    title: 'How to create a room',
    body:
        'Open the create room panel, choose the room type and privacy, then publish the room when the details are ready.',
  ),
  _PopularHelpItem(
    id: 'vip',
    title: 'How to become VIP/SVIP',
    body:
        'Open the personal center to review available VIP access, rewards, and account privileges.',
  ),
  _PopularHelpItem(
    id: 'bind',
    title: 'How do I bind my phone number and email address?',
    body:
        'For account security, bind your mobile phone number and email address in Settings, Account Security.',
  ),
  _PopularHelpItem(
    id: 'mvp',
    title: 'How to become an MVP and its benefits',
    body:
        'MVP status unlocks monthly rewards, profile progress, and room benefits after qualifying top-up milestones.',
  ),
  _PopularHelpItem(
    id: 'missing',
    title: 'I submitted feedback but need help',
    body:
        'Open Feedback record to review previous reports, or submit a new ticket with screenshots and device details.',
  ),
];

const _settingsNav = [
  _SettingsNavItem(value: 'account', label: 'Account Security', icon: 'U'),
  _SettingsNavItem(value: 'privacy', label: 'Privacy Settings', icon: 'S'),
  _SettingsNavItem(value: 'content', label: 'Content Preferences', icon: 'F'),
  _SettingsNavItem(value: 'language', label: 'Multi-Language', icon: 'A'),
  _SettingsNavItem(value: 'region', label: 'Region', icon: 'P'),
  _SettingsNavItem(value: 'terms', label: 'Terms and Policies', icon: 'D'),
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

String _displayName(AppUser user) {
  final name = user.name.trim();
  if (name.isNotEmpty) return name;
  final emailName = user.email.split('@').first.trim();
  return emailName.isEmpty ? 'User' : emailName;
}

String _genderLabel(String value) {
  return switch (value.trim().toLowerCase()) {
    'male' => 'Male',
    'female' => 'Female',
    'non_binary' || 'non-binary' => 'Non-binary',
    'prefer_not_to_say' => 'Private',
    _ => 'Profile',
  };
}

String _dateOnly(String value) {
  final text = value.trim();
  return text.length >= 10 ? text.substring(0, 10) : text;
}

String _mapString(Object? value) {
  return (value ?? '').toString().trim();
}

int? _mapInt(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '');
}

ImageProvider _contactImage(Map<String, dynamic>? contact) {
  final avatarUrl = _mapString(
    contact?['peer_avatar_url'] ?? contact?['avatar_url'],
  );
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
    return NetworkImage(avatarUrl);
  }
  if (avatarUrl.startsWith('assets/')) return AssetImage(avatarUrl);
  return AssetImage(
    RtcAssets.avatarForIndex(_mapInt(contact?['peer_id']) ?? 0),
  );
}

ImageProvider _participantImage(RoomParticipantPreview preview, int index) {
  final avatarUrl = preview.avatarUrl.trim();
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
    return NetworkImage(avatarUrl);
  }
  if (avatarUrl.startsWith('assets/')) return AssetImage(avatarUrl);
  return AssetImage(RtcAssets.avatarForIndex(preview.userId + index));
}

String _roomAccessLabel(Room room) {
  if (room.isLocked) return 'Password';
  if (room.isPrivate) return 'Private';
  return 'Public';
}

List<_RoomFeature> _roomFeatureChips(Room room) {
  return [
    _RoomFeature(
      label: _roomFeatureTypeLabel(room),
      icon: room.supportsVideo
          ? Icons.videocam_outlined
          : Icons.spatial_audio_off_outlined,
      color: room.supportsVideo ? RtcPalette.lobbyTealDark : RtcPalette.violet,
    ),
    if (room.chatEnabled)
      const _RoomFeature(
        label: 'Chat',
        icon: Icons.chat_bubble_outline_rounded,
        color: RtcPalette.lobbyTealDark,
      ),
    if (room.screenShareEnabled)
      const _RoomFeature(
        label: 'Share',
        icon: Icons.screen_share_outlined,
        color: RtcPalette.sky,
      ),
    if (room.aiSecurityEnabled)
      const _RoomFeature(
        label: 'Guard',
        icon: Icons.shield_outlined,
        color: RtcPalette.amber,
      ),
  ];
}

String _roomFeatureTypeLabel(Room room) {
  return switch (room.roomType) {
    'group_video' => 'Group room',
    'group_audio' => 'Music stage',
    'one_to_one_video' => 'Video call',
    'one_to_one_audio' => 'Voice call',
    'pk_live' => 'PK stage',
    'solo_live' => 'Solo stage',
    'youtube_audio' => 'YouTube room',
    'audio' => 'Audio room',
    'video' => 'Video room',
    _ => '${room.roomTypeShortLabel} room',
  };
}

String _messageBody(Map<dynamic, dynamic>? message, {String fallback = ''}) {
  if (message == null) return fallback;
  final type = _mapString(message['message_type']);
  final body = _mapString(message['message_body'] ?? message['body']);
  if (type == 'image') return body.isEmpty ? 'Photo' : body;
  if (type == 'voice') return body.isEmpty ? 'Voice message' : body;
  return body.isEmpty ? fallback : body;
}

String _messageTime(Map<String, dynamic> message) {
  final raw = _mapString(message['created_at'] ?? message['createdAt']);
  final date = DateTime.tryParse(raw);
  if (date == null) return '';
  final local = date.toLocal();
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute.toString().padLeft(2, '0');
  final suffix = local.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $suffix';
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
