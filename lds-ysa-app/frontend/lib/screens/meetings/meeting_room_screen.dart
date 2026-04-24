import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../services/websocket_service.dart';
import '../../theme/app_theme.dart';

class MeetingRoomScreen extends StatefulWidget {
  final Map<String, dynamic> meeting;
  const MeetingRoomScreen({super.key, required this.meeting});

  @override
  State<MeetingRoomScreen> createState() => _MeetingRoomScreenState();
}

class _MeetingRoomScreenState extends State<MeetingRoomScreen> {
  late StreamSubscription<Map<String, dynamic>> _wsSub;
  final _chatCtrl = TextEditingController();
  final _chatScrollCtrl = ScrollController();
  final _me = AuthService().currentUser;

  // ── WebRTC ──
  final _localRenderer = RTCVideoRenderer();
  final Map<String, RTCVideoRenderer> _remoteRenderers = {};
  final Map<String, RTCPeerConnection> _peerConnections = {};
  MediaStream? _localStream;

  bool _cameraOn = true;
  bool _muted = false;
  bool _handRaised = false;
  bool _showChat = false;
  bool _loading = true;

  List<Map<String, dynamic>> _participants = [];
  List<Map<String, dynamic>> _chatMessages = [];
  List<Map<String, dynamic>> _pendingRequests = [];

  static const _iceConfig = {
    'iceServers': [
      {'urls': 'stun:stun.l.google.com:19302'},
      {'urls': 'stun:stun1.l.google.com:19302'},
    ]
  };

  String get _meetingId => widget.meeting['id'] as String;
  String get _meetingCode => widget.meeting['meeting_code'] as String? ?? '';
  String get _meetingLink => 'http://localhost:3000/?meeting=$_meetingCode';
  String get _myRole => _participants
      .firstWhere((p) => p['user_id'] == _me?.id,
          orElse: () => <String, dynamic>{})['role'] ?? 'attendee';
  bool get _isHost => widget.meeting['host_id'] == _me?.id || _myRole == 'host';
  bool get _isCoHost => _myRole == 'co_host';
  bool get _canControl => _isHost || _isCoHost;

  @override
  void initState() {
    super.initState();
    _wsSub = WebSocketService().messages.listen(_onWs);
    _init();
  }

  @override
  void dispose() {
    _wsSub.cancel();
    _chatCtrl.dispose();
    _chatScrollCtrl.dispose();
    _localRenderer.dispose();
    for (final r in _remoteRenderers.values) r.dispose();
    for (final pc in _peerConnections.values) pc.close();
    _localStream?.getTracks().forEach((t) => t.stop());
    super.dispose();
  }

  Future<void> _init() async {
    await _localRenderer.initialize();

    // Request camera + mic
    try {
      _localStream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': {'facingMode': 'user', 'width': {'ideal': 1280}, 'height': {'ideal': 720}},
      });
      _localRenderer.srcObject = _localStream;
    } catch (_) {
      // Fallback: audio only
      try {
        _localStream = await navigator.mediaDevices.getUserMedia({'audio': true, 'video': false});
        if (mounted) setState(() => _cameraOn = false);
      } catch (_) {}
    }

    WebSocketService().joinedMeeting(_meetingId);

    try {
      final detail = await ApiService().get('/meetings/$_meetingId');
      if (!mounted) return;
      setState(() {
        _participants = List<Map<String, dynamic>>.from(detail['participants'] ?? []);
        _pendingRequests = List<Map<String, dynamic>>.from(detail['pending_requests'] ?? []);
        _loading = false;
      });
      for (final p in _participants) {
        final uid = p['user_id'] as String?;
        if (uid != null && uid != _me?.id) await _createOffer(uid);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  // ── WebRTC ──
  Future<RTCPeerConnection> _getOrCreatePc(String userId) async {
    if (_peerConnections.containsKey(userId)) return _peerConnections[userId]!;
    final pc = await createPeerConnection(_iceConfig);
    _peerConnections[userId] = pc;
    _localStream?.getTracks().forEach((t) => pc.addTrack(t, _localStream!));
    pc.onTrack = (event) async {
      if (!_remoteRenderers.containsKey(userId)) {
        final renderer = RTCVideoRenderer();
        await renderer.initialize();
        _remoteRenderers[userId] = renderer;
      }
      _remoteRenderers[userId]!.srcObject =
          event.streams.isNotEmpty ? event.streams.first : null;
      if (mounted) setState(() {});
    };
    pc.onIceCandidate = (c) {
      if (c.candidate == null) return;
      WebSocketService().sendMeetingIceCandidate(_meetingId, userId, c.toMap());
    };
    return pc;
  }

  Future<void> _createOffer(String targetUserId) async {
    final pc = await _getOrCreatePc(targetUserId);
    final offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    WebSocketService().sendMeetingWebRtcOffer(_meetingId, targetUserId, offer.toMap());
  }

  Future<void> _handleOffer(String fromId, Map<String, dynamic> sdpMap) async {
    final pc = await _getOrCreatePc(fromId);
    await pc.setRemoteDescription(RTCSessionDescription(sdpMap['sdp'], sdpMap['type']));
    final answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    WebSocketService().sendMeetingWebRtcAnswer(_meetingId, fromId, answer.toMap());
  }

  Future<void> _handleAnswer(String fromId, Map<String, dynamic> sdpMap) async {
    final pc = _peerConnections[fromId];
    if (pc != null) {
      await pc.setRemoteDescription(RTCSessionDescription(sdpMap['sdp'], sdpMap['type']));
    }
  }

  Future<void> _handleIce(String fromId, Map<String, dynamic> c) async {
    final pc = _peerConnections[fromId];
    if (pc != null) {
      await pc.addCandidate(RTCIceCandidate(c['candidate'], c['sdpMid'], c['sdpMLineIndex']));
    }
  }

  void _onWs(Map<String, dynamic> msg) {
    if (!mounted) return;
    final type = msg['type'] as String?;
    final payload = (msg['payload'] as Map<String, dynamic>?) ?? {};
    if (payload['meeting_id'] != _meetingId) return;

    switch (type) {
      case 'meeting_participant_joined':
        final uid = payload['user_id'] as String?;
        if (uid != null && uid != _me?.id) {
          setState(() {
            if (!_participants.any((p) => p['user_id'] == uid)) {
              _participants.add({
                'user_id': uid,
                'full_name': payload['full_name'] ?? 'Unknown',
                'role': 'attendee',
                'is_muted': false,
                'hand_raised': false,
              });
            }
          });
        }
        break;

      case 'meeting_participant_left':
        final uid = payload['user_id'] as String?;
        if (uid != null) {
          _peerConnections[uid]?.close();
          _peerConnections.remove(uid);
          _remoteRenderers[uid]?.dispose();
          _remoteRenderers.remove(uid);
          setState(() => _participants.removeWhere((p) => p['user_id'] == uid));
        }
        break;

      case 'meeting_webrtc_offer':
        final from = payload['from_user_id'] as String?;
        final sdp = payload['sdp'] as Map<String, dynamic>?;
        if (from != null && sdp != null) _handleOffer(from, sdp);
        break;

      case 'meeting_webrtc_answer':
        final from = payload['from_user_id'] as String?;
        final sdp = payload['sdp'] as Map<String, dynamic>?;
        if (from != null && sdp != null) _handleAnswer(from, sdp);
        break;

      case 'meeting_webrtc_ice':
        final from = payload['from_user_id'] as String?;
        final candidate = payload['candidate'] as Map<String, dynamic>?;
        if (from != null && candidate != null) _handleIce(from, candidate);
        break;

      case 'participant_muted':
        if (payload['user_id'] == _me?.id && payload['by'] != _me?.id) {
          setState(() => _muted = true);
          _localStream?.getAudioTracks().forEach((t) => t.enabled = false);
          ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('You have been muted by the host')));
        }
        setState(() {
          final idx = _participants.indexWhere((p) => p['user_id'] == payload['user_id']);
          if (idx >= 0) _participants[idx]['is_muted'] = true;
        });
        break;

      case 'hand_raised':
        setState(() {
          final idx = _participants.indexWhere((p) => p['user_id'] == payload['user_id']);
          if (idx >= 0) _participants[idx]['hand_raised'] = payload['raised'] ?? true;
        });
        break;

      case 'meeting_chat_message':
        setState(() => _chatMessages.add(payload));
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_chatScrollCtrl.hasClients) {
            _chatScrollCtrl.animateTo(
              _chatScrollCtrl.position.maxScrollExtent,
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
            );
          }
        });
        break;

      case 'join_request_received':
        setState(() => _pendingRequests.add(payload));
        break;

      case 'meeting_ended':
        Navigator.pop(context);
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('The meeting has ended')));
        break;
    }
  }

  Future<void> _leave() async {
    WebSocketService().leaveMeeting(_meetingId);
    if (mounted) Navigator.pop(context);
  }

  Future<void> _endMeeting() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('End Meeting?'),
        content: const Text('This will end the meeting for everyone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('End for All'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      WebSocketService().endMeeting(_meetingId);
      await ApiService().post('/meetings/$_meetingId/end', {});
      if (mounted) Navigator.pop(context);
    }
  }

  void _toggleMute() {
    setState(() => _muted = !_muted);
    _localStream?.getAudioTracks().forEach((t) => t.enabled = !_muted);
  }

  void _toggleCamera() {
    setState(() => _cameraOn = !_cameraOn);
    _localStream?.getVideoTracks().forEach((t) => t.enabled = _cameraOn);
  }

  void _toggleHand() {
    setState(() => _handRaised = !_handRaised);
    WebSocketService().raiseHand(_meetingId, raised: _handRaised);
  }

  void _sendChat() {
    final msg = _chatCtrl.text.trim();
    if (msg.isEmpty) return;
    WebSocketService().sendMeetingChat(_meetingId, msg);
    _chatCtrl.clear();
  }

  void _muteParticipant(String userId) async {
    await ApiService().patch('/meetings/$_meetingId/mute/$userId', {});
    WebSocketService().muteParticipant(_meetingId, userId);
  }

  void _approveRequest(String userId) {
    WebSocketService().approveJoinRequest(_meetingId, userId);
    setState(() => _pendingRequests.removeWhere((r) => r['user_id'] == userId));
  }

  void _rejectRequest(String userId) {
    WebSocketService().rejectJoinRequest(_meetingId, userId);
    setState(() => _pendingRequests.removeWhere((r) => r['user_id'] == userId));
  }

  void _promoteToCoHost(String userId) async {
    await ApiService().patch('/meetings/$_meetingId/promote/$userId', {'role': 'co_host'});
    setState(() {
      final idx = _participants.indexWhere((p) => p['user_id'] == userId);
      if (idx >= 0) _participants[idx]['role'] = 'co_host';
    });
  }

  void _copyCode() {
    Clipboard.setData(ClipboardData(text: _meetingCode));
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('Code $_meetingCode copied')));
  }

  void _copyLink() {
    Clipboard.setData(ClipboardData(text: _meetingLink));
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Meeting link copied!')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: const Color(0xFF111827),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.meeting['title'] ?? 'Meeting',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            Text(_meetingCode,
                style: TextStyle(color: Colors.grey[400], fontSize: 11)),
          ],
        ),
        actions: [
          if (_pendingRequests.isNotEmpty && _canControl)
            IconButton(
              icon: Badge(
                label: Text(_pendingRequests.length.toString()),
                child: const Icon(Icons.person_add_outlined),
              ),
              tooltip: 'Pending join requests',
              onPressed: _showRequestsDialog,
            ),
          IconButton(
            icon: const Icon(Icons.link),
            tooltip: 'Copy invite link',
            onPressed: _copyLink,
          ),
          IconButton(
            icon: const Icon(Icons.tag),
            tooltip: 'Copy meeting code',
            onPressed: _copyCode,
          ),
        ],
        automaticallyImplyLeading: false,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Expanded(child: _showChat ? _buildChat() : _buildVideoGrid()),
                _buildControls(),
              ],
            ),
    );
  }

  Widget _buildVideoGrid() {
    final tiles = <Widget>[_buildLocalTile()];
    for (final p in _participants) {
      if (p['user_id'] == _me?.id) continue;
      tiles.add(_buildRemoteTile(p, p['user_id'] as String));
    }
    final count = tiles.length;
    final crossCount = count == 1 ? 1 : count <= 4 ? 2 : 3;
    return GridView.count(
      crossAxisCount: crossCount,
      padding: const EdgeInsets.all(4),
      crossAxisSpacing: 4,
      mainAxisSpacing: 4,
      children: tiles,
    );
  }

  Widget _buildLocalTile() {
    return _VideoTile(
      name: 'You',
      role: _myRole,
      isMuted: _muted,
      handRaised: _handRaised,
      cameraOn: _cameraOn,
      renderer: _cameraOn ? _localRenderer : null,
      mirror: true,
      isMe: true,
    );
  }

  Widget _buildRemoteTile(Map<String, dynamic> p, String uid) {
    final renderer = _remoteRenderers[uid];
    return GestureDetector(
      onLongPress: _canControl ? () => _showParticipantOptions(p) : null,
      child: _VideoTile(
        name: p['full_name'] as String? ?? 'Unknown',
        role: p['role'] as String? ?? 'attendee',
        isMuted: p['is_muted'] == true,
        handRaised: p['hand_raised'] == true,
        cameraOn: renderer != null,
        renderer: renderer,
        mirror: false,
        isMe: false,
      ),
    );
  }

  Widget _buildControls() {
    return Container(
      color: const Color(0xFF111827),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _CtrlBtn(
            icon: _muted ? Icons.mic_off : Icons.mic,
            label: _muted ? 'Unmute' : 'Mute',
            color: _muted ? Colors.red : Colors.white,
            onTap: _toggleMute,
          ),
          _CtrlBtn(
            icon: _cameraOn ? Icons.videocam : Icons.videocam_off,
            label: _cameraOn ? 'Camera' : 'No Cam',
            color: _cameraOn ? Colors.white : Colors.red,
            onTap: _toggleCamera,
          ),
          _CtrlBtn(
            icon: _handRaised ? Icons.back_hand : Icons.back_hand_outlined,
            label: 'Hand',
            color: _handRaised ? AppTheme.accent : Colors.white,
            onTap: _toggleHand,
          ),
          _CtrlBtn(
            icon: Icons.chat_bubble_outline,
            label: 'Chat',
            color: _showChat ? AppTheme.accent : Colors.white,
            badge: (!_showChat && _chatMessages.isNotEmpty)
                ? _chatMessages.length.toString()
                : null,
            onTap: () => setState(() => _showChat = !_showChat),
          ),
          if (_isHost)
            _CtrlBtn(
              icon: Icons.cancel_outlined,
              label: 'End',
              color: Colors.red,
              onTap: _endMeeting,
            )
          else
            _CtrlBtn(
              icon: Icons.exit_to_app,
              label: 'Leave',
              color: Colors.red,
              onTap: _leave,
            ),
        ],
      ),
    );
  }

  Widget _buildChat() {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            controller: _chatScrollCtrl,
            padding: const EdgeInsets.all(12),
            itemCount: _chatMessages.length,
            itemBuilder: (_, i) {
              final m = _chatMessages[i];
              final isMe = m['user_id'] == _me?.id;
              return Align(
                alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isMe ? AppTheme.accent : AppTheme.surface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (!isMe)
                        Text(m['full_name'] ?? '',
                            style: const TextStyle(
                                fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white70)),
                      Text(m['message'] ?? '',
                          style: TextStyle(
                              color: isMe ? AppTheme.primary : Colors.white)),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _chatCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Type a message…',
                    hintStyle: const TextStyle(color: Colors.grey),
                    filled: true,
                    fillColor: AppTheme.surface,
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide.none),
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  ),
                  onSubmitted: (_) => _sendChat(),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.send, color: AppTheme.accent),
                onPressed: _sendChat,
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _showRequestsDialog() {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Join Requests'),
        content: SizedBox(
          width: 300,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: _pendingRequests.length,
            itemBuilder: (_, i) {
              final r = _pendingRequests[i];
              return ListTile(
                title: Text(r['full_name'] ?? 'Unknown'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.check, color: Colors.green),
                      onPressed: () {
                        _approveRequest(r['user_id']);
                        Navigator.pop(context);
                      },
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.red),
                      onPressed: () {
                        _rejectRequest(r['user_id']);
                        Navigator.pop(context);
                      },
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  void _showParticipantOptions(Map<String, dynamic> p) {
    showModalBottomSheet(
      context: context,
      builder: (_) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.mic_off),
            title: const Text('Mute participant'),
            onTap: () {
              Navigator.pop(context);
              _muteParticipant(p['user_id']);
            },
          ),
          if (_isHost)
            ListTile(
              leading: const Icon(Icons.star_border),
              title: const Text('Promote to Co-Host'),
              onTap: () {
                Navigator.pop(context);
                _promoteToCoHost(p['user_id']);
              },
            ),
        ],
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════
// Video Tile
// ════════════════════════════════════════════════════════════════
class _VideoTile extends StatelessWidget {
  final String name;
  final String role;
  final bool isMuted;
  final bool handRaised;
  final bool cameraOn;
  final RTCVideoRenderer? renderer;
  final bool mirror;
  final bool isMe;

  const _VideoTile({
    required this.name,
    required this.role,
    required this.isMuted,
    required this.handRaised,
    required this.cameraOn,
    required this.renderer,
    required this.mirror,
    required this.isMe,
  });

  Color get _roleColor {
    switch (role) {
      case 'host': return AppTheme.accent;
      case 'co_host': return AppTheme.primaryLight;
      case 'presenter': return AppTheme.success;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(8),
        border: isMe ? Border.all(color: AppTheme.accent, width: 2) : null,
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (cameraOn && renderer != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(7),
              child: RTCVideoView(
                renderer!,
                mirror: mirror,
                objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
              ),
            )
          else
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircleAvatar(
                    radius: 30,
                    backgroundColor: _roleColor.withOpacity(0.2),
                    child: Text(
                      name.isNotEmpty ? name[0].toUpperCase() : '?',
                      style: TextStyle(
                          fontSize: 24, fontWeight: FontWeight.bold, color: _roleColor),
                    ),
                  ),
                  if (!cameraOn)
                    const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: Icon(Icons.videocam_off, size: 14, color: Colors.grey),
                    ),
                ],
              ),
            ),
          Positioned(
            bottom: 0, left: 0, right: 0,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [Colors.black87, Colors.transparent],
                ),
                borderRadius: BorderRadius.vertical(bottom: Radius.circular(7)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(name,
                        style: const TextStyle(
                            color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500),
                        overflow: TextOverflow.ellipsis),
                  ),
                  if (isMuted) const Icon(Icons.mic_off, size: 14, color: Colors.red),
                  if (handRaised) const Text('✋', style: TextStyle(fontSize: 13)),
                ],
              ),
            ),
          ),
          Positioned(
            top: 6, left: 6,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                  color: Colors.black54, borderRadius: BorderRadius.circular(8)),
              child: Text(role, style: TextStyle(fontSize: 9, color: _roleColor)),
            ),
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════════════════════════════════════════
// Control Button
// ════════════════════════════════════════════════════════════════
class _CtrlBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final String? badge;
  final VoidCallback onTap;

  const _CtrlBtn({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
    this.badge,
  });

  @override
  Widget build(BuildContext context) {
    final btn = InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.1),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 3),
            Text(label, style: TextStyle(color: color, fontSize: 10)),
          ],
        ),
      ),
    );
    if (badge != null) return Badge(label: Text(badge!), child: btn);
    return btn;
  }
}
