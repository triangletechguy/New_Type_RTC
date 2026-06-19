import 'package:flutter_test/flutter_test.dart';
import 'package:rtc_enterprise_mobile/services/signaling_service.dart';

void main() {
  test('normalizes signaling peers and removes local user duplicates', () {
    final peers = normalizeSignalingPeers(
      [
        {'socketId': 'local-socket', 'userId': 99, 'userName': 'Local User'},
        {
          'socket_id': 'remote-old',
          'user_id': '101',
          'user_name': 'Remote Viewer',
          'rtc_mode': 'audio',
          'mic_enabled': 'false',
        },
        {
          'socketId': 'remote-new',
          'userId': 101,
          'cameraEnabled': true,
          'screenShared': 'true',
        },
        {
          'socketId': 'remote-two',
          'userId': 102,
          'userName': 'Second Viewer',
          'micEnabled': true,
        },
        {'socket_id': 'remote-two', 'user_id': 102, 'mic_enabled': 0},
      ],
      localUserId: 99,
      localSocketId: 'local-socket',
    );

    expect(peers, hasLength(2));
    expect(peers.first['socketId'], 'remote-new');
    expect(peers.first['userId'], 101);
    expect(peers.first['userName'], 'Remote Viewer');
    expect(peers.first['rtcMode'], 'audio');
    expect(peers.first['micEnabled'], isFalse);
    expect(peers.first['cameraEnabled'], isTrue);
    expect(peers.first['screenShared'], isTrue);

    expect(peers.last['socketId'], 'remote-two');
    expect(peers.last['userId'], 102);
    expect(peers.last['userName'], 'Second Viewer');
    expect(peers.last['micEnabled'], isFalse);
  });

  test('drops invalid signaling peer rows', () {
    final peers = normalizeSignalingPeers([
      null,
      'not a peer',
      {'userName': 'Missing identity'},
      {'socket_id': 'remote-only-socket'},
    ]);

    expect(peers, hasLength(1));
    expect(peers.single['socketId'], 'remote-only-socket');
  });
}
