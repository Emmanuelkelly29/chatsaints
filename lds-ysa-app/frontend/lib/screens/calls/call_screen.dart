import 'dart:async';
import 'package:flutter/material.dart';
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

  const CallScreen({
    super.key,
    required this.callId,
    required this.conversationId,
    required this.remoteUserName,
    this.remoteUserPhoto,
    required this.callType,
    required this.isOutgoing,
  });

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  final _ws   = WebSocketService();

  CallState _state = CallState.calling;
  bool _muted     = false;
  bool _speakerOn = false;
  bool _cameraOff = false;
  Duration _elapsed = Duration.zero;
  Timer? _timer;
  StreamSubscription? _wsSub;

  @override
  void initState() {
    super.initState();
    _state = widget.isOutgoing ? CallState.calling : CallState.ringing;
    _wsSub = _ws.messages.listen(_onWsMessage);

    // Auto-dismiss if no answer in 60 seconds
    if (widget.isOutgoing) {
      Timer(const Duration(seconds: 60), () {
        if (mounted && _state == CallState.calling) _endCall();
      });
    }
  }

  void _onWsMessage(Map<String, dynamic> msg) {
    if (!mounted) return;
    final type    = msg['type'] as String?;
    final payload = msg['payload'] as Map<String, dynamic>? ?? {};
    final callId  = payload['call_id'] as String?;

    if (callId != widget.callId) return;

    switch (type) {
      case 'call_accepted':
        setState(() => _state = CallState.connected);
        _startTimer();
        break;
      case 'call_declined':
        setState(() => _state = CallState.declined);
        _dismiss(after: const Duration(seconds: 2));
        break;
      case 'call_ended':
        setState(() => _state = CallState.ended);
        _dismiss(after: const Duration(seconds: 2));
        break;

      // WebRTC signalling — forward to flutter_webrtc when integrated
      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice_candidate':
        // TODO: pipe into RTCPeerConnection
        // _peerConnection.setRemoteDescription(...)
        break;
    }
  }

  void _accept() {
    _ws.send('call_accepted', {
      'call_id': widget.callId,
      'conversation_id': widget.conversationId,
    });
    setState(() => _state = CallState.connected);
    _startTimer();
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
    setState(() => _state = CallState.ended);
    _dismiss(after: const Duration(seconds: 1));
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsed += const Duration(seconds: 1));
    });
  }

  void _dismiss({Duration after = Duration.zero}) {
    _timer?.cancel();
    Future.delayed(after, () { if (mounted) Navigator.pop(context); });
  }

  String get _elapsedLabel {
    final m = _elapsed.inMinutes.toString().padLeft(2, '0');
    final s = (_elapsed.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  String get _statusLabel {
    switch (_state) {
      case CallState.calling:  return 'Calling…';
      case CallState.ringing:  return 'Incoming ${widget.callType} call';
      case CallState.connected: return _elapsedLabel;
      case CallState.ended:    return 'Call ended';
      case CallState.declined: return 'Call declined';
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFF1A1A2E),
    body: SafeArea(
      child: Column(
        children: [
          const SizedBox(height: 60),

          // Remote user avatar
          CircleAvatar(
            radius: 60,
            backgroundColor: AppTheme.primaryLight,
            backgroundImage: widget.remoteUserPhoto != null
                ? NetworkImage(widget.remoteUserPhoto!) : null,
            child: widget.remoteUserPhoto == null
                ? Text(
                    widget.remoteUserName.isNotEmpty ? widget.remoteUserName[0].toUpperCase() : '?',
                    style: const TextStyle(fontSize: 48, color: Colors.white, fontWeight: FontWeight.w600),
                  )
                : null,
          ),
          const SizedBox(height: 24),

          Text(widget.remoteUserName,
            style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),

          Text(_statusLabel,
            style: TextStyle(
              color: _state == CallState.connected ? Colors.greenAccent : Colors.white60,
              fontSize: 16,
            )),

          // Video placeholder (when WebRTC is fully integrated)
          if (widget.callType == 'video' && _state == CallState.connected) ...[
            const SizedBox(height: 24),
            Container(
              height: 200,
              margin: const EdgeInsets.symmetric(horizontal: 24),
              decoration: BoxDecoration(
                color: Colors.black38,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white12),
              ),
              child: const Center(
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(Icons.videocam, color: Colors.white38, size: 48),
                  SizedBox(height: 8),
                  Text('Video stream appears here\n(WebRTC active)',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white38, fontSize: 13)),
                ]),
              ),
            ),
          ],

          const Spacer(),

          // In-call controls
          if (_state == CallState.connected) ...[
            Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
              _CallButton(
                icon: _muted ? Icons.mic_off : Icons.mic,
                label: _muted ? 'Unmute' : 'Mute',
                onTap: () => setState(() => _muted = !_muted),
                active: _muted,
              ),
              _CallButton(
                icon: _speakerOn ? Icons.volume_up : Icons.volume_down,
                label: 'Speaker',
                onTap: () => setState(() => _speakerOn = !_speakerOn),
                active: _speakerOn,
              ),
              if (widget.callType == 'video')
                _CallButton(
                  icon: _cameraOff ? Icons.videocam_off : Icons.videocam,
                  label: 'Camera',
                  onTap: () => setState(() => _cameraOff = !_cameraOff),
                  active: _cameraOff,
                ),
            ]),
            const SizedBox(height: 32),
            // End call button
            GestureDetector(
              onTap: _endCall,
              child: Container(
                width: 72, height: 72,
                decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                child: const Icon(Icons.call_end, color: Colors.white, size: 32),
              ),
            ),
          ],

          // Incoming call controls (not yet answered)
          if (_state == CallState.ringing) ...[
            Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
              // Decline
              Column(children: [
                GestureDetector(
                  onTap: _decline,
                  child: Container(
                    width: 72, height: 72,
                    decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                    child: const Icon(Icons.call_end, color: Colors.white, size: 32),
                  ),
                ),
                const SizedBox(height: 8),
                const Text('Decline', style: TextStyle(color: Colors.white60)),
              ]),
              // Accept
              Column(children: [
                GestureDetector(
                  onTap: _accept,
                  child: Container(
                    width: 72, height: 72,
                    decoration: const BoxDecoration(color: Colors.green, shape: BoxShape.circle),
                    child: Icon(
                      widget.callType == 'video' ? Icons.videocam : Icons.call,
                      color: Colors.white, size: 32,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                const Text('Accept', style: TextStyle(color: Colors.white60)),
              ]),
            ]),
          ],

          // Outgoing — calling state
          if (_state == CallState.calling)
            GestureDetector(
              onTap: _endCall,
              child: Container(
                width: 72, height: 72,
                decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                child: const Icon(Icons.call_end, color: Colors.white, size: 32),
              ),
            ),

          const SizedBox(height: 60),
        ],
      ),
    ),
  );

  @override
  void dispose() {
    _timer?.cancel();
    _wsSub?.cancel();
    super.dispose();
  }
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
