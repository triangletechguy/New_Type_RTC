import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';
import '../ui/rtc_mobile_ui.dart';
import 'live_room_screen.dart';

class RoomListScreen extends StatefulWidget {
  const RoomListScreen({
    super.key,
    required this.api,
    required this.user,
    required this.onLoggedOut,
  });

  final ApiClient api;
  final AppUser user;
  final Future<void> Function() onLoggedOut;

  @override
  State<RoomListScreen> createState() => _RoomListScreenState();
}

class _RoomListScreenState extends State<RoomListScreen> {
  final _search = TextEditingController();
  late Future<List<Room>> _rooms;
  String _activeFilter = 'All';
  String _query = '';

  @override
  void initState() {
    super.initState();
    _rooms = widget.api.rooms();
    _search.addListener(() {
      setState(() => _query = _search.text.trim().toLowerCase());
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final future = widget.api.rooms();
    setState(() => _rooms = future);
    await future;
  }

  Future<void> _logout() async {
    await widget.api.clearSession();
    await widget.onLoggedOut();
  }

  List<Room> _visibleRooms(List<Room> rooms) {
    return rooms.where((room) {
      final matchesFilter = switch (_activeFilter) {
        'Video' => room.supportsVideo,
        'Audio' => !room.supportsVideo,
        'Private' =>
          room.privacyType.toLowerCase().contains('private') ||
              room.privacyType.toLowerCase().contains('password'),
        _ => true,
      };
      if (!matchesFilter) return false;
      if (_query.isEmpty) return true;
      final haystack = [
        room.name,
        room.description,
        room.roomType,
        room.privacyType,
      ].join(' ').toLowerCase();
      return haystack.contains(_query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: FutureBuilder<List<Room>>(
            future: _rooms,
            builder: (context, snapshot) {
              final rooms = snapshot.data ?? const <Room>[];
              final visibleRooms = _visibleRooms(rooms);
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    BrandHeader(
                      title: 'talk-each-other',
                      subtitle: 'Rooms',
                      trailing: _HeaderActions(
                        user: widget.user,
                        onRefresh: _refresh,
                        onLogout: _logout,
                      ),
                    ),
                    const SizedBox(height: 14),
                    _LobbyHero(
                      user: widget.user,
                      roomCount: rooms.length,
                      liveCount: visibleRooms.length,
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _search,
                      decoration: const InputDecoration(
                        hintText: 'Search rooms',
                        prefixIcon: Icon(Icons.search),
                      ),
                    ),
                    const SizedBox(height: 12),
                    _FilterTabs(
                      active: _activeFilter,
                      onChanged: (filter) =>
                          setState(() => _activeFilter = filter),
                    ),
                    const SizedBox(height: 14),
                    if (snapshot.connectionState != ConnectionState.done)
                      const _LoadingRooms()
                    else if (snapshot.hasError)
                      _MessageState(
                        icon: Icons.cloud_off,
                        title: 'Could not load rooms',
                        detail: apiErrorMessage(snapshot.error!),
                        actionLabel: 'Retry',
                        onAction: _refresh,
                      )
                    else if (visibleRooms.isEmpty)
                      _MessageState(
                        icon: Icons.meeting_room_outlined,
                        title: rooms.isEmpty
                            ? 'No active rooms'
                            : 'No matching rooms',
                        detail: rooms.isEmpty
                            ? 'Create a room from the web frontend or backend API, then refresh.'
                            : 'Try another filter or search term.',
                        actionLabel: 'Refresh',
                        onAction: _refresh,
                      )
                    else
                      ...visibleRooms.asMap().entries.map(
                        (entry) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _RoomCard(
                            room: entry.value,
                            index: entry.key,
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) => LiveRoomScreen(
                                    api: widget.api,
                                    user: widget.user,
                                    room: entry.value,
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _HeaderActions extends StatelessWidget {
  const _HeaderActions({
    required this.user,
    required this.onRefresh,
    required this.onLogout,
  });

  final AppUser user;
  final VoidCallback onRefresh;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        InitialAvatar(user: user, size: 40),
        const SizedBox(width: 8),
        _IconShell(
          tooltip: 'Refresh',
          icon: Icons.refresh,
          onPressed: onRefresh,
        ),
        const SizedBox(width: 6),
        _IconShell(
          tooltip: 'Sign out',
          icon: Icons.logout,
          onPressed: onLogout,
        ),
      ],
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

class _LobbyHero extends StatelessWidget {
  const _LobbyHero({
    required this.user,
    required this.roomCount,
    required this.liveCount,
  });

  final AppUser user;
  final int roomCount;
  final int liveCount;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      color: const Color.fromRGBO(10, 16, 32, 0.94),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'LIVE LOBBY',
            style: TextStyle(
              color: RtcPalette.sky,
              fontSize: 12,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Welcome back, ${user.name}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              height: 1.08,
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'Join a room, start RTC, and keep the same service flow as the web dashboard.',
            style: TextStyle(
              color: RtcPalette.muted,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              MetricChip(label: 'Shown', value: '$liveCount'),
              MetricChip(label: 'Available', value: '$roomCount'),
              const MetricChip(label: 'RTC', value: 'Ready'),
            ],
          ),
        ],
      ),
    );
  }
}

class _FilterTabs extends StatelessWidget {
  const _FilterTabs({required this.active, required this.onChanged});

  final String active;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    const filters = ['All', 'Video', 'Audio', 'Private'];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: filters.map((filter) {
          final selected = filter == active;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              selected: selected,
              label: Text(filter),
              onSelected: (_) => onChanged(filter),
              selectedColor: const Color.fromRGBO(56, 189, 248, 0.2),
              backgroundColor: const Color.fromRGBO(255, 255, 255, 0.07),
              side: BorderSide(
                color: selected
                    ? const Color.fromRGBO(56, 189, 248, 0.48)
                    : const Color.fromRGBO(255, 255, 255, 0.12),
              ),
              labelStyle: TextStyle(
                color: selected ? Colors.white : RtcPalette.soft,
                fontWeight: FontWeight.w900,
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({
    required this.room,
    required this.index,
    required this.onTap,
  });

  final Room room;
  final int index;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            RoomGradientCover(room: room, index: index),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    room.description.isEmpty
                        ? 'Tap to open the native RTC room.'
                        : room.description,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: RtcPalette.muted,
                      fontWeight: FontWeight.w700,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            MetricChip(
                              label: 'Mode',
                              value: room.supportsVideo ? 'Video' : 'Audio',
                            ),
                            MetricChip(
                              label: 'Privacy',
                              value: formatPrivacy(room.privacyType),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right, color: RtcPalette.soft),
                    ],
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

class _LoadingRooms extends StatelessWidget {
  const _LoadingRooms();

  @override
  Widget build(BuildContext context) {
    return const GlassPanel(
      child: Row(
        children: [
          SizedBox.square(
            dimension: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 12),
          Text(
            'Loading live rooms...',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _MessageState extends StatelessWidget {
  const _MessageState({
    required this.icon,
    required this.title,
    required this.detail,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String actionLabel;
  final Future<void> Function() onAction;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 42, color: RtcPalette.sky),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            detail,
            textAlign: TextAlign.center,
            style: const TextStyle(color: RtcPalette.muted, height: 1.35),
          ),
          const SizedBox(height: 16),
          GhostButton(
            onPressed: onAction,
            icon: Icons.refresh,
            label: actionLabel,
          ),
        ],
      ),
    );
  }
}
