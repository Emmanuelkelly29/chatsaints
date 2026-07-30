import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';
import 'users_list_screen.dart';
import 'missionary_overview_screen.dart';
import 'stakes_management_screen.dart';
import '../leaders/leaders_screen.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});
  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  final _api = ApiService();
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await _api.get('/admin/dashboard');
      if (mounted) setState(() { _data = res; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Admin Dashboard'),
      actions: [
        IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
            ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Icon(Icons.error_outline, size: 64, color: AppTheme.danger),
                const SizedBox(height: 16),
                Text(_error!, textAlign: TextAlign.center,
                    style: const TextStyle(color: AppTheme.textSecondary)),
                const SizedBox(height: 24),
                ElevatedButton(onPressed: _load, child: const Text('Retry')),
              ]))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    // Scope badge
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'View scope: ${(_data?['scope'] as String? ?? '').toUpperCase()}',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.accent),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Overview metrics grid
                    const _SectionTitle(title: 'Overview'),
                    const SizedBox(height: 8),
                    _MetricsGrid(overview: _data?['overview'] as Map<String, dynamic>? ?? {}),
                    const SizedBox(height: 20),

                    // Message activity chart (simple bar)
                    const _SectionTitle(title: 'Message activity — last 7 days'),
                    const SizedBox(height: 8),
                    _ActivityChart(
                      rows: (_data?['message_activity'] as List?)?.cast<Map<String, dynamic>>() ?? [],
                    ),
                    const SizedBox(height: 20),

                    // Users by role breakdown
                    const _SectionTitle(title: 'Users by role'),
                    const SizedBox(height: 8),
                    ...((_data?['users_by_role'] as List?)?.cast<Map<String, dynamic>>() ?? [])
                        .map((r) => _RoleRow(role: r)),
                    const SizedBox(height: 20),

                    // Quick actions
                    const _SectionTitle(title: 'Quick actions'),
                    const SizedBox(height: 8),
                    _ActionCard(
                      icon: Icons.people,
                      title: 'Manage users',
                      subtitle: 'View, search, suspend accounts',
                      onTap: () => Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const UsersListScreen())),
                    ),
                    _ActionCard(
                      icon: Icons.flag,
                      title: 'Missionary overview',
                      subtitle: 'Active missionaries by mission',
                      onTap: () => Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const MissionaryOverviewScreen())),
                    ),
                    _ActionCard(
                      icon: Icons.admin_panel_settings,
                      title: 'Pending approvals',
                      subtitle: '${(_data?['overview']?['pending_approvals'] ?? 0)} accounts awaiting review',
                      onTap: () => Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const LeadersScreen())),
                    ),
                    _ActionCard(
                      icon: Icons.location_city,
                      title: 'Manage Stakes & Districts',
                      subtitle: 'Add, rename or remove stakes and districts',
                      onTap: () => Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const StakesManagementScreen())),
                    ),
                    const SizedBox(height: 40),
                  ],
                ),
              ),
  );
}

class _SectionTitle extends StatelessWidget {
  final String title;
  const _SectionTitle({required this.title});
  @override
  Widget build(BuildContext context) => Text(title.toUpperCase(),
    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
        color: AppTheme.textSecondary, letterSpacing: 1.1));
}

class _MetricsGrid extends StatelessWidget {
  final Map<String, dynamic> overview;
  const _MetricsGrid({required this.overview});
  @override
  Widget build(BuildContext context) => GridView.count(
    crossAxisCount: 2,
    shrinkWrap: true,
    physics: const NeverScrollableScrollPhysics(),
    crossAxisSpacing: 12, mainAxisSpacing: 12,
    childAspectRatio: 1.8,
    children: [
      _MetricCard(label: 'Online now',    value: '${overview['online_now'] ?? 0}',   color: AppTheme.success),
      _MetricCard(label: 'Missionaries',  value: '${overview['active_missionaries'] ?? 0}', color: AppTheme.missionary),
      _MetricCard(label: 'Pending approvals', value: '${overview['pending_approvals'] ?? 0}', color: AppTheme.danger),
      _MetricCard(label: 'MDM enrolled',  value: '${overview['mdm_enrolled'] ?? 0}', color: AppTheme.accentLight),
      _MetricCard(label: 'Active statuses', value: '${overview['active_statuses'] ?? 0}', color: AppTheme.accent),
      _MetricCard(label: 'Posting today', value: '${overview['users_posting_today'] ?? 0}', color: AppTheme.textSecondary),
    ],
  );
}

class _MetricCard extends StatelessWidget {
  final String label, value;
  final Color color;
  const _MetricCard({required this.label, required this.value, required this.color});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: color.withOpacity(0.08),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withOpacity(0.25)),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(value, style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: color)),
      const SizedBox(height: 2),
      Text(label, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
    ]),
  );
}

class _ActivityChart extends StatelessWidget {
  final List<Map<String, dynamic>> rows;
  const _ActivityChart({required this.rows});
  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return const Center(child: Padding(
        padding: EdgeInsets.all(24),
        child: Text('No message data yet', style: TextStyle(color: AppTheme.textSecondary)),
      ));
    }
    final maxVal = rows.map((r) => int.tryParse(r['messages']?.toString() ?? '0') ?? 0)
        .fold(0, (a, b) => a > b ? a : b);
    return Container(
      height: 120,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.divider),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: rows.map((r) {
          final count = int.tryParse(r['messages']?.toString() ?? '0') ?? 0;
          final frac  = maxVal > 0 ? count / maxVal : 0.0;
          final day   = (r['day']?.toString() ?? '').split('T').first.split('-').last;
          return Expanded(child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
              Text('$count', style: const TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
              const SizedBox(height: 2),
              Container(
                height: 60 * frac + 4,
                decoration: BoxDecoration(
                  color: AppTheme.accent.withOpacity(0.7),
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                ),
              ),
              const SizedBox(height: 2),
              Text(day, style: const TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
            ]),
          ));
        }).toList(),
      ),
    );
  }
}

class _RoleRow extends StatelessWidget {
  final Map<String, dynamic> role;
  const _RoleRow({required this.role});
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 6),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: AppTheme.divider),
    ),
    child: Row(children: [
      Expanded(child: Text(role['role'] ?? '', style: const TextStyle(fontWeight: FontWeight.w500, color: AppTheme.textPrimary))),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(
          color: AppTheme.accent.withOpacity(0.15), borderRadius: BorderRadius.circular(10)),
        child: Text('${role['count']}',
          style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.accent)),
      ),
      const SizedBox(width: 8),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: role['status'] == 'active'
              ? AppTheme.success.withOpacity(0.15) : AppTheme.danger.withOpacity(0.15),
          borderRadius: BorderRadius.circular(10)),
        child: Text(role['status'] ?? '',
          style: TextStyle(fontSize: 11,
            color: role['status'] == 'active' ? AppTheme.success : AppTheme.danger)),
      ),
    ]),
  );
}

class _ActionCard extends StatelessWidget {
  final IconData icon;
  final String title, subtitle;
  final VoidCallback onTap;
  const _ActionCard({required this.icon, required this.title, required this.subtitle, required this.onTap});
  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: 10),
    child: ListTile(
      leading: Container(
        width: 44, height: 44,
        decoration: BoxDecoration(
          color: AppTheme.accent.withOpacity(0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, color: AppTheme.accent),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 13)),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    ),
  );
}
