import 'dart:async';
import 'package:flutter/material.dart';
import '../../services/websocket_service.dart';
import '../../theme/app_theme.dart';
import 'meeting_room_screen.dart';

/// Waiting room shown when user's join request is pending host approval.
class MeetingLobbyScreen extends StatefulWidget {
  final Map<String, dynamic> meeting;
  const MeetingLobbyScreen({super.key, required this.meeting});

  @override
  State<MeetingLobbyScreen> createState() => _MeetingLobbyScreenState();
}

class _MeetingLobbyScreenState extends State<MeetingLobbyScreen> {
  late StreamSubscription<Map<String, dynamic>> _wsSub;
  bool _rejected = false;
  bool _approved = false;

  @override
  void initState() {
    super.initState();
    _wsSub = WebSocketService().messages.listen(_onWs);
  }

  @override
  void dispose() {
    _wsSub.cancel();
    super.dispose();
  }

  void _onWs(Map<String, dynamic> msg) {
    final type = msg['type'] as String?;
    final payload = (msg['payload'] as Map<String, dynamic>?) ?? {};
    final meetingId = payload['meeting_id'] as String?;
    if (meetingId != widget.meeting['id']) return;

    if (type == 'join_request_approved' && !_approved) {
      setState(() => _approved = true);
      // Small delay so user sees approval message, then push to room
      Future.delayed(const Duration(milliseconds: 800), () {
        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (_) => MeetingRoomScreen(meeting: widget.meeting),
            ),
          );
        }
      });
    } else if (type == 'join_request_rejected' && !_rejected) {
      setState(() => _rejected = true);
    } else if (type == 'meeting_ended') {
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('The meeting has ended')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      onPopInvokedWithResult: (_, __) {},
      canPop: _rejected,
      child: Scaffold(
        backgroundColor: AppTheme.background,
        appBar: AppBar(
          backgroundColor: AppTheme.surface,
          title: const Text('Waiting Room'),
          leading: _rejected
              ? BackButton(onPressed: () => Navigator.pop(context))
              : const SizedBox.shrink(),
          automaticallyImplyLeading: false,
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_rejected) ...[
                  const Icon(Icons.cancel, size: 80, color: Colors.red),
                  const SizedBox(height: 20),
                  const Text('Request Rejected',
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  Text(
                    'The host has declined your request to join this meeting.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey[400]),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Back to Meetings'),
                  ),
                ] else if (_approved) ...[
                  const Icon(Icons.check_circle, size: 80, color: Colors.green),
                  const SizedBox(height: 20),
                  const Text('Approved! Entering…',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                ] else ...[
                  TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: 1),
                    duration: const Duration(seconds: 2),
                    builder: (ctx, v, _) => CircularProgressIndicator(value: null),
                  ),
                  const SizedBox(height: 32),
                  Text(
                    widget.meeting['title'] ?? 'Meeting',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Waiting for the host to let you in…',
                    style: TextStyle(color: Colors.grey[400], fontSize: 15),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Host: ${widget.meeting['host_name'] ?? ''}',
                    style: TextStyle(color: Colors.grey[500], fontSize: 13),
                  ),
                  const SizedBox(height: 32),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.exit_to_app),
                    label: const Text('Cancel Request'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red,
                      side: const BorderSide(color: Colors.red),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
