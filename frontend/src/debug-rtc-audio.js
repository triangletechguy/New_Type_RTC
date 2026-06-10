/**
 * RTC Audio Diagnostic Tool
 * 
 * Paste this code into your browser console (F12 → Console tab) while in an RTC room
 * to diagnose audio issues.
 */

async function diagnoseRTCAudio() {
  console.clear();
  console.log('🔍 RTC Audio Diagnostic Report\n');

  // 1. Check local stream
  console.log('📍 Local Stream Status:');
  if (window.rtcRef?.current?.localStream) {
    const stream = window.rtcRef.current.localStream;
    const audioTracks = stream.getAudioTracks();
    console.log(`  ✓ Local stream exists`);
    console.log(`  📊 Audio tracks: ${audioTracks.length}`);
    audioTracks.forEach((track, i) => {
      console.log(`    Track ${i}: enabled=${track.enabled}, state=${track.readyState}`);
    });
  } else {
    console.log(`  ✗ No local stream found`);
  }

  // 2. Check peer connections
  console.log('\n🔗 Peer Connections:');
  const peerConnections = window.rtcRef?.current?.peerConnections || {};
  const peerCount = Object.keys(peerConnections).length;
  console.log(`  Total peers: ${peerCount}`);

  for (const [remoteSocketId, pc] of Object.entries(peerConnections)) {
    console.log(`\n  Peer: ${remoteSocketId.slice(0, 8)}...`);
    console.log(`    Connection state: ${pc.connectionState}`);
    console.log(`    ICE state: ${pc.iceConnectionState}`);
    console.log(`    Signaling state: ${pc.signalingState}`);

    // Check transceivers
    const transceivers = pc.getTransceivers();
    const audioTransceiver = transceivers.find(t => t.sender?.track?.kind === 'audio' || t.receiver?.track?.kind === 'audio');
    
    if (audioTransceiver) {
      console.log(`    Audio transceiver:`);
      console.log(`      Direction: ${audioTransceiver.direction}`);
      console.log(`      Sender track: ${audioTransceiver.sender?.track ? '✓' : '✗'}`);
      if (audioTransceiver.sender?.track) {
        console.log(`        Enabled: ${audioTransceiver.sender.track.enabled}`);
        console.log(`        State: ${audioTransceiver.sender.track.readyState}`);
      }
      console.log(`      Receiver track: ${audioTransceiver.receiver?.track ? '✓' : '✗'}`);
      if (audioTransceiver.receiver?.track) {
        console.log(`        State: ${audioTransceiver.receiver.track.readyState}`);
      }
    } else {
      console.log(`    ✗ No audio transceiver found`);
    }

    // Check senders
    const senders = pc.getSenders();
    const audioSender = senders.find(s => s.track?.kind === 'audio');
    if (audioSender && audioSender.track) {
      console.log(`    Audio sender parameters:`);
      const params = audioSender.getParameters();
      console.log(`      Encodings: ${JSON.stringify(params.encodings, null, 2)}`);
    }
  }

  // 3. Check remote streams
  console.log('\n📡 Remote Streams:');
  const remoteStreams = window.rtcRef?.current?.remoteMediaStreams || {};
  const remoteCount = Object.keys(remoteStreams).length;
  console.log(`  Total remote streams: ${remoteCount}`);

  for (const [socketId, stream] of Object.entries(remoteStreams)) {
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      console.log(`  ${socketId.slice(0, 8)}...: ${audioTracks.length} audio track(s)`);
      audioTracks.forEach((track, i) => {
        console.log(`    Track ${i}: enabled=${track.enabled}, state=${track.readyState}`);
      });
    }
  }

  // 4. Check RTC stats
  console.log('\n📊 Latest RTC Stats:');
  const peerStats = window.peerStatsRef?.current || {};
  let foundAudio = false;

  for (const [socketId, stats] of Object.entries(peerStats)) {
    if (stats?.media?.outbound?.audio?.bitrateKbps > 0) {
      console.log(`  ✓ Outbound audio to ${socketId.slice(0, 8)}...: ${stats.media.outbound.audio.bitrateKbps} kb/s`);
      foundAudio = true;
    }
    if (stats?.media?.inbound?.audio?.bitrateKbps > 0) {
      console.log(`  ✓ Inbound audio from ${socketId.slice(0, 8)}...: ${stats.media.inbound.audio.bitrateKbps} kb/s`);
      foundAudio = true;
    }
  }

  if (!foundAudio) {
    console.log(`  ⚠️  No audio bitrate detected`);
  }

  // 5. Summary
  console.log('\n📋 Summary:');
  const hasLocalAudio = window.rtcRef?.current?.localStream?.getAudioTracks?.().some(t => t.readyState === 'live' && t.enabled);
  const hasRemoteAudio = Object.values(remoteStreams).some(s => s?.getAudioTracks?.().some(t => t.readyState === 'live'));
  
  console.log(`  Local audio active: ${hasLocalAudio ? '✓' : '✗'}`);
  console.log(`  Remote audio received: ${hasRemoteAudio ? '✓' : '✗'}`);
  console.log(`  All peers connected: ${Object.values(peerConnections).every(pc => pc.connectionState === 'connected') ? '✓' : '✗'}`);

  console.log('\n💡 Tip: Run this again to check for changes.');
}

// Run the diagnostic
diagnoseRTCAudio();
