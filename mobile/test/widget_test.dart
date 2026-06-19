import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:rtc_enterprise_mobile/main.dart';
import 'package:rtc_enterprise_mobile/models/app_user.dart';
import 'package:rtc_enterprise_mobile/navigation/app_routes.dart';
import 'package:rtc_enterprise_mobile/ui/rtc_assets.dart';
import 'package:rtc_enterprise_mobile/ui/rtc_mobile_ui.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('app widget can be constructed', () {
    expect(const RtcEnterpriseApp(), isA<RtcEnterpriseApp>());
  });

  test('native route registry includes expected routes', () {
    expect(
      AppRoutes.all,
      containsAll(const [
        AppRoutes.root,
        AppRoutes.login,
        AppRoutes.rooms,
        AppRoutes.liveRoom,
        AppRoutes.profile,
        AppRoutes.admin,
        AppRoutes.settings,
        AppRoutes.error,
      ]),
    );
    expect(AppRoutes.all, isNot(contains('/debug/web-reference')));
  });

  test('admin role gate matches web roles', () {
    const superAdmin = AppUser(
      id: 1,
      name: 'Platform Service Admin',
      email: 'admin@gmail.com',
      roles: ['super_admin'],
    );
    const clientAdmin = AppUser(
      id: 2,
      name: 'Company Service Admin',
      email: 'client@example.com',
      roles: ['client_admin'],
    );
    const endUser = AppUser(
      id: 3,
      name: 'End User',
      email: 'user@example.com',
      roles: ['end_user'],
    );

    expect(superAdmin.canUseAdminDashboard, isTrue);
    expect(clientAdmin.canUseAdminDashboard, isTrue);
    expect(endUser.canUseAdminDashboard, isFalse);
  });

  test('theme tokens match frozen web palette and typography', () {
    expect(RtcPalette.bg, const Color(0xFF0A1020));
    expect(RtcPalette.panel, const Color(0xFF121827));
    expect(RtcPalette.surface2, const Color(0xFF182133));
    expect(RtcPalette.surface3, const Color(0xFF202A3F));
    expect(RtcPalette.text, const Color(0xFFF8FAFC));
    expect(RtcPalette.soft, const Color(0xFFD7E0EF));
    expect(RtcPalette.muted, const Color(0xFFA8B3C7));
    expect(RtcPalette.hot, const Color(0xFFFF3F7F));
    expect(RtcPalette.hot2, const Color(0xFFFF7A45));
    expect(RtcPalette.sky, const Color(0xFF38BDF8));
    expect(RtcPalette.mint, const Color(0xFF34D399));
    expect(RtcPalette.violet, const Color(0xFF8B5CF6));
    expect(RtcPalette.amber, const Color(0xFFF59E0B));
    expect(RtcPalette.red, const Color(0xFFEF4444));
    expect(RtcPalette.lobbyBg, const Color(0xFFF4F7F5));
    expect(RtcPalette.lobbyTeal, const Color(0xFF20BFA3));
    expect(RtcPalette.lobbyGold, const Color(0xFFFFC928));
    expect(RtcPalette.stageBg, const Color(0xFF21070C));
    expect(RtcPalette.stagePlum, const Color(0xFF31105A));
    expect(RtcPalette.chatPurple, const Color(0xFFD34BFF));
    expect(RtcTypography.fontFamily, 'Inter');
  });

  testWidgets('mobile behavior primitives render lobby and stage UI', (
    tester,
  ) async {
    final chatController = TextEditingController();
    addTearDown(chatController.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: RtcMobileFrame(
          bottomNavigation: RtcMobileBottomNav(
            activeIndex: 0,
            onChanged: (_) {},
            items: const [
              RtcMobileBottomNavItem(icon: Icons.home_rounded, label: 'Home'),
              RtcMobileBottomNavItem(
                icon: Icons.sports_esports_rounded,
                label: 'Game',
              ),
              RtcMobileBottomNavItem(
                icon: Icons.chat_bubble_rounded,
                label: 'Message',
                badge: '99+',
              ),
            ],
          ),
          child: ListView(
            children: [
              const RtcLobbyHero(
                title: 'TalkEachOther',
                subtitle: '1/1 rooms · 0 live',
              ),
              RtcLobbyRoomRow(
                title: 'Customer Service',
                subtitle: 'Support room',
                badge: 'LIVE',
                tags: const ['Public', 'Group'],
                liveCount: 1,
                onTap: () {},
              ),
              const RtcStageSeat(
                number: 1,
                label: 'Host',
                state: RtcSeatState.speaking,
              ),
              const RtcInlineNotice(
                icon: Icons.info_outline,
                title: 'No active participants yet.',
                detail: 'People will appear here after they join.',
              ),
              RtcParticipantTile(
                label: 'Remote Viewer',
                detail: 'Audience · mic on',
                actions: [
                  RtcCompactActionButton(label: 'Mute', onPressed: () {}),
                ],
              ),
              RtcChatComposer(controller: chatController, onSend: () {}),
            ],
          ),
        ),
      ),
    );

    expect(find.text('TalkEachOther'), findsOneWidget);
    expect(find.text('Customer Service'), findsOneWidget);
    expect(find.text('LIVE'), findsOneWidget);
    expect(find.text('No.1'), findsNothing);
    expect(find.text('Host'), findsOneWidget);
    expect(find.text('No active participants yet.'), findsOneWidget);
    expect(find.text('Remote Viewer'), findsOneWidget);
    expect(find.text('Mute'), findsOneWidget);
    expect(find.text('Message'), findsOneWidget);
    expect(find.byType(RtcChatComposer), findsOneWidget);
  });

  test('asset helper resolves bundled and remote image providers', () {
    expect(
      RtcAssets.imageProviderFromValue(RtcAssets.videoRoom),
      isA<AssetImage>(),
    );
    expect(
      RtcAssets.imageProviderFromValue('https://example.com/avatar.png'),
      isA<NetworkImage>(),
    );
    expect(RtcAssets.imageProviderFromValue(''), isNull);
  });

  test('rtc web assets are registered in the Flutter bundle', () async {
    expect(RtcAssets.allBundledAssets, hasLength(50));
    expect(
      RtcAssets.allBundledAssets.toSet(),
      hasLength(RtcAssets.allBundledAssets.length),
    );

    final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
    final bundledAssets = manifest.listAssets();

    expect(bundledAssets, containsAll(RtcAssets.allBundledAssets));
  });
}
