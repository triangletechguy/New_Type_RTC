import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../models/app_user.dart';
import '../models/room.dart';
import 'rtc_assets.dart';

class RtcPalette {
  static const bg = Color(0xFF0A1020);
  static const ink = bg;
  static const surface = Color(0xFF121827);
  static const panel = surface;
  static const surface2 = Color(0xFF182133);
  static const panelStrong = surface2;
  static const surface3 = Color(0xFF202A3F);
  static const line = Color.fromRGBO(148, 163, 184, 0.2);
  static const lineStrong = Color.fromRGBO(226, 232, 240, 0.28);
  static const text = Color(0xFFF8FAFC);
  static const soft = Color(0xFFD7E0EF);
  static const muted = Color(0xFFA8B3C7);
  static const hot = Color(0xFFFF3F7F);
  static const hot2 = Color(0xFFFF7A45);
  static const sky = Color(0xFF38BDF8);
  static const mint = Color(0xFF34D399);
  static const amber = Color(0xFFF59E0B);
  static const violet = Color(0xFF8B5CF6);
  static const red = Color(0xFFEF4444);
  static const hoverBg = Color.fromRGBO(255, 255, 255, 0.07);
  static const hoverBgStrong = Color.fromRGBO(255, 255, 255, 0.11);
  static const hoverBorder = Color.fromRGBO(226, 232, 240, 0.22);
  static const focusRing = Color.fromRGBO(139, 92, 246, 0.34);
  static const focusBorder = Color.fromRGBO(167, 139, 250, 0.72);
  static const panelGlass = Color.fromRGBO(18, 24, 39, 0.9);
  static const panelScrim = Color.fromRGBO(10, 16, 32, 0.9);
  static const chip = Color.fromRGBO(148, 163, 184, 0.12);

  static const lobbyBg = Color(0xFFF4F7F5);
  static const lobbySurface = Color(0xFFFFFFFF);
  static const lobbyInk = Color(0xFF111827);
  static const lobbySoft = Color(0xFF667085);
  static const lobbyMuted = Color(0xFF98A2B3);
  static const lobbyLine = Color(0xFFE1E7EA);
  static const lobbyTeal = Color(0xFF20BFA3);
  static const lobbyTealDark = Color(0xFF10866F);
  static const lobbyMint = Color(0xFFE8F8F2);
  static const lobbyGold = Color(0xFFFFC928);
  static const lobbyGoldSoft = Color(0xFFFFF3C4);

  static const stageBg = Color(0xFF21070C);
  static const stageWine = Color(0xFF4A0E19);
  static const stagePlum = Color(0xFF31105A);
  static const stagePanel = Color.fromRGBO(37, 8, 18, 0.88);
  static const stagePanelSoft = Color.fromRGBO(255, 255, 255, 0.1);
  static const stageLine = Color.fromRGBO(255, 255, 255, 0.18);
  static const chatPurple = Color(0xFFD34BFF);
  static const sheetSurface = Color(0xFFFFFFFF);
}

class RtcTypography {
  static const fontFamily = 'Inter';
  static const fontFamilyFallback = ['Roboto', 'Arial', 'sans-serif'];
  static const bodySize = 16.0;
  static const bodyHeight = 1.35;
  static const tightHeight = 1.08;
}

class RtcRadius {
  static const panel = 8.0;
  static const control = 8.0;
  static const brand = 10.0;
  static const pill = 999.0;
}

class RtcSpacing {
  static const xxs = 4.0;
  static const xs = 6.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 24.0;
}

class RtcShadows {
  static const panel = [
    BoxShadow(
      color: Color.fromRGBO(0, 0, 0, 0.34),
      blurRadius: 60,
      offset: Offset(0, 18),
    ),
  ];

  static const brand = [
    BoxShadow(
      color: Color.fromRGBO(56, 189, 248, 0.24),
      blurRadius: 24,
      offset: Offset(0, 12),
    ),
  ];

  static const cta = [
    BoxShadow(
      color: Color.fromRGBO(255, 63, 127, 0.22),
      blurRadius: 28,
      offset: Offset(0, 14),
    ),
  ];
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
          colors: [RtcPalette.bg, RtcPalette.surface2, RtcPalette.surface3],
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
    this.color = RtcPalette.panelGlass,
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
        borderRadius: BorderRadius.circular(RtcRadius.panel),
        boxShadow: RtcShadows.panel,
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
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(RtcRadius.brand),
        boxShadow: RtcShadows.brand,
      ),
      child: SvgPicture.asset(RtcAssets.brandAppIconSmall, fit: BoxFit.cover),
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
                  color: RtcPalette.text,
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
          borderRadius: BorderRadius.circular(RtcRadius.pill),
          gradient: enabled
              ? const LinearGradient(
                  colors: [RtcPalette.hot, RtcPalette.hot2, RtcPalette.sky],
                )
              : const LinearGradient(
                  colors: [RtcPalette.surface3, RtcPalette.surface3],
                ),
          boxShadow: enabled ? RtcShadows.cta : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(RtcRadius.pill),
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
                        color: RtcPalette.text,
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
        side: const BorderSide(color: RtcPalette.hoverBorder),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RtcRadius.pill),
        ),
      ),
    );
  }
}

class RtcIconButton extends StatelessWidget {
  const RtcIconButton({
    super.key,
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.size = 40,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final double size;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(RtcRadius.control),
        onTap: onPressed,
        child: Opacity(
          opacity: enabled ? 1 : 0.48,
          child: Container(
            width: size,
            height: size,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: RtcPalette.hoverBg,
              border: Border.all(color: RtcPalette.line),
              borderRadius: BorderRadius.circular(RtcRadius.control),
            ),
            child: Icon(icon, color: RtcPalette.soft, size: size * 0.5),
          ),
        ),
      ),
    );
  }
}

class RtcFilterBar extends StatelessWidget {
  const RtcFilterBar({
    super.key,
    required this.options,
    required this.active,
    required this.onChanged,
  });

  final List<String> options;
  final String active;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: options.map((option) {
          final selected = option == active;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              selected: selected,
              label: Text(option),
              onSelected: (_) => onChanged(option),
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
            ),
          );
        }).toList(),
      ),
    );
  }
}

class RtcLoadingPanel extends StatelessWidget {
  const RtcLoadingPanel({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Row(
        children: [
          const SizedBox.square(
            dimension: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class RtcMessagePanel extends StatelessWidget {
  const RtcMessagePanel({
    super.key,
    required this.icon,
    required this.title,
    required this.detail,
    this.actionLabel,
    this.actionIcon = Icons.refresh,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String? actionLabel;
  final IconData actionIcon;
  final Future<void> Function()? onAction;

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
              color: RtcPalette.text,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            detail,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: RtcPalette.muted,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 16),
            GhostButton(
              onPressed: onAction,
              icon: actionIcon,
              label: actionLabel!,
            ),
          ],
        ],
      ),
    );
  }
}

class RtcSectionHeader extends StatelessWidget {
  const RtcSectionHeader({
    super.key,
    required this.eyebrow,
    required this.title,
    required this.detail,
  });

  final String eyebrow;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          eyebrow.toUpperCase(),
          style: const TextStyle(
            color: RtcPalette.sky,
            fontSize: 12,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            color: RtcPalette.text,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          detail,
          style: const TextStyle(
            color: RtcPalette.muted,
            fontWeight: FontWeight.w700,
            height: 1.35,
          ),
        ),
      ],
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
      RtcStatusState.error => RtcPalette.red,
      RtcStatusState.idle => RtcPalette.muted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: RtcPalette.panelScrim.withValues(alpha: 0.58),
        border: Border.all(color: color.withValues(alpha: 0.32)),
        borderRadius: BorderRadius.circular(RtcRadius.brand),
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
              color: RtcPalette.text,
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
                style: TextStyle(
                  color: RtcPalette.soft.withValues(alpha: 0.78),
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
        color: RtcPalette.chip,
        border: Border.all(color: RtcPalette.line),
        borderRadius: BorderRadius.circular(RtcRadius.control),
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
              color: RtcPalette.text,
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
    if (RtcAssets.shouldUseAdminAvatar(user)) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(RtcRadius.brand),
        child: SvgPicture.asset(
          RtcAssets.adminDashboardAvatar,
          width: size,
          height: size,
          fit: BoxFit.cover,
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(RtcRadius.brand),
      child: Image(
        image: RtcAssets.avatarImageForUser(user),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => _InitialAvatarFallback(
          initial: initial,
          size: size,
          gradient: RtcAssets.initialGradientForUser(user),
        ),
      ),
    );
  }
}

class _InitialAvatarFallback extends StatelessWidget {
  const _InitialAvatarFallback({
    required this.initial,
    required this.size,
    required this.gradient,
  });

  final String initial;
  final double size;
  final List<Color> gradient;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        gradient: LinearGradient(colors: gradient),
      ),
      child: Text(
        initial,
        style: TextStyle(
          color: RtcPalette.text,
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
    return Container(
      height: height,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: RtcPalette.panelStrong,
        image: DecorationImage(
          image: RtcAssets.coverImageForRoom(room, index),
          fit: BoxFit.cover,
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
                    Color.fromRGBO(10, 16, 32, 0.06),
                    RtcPalette.panelScrim,
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
                    color: RtcPalette.text,
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
              color: RtcPalette.hoverBgStrong.withValues(alpha: 0.22),
              borderRadius: BorderRadius.circular(RtcRadius.control),
              border: Border.all(color: RtcPalette.lineStrong),
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
        color: RtcPalette.hoverBgStrong,
        border: Border.all(color: RtcPalette.hoverBorder),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
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

class RtcMobileFrame extends StatelessWidget {
  const RtcMobileFrame({
    super.key,
    required this.child,
    this.bottomNavigation,
    this.backgroundColor = RtcPalette.lobbyBg,
    this.extendBehindBottomNav = false,
  });

  final Widget child;
  final Widget? bottomNavigation;
  final Color backgroundColor;
  final bool extendBehindBottomNav;

  @override
  Widget build(BuildContext context) {
    final bottomInset = bottomNavigation == null || extendBehindBottomNav
        ? 0.0
        : 82.0 + MediaQuery.paddingOf(context).bottom;
    return Scaffold(
      backgroundColor: backgroundColor,
      body: Stack(
        children: [
          Positioned.fill(
            child: Padding(
              padding: EdgeInsets.only(bottom: bottomInset),
              child: child,
            ),
          ),
          if (bottomNavigation != null)
            Positioned(left: 0, right: 0, bottom: 0, child: bottomNavigation!),
        ],
      ),
    );
  }
}

class RtcLobbyHero extends StatelessWidget {
  const RtcLobbyHero({
    super.key,
    required this.title,
    required this.subtitle,
    this.leading,
    this.trailing,
    this.child,
    this.minHeight = 168,
    this.background,
  });

  final String title;
  final String subtitle;
  final Widget? leading;
  final Widget? trailing;
  final Widget? child;
  final double minHeight;
  final ImageProvider? background;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Container(
      constraints: BoxConstraints(minHeight: minHeight + top),
      padding: EdgeInsets.fromLTRB(
        RtcSpacing.md,
        top + RtcSpacing.xxl,
        RtcSpacing.md,
        RtcSpacing.lg,
      ),
      decoration: BoxDecoration(
        image: background == null
            ? null
            : DecorationImage(
                image: background!,
                fit: BoxFit.cover,
                alignment: Alignment.topCenter,
              ),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF6EE7C9),
            RtcPalette.lobbyTeal,
            RtcPalette.lobbyGoldSoft,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (leading != null) ...[leading!, const SizedBox(width: 10)],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbyInk,
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                        height: RtcTypography.tightHeight,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color.fromRGBO(17, 24, 39, 0.72),
                        fontSize: 13,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 10), trailing!],
            ],
          ),
          if (child != null) ...[const SizedBox(height: 16), child!],
        ],
      ),
    );
  }
}

class RtcMobileBottomNavItem {
  const RtcMobileBottomNavItem({
    required this.label,
    this.icon,
    this.asset,
    this.image,
    this.badge,
  });

  final IconData? icon;
  final String? asset;
  final ImageProvider? image;
  final String label;
  final String? badge;
}

class RtcMobileBottomNav extends StatelessWidget {
  const RtcMobileBottomNav({
    super.key,
    required this.items,
    required this.activeIndex,
    required this.onChanged,
  });

  final List<RtcMobileBottomNavItem> items;
  final int activeIndex;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    return Container(
      height: 66 + bottom,
      padding: EdgeInsets.fromLTRB(10, 5, 10, bottom + 6),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF43B68F), Color(0xFF17836E)],
        ),
        boxShadow: [
          BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.16),
            blurRadius: 26,
            offset: Offset(0, -14),
          ),
        ],
      ),
      child: Row(
        children: List.generate(items.length, (index) {
          final item = items[index];
          final selected = index == activeIndex;
          final color = selected
              ? const Color(0xFFFFD95A)
              : Colors.white.withValues(alpha: 0.9);
          return Expanded(
            child: Material(
              color: selected
                  ? Colors.white.withValues(alpha: 0.1)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: () => onChanged(index),
                child: Semantics(
                  selected: selected,
                  button: true,
                  label: item.label,
                  child: SizedBox(
                    height: 54,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Stack(
                          clipBehavior: Clip.none,
                          alignment: Alignment.center,
                          children: [
                            _NavIcon(item: item, color: color),
                            if (item.badge != null)
                              Positioned(
                                right: -14,
                                top: -7,
                                child: _NavBadge(label: item.badge!),
                              ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: color,
                            fontSize: 11,
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
        }),
      ),
    );
  }
}

class _NavIcon extends StatelessWidget {
  const _NavIcon({required this.item, required this.color});

  final RtcMobileBottomNavItem item;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final image = item.image;
    if (image != null) {
      return RtcAvatarToken(
        label: item.label,
        image: image,
        size: 30,
        borderRadius: RtcRadius.pill,
      );
    }

    final asset = item.asset;
    if (asset != null) {
      final colorFilter =
          asset == RtcAssets.feedbackHelpIcon ||
              asset == RtcAssets.settingsIcon ||
              asset == RtcAssets.brandAppIconSmall
          ? ColorFilter.mode(color, BlendMode.srcIn)
          : null;
      return SvgPicture.asset(
        asset,
        width: 30,
        height: 30,
        fit: BoxFit.contain,
        colorFilter: colorFilter,
      );
    }

    return Icon(item.icon ?? Icons.circle, color: color, size: 30);
  }
}

class _NavBadge extends StatelessWidget {
  const _NavBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: RtcPalette.red,
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 8,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class RtcCompactTabs extends StatelessWidget {
  const RtcCompactTabs({
    super.key,
    required this.tabs,
    required this.activeIndex,
    required this.onChanged,
    this.dark = false,
  });

  final List<String> tabs;
  final int activeIndex;
  final ValueChanged<int> onChanged;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: tabs.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final selected = index == activeIndex;
          final foreground = dark
              ? selected
                    ? RtcPalette.text
                    : RtcPalette.muted
              : selected
              ? RtcPalette.lobbyInk
              : RtcPalette.lobbySoft;
          final background = dark
              ? selected
                    ? RtcPalette.stagePanelSoft
                    : Colors.transparent
              : selected
              ? RtcPalette.lobbySurface
              : const Color(0xFFEAF0F2);
          return Material(
            color: background,
            borderRadius: BorderRadius.circular(RtcRadius.pill),
            child: InkWell(
              borderRadius: BorderRadius.circular(RtcRadius.pill),
              onTap: () => onChanged(index),
              child: Container(
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 18),
                decoration: BoxDecoration(
                  border: Border.all(
                    color: selected
                        ? RtcPalette.lobbyTeal
                        : dark
                        ? RtcPalette.stageLine
                        : Colors.transparent,
                  ),
                  borderRadius: BorderRadius.circular(RtcRadius.pill),
                ),
                child: Text(
                  tabs[index],
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class RtcAvatarToken extends StatelessWidget {
  const RtcAvatarToken({
    super.key,
    required this.label,
    this.image,
    this.asset,
    this.size = 48,
    this.gradient,
    this.borderRadius = 12,
  });

  final String label;
  final ImageProvider? image;
  final String? asset;
  final double size;
  final List<Color>? gradient;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    final initial = label.trim().isEmpty ? '?' : label.trim()[0].toUpperCase();
    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: asset != null
          ? SvgPicture.asset(
              asset!,
              width: size,
              height: size,
              fit: BoxFit.cover,
            )
          : image == null
          ? _InitialAvatarFallback(
              initial: initial,
              size: size,
              gradient:
                  gradient ?? const [RtcPalette.lobbyTeal, RtcPalette.sky],
            )
          : Image(
              image: image!,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => _InitialAvatarFallback(
                initial: initial,
                size: size,
                gradient:
                    gradient ?? const [RtcPalette.lobbyTeal, RtcPalette.sky],
              ),
            ),
    );
  }
}

class RtcLobbyRoomRow extends StatelessWidget {
  const RtcLobbyRoomRow({
    super.key,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.image,
    this.badge,
    this.tags = const [],
    this.liveCount = 0,
    this.locked = false,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final ImageProvider? image;
  final String? badge;
  final List<String> tags;
  final int liveCount;
  final bool locked;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: RtcPalette.lobbySurface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            border: Border.all(color: RtcPalette.lobbyLine),
            borderRadius: BorderRadius.circular(12),
            boxShadow: const [
              BoxShadow(
                color: Color.fromRGBO(15, 23, 42, 0.05),
                blurRadius: 14,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            children: [
              RtcAvatarToken(label: title, image: image, size: 54),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: RtcPalette.lobbyInk,
                              fontSize: 14,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        if (locked) ...[
                          const SizedBox(width: 6),
                          const Icon(
                            Icons.lock_rounded,
                            size: 14,
                            color: RtcPalette.amber,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RtcPalette.lobbySoft,
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (badge != null || tags.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 5,
                        runSpacing: 5,
                        children: [
                          if (badge != null)
                            RtcMiniBadge(
                              label: badge!,
                              color: RtcPalette.lobbyTeal,
                            ),
                          ...tags
                              .take(3)
                              .map(
                                (tag) => RtcMiniBadge(
                                  label: tag,
                                  color: RtcPalette.lobbySoft,
                                  subtle: true,
                                ),
                              ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              trailing ??
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.graphic_eq_rounded,
                        color: RtcPalette.lobbyGold,
                        size: 16,
                      ),
                      Text(
                        liveCount.toString(),
                        style: const TextStyle(
                          color: RtcPalette.lobbySoft,
                          fontSize: 11,
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

class RtcMiniBadge extends StatelessWidget {
  const RtcMiniBadge({
    super.key,
    required this.label,
    required this.color,
    this.subtle = false,
  });

  final String label;
  final Color color;
  final bool subtle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: subtle ? 0.08 : 0.14),
        borderRadius: BorderRadius.circular(RtcRadius.pill),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class RtcInlineNotice extends StatelessWidget {
  const RtcInlineNotice({
    super.key,
    required this.icon,
    required this.title,
    this.detail,
    this.state = RtcStatusState.idle,
    this.dark = false,
    this.action,
  });

  final IconData icon;
  final String title;
  final String? detail;
  final RtcStatusState state;
  final bool dark;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      RtcStatusState.good => RtcPalette.mint,
      RtcStatusState.warning => RtcPalette.amber,
      RtcStatusState.error => RtcPalette.red,
      RtcStatusState.idle => dark ? RtcPalette.soft : RtcPalette.lobbySoft,
    };
    final background = dark
        ? RtcPalette.stagePanelSoft
        : const Color(0xFFF8FAFC);
    final textColor = dark ? RtcPalette.text : RtcPalette.lobbyInk;
    final detailColor = dark ? RtcPalette.muted : RtcPalette.lobbySoft;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: background,
        border: Border.all(color: color.withValues(alpha: 0.26)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: textColor,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                if (detail != null && detail!.trim().isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    detail!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: detailColor,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      height: 1.25,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (action != null) ...[const SizedBox(width: 10), action!],
        ],
      ),
    );
  }
}

class RtcCompactActionButton extends StatelessWidget {
  const RtcCompactActionButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.destructive = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive ? RtcPalette.red : RtcPalette.lobbyTealDark;
    final style = OutlinedButton.styleFrom(
      foregroundColor: color,
      side: BorderSide(color: color.withValues(alpha: 0.3)),
      visualDensity: VisualDensity.compact,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
    );

    final buttonIcon = icon;
    if (buttonIcon == null) {
      return OutlinedButton(
        onPressed: onPressed,
        style: style,
        child: Text(label),
      );
    }

    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(buttonIcon, size: 14),
      label: Text(label),
      style: style,
    );
  }
}

class RtcParticipantTile extends StatelessWidget {
  const RtcParticipantTile({
    super.key,
    required this.label,
    required this.detail,
    this.image,
    this.asset,
    this.busy = false,
    this.locked = false,
    this.dark = false,
    this.actions = const [],
  });

  final String label;
  final String detail;
  final ImageProvider? image;
  final String? asset;
  final bool busy;
  final bool locked;
  final bool dark;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final background = dark
        ? RtcPalette.stagePanelSoft
        : const Color(0xFFF8FAFC);
    final border = dark ? RtcPalette.stageLine : RtcPalette.lobbyLine;
    final titleColor = dark ? RtcPalette.text : RtcPalette.lobbyInk;
    final detailColor = dark ? RtcPalette.muted : RtcPalette.lobbySoft;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: background,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              RtcAvatarToken(
                label: label,
                image: image,
                asset: asset,
                size: 34,
                borderRadius: RtcRadius.pill,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: titleColor,
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: detailColor,
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
              else if (locked)
                Icon(Icons.lock_outline_rounded, color: detailColor, size: 18),
            ],
          ),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: actions),
          ],
        ],
      ),
    );
  }
}

enum RtcSeatState { open, occupied, speaking, muted, locked }

class RtcStageSeat extends StatelessWidget {
  const RtcStageSeat({
    super.key,
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
    final color = _seatColor(state);
    final locked = state == RtcSeatState.locked;
    final occupied =
        state == RtcSeatState.occupied ||
        state == RtcSeatState.speaking ||
        state == RtcSeatState.muted;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          decoration: BoxDecoration(
            color: RtcPalette.stagePanelSoft,
            border: Border.all(color: color.withValues(alpha: 0.45)),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.16),
                      border: Border.all(color: color.withValues(alpha: 0.45)),
                    ),
                  ),
                  if (locked)
                    Icon(Icons.lock_rounded, color: color, size: 20)
                  else if (occupied)
                    RtcAvatarToken(
                      label: label,
                      image: image,
                      asset: asset,
                      size: 38,
                      borderRadius: RtcRadius.pill,
                      gradient: [color, RtcPalette.stagePlum],
                    )
                  else
                    Icon(Icons.mic_none_rounded, color: color, size: 21),
                  if (state == RtcSeatState.muted)
                    const Positioned(
                      right: 0,
                      bottom: 0,
                      child: Icon(
                        Icons.mic_off_rounded,
                        color: RtcPalette.red,
                        size: 15,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                occupied ? label : 'No.$number',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: RtcPalette.text,
                  fontSize: 10,
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

Color _seatColor(RtcSeatState state) {
  return switch (state) {
    RtcSeatState.speaking => RtcPalette.lobbyGold,
    RtcSeatState.occupied => RtcPalette.chatPurple,
    RtcSeatState.muted => RtcPalette.muted,
    RtcSeatState.locked => RtcPalette.red,
    RtcSeatState.open => RtcPalette.soft,
  };
}

class RtcStageActionButton extends StatelessWidget {
  const RtcStageActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.active = false,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool active;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive
        ? RtcPalette.red
        : active
        ? RtcPalette.mint
        : RtcPalette.soft;
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 18),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        minimumSize: const Size(0, 44),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        side: BorderSide(color: color.withValues(alpha: 0.34)),
        backgroundColor: RtcPalette.stagePanelSoft,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
      ),
    );
  }
}

class RtcChatBubble extends StatelessWidget {
  const RtcChatBubble({
    super.key,
    required this.sender,
    required this.message,
    this.mine = false,
    this.accent = RtcPalette.chatPurple,
  });

  final String sender;
  final String message;
  final bool mine;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 300),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: mine
              ? accent.withValues(alpha: 0.22)
              : RtcPalette.stagePanelSoft,
          border: Border.all(
            color: accent.withValues(alpha: mine ? 0.36 : 0.16),
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              sender,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: accent,
                fontSize: 11,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              message,
              style: const TextStyle(
                color: RtcPalette.text,
                fontSize: 12,
                fontWeight: FontWeight.w700,
                height: 1.25,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class RtcChatComposer extends StatelessWidget {
  const RtcChatComposer({
    super.key,
    required this.controller,
    required this.onSend,
    this.hintText = 'Say hi...',
    this.onAttach,
    this.enabled = true,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final String hintText;
  final VoidCallback? onAttach;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        decoration: const BoxDecoration(color: Color.fromRGBO(0, 0, 0, 0.22)),
        child: Row(
          children: [
            IconButton(
              tooltip: 'Attach',
              onPressed: enabled ? onAttach : null,
              icon: const Icon(Icons.image_outlined, color: RtcPalette.soft),
            ),
            Expanded(
              child: TextField(
                controller: controller,
                enabled: enabled,
                minLines: 1,
                maxLines: 4,
                style: const TextStyle(
                  color: RtcPalette.text,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
                decoration: InputDecoration(
                  hintText: hintText,
                  hintStyle: const TextStyle(
                    color: RtcPalette.muted,
                    fontWeight: FontWeight.w700,
                  ),
                  filled: true,
                  fillColor: RtcPalette.stagePanelSoft,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RtcRadius.pill),
                    borderSide: const BorderSide(color: RtcPalette.stageLine),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RtcRadius.pill),
                    borderSide: const BorderSide(color: RtcPalette.chatPurple),
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: 'Send',
              onPressed: enabled ? onSend : null,
              icon: const Icon(Icons.send_rounded, color: RtcPalette.mint),
            ),
          ],
        ),
      ),
    );
  }
}

class RtcActionSheetPanel extends StatelessWidget {
  const RtcActionSheetPanel({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        decoration: const BoxDecoration(
          color: RtcPalette.sheetSurface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: RtcPalette.lobbyLine,
                  borderRadius: BorderRadius.circular(RtcRadius.pill),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              title,
              style: const TextStyle(
                color: RtcPalette.lobbyInk,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(
                subtitle!,
                style: const TextStyle(
                  color: RtcPalette.lobbySoft,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

class RtcSheetActionTile extends StatelessWidget {
  const RtcSheetActionTile({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.trailing,
    this.destructive = false,
  });

  final IconData icon;
  final String title;
  final VoidCallback? onTap;
  final String? subtitle;
  final Widget? trailing;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive ? RtcPalette.red : RtcPalette.lobbyTealDark;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 9),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: destructive
                            ? RtcPalette.red
                            : RtcPalette.lobbyInk,
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: RtcPalette.lobbySoft,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              trailing ??
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: RtcPalette.lobbyMuted,
                  ),
            ],
          ),
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
