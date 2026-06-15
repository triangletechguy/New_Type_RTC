import 'package:flutter/material.dart';

import '../ui/rtc_mobile_ui.dart';

class NativeRouteErrorScreen extends StatelessWidget {
  const NativeRouteErrorScreen({
    super.key,
    required this.title,
    required this.message,
    this.routeName = '',
  });

  final String title;
  final String message;
  final String routeName;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RtcBackdrop(
        child: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: GlassPanel(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const BrandHeader(
                        title: 'TalkEachOther',
                        subtitle: 'Native route',
                      ),
                      const SizedBox(height: 18),
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        message,
                        style: const TextStyle(
                          color: RtcPalette.muted,
                          fontWeight: FontWeight.w700,
                          height: 1.35,
                        ),
                      ),
                      if (routeName.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        StatusPill(
                          label: 'Route',
                          detail: routeName,
                          state: RtcStatusState.warning,
                        ),
                      ],
                      const SizedBox(height: 16),
                      GhostButton(
                        onPressed: Navigator.of(context).canPop()
                            ? () => Navigator.of(context).pop()
                            : null,
                        icon: Icons.arrow_back,
                        label: 'Back',
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
