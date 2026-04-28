import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../../utils/constants.dart';
import '../settings/settings_screen.dart';
import '../settings/edit_profile_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _auth = AuthService();

  Future<void> _openEditProfile() async {
    final changed = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const EditProfileScreen()),
    );
    if (changed == true && mounted) setState(() {});
  }

  Future<void> _copyValue(String label, String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label copied'), backgroundColor: AppTheme.success),
    );
  }

  void _showInfo(String title, String message) {
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
        ],
      ),
    );
  }

  String? _resolvePhotoUrl(String? rawUrl) {
    if (rawUrl == null || rawUrl.isEmpty) return null;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
    return '${AppConstants.uploadsBase}/${rawUrl.split('/').last}';
  }

  @override
  Widget build(BuildContext context) {
    final user = _auth.currentUser;
    final photoUrl = _resolvePhotoUrl(user?.profilePhotoUrl);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () async {
              await Navigator.push(context,
                MaterialPageRoute(builder: (_) => const SettingsScreen()));
              if (mounted) setState(() {});
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Avatar + name
          Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(24),
              onTap: _openEditProfile,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Center(child: Column(children: [
                  CircleAvatar(
                    radius: 52,
                    backgroundColor: AppTheme.primaryLight,
                    backgroundImage: photoUrl != null ? NetworkImage(photoUrl) : null,
                    child: photoUrl == null
                        ? Text((user?.fullName ?? '?')[0].toUpperCase(),
                            style: const TextStyle(fontSize: 40, color: Colors.white, fontWeight: FontWeight.w600))
                        : null,
                  ),
                  const SizedBox(height: 14),
                  Text(user?.fullName ?? '',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(user?.displayRole ?? '',
                    style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w500, fontSize: 15)),
                  if (user?.stakeName != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(user!.stakeName!,
                        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                    ),
                  const SizedBox(height: 10),

                  Wrap(spacing: 8, runSpacing: 6, children: [
                    if (!(user?.isApproved ?? true))
                      _Badge(label: 'Pending approval', color: AppTheme.accent.withOpacity(0.15), textColor: AppTheme.accent),
                    if (user?.isMissionary ?? false)
                      _Badge(label: 'Missionary mode', color: AppTheme.missionary.withOpacity(0.15), textColor: AppTheme.missionary),
                    if (user?.isApproved ?? false)
                      _Badge(label: 'Verified', color: AppTheme.success.withOpacity(0.15), textColor: AppTheme.success),
                  ]),
                ])),
              ),
            ),
          ),

          const SizedBox(height: 28),

          // Info cards
          _InfoCard(children: [
            _InfoRow(
              icon: Icons.phone,
              label: 'Phone',
              value: user?.phoneNumber ?? '',
              onTap: user?.phoneNumber.isNotEmpty == true
                  ? () => _copyValue('Phone number', user!.phoneNumber)
                  : null,
            ),
            if (user?.email != null)
              _InfoRow(
                icon: Icons.email,
                label: 'Email',
                value: user!.email!,
                onTap: () => _copyValue('Email', user.email!),
              ),
            if (user?.age != null)
              _InfoRow(
                icon: Icons.cake,
                label: 'Age',
                value: '${user!.age}',
                onTap: () => _showInfo('Age', '${user.age} years old'),
              ),
          ]),

          if (user?.bio != null && user!.bio!.isNotEmpty) ...[
            const SizedBox(height: 12),
            _InfoCard(children: [
              InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () => _showInfo('Bio', user.bio!),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(user.bio!, style: const TextStyle(fontSize: 15, height: 1.5)),
                ),
              ),
            ]),
          ],

          if (user?.missionName != null) ...[
            const SizedBox(height: 12),
            _InfoCard(children: [
              _InfoRow(
                icon: Icons.flag,
                label: 'Mission',
                value: user!.missionName!,
                iconColor: AppTheme.missionary,
                onTap: () => _showInfo('Mission', user.missionName!),
              ),
            ]),
          ],

          const SizedBox(height: 24),

          // Settings button
          ElevatedButton.icon(
            onPressed: () async {
              await Navigator.push(context,
                MaterialPageRoute(builder: (_) => const SettingsScreen()));
              if (mounted) setState(() {});
            },
            icon: const Icon(Icons.settings),
            label: const Text('Settings'),
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color, textColor;
  const _Badge({required this.label, required this.color, required this.textColor});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(20)),
    child: Text(label, style: TextStyle(fontSize: 12, color: textColor, fontWeight: FontWeight.w500)),
  );
}

class _InfoCard extends StatelessWidget {
  final List<Widget> children;
  const _InfoCard({required this.children});
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(children: children),
    ),
  );
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label, value;
  final Color? iconColor;
  final VoidCallback? onTap;
  const _InfoRow({required this.icon, required this.label, required this.value, this.iconColor, this.onTap});
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.transparent,
    child: InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(children: [
          Icon(icon, size: 20, color: iconColor ?? AppTheme.accent),
          const SizedBox(width: 12),
          SizedBox(width: 60, child: Text(label,
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13))),
          const SizedBox(width: 8),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500))),
          if (onTap != null) const Icon(Icons.open_in_new, size: 16, color: AppTheme.textSecondary),
        ]),
      ),
    ),
  );
}
