import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../config/app_config.dart';
import '../ui/rtc_mobile_ui.dart';

class WebAppScreen extends StatefulWidget {
  const WebAppScreen({super.key});

  @override
  State<WebAppScreen> createState() => _WebAppScreenState();
}

class _WebAppScreenState extends State<WebAppScreen> {
  late final WebViewController _controller;
  int _progress = 0;
  String? _mainFrameError;

  @override
  void initState() {
    super.initState();
    _controller =
        WebViewController(
            onPermissionRequest: (request) {
              unawaited(_handleWebPermissionRequest(request));
            },
          )
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(RtcPalette.ink)
          ..setNavigationDelegate(
            NavigationDelegate(
              onProgress: (progress) => setState(() => _progress = progress),
              onPageStarted: (_) => setState(() => _mainFrameError = null),
              onWebResourceError: (error) {
                if (error.isForMainFrame == true) {
                  setState(() => _mainFrameError = error.description);
                }
              },
            ),
          )
          ..loadRequest(Uri.parse(AppConfig.webAppUrl));

    final platformController = _controller.platform;
    if (platformController is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(true);
      unawaited(platformController.setMediaPlaybackRequiresUserGesture(false));
    }
  }

  Future<void> _handleWebPermissionRequest(
    WebViewPermissionRequest request,
  ) async {
    final permissions = <Permission>[];
    if (request.types.contains(WebViewPermissionResourceType.camera)) {
      permissions.add(Permission.camera);
    }
    if (request.types.contains(WebViewPermissionResourceType.microphone)) {
      permissions.add(Permission.microphone);
    }

    if (permissions.isEmpty) {
      await request.grant();
      return;
    }

    final statuses = await permissions.request();
    final granted = statuses.values.every((status) => status.isGranted);
    if (granted) {
      await request.grant();
    } else {
      await request.deny();
    }
  }

  Future<void> _reload() async {
    setState(() {
      _mainFrameError = null;
      _progress = 0;
    });
    await _controller.loadRequest(Uri.parse(AppConfig.webAppUrl));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (_progress < 100 && _mainFrameError == null)
              Positioned(
                left: 0,
                right: 0,
                top: 0,
                child: LinearProgressIndicator(value: _progress / 100),
              ),
            if (_mainFrameError != null)
              Positioned.fill(
                child: RtcBackdrop(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: GlassPanel(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const BrandHeader(
                              title: 'talk-each-other',
                              subtitle: 'Web app unavailable',
                            ),
                            const SizedBox(height: 18),
                            Text(
                              'Could not open the web frontend.',
                              style: Theme.of(context).textTheme.titleLarge
                                  ?.copyWith(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w900,
                                  ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Start the frontend dev server, then retry:\n${AppConfig.webAppUrl}',
                              style: const TextStyle(
                                color: RtcPalette.muted,
                                fontWeight: FontWeight.w700,
                                height: 1.35,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              _mainFrameError!,
                              style: const TextStyle(
                                color: Color(0xFFFCA5A5),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 16),
                            GhostButton(
                              onPressed: _reload,
                              icon: Icons.refresh,
                              label: 'Reload web app',
                            ),
                          ],
                        ),
                      ),
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
