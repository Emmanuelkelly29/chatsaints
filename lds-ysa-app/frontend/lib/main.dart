import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'services/auth_service.dart';
import 'services/websocket_service.dart';
import 'services/notification_service.dart';
import 'theme/app_theme.dart';
import 'utils/constants.dart';
import 'screens/auth/login_screen.dart';
import 'screens/home/home_screen.dart';
import 'screens/calls/call_screen.dart';
import 'screens/meetings/meeting_room_screen.dart';
import 'services/api_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // TODO: Uncomment when Firebase is set up
  // await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  runApp(const ChatSaintsApp());
}

class ChatSaintsApp extends StatefulWidget {
  const ChatSaintsApp({super.key});
  @override
  State<ChatSaintsApp> createState() => _ChatSaintsAppState();
}

class _ChatSaintsAppState extends State<ChatSaintsApp> {
  bool _ready    = false;
  bool _loggedIn = false;
  StreamSubscription? _wsSub;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    // Restore saved session
    final user = await AuthService().loadSavedUser();
    if (user != null) {
      const storage = FlutterSecureStorage();
      final token   = await storage.read(key: StorageKeys.authToken);
      if (token != null) {
        WebSocketService().connect(token);
        // Listen for incoming calls globally
        _wsSub = WebSocketService().messages.listen(_handleGlobalWsEvent);
      }
    }
    setState(() { _loggedIn = user != null; _ready = true; });
  }

  void _handleGlobalWsEvent(Map<String, dynamic> msg) async {
    if (!mounted) return;
    if (msg['type'] == 'incoming_call') {
      final p = msg['payload'] as Map<String, dynamic>;
      final callId        = p['call_id'] as String? ?? '';
      final conversationId = p['conversation_id'] as String? ?? '';
      // Notify caller that this device is ringing
      WebSocketService().send('call_ringing', {
        'call_id': callId,
        'conversation_id': conversationId,
      });
      // Push call screen over any current screen
      NotificationService.navigatorKey.currentState?.push(
        MaterialPageRoute(
          builder: (_) => CallScreen(
            callId:           callId,
            conversationId:   conversationId,
            remoteUserName:   p['caller_name'] ?? 'Unknown',
            remoteUserPhoto:  p['caller_photo'],
            callType:         p['call_type'] ?? 'voice',
            isOutgoing:       false,
            remoteUserId:     p['caller_id'] as String?,
          ),
          fullscreenDialog: true,
        ),
      );
    }

    // ── Meeting approval notifications ──────────────────────────
    if (msg['type'] == 'join_request_approved') {
      final meetingId = (msg['payload'] as Map<String, dynamic>?)?['meeting_id'] as String?;
      if (meetingId == null) return;
      try {
        final detail = await ApiService().get('/api/meetings/$meetingId');
        if (!mounted) return;
        NotificationService.navigatorKey.currentState?.push(
          MaterialPageRoute(
            builder: (_) => MeetingRoomScreen(meeting: detail),
          ),
        );
      } catch (_) {}
    }

    if (msg['type'] == 'join_request_received') {
      // Host's pending requests badge is handled inside MeetingRoomScreen
      // Global notification banner for when host is not in the room
      final p = msg['payload'] as Map<String, dynamic>?;
      if (p != null) {
        final name = p['full_name'] ?? 'Someone';
        ScaffoldMessenger.of(
          NotificationService.navigatorKey.currentContext!,
        ).showSnackBar(SnackBar(
          content: Text('$name wants to join your meeting'),
          duration: const Duration(seconds: 5),
        ));
      }
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'ChatSaints',
    debugShowCheckedModeBanner: false,
    theme: AppTheme.dark,
    navigatorKey: NotificationService.navigatorKey,
    home: !_ready
        ? const Scaffold(
            body: Center(child: CircularProgressIndicator()))
        : _loggedIn
            ? const HomeScreen()
            : const LoginScreen(),
  );

  @override
  void dispose() { _wsSub?.cancel(); super.dispose(); }
}
