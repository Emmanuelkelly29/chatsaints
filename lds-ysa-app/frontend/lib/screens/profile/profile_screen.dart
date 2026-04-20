import 'package:flutter/material.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../../utils/constants.dart';
import '../settings/settings_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _auth = AuthService();

  @override
  Widget build(BuildContext context) {
    final user = _auth.currentUser;
    final photoUrl = user?.profilePhotoUrl != null
        ? '${AppConstants.uploadsBase}/${user!.profilePhotoUrl!.split('/').last}'
        : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.push(context,
              MaterialPageRoute(builder: (_) => const SettingsScreen())),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Avatar + name
          Center(child: Column(children: [
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

            // Status badges
            Wrap(spacing: 8, runSpacing: 6, children: [
              if (!(user?.isApproved ?? true))
                _Badge(label: 'Pending approval', color: AppTheme.accent.withOpacity(0.15), textColor: AppTheme.accent),
              if (user?.isMissionary ?? false)
                _Badge(label: 'Missionary mode', color: AppTheme.missionary.withOpacity(0.15), textColor: AppTheme.missionary),
              if (user?.isApproved ?? false)
                _Badge(label: 'Verified', color: AppTheme.success.withOpacity(0.15), textColor: AppTheme.success),
            ]),
          ])),

          const SizedBox(height: 28),

          // Info cards
          _InfoCard(children: [
            _InfoRow(icon: Icons.phone, label: 'Phone', value: user?.phoneNumber ?? ''),
            if (user?.email != null) _InfoRow(icon: Icons.email, label: 'Email', value: user!.email!),
            if (user?.age != null) _InfoRow(icon: Icons.cake, label: 'Age', value: '${user!.age}'),
          ]),

          if (user?.bio != null && user!.bio!.isNotEmpty) ...[
            const SizedBox(height: 12),
            _InfoCard(children: [
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(user.bio!, style: const TextStyle(fontSize: 15, height: 1.5)),
              ),
            ]),
          ],

          if (user?.missionName != null) ...[
            const SizedBox(height: 12),
            _InfoCard(children: [
              _InfoRow(icon: Icons.flag, label: 'Mission', value: user!.missionName!, iconColor: AppTheme.missionary),
            ]),
          ],

          const SizedBox(height: 24),

          // Settings button
          ElevatedButton.icon(
            onPressed: () => Navigator.push(context,
              MaterialPageRoute(builder: (_) => const SettingsScreen())),
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
  const _InfoRow({required this.icon, required this.label, required this.value, this.iconColor});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(children: [
      Icon(icon, size: 20, color: iconColor ?? AppTheme.accent),
      const SizedBox(width: 12),
      SizedBox(width: 60, child: Text(label,
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13))),
      const SizedBox(width: 8),
      Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500))),
    ]),
  );
}
