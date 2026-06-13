import 'package:flutter/material.dart';

import '../models/app_user.dart';
import '../models/room.dart';

class RtcPalette {
  static const ink = Color(0xFF080D19);
  static const panel = Color(0xFF121827);
  static const panelStrong = Color(0xFF0F172A);
  static const line = Color(0xFF263348);
  static const soft = Color(0xFFE2E8F0);
  static const muted = Color(0xFF94A3B8);
  static const hot = Color(0xFFFF3F7F);
  static const sky = Color(0xFF38BDF8);
  static const mint = Color(0xFF34D399);
  static const amber = Color(0xFFF59E0B);
  static const violet = Color(0xFF8B5CF6);
}

class RtcBackdrop extends StatelessWidget {
  const RtcBackdrop({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF050816), Color(0xFF0F172A), Color(0xFF101923)],
        ),
      ),
      child: Stack(
        children: [
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment(-1, -0.85),
                  end: Alignment(1, 0.9),
                  colors: [
                    Color.fromRGBO(255, 63, 127, 0.16),
                    Color.fromRGBO(56, 189, 248, 0.07),
                    Color.fromRGBO(52, 211, 153, 0.05),
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

class GlassPanel extends StatelessWidget {
  const GlassPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.color = const Color.fromRGBO(18, 24, 39, 0.9),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(8),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(0, 0, 0, 0.28),
            blurRadius: 32,
            offset: Offset(0, 18),
          ),
        ],
      ),
      child: child,
    );
  }
}

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 44});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [RtcPalette.hot, RtcPalette.sky, RtcPalette.mint],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(56, 189, 248, 0.24),
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Icon(Icons.graphic_eq, color: Colors.white, size: size * 0.54),
    );
  }
}

class BrandHeader extends StatelessWidget {
  const BrandHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const BrandMark(),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w900,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: RtcPalette.muted,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: 12), trailing!],
      ],
    );
  }
}

class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.onPressed,
    required this.child,
    this.icon,
  });

  final VoidCallback? onPressed;
  final Widget child;
  final Widget? icon;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          gradient: enabled
              ? const LinearGradient(colors: [RtcPalette.hot, RtcPalette.sky])
              : const LinearGradient(
                  colors: [Color(0xFF334155), Color(0xFF334155)],
                ),
          boxShadow: enabled
              ? const [
                  BoxShadow(
                    color: Color.fromRGBO(255, 63, 127, 0.22),
                    blurRadius: 28,
                    offset: Offset(0, 14),
                  ),
                ]
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: onPressed,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 52),
              child: SizedBox(
                width: double.infinity,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[icon!, const SizedBox(width: 10)],
                    DefaultTextStyle(
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 16,
                      ),
                      child: child,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class GhostButton extends StatelessWidget {
  const GhostButton({
    super.key,
    required this.onPressed,
    required this.icon,
    required this.label,
  });

  final VoidCallback? onPressed;
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(50),
        foregroundColor: RtcPalette.soft,
        side: const BorderSide(color: Color.fromRGBO(255, 255, 255, 0.16)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    this.detail,
    this.state = RtcStatusState.idle,
  });

  final String label;
  final String? detail;
  final RtcStatusState state;

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      RtcStatusState.good => RtcPalette.mint,
      RtcStatusState.warning => RtcPalette.amber,
      RtcStatusState.error => const Color(0xFFFB7185),
      RtcStatusState.idle => RtcPalette.muted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(8, 4, 24, 0.58),
        border: Border.all(color: color.withValues(alpha: 0.32)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: color.withValues(alpha: 0.18),
                  blurRadius: 0,
                  spreadRadius: 5,
                ),
              ],
            ),
          ),
          const SizedBox(width: 9),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (detail != null && detail!.isNotEmpty) ...[
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                detail!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color.fromRGBO(226, 232, 240, 0.78),
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

enum RtcStatusState { idle, good, warning, error }

class MetricChip extends StatelessWidget {
  const MetricChip({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(148, 163, 184, 0.12),
        border: Border.all(color: const Color.fromRGBO(148, 163, 184, 0.18)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: RtcPalette.muted,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class InitialAvatar extends StatelessWidget {
  const InitialAvatar({super.key, required this.user, this.size = 42});

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
        borderRadius: BorderRadius.circular(10),
        gradient: const LinearGradient(
          colors: [RtcPalette.sky, RtcPalette.violet],
        ),
      ),
      child: Text(
        initial,
        style: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w900,
          fontSize: size * 0.42,
        ),
      ),
    );
  }
}

class RoomGradientCover extends StatelessWidget {
  const RoomGradientCover({
    super.key,
    required this.room,
    required this.index,
    this.height = 168,
  });

  final Room room;
  final int index;
  final double height;

  @override
  Widget build(BuildContext context) {
    final gradient = roomToneGradient(room, index);
    return Container(
      height: height,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: gradient,
        ),
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
                    Color.fromRGBO(8, 13, 25, 0.06),
                    Color.fromRGBO(8, 13, 25, 0.9),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            right: 0,
            top: 42,
            child: _StageGlyph(video: room.supportsVideo),
          ),
          Positioned(
            top: 0,
            left: 0,
            child: StatusPill(
              label: room.supportsVideo ? 'Live video' : 'Live audio',
              state: RtcStatusState.good,
            ),
          ),
          Positioned(
            right: 0,
            top: 0,
            child: _TinyChip(label: formatPrivacy(room.privacyType)),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  room.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                    height: 1.05,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _TinyChip(label: formatRoomType(room.roomType)),
                    _TinyChip(label: '${room.maxMicCount} seats'),
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

class _StageGlyph extends StatelessWidget {
  const _StageGlyph({required this.video});

  final bool video;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 116,
      height: 78,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(4, (index) {
          final heights = [34.0, 58.0, 46.0, 72.0];
          return Container(
            width: video ? 22 : 14,
            height: heights[index],
            margin: const EdgeInsets.only(left: 7),
            decoration: BoxDecoration(
              color: const Color.fromRGBO(255, 255, 255, 0.22),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: const Color.fromRGBO(255, 255, 255, 0.2),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _TinyChip extends StatelessWidget {
  const _TinyChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: const Color.fromRGBO(255, 255, 255, 0.1),
        border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.16)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: RtcPalette.soft,
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

List<Color> roomToneGradient(Room room, int index) {
  final value = room.roomType.toLowerCase();
  if (value.contains('music') || value.contains('audio')) {
    return const [RtcPalette.mint, RtcPalette.sky];
  }
  if (value.contains('solo') || value.contains('video')) {
    return const [RtcPalette.sky, RtcPalette.violet];
  }
  if (value.contains('pk')) {
    return const [RtcPalette.hot, RtcPalette.violet, RtcPalette.sky];
  }
  final variants = const [
    [RtcPalette.hot, RtcPalette.sky],
    [RtcPalette.hot, RtcPalette.amber, RtcPalette.mint],
    [RtcPalette.mint, RtcPalette.sky, RtcPalette.violet],
  ];
  return variants[index % variants.length];
}

String formatRoomType(String value) {
  return _humanize(value.isEmpty ? 'live_room' : value);
}

String formatPrivacy(String value) {
  return _humanize(value.isEmpty ? 'public' : value);
}

String _humanize(String value) {
  final words = value
      .replaceAll('-', '_')
      .split('_')
      .where((word) => word.trim().isNotEmpty)
      .map((word) {
        final lower = word.toLowerCase();
        return '${lower[0].toUpperCase()}${lower.substring(1)}';
      });
  return words.isEmpty ? value : words.join(' ');
}
