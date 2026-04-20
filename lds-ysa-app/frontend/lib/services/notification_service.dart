import 'package:flutter/material.dart';
import '../screens/calls/call_screen.dart';

/// Handles incoming push notification payloads and routes them
/// to the correct screen (chat, call overlay, status alert).
///
/// In production, wire this to firebase_messaging:
///   FirebaseMessaging.onMessage.listen(NotificationService().handleForeground);
///   FirebaseMessaging.onMessageOpenedApp.listen(NotificationService().handleBackground);
class NotificationService {
  static final NotificationService _i = NotificationService._();
  factory NotificationService() => _i;
  NotificationService._();

  // Navigator key — set in main.dart so we can push routes from anywhere
  static final navigatorKey = GlobalKey<NavigatorState>();

  /// Called when a push notification arrives while the app is in the foreground.
  void handleForeground(Map<String, dynamic> data) {
    final type = data['type'] as String? ?? '';
    switch (type) {
      case 'new_message':
        // Show an in-app snackbar banner
        _showBanner(
          title: data['sender_name'] ?? 'New message',
          body: data['message_preview'] ?? '',
          icon: Icons.chat_bubble,
          onTap: () => _navigateTo(data),
        );
        break;

      case 'incoming_call':
        // Push the call screen on top of whatever is open
        final ctx = navigatorKey.currentContext;
        if (ctx == null) return;
        Navigator.of(ctx).push(MaterialPageRoute(
          builder: (_) => CallScreen(
            callId: data['call_id'] ?? '',
            conversationId: data['conversation_id'] ?? '',
            remoteUserName: data['caller_name'] ?? 'Unknown',
            callType: data['call_type'] ?? 'voice',
            isOutgoing: false,
          ),
          fullscreenDialog: true,
        ));
        break;

      case 'new_status':
        _showBanner(
          title: 'New status',
          body: data['message'] ?? 'Someone posted a status update',
          icon: Icons.circle,
          onTap: () {},
        );
        break;

      case 'leader_approval':
        _showBanner(
          title: 'Approval needed',
          body: data['message'] ?? 'A new leader account needs your approval',
          icon: Icons.admin_panel_settings,
          onTap: () {},
        );
        break;
    }
  }

  /// Called when user taps a notification while app is in background/terminated.
  void handleBackground(Map<String, dynamic> data) {
    _navigateTo(data);
  }

  void _navigateTo(Map<String, dynamic> data) {
    // TODO: Use go_router or named routes to navigate based on data['type']
    // For now, routes are handled by the WebSocket listener in HomeScreen
  }

  void _showBanner({
    required String title,
    required String body,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    final ctx = navigatorKey.currentContext;
    if (ctx == null) return;
    ScaffoldMessenger.of(ctx).showSnackBar(
      SnackBar(
        content: Row(children: [
          Icon(icon, color: Colors.white, size: 20),
          const SizedBox(width: 12),
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              Text(body, style: const TextStyle(fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
            ],
          )),
        ]),
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(0xFF1A5276),
        duration: const Duration(seconds: 4),
        action: SnackBarAction(label: 'Open', textColor: Colors.white, onPressed: onTap),
      ),
    );
  }
}
