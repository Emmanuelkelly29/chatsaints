import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../auth/login_screen.dart';
import 'edit_profile_screen.dart';
import 'privacy_settings_screen.dart';
import 'notification_settings_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = AuthService().currentUser;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          // Profile header
          Container(
            padding: const EdgeInsets.all(20),
            color: AppTheme.primary,
            child: Row(children: [
              CircleAvatar(
                radius: 36,
                backgroundColor: Colors.white24,
                backgroundImage: user?.profilePhotoUrl != null
                    ? NetworkImage(user!.profilePhotoUrl!) : null,
                child: user?.profilePhotoUrl == null
                    ? Text(
                        (user?.fullName ?? '?')[0].toUpperCase(),
                        style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700),
                      )
                    : null,
              ),
              const SizedBox(width: 16),
              Expanded(child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user?.fullName ?? '',
                    style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(user?.phoneNumber ?? '',
                    style: TextStyle(color: Colors.white.withOpacity(0.8), fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(user?.displayRole ?? '',
                    style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 12)),
                ],
              )),
              IconButton(
                icon: const Icon(Icons.edit, color: Colors.white),
                onPressed: () => Navigator.push(context,
                  MaterialPageRoute(builder: (_) => const EditProfileScreen())),
              ),
            ]),
          ),

          const SizedBox(height: 8),

          // Account section
          const _SectionHeader(title: 'Account'),
          _SettingsTile(
            icon: Icons.person_outline,
            title: 'Edit profile',
            subtitle: 'Name, photo, bio, email',
            onTap: () => Navigator.push(context,
              MaterialPageRoute(builder: (_) => const EditProfileScreen())),
          ),
          _SettingsTile(
            icon: Icons.lock_outline,
            title: 'Privacy',
            subtitle: 'Status visibility, stealth mode',
            onTap: () => Navigator.push(context,
              MaterialPageRoute(builder: (_) => const PrivacySettingsScreen())),
          ),
          _SettingsTile(
            icon: Icons.notifications_outlined,
            title: 'Notifications',
            subtitle: 'Push alerts, sounds',
            onTap: () => Navigator.push(context,
              MaterialPageRoute(builder: (_) => const NotificationSettingsScreen())),
          ),

          const SizedBox(height: 8),

          // Church section
          const _SectionHeader(title: 'Church'),
          _SettingsTile(
            icon: Icons.church_outlined,
            title: 'Stake & unit',
            subtitle: user?.stakeName ?? 'Not assigned',
            onTap: () {},
          ),
          if (user?.isMissionary ?? false)
            _SettingsTile(
              icon: Icons.flag_outlined,
              title: 'Mission',
              subtitle: user?.missionName ?? 'Active mission',
              color: AppTheme.missionary,
              onTap: () {},
            ),

          const SizedBox(height: 8),

          // Help section
          const _SectionHeader(title: 'Help & Info'),
          _SettingsTile(
            icon: Icons.help_outline,
            title: 'About LDS YSA Connect',
            subtitle: 'Version 1.0.0',
            onTap: () => _showAbout(context),
          ),
          _SettingsTile(
            icon: Icons.privacy_tip_outlined,
            title: 'Privacy Policy',
            onTap: () {},
          ),

          const SizedBox(height: 8),

          // Danger zone
          const _SectionHeader(title: 'Account Actions'),
          _SettingsTile(
            icon: Icons.logout,
            title: 'Sign out',
            color: AppTheme.danger,
            onTap: () => _confirmSignOut(context),
          ),
          _SettingsTile(
            icon: Icons.delete_forever_outlined,
            title: 'Delete account',
            subtitle: 'Permanently remove all your data',
            color: AppTheme.danger,
            onTap: () => _confirmDeleteAccount(context),
          ),

          const SizedBox(height: 40),
        ],
      ),
    );
  }

  void _showAbout(BuildContext context) {
    showAboutDialog(
      context: context,
      applicationName: 'LDS YSA Connect',
      applicationVersion: '1.0.0',
      applicationLegalese: '© 2025 The Church of Jesus Christ of Latter-day Saints',
      children: const [
        SizedBox(height: 12),
        Text('A secure communication platform for Young Single Adults and leaders of The Church of Jesus Christ of Latter-day Saints worldwide.'),
      ],
    );
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will need to sign in again to access your messages.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign out', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    await AuthService().logout();
    Navigator.pushAndRemoveUntil(context,
      MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  }

  Future<void> _confirmDeleteAccount(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete account permanently?'),
        content: const Text(
          'This will permanently delete your account, all your messages history, '
          'status updates, and remove you from all groups and stake pools.\n\n'
          'This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.danger),
            child: const Text('Delete permanently'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    try {
      await ApiService().delete('/settings/account');
      await AuthService().logout();
      if (!context.mounted) return;
      Navigator.pushAndRemoveUntil(context,
        MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
    }
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
    child: Text(title.toUpperCase(),
      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
          color: AppTheme.textSecondary, letterSpacing: 1.2)),
  );
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final Color? color;

  const _SettingsTile({
    required this.icon, required this.title,
    this.subtitle, required this.onTap, this.color,
  });

  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(icon, color: color ?? AppTheme.primary, size: 24),
    title: Text(title, style: TextStyle(
      fontWeight: FontWeight.w500,
      color: color ?? AppTheme.textPrimary,
    )),
    subtitle: subtitle != null
        ? Text(subtitle!, style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary))
        : null,
    trailing: const Icon(Icons.chevron_right, color: AppTheme.textSecondary),
    onTap: onTap,
    tileColor: Colors.white,
  );
}
