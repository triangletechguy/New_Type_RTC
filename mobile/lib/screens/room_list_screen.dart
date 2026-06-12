import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import '../services/api_client.dart';
import '../theme/buzzcast_theme.dart';
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
  var _rooms = <Room>[];
  var _loading = true;
  var _showSearch = false;
  var _feed = 'popular';
  var _group = 'recently';
  var _status = 'Loading rooms...';

  @override
  void initState() {
    super.initState();
    _loadRooms();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _loadRooms({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _loading = true;
        _status = 'Loading rooms...';
      });
    }

    try {
      final rooms = await widget.api.rooms();
      if (!mounted) return;
      setState(() {
        _rooms = rooms;
        _status = rooms.length == 1
            ? 'Showing 1 room'
            : 'Showing ${rooms.length} rooms';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _logout() async {
    await widget.api.clearSession();
    await widget.onLoggedOut();
  }

  List<Room> get _visibleRooms {
    final query = _search.text.trim().toLowerCase();
    final byQuery = query.isEmpty
        ? _rooms
        : _rooms.where((room) {
            return room.name.toLowerCase().contains(query) ||
                room.ownerName.toLowerCase().contains(query) ||
                roomTypeLabel(room.roomType).toLowerCase().contains(query);
          }).toList();

    if (_feed == 'explore') {
      return byQuery.where((room) => room.privacyType != 'private').toList();
    }
    if (_feed == 'mine') {
      return byQuery
          .where((room) => room.ownerName == widget.user.name)
          .toList();
    }
    return byQuery;
  }

  Room? get _featuredRoom {
    if (_visibleRooms.isEmpty) return null;
    return _visibleRooms.first;
  }

  void _openRoom(Room room) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            LiveRoomScreen(api: widget.api, user: widget.user, room: room),
      ),
    );
  }

  void _openProfileSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _ProfileAvatar(user: widget.user, size: 52),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.user.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          widget.user.email,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: BuzzColors.mutedText,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  _logout();
                },
                icon: const Icon(Icons.logout),
                label: const Text('Sign out'),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final rooms = _visibleRooms;

    return Scaffold(
      backgroundColor: BuzzColors.feedBackground,
      body: Stack(
        children: [
          Positioned.fill(
            child: RefreshIndicator(
              color: BuzzColors.green,
              onRefresh: () => _loadRooms(quiet: true),
              child: ListView(
                padding: const EdgeInsets.only(bottom: 94),
                children: [
                  SafeArea(
                    bottom: false,
                    child: _MobileHomeHeader(
                      user: widget.user,
                      feed: _feed,
                      showSearch: _showSearch,
                      featuredRoom: _featuredRoom,
                      onFeedChanged: (value) => setState(() => _feed = value),
                      onToggleSearch: () =>
                          setState(() => _showSearch = !_showSearch),
                      onRefresh: () => _loadRooms(quiet: true),
                      onOpenFeatured: _featuredRoom == null
                          ? null
                          : () => _openRoom(_featuredRoom!),
                    ),
                  ),
                  if (_showSearch)
                    _SearchPanel(
                      controller: _search,
                      onChanged: (_) => setState(() {}),
                      onSearch: () => setState(() {}),
                    ),
                  _RoomGroupTabs(
                    value: _group,
                    onChanged: (value) => setState(() => _group = value),
                  ),
                  _FeedStatusBar(status: _status, loading: _loading),
                  if (_loading && _rooms.isEmpty)
                    const _LoadingRooms()
                  else if (rooms.isEmpty)
                    _EmptyRoomsState(
                      status: _status,
                      onRefresh: () => _loadRooms(quiet: true),
                    )
                  else
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 8, 10, 12),
                      child: Column(
                        children: [
                          for (
                            var index = 0;
                            index < rooms.length;
                            index++
                          ) ...[
                            _RoomFeedCard(
                              room: rooms[index],
                              index: index,
                              onTap: () => _openRoom(rooms[index]),
                            ),
                            if (index != rooms.length - 1)
                              const SizedBox(height: 10),
                          ],
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _BottomNav(
              onLive: () => _loadRooms(quiet: true),
              onSearch: () => setState(() => _showSearch = true),
              onProfile: _openProfileSheet,
            ),
          ),
        ],
      ),
    );
  }
}

class _MobileHomeHeader extends StatelessWidget {
  const _MobileHomeHeader({
    required this.user,
    required this.feed,
    required this.showSearch,
    required this.featuredRoom,
    required this.onFeedChanged,
    required this.onToggleSearch,
    required this.onRefresh,
    required this.onOpenFeatured,
  });

  final AppUser user;
  final String feed;
  final bool showSearch;
  final Room? featuredRoom;
  final ValueChanged<String> onFeedChanged;
  final VoidCallback onToggleSearch;
  final VoidCallback onRefresh;
  final VoidCallback? onOpenFeatured;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 190,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            height: 142,
            padding: const EdgeInsets.fromLTRB(12, 26, 12, 44),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [BuzzColors.mint, BuzzColors.green],
              ),
            ),
            child: Stack(
              children: [
                Positioned(
                  left: -4,
                  top: -8,
                  child: Image.asset(
                    BuzzAssets.goat,
                    width: 74,
                    height: 72,
                    fit: BoxFit.contain,
                  ),
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    _CircleImageButton(
                      asset: BuzzAssets.homeIcon,
                      onTap: onRefresh,
                      tooltip: 'Home',
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          _HeroTab(
                            label: 'Mine',
                            active: feed == 'mine',
                            onTap: () => onFeedChanged('mine'),
                          ),
                          _HeroTab(
                            label: 'Popular',
                            active: feed == 'popular',
                            onTap: () => onFeedChanged('popular'),
                          ),
                          _HeroTab(
                            label: 'Explore',
                            active: feed == 'explore',
                            onTap: () => onFeedChanged('explore'),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    _CircleImageButton(
                      asset: BuzzAssets.searchIcon,
                      onTap: onToggleSearch,
                      tooltip: showSearch ? 'Close search' : 'Search',
                      oversized: true,
                    ),
                  ],
                ),
              ],
            ),
          ),
          Positioned(
            left: 10,
            right: 10,
            bottom: 0,
            child: featuredRoom == null
                ? _FeatureEmpty(user: user)
                : _FeatureRoom(room: featuredRoom!, onTap: onOpenFeatured),
          ),
        ],
      ),
    );
  }
}

class _FeatureRoom extends StatelessWidget {
  const _FeatureRoom({required this.room, required this.onTap});

  final Room room;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final count = compactCount(room.activeParticipants);
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      elevation: 8,
      shadowColor: Colors.black.withValues(alpha: .16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 56, 8),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: _RoomImage(room: room, size: 60),
                  ),
                  const SizedBox(width: 10),
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
                            color: BuzzColors.feedText,
                            fontSize: 17,
                            height: 1.12,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Image.asset(BuzzAssets.bars, width: 18, height: 18),
                            const SizedBox(width: 5),
                            Image.asset(
                              BuzzAssets.group,
                              width: 18,
                              height: 18,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              count,
                              style: const TextStyle(
                                color: BuzzColors.mutedText,
                                fontSize: 13,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(width: 5),
                            Image.asset(BuzzAssets.lock, width: 16, height: 16),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              top: 0,
              right: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: const BoxDecoration(
                  color: BuzzColors.yellow,
                  borderRadius: BorderRadius.only(
                    topRight: Radius.circular(12),
                    bottomLeft: Radius.circular(12),
                  ),
                ),
                child: const Text(
                  'Live',
                  style: TextStyle(
                    color: Color(0xFF3F2F00),
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureEmpty extends StatelessWidget {
  const _FeatureEmpty({required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 82),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .12),
            blurRadius: 30,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.asset(
              BuzzAssets.creator,
              width: 60,
              height: 60,
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Welcome, ${user.name}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: BuzzColors.feedText,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const Text(
                  'No followed rooms yet',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: BuzzColors.mutedText,
                    fontSize: 13,
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

class _SearchPanel extends StatelessWidget {
  const _SearchPanel({
    required this.controller,
    required this.onChanged,
    required this.onSearch,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(10, 0, 10, 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .12),
            blurRadius: 26,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => onSearch(),
              decoration: InputDecoration(
                hintText: 'Search room or host',
                isDense: true,
                filled: true,
                fillColor: const Color(0xFFF8FAFC),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            height: 42,
            child: FilledButton(
              onPressed: onSearch,
              style: FilledButton.styleFrom(
                minimumSize: const Size(76, 42),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: const Text('Search'),
            ),
          ),
        ],
      ),
    );
  }
}

class _RoomGroupTabs extends StatelessWidget {
  const _RoomGroupTabs({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 58,
      padding: const EdgeInsets.fromLTRB(16, 5, 16, 8),
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Color(0x0F0F172A), offset: Offset(0, 1))],
      ),
      child: Row(
        children: [
          Expanded(
            child: _GroupTab(
              label: 'Recently',
              active: value == 'recently',
              onTap: () => onChanged('recently'),
            ),
          ),
          Expanded(
            child: _GroupTab(
              label: 'Follow',
              active: value == 'follow',
              onTap: () => onChanged('follow'),
            ),
          ),
          Expanded(
            child: _GroupTab(
              label: 'Group',
              active: value == 'group',
              onTap: () => onChanged('group'),
            ),
          ),
        ],
      ),
    );
  }
}

class _FeedStatusBar extends StatelessWidget {
  const _FeedStatusBar({required this.status, required this.loading});

  final String status;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              loading ? 'Refreshing rooms...' : status,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: BuzzColors.mutedText,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const _FilterPill(label: 'All'),
          const SizedBox(width: 8),
          const _FilterPill(label: 'Public'),
          const SizedBox(width: 8),
          const _FilterPill(label: 'Newest'),
        ],
      ),
    );
  }
}

class _RoomFeedCard extends StatelessWidget {
  const _RoomFeedCard({
    required this.room,
    required this.index,
    required this.onTap,
  });

  final Room room;
  final int index;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final userCount = room.activeParticipants;
    final countLabel = compactCount(userCount);
    final type = roomTypeLabel(room.roomType);
    final privacy = room.privacyType == 'public'
        ? '$countLabel watching'
        : room.privacyType;

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      elevation: 4,
      shadowColor: Colors.black.withValues(alpha: .07),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Row(
            children: [
              SizedBox(
                width: 78,
                height: 78,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: _RoomImage(room: room, size: 78),
                    ),
                    Positioned(
                      top: 6,
                      left: 6,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: .58),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          room.privacyType == 'password' ? 'Locked' : 'LIVE',
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
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      room.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: BuzzColors.feedText,
                        fontSize: 15,
                        height: 1.15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      room.ownerName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: BuzzColors.mutedText,
                        fontSize: 12,
                        height: 1.25,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            type,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BuzzColors.teal,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const SizedBox(width: 7),
                        Flexible(
                          child: Text(
                            privacy,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BuzzColors.softText,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.local_fire_department,
                    color: BuzzColors.amber,
                    size: 18,
                  ),
                  Text(
                    countLabel,
                    style: const TextStyle(
                      color: BuzzColors.amber,
                      fontSize: 12,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav({
    required this.onLive,
    required this.onSearch,
    required this.onProfile,
  });

  final VoidCallback onLive;
  final VoidCallback onSearch;
  final VoidCallback onProfile;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Container(
      height: 66 + bottomInset,
      padding: EdgeInsets.fromLTRB(10, 5, 10, 6 + bottomInset),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [BuzzColors.mint, BuzzColors.green],
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .16),
            blurRadius: 26,
            offset: const Offset(0, -12),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: _NavItem(
              icon: Icons.videocam_rounded,
              label: 'Live',
              active: true,
              onTap: onLive,
            ),
          ),
          const Expanded(
            child: _NavItem(icon: Icons.emoji_events_rounded, label: 'Ranking'),
          ),
          Expanded(
            child: _NavItem(
              icon: Icons.chat_bubble_rounded,
              label: 'Message',
              onTap: onSearch,
            ),
          ),
          Expanded(
            child: _NavItem(
              icon: Icons.person_rounded,
              label: 'Me',
              onTap: onProfile,
            ),
          ),
        ],
      ),
    );
  }
}

class _RoomImage extends StatelessWidget {
  const _RoomImage({required this.room, required this.size});

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
        errorBuilder: (_, _, _) => Image.asset(
          BuzzAssets.coverForRoom(room),
          width: size,
          height: size,
          fit: BoxFit.cover,
        ),
      );
    }
    return Image.asset(
      BuzzAssets.coverForRoom(room),
      width: size,
      height: size,
      fit: BoxFit.cover,
    );
  }
}

class _ProfileAvatar extends StatelessWidget {
  const _ProfileAvatar({required this.user, required this.size});

  final AppUser user;
  final double size;

  @override
  Widget build(BuildContext context) {
    final imageUrl = user.avatarUrl.trim();
    if (imageUrl.startsWith('http')) {
      return ClipOval(
        child: Image.network(
          imageUrl,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _InitialAvatar(user: user, size: size),
        ),
      );
    }
    return _InitialAvatar(user: user, size: size);
  }
}

class _InitialAvatar extends StatelessWidget {
  const _InitialAvatar({required this.user, required this.size});

  final AppUser user;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initial = user.name.trim().isEmpty
        ? 'U'
        : user.name.trim()[0].toUpperCase();
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          colors: [Color(0xFF9259FE), Color(0xFF14B8A6)],
        ),
      ),
      child: Text(
        initial,
        style: TextStyle(
          color: Colors.white,
          fontSize: size * .42,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _CircleImageButton extends StatelessWidget {
  const _CircleImageButton({
    required this.asset,
    required this.onTap,
    required this.tooltip,
    this.oversized = false,
  });

  final String asset;
  final VoidCallback onTap;
  final String tooltip;
  final bool oversized;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          width: 42,
          height: 42,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .2),
            shape: BoxShape.circle,
          ),
          child: Image.asset(
            asset,
            width: oversized ? 54 : 24,
            height: oversized ? 54 : 24,
            fit: BoxFit.contain,
          ),
        ),
      ),
    );
  }
}

class _HeroTab extends StatelessWidget {
  const _HeroTab({
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: TextButton(
        onPressed: onTap,
        style: TextButton.styleFrom(
          foregroundColor: active
              ? Colors.white
              : Colors.white.withValues(alpha: .78),
          padding: EdgeInsets.zero,
          minimumSize: const Size(0, 36),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
        ),
      ),
    );
  }
}

class _GroupTab extends StatelessWidget {
  const _GroupTab({
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        foregroundColor: active ? BuzzColors.green : BuzzColors.mutedText,
        backgroundColor: active ? const Color(0xFFE8F7F2) : Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      child: Text(label, style: const TextStyle(fontWeight: FontWeight.w900)),
    );
  }
}

class _FilterPill extends StatelessWidget {
  const _FilterPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        boxShadow: const [
          BoxShadow(color: Color(0x0F0F172A), offset: Offset(0, 1)),
        ],
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: BuzzColors.feedText,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    this.active = false,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = active
        ? BuzzColors.yellow
        : Colors.white.withValues(alpha: .9);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 54,
        decoration: BoxDecoration(
          color: active
              ? Colors.white.withValues(alpha: .1)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 26),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w900,
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
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 48),
      child: Center(child: CircularProgressIndicator()),
    );
  }
}

class _EmptyRoomsState extends StatelessWidget {
  const _EmptyRoomsState({required this.status, required this.onRefresh});

  final String status;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(18),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.asset(
                BuzzAssets.studioStage,
                height: 150,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 14),
            const Text(
              'No matching rooms yet',
              style: TextStyle(
                color: BuzzColors.feedText,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              status,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: BuzzColors.mutedText,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh'),
            ),
          ],
        ),
      ),
    );
  }
}
