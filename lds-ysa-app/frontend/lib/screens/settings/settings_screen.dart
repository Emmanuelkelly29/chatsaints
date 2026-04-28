import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../../utils/constants.dart';
import '../auth/login_screen.dart';
import 'edit_profile_screen.dart';
import 'privacy_settings_screen.dart';
import 'notification_settings_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Future<void> _openEditProfile() async {
    final changed = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const EditProfileScreen()),
    );
    if (changed == true && mounted) setState(() {});
  }

  String? _resolvePhotoUrl(String? rawUrl) {
    if (rawUrl == null || rawUrl.isEmpty) return null;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
    return '${AppConstants.uploadsBase}/${rawUrl.split('/').last}';
  }

  @override
  Widget build(BuildContext context) {
    final user = AuthService().currentUser;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          // Profile header
          Material(
            color: AppTheme.primary,
            child: InkWell(
              onTap: _openEditProfile,
              child: Container(
                padding: const EdgeInsets.all(20),
                child: Row(children: [
                  CircleAvatar(
                    radius: 36,
                    backgroundColor: Colors.white24,
                    backgroundImage: _resolvePhotoUrl(user?.profilePhotoUrl) != null
                      ? NetworkImage(_resolvePhotoUrl(user?.profilePhotoUrl)!) : null,
                    child: _resolvePhotoUrl(user?.profilePhotoUrl) == null
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
                    onPressed: _openEditProfile,
                  ),
                ]),
              ),
            ),
          ),

          const SizedBox(height: 8),

          // Account section
          const _SectionHeader(title: 'Account'),
          _SettingsTile(
            icon: Icons.person_outline,
            title: 'Edit profile',
            subtitle: 'Name, photo, bio, email',
            onTap: _openEditProfile,
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
            onTap: () => _showSimpleInfo(
              'Stake & unit',
              user?.stakeName ?? 'No stake or unit has been assigned to your account yet.',
            ),
          ),
          if (user?.isMissionary ?? false)
            _SettingsTile(
              icon: Icons.flag_outlined,
              title: 'Mission',
              subtitle: user?.missionName ?? 'Active mission',
              color: AppTheme.missionary,
              onTap: () => _showSimpleInfo(
                'Mission',
                user?.missionName ?? 'Mission details are not available yet.',
              ),
            ),

          const SizedBox(height: 8),

          // Help section
          const _SectionHeader(title: 'Help & Info'),
          _SettingsTile(
            icon: Icons.help_outline,
            title: 'About ChatSaints',
            subtitle: 'Version 1.0.0',
            onTap: () => _showAbout(context),
          ),
          _SettingsTile(
            icon: Icons.privacy_tip_outlined,
            title: 'Privacy Policy',
            onTap: () => _showSimpleInfo(
              'Privacy Policy',
              'ChatSaints protects profile data, messages, and account settings according to church and platform privacy rules.',
            ),
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

  void _showSimpleInfo(String title, String message) {
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  void _showAbout(BuildContext context) {
    showAboutDialog(
      context: context,
      applicationName: 'ChatSaints',
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
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    decoration: BoxDecoration(
      color: AppTheme.primaryLight,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppTheme.divider),
    ),
    child: ListTile(
      leading: Icon(icon, color: color ?? AppTheme.accent, size: 24),
      title: Text(title, style: TextStyle(
        fontWeight: FontWeight.w600,
        color: color ?? AppTheme.textPrimary,
      )),
      subtitle: subtitle != null
          ? Text(subtitle!, style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary))
          : null,
      trailing: const Icon(Icons.chevron_right, color: AppTheme.textSecondary),
      onTap: onTap,
    ),
  );
}
