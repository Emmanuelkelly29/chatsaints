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

  void _handleGlobalWsEvent(Map<String, dynamic> msg) {
    if (!mounted) return;
    if (msg['type'] == 'incoming_call') {
      final p = msg['payload'] as Map<String, dynamic>;
      // Push call screen over any current screen
      NotificationService.navigatorKey.currentState?.push(
        MaterialPageRoute(
          builder: (_) => CallScreen(
            callId:           p['call_id'] ?? '',
            conversationId:   p['conversation_id'] ?? '',
            remoteUserName:   p['caller_name'] ?? 'Unknown',
            remoteUserPhoto:  p['caller_photo'],
            callType:         p['call_type'] ?? 'voice',
            isOutgoing:       false,
          ),
          fullscreenDialog: true,
        ),
      );
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
