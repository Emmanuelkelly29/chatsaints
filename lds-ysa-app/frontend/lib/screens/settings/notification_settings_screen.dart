import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});
  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  bool _messages   = true;
  bool _calls      = true;
  bool _statuses   = true;
  bool _approvals  = true;
  bool _sound      = true;
  bool _vibration  = true;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Notifications')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('NOTIFY ME ABOUT', style: TextStyle(fontSize: 11,
            fontWeight: FontWeight.w700, color: AppTheme.textSecondary, letterSpacing: 1.2)),
        const SizedBox(height: 12),
        Card(child: Column(children: [
          SwitchListTile(
            value: _messages, onChanged: (v) => setState(() => _messages = v),
            activeThumbColor: AppTheme.accent,
            title: const Text('New messages'),
            secondary: const Icon(Icons.chat_bubble_outline, color: AppTheme.accent),
          ),
          const Divider(height: 1, indent: 16),
          SwitchListTile(
            value: _calls, onChanged: (v) => setState(() => _calls = v),
            activeThumbColor: AppTheme.accent,
            title: const Text('Incoming calls'),
            secondary: const Icon(Icons.call_outlined, color: AppTheme.accent),
          ),
          const Divider(height: 1, indent: 16),
          SwitchListTile(
            value: _statuses, onChanged: (v) => setState(() => _statuses = v),
            activeThumbColor: AppTheme.accent,
            title: const Text('Status updates'),
            secondary: const Icon(Icons.circle_outlined, color: AppTheme.accent),
          ),
          const Divider(height: 1, indent: 16),
          SwitchListTile(
            value: _approvals, onChanged: (v) => setState(() => _approvals = v),
            activeThumbColor: AppTheme.accent,
            title: const Text('Leader approvals'),
            secondary: const Icon(Icons.admin_panel_settings_outlined, color: AppTheme.accent),
          ),
        ])),
        const SizedBox(height: 20),
        const Text('SOUND & VIBRATION', style: TextStyle(fontSize: 11,
            fontWeight: FontWeight.w700, color: AppTheme.textSecondary, letterSpacing: 1.2)),
        const SizedBox(height: 12),
        Card(child: Column(children: [
          SwitchListTile(
            value: _sound, onChanged: (v) => setState(() => _sound = v),
            activeThumbColor: AppTheme.accent,
            title: const Text('Sound'),
            secondary: const Icon(Icons.volume_up_outlined, color: AppTheme.accent),
          ),
          const Divider(height: 1, indent: 16),
          SwitchListTile(
            value: _vibration, onChanged: (v) => setState(() => _vibration = v),
            activeThumbColor: AppTheme.accent,
            title: const Text('Vibration'),
            secondary: const Icon(Icons.vibration, color: AppTheme.accent),
          ),
        ])),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppTheme.accent.withOpacity(0.1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Text(
            'Push notifications require Firebase to be set up. '
            'See SETUP_GUIDE.md for instructions.',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
        ),
      ],
    ),
  );
}
