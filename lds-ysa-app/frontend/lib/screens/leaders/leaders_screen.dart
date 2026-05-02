import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class LeadersScreen extends StatefulWidget {
  const LeadersScreen({super.key});
  @override
  State<LeadersScreen> createState() => _LeadersScreenState();
}

class _LeadersScreenState extends State<LeadersScreen> with SingleTickerProviderStateMixin {
  late TabController _tabs;
  final _api = ApiService();
  List<Map<String, dynamic>> _approvals = [];
  List<Map<String, dynamic>> _poolMembers = [];
  List<Map<String, dynamic>> _stakes = [];
  List<Map<String, dynamic>> _districts = [];
  bool _loading = true;
  bool _poolLoading = true;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _tabs.addListener(() {
      if (_tabs.index == 1 && _poolLoading) _loadPool();
    });
    _loadApprovals();
  }

  Future<void> _loadApprovals() async {
    try {
      final res = await _api.get('/leaders/approvals');
      final list = (res is List ? res : (res['data'] as List? ?? [])) as List<dynamic>;
      if (mounted) {
        setState(() {
          _approvals = list.whereType<Map<String, dynamic>>().toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadPool() async {
    try {
      final res = await _api.get('/ysa-pool/members');
      final list = (res['data'] as List? ?? []);
      final stakeList = (res['stakes'] as List? ?? []);
      final districtList = (res['districts'] as List? ?? []);
      if (mounted) {
        setState(() {
          _poolMembers = list.whereType<Map<String, dynamic>>().toList();
          _stakes = stakeList.whereType<Map<String, dynamic>>().toList();
          _districts = districtList.whereType<Map<String, dynamic>>().toList();
          _poolLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _poolLoading = false);
    }
  }

  Future<void> _approve(String id) async {
    await _api.post('/leaders/approvals/$id/approve', {});
    _loadApprovals();
  }

  Future<void> _reject(String id) async {
    await _api.post('/leaders/approvals/$id/reject', {'notes': 'Rejected by reviewer'});
    _loadApprovals();
  }

  Future<void> _approvePoolMember(String id) async {
    await _api.post('/ysa-pool/members/$id/approve', {});
    _loadPool();
  }

  Future<void> _removePoolMember(String id, String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove from Pool'),
        content: Text('Remove $name from the stake pool?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppTheme.danger),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _api.post('/ysa-pool/members/$id/remove', {});
      _loadPool();
    }
  }

  Future<void> _togglePool(String stakeId) async {
    await _api.post('/ysa-pool/toggle/$stakeId', {});
    _loadPool();
  }

  Future<void> _toggleDistrict(String districtId) async {
    await _api.post('/ysa-pool/toggle-district/$districtId', {});
    _loadPool();
  }

  String _formatRole(String? role) {
    if (role == null) return '';
    return role.replaceAll('_', ' ').split(' ').map((w) =>
      w.isNotEmpty ? '${w[0].toUpperCase()}${w.substring(1)}' : ''
    ).join(' ');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Leaders'),
      bottom: TabBar(
        controller: _tabs,
        labelColor: Colors.white,
        unselectedLabelColor: Colors.white70,
        indicatorColor: AppTheme.accent,
        tabs: const [Tab(text: 'Approvals'), Tab(text: 'Stake & District Pool')],
      ),
    ),
    body: TabBarView(
      controller: _tabs,
      children: [
        _loading
            ? const Center(child: CircularProgressIndicator())
            : _approvals.isEmpty
                ? const Center(child: Text('No pending approvals', style: TextStyle(color: AppTheme.textSecondary)))
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: _approvals.length,
                    itemBuilder: (_, i) {
                      final a = _approvals[i];
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(a['full_name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                              const SizedBox(height: 4),
                              Text('Role requested: ${a['declared_role'] ?? ''}',
                                  style: const TextStyle(color: AppTheme.accent)),
                              Text('Phone: ${a['phone_number'] ?? ''}',
                                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                              if (a['stake_name'] != null)
                                Text('Stake: ${a['stake_name']}',
                                    style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                              const SizedBox(height: 12),
                              Row(children: [
                                Expanded(child: OutlinedButton(
                                  onPressed: () => _reject('${a['id']}'),
                                  style: OutlinedButton.styleFrom(foregroundColor: AppTheme.danger),
                                  child: const Text('Reject'),
                                )),
                                const SizedBox(width: 12),
                                Expanded(child: ElevatedButton(
                                  onPressed: () => _approve('${a['id']}'),
                                  child: const Text('Approve'),
                                )),
                              ]),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
        _poolLoading
            ? const Center(child: CircularProgressIndicator())
            : _buildPoolTab(),
      ],
    ),
  );

  Widget _buildPoolTab() {
    final pending = _poolMembers.where((m) => m['approved'] != true).toList();
    final approved = _poolMembers.where((m) => m['approved'] == true).toList();

    return RefreshIndicator(
      onRefresh: _loadPool,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (_stakes.isNotEmpty || _districts.isNotEmpty) ...[
            const Text('Stake & District Pool Status',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: Colors.white)),
            const SizedBox(height: 8),
            ..._stakes.map((s) => Card(
              child: ListTile(
                leading: Icon(
                  s['ysa_pool_active'] == true ? Icons.lock_open : Icons.lock_outline,
                  color: s['ysa_pool_active'] == true ? AppTheme.success : AppTheme.textSecondary,
                ),
                title: Text(s['name'] ?? 'Unknown Stake',
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                subtitle: Text(
                  s['ysa_pool_active'] == true ? 'Pool is OPEN' : 'Pool is CLOSED',
                  style: TextStyle(
                    color: s['ysa_pool_active'] == true ? AppTheme.success : AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
                trailing: Switch(
                  value: s['ysa_pool_active'] == true,
                  activeThumbColor: AppTheme.accent,
                  onChanged: (_) => _togglePool('${s['id']}'),
                ),
              ),
            )),
            ..._districts.map((d) => Card(
              child: ListTile(
                leading: Icon(
                  d['ysa_pool_active'] == true ? Icons.lock_open : Icons.lock_outline,
                  color: d['ysa_pool_active'] == true ? AppTheme.success : AppTheme.textSecondary,
                ),
                title: Row(
                  children: [
                    Expanded(child: Text(d['name'] ?? 'Unknown District',
                        style: const TextStyle(fontWeight: FontWeight.w500))),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('District',
                          style: TextStyle(color: AppTheme.accent, fontSize: 10)),
                    ),
                  ],
                ),
                subtitle: Text(
                  d['ysa_pool_active'] == true ? 'Pool is OPEN' : 'Pool is CLOSED',
                  style: TextStyle(
                    color: d['ysa_pool_active'] == true ? AppTheme.success : AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
                trailing: Switch(
                  value: d['ysa_pool_active'] == true,
                  activeThumbColor: AppTheme.accent,
                  onChanged: (_) => _toggleDistrict('${d['id']}'),
                ),
              ),
            )),
            const SizedBox(height: 16),
          ],
          if (pending.isNotEmpty) ...[
            Row(children: [
              const Icon(Icons.pending_actions, color: AppTheme.accent, size: 20),
              const SizedBox(width: 8),
              Text('Pending Approval (${pending.length})',
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: AppTheme.accent)),
            ]),
            const SizedBox(height: 8),
            ...pending.map((m) => _poolMemberCard(m, isPending: true)),
            const SizedBox(height: 16),
          ],
          Row(children: [
            const Icon(Icons.check_circle_outline, color: AppTheme.success, size: 20),
            const SizedBox(width: 8),
            Text('Approved Members (${approved.length})',
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: AppTheme.success)),
          ]),
          const SizedBox(height: 8),
          if (approved.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('No approved pool members yet',
                  style: TextStyle(color: AppTheme.textSecondary))),
            )
          else
            ...approved.map((m) => _poolMemberCard(m, isPending: false)),
        ],
      ),
    );
  }

  Widget _poolMemberCard(Map<String, dynamic> m, {required bool isPending}) {
    final photoUrl = m['profile_photo_url'] as String?;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            CircleAvatar(
              radius: 22,
              backgroundColor: AppTheme.accent.withValues(alpha: 0.2),
              backgroundImage: photoUrl != null && photoUrl.isNotEmpty ? NetworkImage(photoUrl) : null,
              child: photoUrl == null || photoUrl.isEmpty
                  ? Text((m['full_name'] ?? '?')[0].toUpperCase(),
                      style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.bold))
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m['full_name'] ?? '',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  Text(_formatRole(m['role']),
                      style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                  if (m['stake_name'] != null)
                    Text(m['stake_name'],
                        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                  if (m['phone_number'] != null)
                    Text(m['phone_number'],
                        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                ],
              ),
            ),
            if (isPending) ...[
              IconButton(
                icon: const Icon(Icons.check_circle, color: AppTheme.success),
                tooltip: 'Approve',
                onPressed: () => _approvePoolMember('${m['id']}'),
              ),
              IconButton(
                icon: const Icon(Icons.remove_circle, color: AppTheme.danger),
                tooltip: 'Remove',
                onPressed: () => _removePoolMember('${m['id']}', m['full_name'] ?? ''),
              ),
            ] else
              IconButton(
                icon: const Icon(Icons.remove_circle_outline, color: AppTheme.danger),
                tooltip: 'Remove',
                onPressed: () => _removePoolMember('${m['id']}', m['full_name'] ?? ''),
              ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }
}