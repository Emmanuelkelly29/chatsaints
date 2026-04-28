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
  bool _screenSharing = false;
  MediaStream? _screenStream;
  String? _cameraError;
  /// User ID of the remote participant currently sharing their screen (null if nobody).
  String? _remoteScreenSharingUserId;

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
    _localRenderer.removeListener(_onRendererChanged);
    _localRenderer.dispose();
    for (final r in _remoteRenderers.values) r.dispose();
    for (final pc in _peerConnections.values) pc.close();
    _localStream?.getTracks().forEach((t) => t.stop());
    _screenStream?.getTracks().forEach((t) => t.stop());
    super.dispose();
  }

  Future<void> _init() async {
    await _localRenderer.initialize();
    // Rebuild our screen whenever the local renderer changes state
    // (e.g. when renderVideo flips true after the first camera frame arrives).
    _localRenderer.addListener(_onRendererChanged);
    _localRenderer.onFirstFrameRendered = () { if (mounted) setState(() {}); };

    // Request camera + mic
    try {
      _localStream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': true,
      });
      // First setState mounts RTCVideoView / HtmlElementView into the DOM
      if (mounted) setState(() {});
      // Wait one frame so the <video> element is created before assigning srcObject
      await Future.delayed(const Duration(milliseconds: 300));
      if (mounted && _localStream != null) {
        _localRenderer.srcObject = _localStream;
        if (mounted) setState(() {});
      }
    } catch (e) {
      // Fallback: audio only if camera denied/unavailable
      try {
        _localStream =
            await navigator.mediaDevices.getUserMedia({'audio': true, 'video': false});
        if (mounted) {
          setState(() {
            _cameraOn = false;
            _cameraError = 'Camera unavailable: ${e.toString()}';
          });
          // Show the exact error so user can diagnose
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                content: Text('Camera error: ${e.toString()}'),
                backgroundColor: Colors.orange,
                duration: const Duration(seconds: 8),
              ));
            }
          });
        }
      } catch (e2) {
        if (mounted) {
          setState(() {
            _cameraOn = false;
            _cameraError = 'No media access: ${e2.toString()}';
          });
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                content: Text('Media access denied: ${e2.toString()}'),
                backgroundColor: Colors.red,
                duration: const Duration(seconds: 8),
              ));
            }
          });
        }
      }
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
        // Tie-break: only the participant with the lexicographically greater ID
        // creates the offer. This prevents glare when both users join simultaneously.
        if (uid != null && uid != _me?.id && (_me?.id ?? '').compareTo(uid) > 0) {
          await _createOffer(uid);
        }
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onRendererChanged() {
    if (mounted) setState(() {});
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
        renderer.onFirstFrameRendered = () {
          if (mounted) setState(() {});
        };
        // Also listen to all renderer changes for reliable rebuild
        renderer.addListener(() { if (mounted) setState(() {}); });
        _remoteRenderers[userId] = renderer;
      }
      // setState first to mount RTCVideoView into DOM, then delay before setting srcObject
      if (mounted) setState(() {});
      await Future.delayed(const Duration(milliseconds: 200));
      if (!mounted) return;
      if (event.streams.isNotEmpty) {
        _remoteRenderers[userId]!.srcObject = event.streams.first;
      } else if (event.track.kind == 'video') {
        // Wrap single track in a synthetic stream
        final s = await createLocalMediaStream(userId);
        await s.addTrack(event.track);
        _remoteRenderers[userId]!.srcObject = s;
      }
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
          // If our ID is greater, WE create the offer (tie-breaking so only one
          // side offers, preventing glare when both users join simultaneously).
          if ((_me?.id ?? '').compareTo(uid) > 0) {
            _createOffer(uid);
          }
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
        // payload now has user_id = the muted person, by = who muted them
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

      case 'participant_screen_share':
        final sharingUid = payload['user_id'] as String?;
        final isSharing = payload['sharing'] == true;
        if (sharingUid != null && sharingUid != _me?.id) {
          setState(() {
            _remoteScreenSharingUserId = isSharing ? sharingUid : null;
          });
        }
        break;

      case 'hand_raised':
        setState(() {
          final idx = _participants.indexWhere((p) => p['user_id'] == payload['user_id']);
          if (idx >= 0) _participants[idx]['hand_raised'] = payload['raised'] ?? true;
        });
        break;

      case 'meeting_chat_message':
        // Ignore echo of our own message (we already added it locally)
        if (payload['from_user_id'] == _me?.id) break;
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

      case 'host_transferred':
        final newHostId = payload['new_host_id'] as String?;
        final reason = payload['reason'] as String?;
        setState(() {
          // Update host role in participants list
          for (final p in _participants) {
            if (p['user_id'] == newHostId) p['role'] = 'host';
            else if (p['role'] == 'host') p['role'] = 'co_host';
          }
        });
        if (newHostId == _me?.id) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(reason == 'host_disconnected'
                  ? 'The previous host disconnected. You are now the host!'
                  : 'You are now the host!'),
              backgroundColor: Colors.green,
            ),
          );
        }
        break;
    }
  }

  Future<void> _leave() async {
    WebSocketService().leaveMeeting(_meetingId);
    if (mounted) Navigator.pop(context);
  }

  Future<void> _endMeeting() async {
    if (_isHost) {
      // Host must choose: end for all, transfer host, or cancel
      final otherParticipants = _participants
          .where((p) => p['user_id'] != _me?.id)
          .toList();

      final choice = await showDialog<String>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Leave Meeting'),
          content: const Text(
              'You are the host. What would you like to do?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, 'cancel'),
              child: const Text('Cancel'),
            ),
            if (otherParticipants.isNotEmpty)
              OutlinedButton.icon(
                icon: const Icon(Icons.swap_horiz, color: Colors.orange),
                label: const Text('Assign New Host',
                    style: TextStyle(color: Colors.orange)),
                onPressed: () => Navigator.pop(context, 'transfer'),
              ),
            ElevatedButton.icon(
              icon: const Icon(Icons.cancel_outlined),
              label: const Text('End for Everyone'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              onPressed: () => Navigator.pop(context, 'end'),
            ),
          ],
        ),
      );

      if (choice == 'transfer' && otherParticipants.isNotEmpty) {
        await _showTransferHostDialog(otherParticipants);
        return;
      }
      if (choice != 'end') return;

      WebSocketService().endMeeting(_meetingId);
      await ApiService().post('/meetings/$_meetingId/end', {});
      if (mounted) Navigator.pop(context);
    } else {
      // Non-host: just confirm and leave
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Leave Meeting?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              child: const Text('Leave'),
            ),
          ],
        ),
      );
      if (confirmed == true) await _leave();
    }
  }

  Future<void> _showTransferHostDialog(List<Map<String, dynamic>> candidates) async {
    final selected = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Assign New Host'),
        content: SizedBox(
          width: 300,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: candidates.length,
            itemBuilder: (_, i) {
              final p = candidates[i];
              return ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person)),
                title: Text(p['full_name'] ?? 'Unknown'),
                subtitle: Text(p['role'] ?? 'attendee'),
                onTap: () => Navigator.pop(context, p),
              );
            },
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
        ],
      ),
    );

    if (selected == null || !mounted) return;
    final newHostId = selected['user_id'] as String;
    try {
      await ApiService().post('/meetings/$_meetingId/transfer-host/$newHostId', {});
      WebSocketService().send('transfer_host', {'meeting_id': _meetingId, 'new_host_id': newHostId});
      // Current host leaves
      await _leave();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
      }
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

  Future<void> _toggleScreenShare() async {
    if (_screenSharing) {
      // Stop screen share — restore camera
      _screenStream?.getTracks().forEach((t) => t.stop());
      setState(() {
        _screenSharing = false;
        _screenStream = null;
      });
      // Notify all participants that we stopped sharing
      WebSocketService().notifyScreenShare(_meetingId, sharing: false);
      // Restore camera track in all peer connections
      if (_localStream != null) {
        for (final pc in _peerConnections.values) {
          final senders = await pc.getSenders();
          for (final sender in senders) {
            if (sender.track?.kind == 'video') {
              final camTrack = _localStream!.getVideoTracks().firstOrNull;
              if (camTrack != null) await sender.replaceTrack(camTrack);
            }
          }
        }
        _localRenderer.srcObject = _localStream;
      }
    } else {
      try {
        final screenStream = await navigator.mediaDevices.getDisplayMedia({
          'video': {'cursor': 'always'},
          'audio': false,
        });
        final screenTracks = screenStream.getVideoTracks();
        if (screenTracks.isEmpty) throw Exception('No screen track captured');
        setState(() {
          _screenStream = screenStream;
          _screenSharing = true;
        });
        _localRenderer.srcObject = screenStream;
        if (mounted) setState(() {});
        // Notify all participants that we started sharing
        WebSocketService().notifyScreenShare(_meetingId, sharing: true);
        // Replace video track in all peer connections with screen track
        final screenTrack = screenTracks.first;
        for (final pc in _peerConnections.values) {
          final senders = await pc.getSenders();
          for (final sender in senders) {
            if (sender.track?.kind == 'video') {
              await sender.replaceTrack(screenTrack);
            }
          }
        }
        // Auto-stop when user ends share via browser UI
        screenTrack.onEnded = () {
          if (mounted) _toggleScreenShare();
        };
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                  content: Text('Screen share failed: ${e.toString()}'),
                  backgroundColor: Colors.red));
        }
      }
    }
  }

  void _toggleHand() {
    setState(() => _handRaised = !_handRaised);
    WebSocketService().raiseHand(_meetingId, raised: _handRaised);
  }

  void _sendChat() {
    final msg = _chatCtrl.text.trim();
    if (msg.isEmpty) return;
    WebSocketService().sendMeetingChat(_meetingId, msg);
    // Echo locally with correct keys matching backend payload
    setState(() => _chatMessages.add({
      'meeting_id': _meetingId,
      'from_user_id': _me?.id ?? '',
      'from_name': _me?.fullName ?? 'You',
      'message': msg,
      'sent_at': DateTime.now().toIso8601String(),
    }));
    _chatCtrl.clear();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_chatScrollCtrl.hasClients) {
        _chatScrollCtrl.animateTo(
          _chatScrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
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
    // Local user is screen sharing
    if (_screenSharing) return _buildScreenShareLayout(null);

    // A remote participant is screen sharing — show them featured
    if (_remoteScreenSharingUserId != null) {
      return _buildRemoteScreenShareLayout(_remoteScreenSharingUserId!);
    }

    final remoteTiles = <Widget>[];
    for (final p in _participants) {
      if (p['user_id'] == _me?.id) continue;
      remoteTiles.add(_buildRemoteTile(p, p['user_id'] as String));
    }

    // Only me — single tile fills the whole space
    if (remoteTiles.isEmpty) {
      return Padding(padding: const EdgeInsets.all(4), child: _buildLocalTile());
    }

    final allTiles = <Widget>[_buildLocalTile(), ...remoteTiles];
    final crossCount = allTiles.length <= 2 ? 1 : allTiles.length <= 4 ? 2 : 3;
    return GridView.count(
      crossAxisCount: crossCount,
      childAspectRatio: 16 / 9,
      padding: const EdgeInsets.all(4),
      crossAxisSpacing: 4,
      mainAxisSpacing: 4,
      children: allTiles,
    );
  }

  /// Featured layout when LOCAL user is sharing screen.
  /// [_] unused (kept for API symmetry with remote version).
  Widget _buildScreenShareLayout(String? _) {
    final thumbs = <Widget>[];
    for (final p in _participants) {
      if (p['user_id'] == _me?.id) continue;
      thumbs.add(_buildRemoteTile(p, p['user_id'] as String));
    }
    return Row(
      children: [
        Expanded(
          flex: 3,
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: _buildLocalTile(),
          ),
        ),
        if (thumbs.isNotEmpty)
          SizedBox(
            width: 160,
            child: ListView.builder(
              padding: const EdgeInsets.all(4),
              itemCount: thumbs.length,
              itemBuilder: (_, i) => AspectRatio(
                aspectRatio: 16 / 9,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: thumbs[i],
                ),
              ),
            ),
          ),
      ],
    );
  }

  /// Featured layout when a REMOTE participant is sharing screen.
  Widget _buildRemoteScreenShareLayout(String sharingUid) {
    final sharer = _participants.firstWhere(
      (p) => p['user_id'] == sharingUid,
      orElse: () => <String, dynamic>{},
    );
    final sharerRenderer = _remoteRenderers[sharingUid];
    final thumbs = <Widget>[];
    // Local tile as thumbnail
    thumbs.add(_buildLocalTile());
    // Other remote participants as thumbnails
    for (final p in _participants) {
      if (p['user_id'] == _me?.id || p['user_id'] == sharingUid) continue;
      thumbs.add(_buildRemoteTile(p, p['user_id'] as String));
    }
    return Row(
      children: [
        // Large screen-share tile for the sharer
        Expanded(
          flex: 3,
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: _VideoTile(
              name: '${sharer['full_name'] ?? 'Unknown'} (Screen)',
              role: sharer['role'] as String? ?? 'attendee',
              isMuted: sharer['is_muted'] == true,
              handRaised: false,
              showVideo: sharerRenderer != null && sharerRenderer.renderVideo,
              renderer: sharerRenderer,
              mirror: false,
              isMe: false,
              isScreenShare: true,
            ),
          ),
        ),
        // Thumbnail strip: local + other participants
        SizedBox(
          width: 160,
          child: ListView.builder(
            padding: const EdgeInsets.all(4),
            itemCount: thumbs.length,
            itemBuilder: (_, i) => AspectRatio(
              aspectRatio: 16 / 9,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: thumbs[i],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildLocalTile() {
    // showVideo: true as soon as we have a stream with video tracks and camera is on.
    // We deliberately do NOT gate on _localRenderer.renderVideo because that only
    // becomes true after the first painted frame — by which point we want the video
    // element already visible (not covered by avatar).
    final hasVideoTrack = _localStream != null &&
        _localStream!.getVideoTracks().isNotEmpty &&
        _localStream!.getVideoTracks().first.enabled;
    final showVideo = (_cameraOn || _screenSharing) &&
        _localRenderer.srcObject != null &&
        (hasVideoTrack || _screenSharing);
    // ignore: avoid_print
    print('[MeetingRoom] cameraOn=$_cameraOn screenSharing=$_screenSharing renderVideo=${_localRenderer.renderVideo} hasVideoTrack=$hasVideoTrack srcObject=${_localRenderer.srcObject != null} cameraError=$_cameraError');
    return _VideoTile(
      name: _screenSharing ? 'Your Screen' : 'You',
      role: _myRole,
      isMuted: _muted,
      handRaised: _handRaised,
      showVideo: showVideo,
      renderer: _localRenderer,
      mirror: !_screenSharing,
      isMe: true,
      isScreenShare: _screenSharing,
    );
  }

  Widget _buildRemoteTile(Map<String, dynamic> p, String uid) {
    final renderer = _remoteRenderers[uid];
    // Show video as soon as srcObject is assigned — don't wait for renderVideo
    // (which only becomes true after the first painted frame)
    final showVideo = renderer != null && renderer.srcObject != null;
    return GestureDetector(
      onLongPress: _canControl ? () => _showParticipantOptions(p) : null,
      child: Stack(
        children: [
          _VideoTile(
            name: p['full_name'] as String? ?? 'Unknown',
            role: p['role'] as String? ?? 'attendee',
            isMuted: p['is_muted'] == true,
            handRaised: p['hand_raised'] == true,
            showVideo: showVideo,
            renderer: renderer,
            mirror: false,
            isMe: false,
          ),
          // Visible mute button for host/co-host
          if (_canControl)
            Positioned(
              top: 6,
              right: 6,
              child: GestureDetector(
                onTap: () => _muteParticipant(uid),
                child: Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Icon(
                    p['is_muted'] == true ? Icons.mic_off : Icons.mic,
                    color: p['is_muted'] == true ? Colors.red : Colors.white,
                    size: 16,
                  ),
                ),
              ),
            ),
        ],
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
          _CtrlBtn(
            icon: _screenSharing ? Icons.stop_screen_share : Icons.screen_share,
            label: _screenSharing ? 'Stop Share' : 'Share',
            color: _screenSharing ? Colors.orange : Colors.white,
            onTap: _toggleScreenShare,
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
              onTap: _endMeeting,
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
              final isMe = m['from_user_id'] == _me?.id;
              final name = m['from_name'] as String? ?? 'Unknown';
              final sentAt = m['sent_at'] as String?;
              String timeStr = '';
              if (sentAt != null) {
                try {
                  final dt = DateTime.parse(sentAt).toLocal();
                  final h = dt.hour.toString().padLeft(2, '0');
                  final min = dt.minute.toString().padLeft(2, '0');
                  timeStr = '$h:$min';
                } catch (_) {}
              }
              return Align(
                alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  constraints: const BoxConstraints(maxWidth: 280),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isMe ? AppTheme.accent : AppTheme.surface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Flexible(
                            child: Text(
                              isMe ? 'You' : name,
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: isMe ? AppTheme.primary.withOpacity(0.8) : Colors.white70,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (timeStr.isNotEmpty) ...
                            [
                              const SizedBox(width: 8),
                              Text(
                                timeStr,
                                style: TextStyle(
                                  fontSize: 10,
                                  color: isMe ? AppTheme.primary.withOpacity(0.6) : Colors.white38,
                                ),
                              ),
                            ],
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        m['message'] as String? ?? '',
                        style: TextStyle(color: isMe ? AppTheme.primary : Colors.white),
                      ),
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
  final bool showVideo;        // whether video track is active
  final RTCVideoRenderer? renderer; // null for remote tiles with no WebRTC yet
  final bool mirror;
  final bool isMe;
  final bool isScreenShare;

  const _VideoTile({
    required this.name,
    required this.role,
    required this.isMuted,
    required this.handRaised,
    required this.showVideo,
    this.renderer,
    required this.mirror,
    required this.isMe,
    this.isScreenShare = false,
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
          // RTCVideoView only when renderer is available.
          // Local tile: always has renderer, mounted even before srcObject so
          // platformViewRegistry creates the <video> DOM element in time.
          // Remote tiles: renderer is null until WebRTC track arrives.
          if (renderer != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(7),
              child: RTCVideoView(
                renderer!,
                mirror: mirror,
                objectFit: isScreenShare
                    ? RTCVideoViewObjectFit.RTCVideoViewObjectFitContain
                    : RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
              ),
            ),
          // Avatar overlay — shown when no video or no renderer yet
          if (!showVideo || renderer == null)
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircleAvatar(
                    radius: 30,
                    backgroundColor: _roleColor.withOpacity(0.2),
                    child: isScreenShare
                        ? Icon(Icons.screen_share, color: _roleColor, size: 28)
                        : Text(
                            name.isNotEmpty ? name[0].toUpperCase() : '?',
                            style: TextStyle(
                                fontSize: 24, fontWeight: FontWeight.bold, color: _roleColor),
                          ),
                  ),
                  if (!isScreenShare)
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
