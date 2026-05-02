import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../services/websocket_service.dart';
import '../../theme/app_theme.dart';
import 'call_screen.dart';

class CallHistoryScreen extends StatefulWidget {
  const CallHistoryScreen({super.key});
  @override
  State<CallHistoryScreen> createState() => _CallHistoryScreenState();
}

class _CallHistoryScreenState extends State<CallHistoryScreen> {
  final _api = ApiService();
  final _ws  = WebSocketService();
  StreamSubscription? _wsSub;

  List<Map<String, dynamic>> _calls = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    // Refresh when a call ends so the log updates live
    _wsSub = _ws.messages.listen((msg) {
      if (msg['type'] == 'call_ended' || msg['type'] == 'call_declined') _load();
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await _api.get('/calls/history');
      if (mounted) {
        setState(() {
          _calls = List<Map<String, dynamic>>.from(data['calls'] ?? []);
          _loading = false;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // ── Hierarchy permission helper ────────────────────────────
  // Mirror of backend canCall — prevents showing call button when not allowed
  static const _roleLevel = {
    'ysa_member': 1, 'missionary': 1, 'ysa_rep': 2, 'ysa_adviser': 2,
    'bishop': 3, 'district_presidency': 3, 'stake_presidency': 4,
    'coordinating_council': 5, 'area_authority': 6, 'mission_president': 6,
    'mission_president_wife': 6, 'area_presidency': 7, 'general_authority': 8,
    'apostle': 9, 'first_presidency': 10, 'it_support': 11,
  };

  bool _canCallBack(String? otherRole) {
    if (otherRole == null) return false;
    final myRole = AuthService().currentUser?.role ?? '';
    if (myRole == 'it_support') return true;
    if (myRole == 'missionary') {
      return ['missionary', 'mission_president', 'mission_president_wife'].contains(otherRole);
    }
    final myLevel     = _roleLevel[myRole]     ?? 0;
    final otherLevel  = _roleLevel[otherRole]  ?? 0;
    return myLevel >= otherLevel;
  }

  // ── Helpers ────────────────────────────────────────────────

  String _formatTime(String? isoString) {
    if (isoString == null) return '';
    final dt = DateTime.tryParse(isoString)?.toLocal();
    if (dt == null) return '';
    final now = DateTime.now();
    if (now.difference(dt).inDays == 0) return DateFormat('h:mm a').format(dt);
    if (now.difference(dt).inDays < 7)  return DateFormat('EEE').format(dt);
    return DateFormat('MMM d').format(dt);
  }

  String _formatDuration(int? secs) {
    if (secs == null || secs <= 0) return '';
    final m = (secs ~/ 60).toString().padLeft(2, '0');
    final s = (secs  % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  String _statusLabel(Map<String, dynamic> call) {
    final status     = call['status'] as String? ?? '';
    final isOutgoing = call['is_outgoing'] as bool? ?? false;
    switch (status) {
      case 'ended':     return _formatDuration(call['duration_seconds'] as int?);
      case 'missed':    return 'Missed';
      case 'declined':  return isOutgoing ? 'Declined' : 'You declined';
      case 'rejected':  return isOutgoing ? 'Declined' : 'You declined'; // legacy
      case 'initiated': return 'No answer';
      case 'ringing':   return 'No answer'; // legacy
      case 'answered':  return 'Ongoing';
      case 'active':    return 'Ongoing'; // legacy
      default:          return status;
    }
  }

  Color _statusColor(Map<String, dynamic> call) {
    final status     = call['status'] as String? ?? '';
    final isOutgoing = call['is_outgoing'] as bool? ?? false;
    if (status == 'missed' || (status == 'declined' && !isOutgoing) || (status == 'rejected' && !isOutgoing)) {
      return Colors.redAccent;
    }
    return AppTheme.textSecondary;
  }

  IconData _directionIcon(Map<String, dynamic> call) {
    final status     = call['status'] as String? ?? '';
    final isOutgoing = call['is_outgoing'] as bool? ?? false;
    if (status == 'missed' || (status == 'declined' && !isOutgoing) || (status == 'rejected' && !isOutgoing)) {
      return Icons.call_missed;
    }
    return isOutgoing ? Icons.call_made : Icons.call_received;
  }

  Color _directionColor(Map<String, dynamic> call) {
    final status     = call['status'] as String? ?? '';
    final isOutgoing = call['is_outgoing'] as bool? ?? false;
    if (status == 'missed' || (status == 'declined' && !isOutgoing) || (status == 'rejected' && !isOutgoing)) {
      return Colors.redAccent;
    }
    return isOutgoing ? Colors.blueAccent : Colors.greenAccent;
  }

  void _callBack(Map<String, dynamic> call, String callType) {
    final other = call['other_user'] as Map<String, dynamic>?;
    if (other == null) return;
    final convId = call['conversation_id'] as String? ?? '';
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => CallScreen(
        callId:          '',        // will be assigned by server on initiate
        conversationId:  convId,
        remoteUserName:  other['name'] as String? ?? 'User',
        remoteUserPhoto: other['photo'] as String?,
        callType:        callType,
        isOutgoing:      true,
        remoteUserId:    other['id'] as String?,
      ),
      fullscreenDialog: true,
    ));
    _ws.initiateCall(convId, callType);
  }

  // ── Build ──────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Calls'),
        backgroundColor: AppTheme.surface,
        foregroundColor: AppTheme.textPrimary,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () { setState(() => _loading = true); _load(); },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: AppTheme.textSecondary)))
              : _calls.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.call_outlined, size: 64, color: AppTheme.textSecondary),
                          SizedBox(height: 16),
                          Text('No calls yet', style: TextStyle(color: AppTheme.textSecondary, fontSize: 16)),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        itemCount: _calls.length,
                        separatorBuilder: (_, __) => const Divider(
                          height: 1, color: AppTheme.surface, indent: 72),
                        itemBuilder: (_, i) => _CallTile(
                          call:          _calls[i],
                          directionIcon: _directionIcon(_calls[i]),
                          directionColor:_directionColor(_calls[i]),
                          statusLabel:   _statusLabel(_calls[i]),
                          statusColor:   _statusColor(_calls[i]),
                          timeLabel:     _formatTime(_calls[i]['created_at'] as String?),
                          canCallBack:   _canCallBack((_calls[i]['other_user'] as Map?)?.cast<String,dynamic>()['role'] as String?),
                          onCallBack:    (type) => _callBack(_calls[i], type),
                        ),
                      ),
                    ),
    );
  }
}

// ── Tile ───────────────────────────────────────────────────────

class _CallTile extends StatelessWidget {
  final Map<String, dynamic> call;
  final IconData  directionIcon;
  final Color     directionColor;
  final String    statusLabel;
  final Color     statusColor;
  final String    timeLabel;
  final bool      canCallBack;
  final void Function(String callType) onCallBack;

  const _CallTile({
    required this.call,
    required this.directionIcon,
    required this.directionColor,
    required this.statusLabel,
    required this.statusColor,
    required this.timeLabel,
    required this.canCallBack,
    required this.onCallBack,
  });

  @override
  Widget build(BuildContext context) {
    final other    = (call['other_user'] as Map?)?.cast<String, dynamic>();
    final name     = other?['name'] as String? ?? 'Unknown';
    final photo    = other?['photo'] as String?;
    final callType = call['call_type'] as String? ?? 'voice';
    final isVideo  = callType == 'video';

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: CircleAvatar(
        radius: 24,
        backgroundColor: AppTheme.surface,
        backgroundImage: photo != null ? NetworkImage(photo) : null,
        child: photo == null
            ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))
            : null,
      ),
      title: Text(name,
          style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w600)),
      subtitle: Row(
        children: [
          Icon(directionIcon, size: 14, color: directionColor),
          const SizedBox(width: 4),
          Icon(isVideo ? Icons.videocam_outlined : Icons.call_outlined,
              size: 14, color: AppTheme.textSecondary),
          const SizedBox(width: 4),
          Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 13)),
        ],
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(timeLabel,
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
          if (canCallBack) ...[
            const SizedBox(width: 8),
            GestureDetector(
              onTap: () => _showCallOptions(context),
              child: Icon(
                isVideo ? Icons.videocam : Icons.call,
                color: AppTheme.primary,
              ),
            ),
          ],
        ],
      ),
      onTap: canCallBack ? () => _showCallOptions(context) : null,
    );
  }

  void _showCallOptions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.call, color: Colors.greenAccent),
              title: const Text('Voice Call',
                  style: TextStyle(color: AppTheme.textPrimary)),
              onTap: () { Navigator.pop(context); onCallBack('voice'); },
            ),
            ListTile(
              leading: const Icon(Icons.videocam, color: Colors.blueAccent),
              title: const Text('Video Call',
                  style: TextStyle(color: AppTheme.textPrimary)),
              onTap: () { Navigator.pop(context); onCallBack('video'); },
            ),
          ],
        ),
      ),
    );
  }
}
