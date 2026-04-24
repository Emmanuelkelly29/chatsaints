import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../../services/websocket_service.dart';
import '../../theme/app_theme.dart';

enum CallState { calling, ringing, connected, ended, declined }

class CallScreen extends StatefulWidget {
  final String callId;
  final String conversationId;
  final String remoteUserName;
  final String? remoteUserPhoto;
  final String callType;       // 'voice' or 'video'
  final bool isOutgoing;
  final String? remoteUserId;  // Known for incoming calls (caller_id); set on call_accepted for outgoing
  /// For outgoing calls: whether at least one receiver was online when call was placed.
  final bool receiverOnline;

  const CallScreen({
    super.key,
    required this.callId,
    required this.conversationId,
    required this.remoteUserName,
    this.remoteUserPhoto,
    required this.callType,
    required this.isOutgoing,
    this.remoteUserId,
    this.receiverOnline = false,
  });

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  final _ws = WebSocketService();

  CallState _state = CallState.calling;
  bool _muted        = false;
  bool _speakerOn    = false;
  bool _cameraOff    = false;
  bool _receiverRinging = false; // true once we know the receiver's device is ringing
  Duration _elapsed = Duration.zero;
  Timer? _timer;
  StreamSubscription? _wsSub;

  // WebRTC
  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  final _localRenderer  = RTCVideoRenderer();
  final _remoteRenderer = RTCVideoRenderer();
  String? _remoteUserId;

  static const _iceConfig = {
    'iceServers': [
      {'urls': 'stun:stun.l.google.com:19302'},
      {'urls': 'stun:stun1.l.google.com:19302'},
    ]
  };

  @override
  void initState() {
    super.initState();
    _remoteUserId = widget.remoteUserId;
    _state = widget.isOutgoing ? CallState.calling : CallState.ringing;
    _receiverRinging = widget.receiverOnline; // if already online, treat as ringing from start

    _localRenderer.initialize();
    _remoteRenderer.initialize();

    _wsSub = _ws.messages.listen(_onWsMessage);

    if (widget.isOutgoing) {
      Timer(const Duration(seconds: 60), () {
        if (mounted && _state == CallState.calling) _endCall();
      });
    }
  }

  // â”€â”€ WebRTC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  Future<void> _initWebRTC({required bool isOfferer}) async {
    try {
      _pc = await createPeerConnection(_iceConfig);

      final constraints = <String, dynamic>{
        'audio': true,
        'video': widget.callType == 'video' ? {'facingMode': 'user'} : false,
      };
      _localStream = await navigator.mediaDevices.getUserMedia(constraints);
      for (final track in _localStream!.getTracks()) {
        await _pc!.addTrack(track, _localStream!);
      }

      if (widget.callType == 'video' && mounted) {
        setState(() => _localRenderer.srcObject = _localStream);
      }

      _pc!.onTrack = (event) {
        if (event.streams.isNotEmpty && mounted) {
          setState(() => _remoteRenderer.srcObject = event.streams[0]);
        }
      };

      _pc!.onIceCandidate = (candidate) {
        if (_remoteUserId == null) return;
        _ws.send('webrtc_ice_candidate', {
          'call_id': widget.callId,
          'target_user_id': _remoteUserId,
          'candidate': candidate.toMap(),
        });
      };

      if (isOfferer) {
        final offer = await _pc!.createOffer();
        await _pc!.setLocalDescription(offer);
        _ws.send('webrtc_offer', {
          'call_id': widget.callId,
          'target_user_id': _remoteUserId,
          'sdp': offer.toMap(),
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not access microphone/camera: $e')));
      }
    }
  }

  void _onWsMessage(Map<String, dynamic> msg) {
    if (!mounted) return;
    final type    = msg['type'] as String?;
    final payload = msg['payload'] as Map<String, dynamic>? ?? {};
    final callId  = payload['call_id'] as String?;
    if (callId != widget.callId) return;

    switch (type) {
      case 'call_ringing':
        // A receiver's device started ringing — upgrade label from Calling → Ringing
        if (_state == CallState.calling) {
          setState(() => _receiverRinging = true);
        }
        break;

      case 'call_accepted':
        _remoteUserId ??= payload['accepted_by'] as String?;
        // Only transition if not already connected (first acceptor wins for group calls)
        if (_state != CallState.connected) {
          setState(() => _state = CallState.connected);
          _startTimer();
          if (widget.isOutgoing) {
            // Caller initiates WebRTC after callee accepts
            _initWebRTC(isOfferer: true);
          }
        }
        break;

      case 'call_declined':
        // For group calls, only end if nobody else is connected
        if (_state != CallState.connected) {
          setState(() => _state = CallState.declined);
          _dismiss(after: const Duration(seconds: 2));
        }
        break;

      case 'call_ended':
        setState(() => _state = CallState.ended);
        _dismiss(after: const Duration(seconds: 2));
        break;

      case 'webrtc_offer':
        _remoteUserId ??= payload['from_user_id'] as String?;
        _handleOffer(payload);
        break;

      case 'webrtc_answer':
        _handleAnswer(payload);
        break;

      case 'webrtc_ice_candidate':
        _handleIceCandidate(payload);
        break;
    }
  }

  Future<void> _handleOffer(Map<String, dynamic> payload) async {
    await _initWebRTC(isOfferer: false);
    final sdpMap = payload['sdp'] as Map<String, dynamic>;
    await _pc?.setRemoteDescription(
        RTCSessionDescription(sdpMap['sdp'] as String?, sdpMap['type'] as String?));
    final answer = await _pc!.createAnswer();
    await _pc!.setLocalDescription(answer);
    _ws.send('webrtc_answer', {
      'call_id': widget.callId,
      'target_user_id': _remoteUserId,
      'sdp': answer.toMap(),
    });
  }

  Future<void> _handleAnswer(Map<String, dynamic> payload) async {
    final sdpMap = payload['sdp'] as Map<String, dynamic>;
    await _pc?.setRemoteDescription(
        RTCSessionDescription(sdpMap['sdp'] as String?, sdpMap['type'] as String?));
  }

  Future<void> _handleIceCandidate(Map<String, dynamic> payload) async {
    final c = payload['candidate'] as Map<String, dynamic>?;
    if (c == null || _pc == null) return;
    await _pc!.addCandidate(RTCIceCandidate(
      c['candidate'] as String?,
      c['sdpMid'] as String?,
      c['sdpMLineIndex'] as int?,
    ));
  }

  // â”€â”€ Call control â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  void _accept() {
    _ws.send('call_accepted', {
      'call_id': widget.callId,
      'conversation_id': widget.conversationId,
    });
    setState(() => _state = CallState.connected);
    _startTimer();
    // Callee waits for webrtc_offer from caller (handled in _onWsMessage)
  }

  void _decline() {
    _ws.send('call_declined', {
      'call_id': widget.callId,
      'conversation_id': widget.conversationId,
    });
    Navigator.pop(context);
  }

  void _endCall() {
    _ws.endCall(widget.callId, widget.conversationId);
    _cleanup();
    setState(() => _state = CallState.ended);
    _dismiss(after: const Duration(seconds: 1));
  }

  void _cleanup() {
    _timer?.cancel();
    _pc?.close();
    _localStream?.dispose();
  }

  void _toggleMute() {
    setState(() => _muted = !_muted);
    _localStream?.getAudioTracks().forEach((t) => t.enabled = !_muted);
  }

  void _toggleCamera() {
    setState(() => _cameraOff = !_cameraOff);
    _localStream?.getVideoTracks().forEach((t) => t.enabled = !_cameraOff);
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsed += const Duration(seconds: 1));
    });
  }

  void _dismiss({Duration after = Duration.zero}) =>
      Future.delayed(after, () { if (mounted) Navigator.pop(context); });

  String get _elapsedLabel {
    final m = _elapsed.inMinutes.toString().padLeft(2, '0');
    final s = (_elapsed.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  String get _statusLabel {
    switch (_state) {
      case CallState.calling:
        return _receiverRinging ? 'Ringing\u2026' : 'Calling\u2026';
      case CallState.ringing:   return 'Incoming ${widget.callType} call';
      case CallState.connected: return _elapsedLabel;
      case CallState.ended:     return 'Call ended';
      case CallState.declined:  return 'Call declined';
    }
  }

  // â”€â”€ UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @override
  Widget build(BuildContext context) {
    final isVideo = widget.callType == 'video';

    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 40),

            // Video area (video calls in connected state)
            if (isVideo && _state == CallState.connected)
              Expanded(
                child: Stack(children: [
                  // Remote stream (full)
                  RTCVideoView(
                    _remoteRenderer,
                    objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                  ),
                  // Local stream (PiP)
                  Positioned(
                    top: 16, right: 16, width: 100, height: 140,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: RTCVideoView(_localRenderer, mirror: true),
                    ),
                  ),
                  // Name overlay
                  Positioned(
                    top: 16, left: 16,
                    child: Text(widget.remoteUserName,
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w600, shadows: [
                        Shadow(color: Colors.black54, blurRadius: 4)
                      ])),
                  ),
                ]),
              )
            else ...[
              CircleAvatar(
                radius: 60,
                backgroundColor: AppTheme.primaryLight,
                backgroundImage: widget.remoteUserPhoto != null
                    ? NetworkImage(widget.remoteUserPhoto!) : null,
                child: widget.remoteUserPhoto == null
                    ? Text(
                        widget.remoteUserName.isNotEmpty
                            ? widget.remoteUserName[0].toUpperCase() : '?',
                        style: const TextStyle(
                            fontSize: 48, color: Colors.white, fontWeight: FontWeight.w600),
                      )
                    : null,
              ),
              const SizedBox(height: 24),
              Text(widget.remoteUserName,
                style: const TextStyle(
                    color: Colors.white, fontSize: 26, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Text(_statusLabel,
                style: TextStyle(
                  color: _state == CallState.connected
                      ? Colors.greenAccent : Colors.white60,
                  fontSize: 16,
                )),
              const Spacer(),
            ],

            // Controls
            if (_state == CallState.connected) ...[
              Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
                _CallButton(
                  icon: _muted ? Icons.mic_off : Icons.mic,
                  label: _muted ? 'Unmute' : 'Mute',
                  onTap: _toggleMute, active: _muted,
                ),
                _CallButton(
                  icon: _speakerOn ? Icons.volume_up : Icons.volume_down,
                  label: 'Speaker',
                  onTap: () => setState(() => _speakerOn = !_speakerOn),
                  active: _speakerOn,
                ),
                if (isVideo)
                  _CallButton(
                    icon: _cameraOff ? Icons.videocam_off : Icons.videocam,
                    label: 'Camera',
                    onTap: _toggleCamera, active: _cameraOff,
                  ),
              ]),
              const SizedBox(height: 32),
              _EndCallButton(onTap: _endCall),
              const SizedBox(height: 48),
            ],

            if (_state == CallState.ringing) ...[
              Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
                Column(children: [
                  _EndCallButton(onTap: _decline),
                  const SizedBox(height: 8),
                  const Text('Decline', style: TextStyle(color: Colors.white60)),
                ]),
                Column(children: [
                  GestureDetector(
                    onTap: _accept,
                    child: Container(
                      width: 72, height: 72,
                      decoration: const BoxDecoration(
                          color: Colors.green, shape: BoxShape.circle),
                      child: Icon(
                        isVideo ? Icons.videocam : Icons.call,
                        color: Colors.white, size: 32,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text('Accept', style: TextStyle(color: Colors.white60)),
                ]),
              ]),
              const SizedBox(height: 48),
            ],

            if (_state == CallState.calling) ...[
              Column(children: [
                _EndCallButton(onTap: _endCall),
                const SizedBox(height: 8),
                const Text('Cancel', style: TextStyle(color: Colors.white60)),
              ]),
              const SizedBox(height: 48),
            ],
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    _cleanup();
    _localRenderer.dispose();
    _remoteRenderer.dispose();
    super.dispose();
  }
}

class _EndCallButton extends StatelessWidget {
  final VoidCallback onTap;
  const _EndCallButton({required this.onTap});
  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Container(
      width: 72, height: 72,
      decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
      child: const Icon(Icons.call_end, color: Colors.white, size: 32),
    ),
  );
}

class _CallButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  const _CallButton({required this.icon, required this.label, required this.onTap, this.active = false});

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Column(children: [
      Container(
        width: 56, height: 56,
        decoration: BoxDecoration(
          color: active ? Colors.white.withOpacity(0.3) : Colors.white.withOpacity(0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: Colors.white, size: 26),
      ),
      const SizedBox(height: 6),
      Text(label, style: const TextStyle(color: Colors.white60, fontSize: 12)),
    ]),
  );
}

