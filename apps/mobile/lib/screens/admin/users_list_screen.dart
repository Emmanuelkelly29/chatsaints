import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class UsersListScreen extends StatefulWidget {
  const UsersListScreen({super.key});
  @override
  State<UsersListScreen> createState() => _UsersListScreenState();
}

class _UsersListScreenState extends State<UsersListScreen> {
  final _api        = ApiService();
  final _searchCtrl = TextEditingController();
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  int _page = 1;
  int _total = 0;
  String? _filterRole;
  String? _filterStatus;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load({bool reset = false}) async {
    if (reset) setState(() { _page = 1; _users = []; });
    setState(() => _loading = true);
    try {
      final q = [
        if (_filterRole != null) 'role=$_filterRole',
        if (_filterStatus != null) 'status=$_filterStatus',
        if (_searchCtrl.text.trim().isNotEmpty) 'search=${Uri.encodeComponent(_searchCtrl.text.trim())}',
        'page=$_page', 'limit=30',
      ].join('&');
      final res = await _api.get('/admin/users?$q');
      if (mounted) {
        setState(() {
        _users   = [..._users, ...(res['users'] as List? ?? []).cast<Map<String, dynamic>>()];
        _total   = res['total'] ?? 0;
        _loading = false;
      });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _suspend(String userId, bool suspend) async {
    try {
      await _api.patch('/admin/users/$userId/suspend', {
        'suspended': suspend,
        'reason': suspend ? 'Admin action' : null,
      });
      _load(reset: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    }
  }

  void _showUserDetail(Map<String, dynamic> u) {
    final suspended = u['status'] == 'suspended';
    final approved = u['is_approved'] as bool? ?? false;
    final name = u['full_name'] ?? 'Unknown';
    final role = (u['role'] ?? '').toString().replaceAll('_', ' ');
    final phone = u['phone_number'] ?? 'N/A';
    final email = u['email'] ?? 'N/A';
    final dob = u['date_of_birth'] != null
        ? u['date_of_birth'].toString().substring(0, 10)
        : 'N/A';
    final createdAt = u['created_at'] != null
        ? u['created_at'].toString().substring(0, 10)
        : 'N/A';
    final missionary = u['missionary_mode_active'] == true;
    final stakeName = u['stake_name'] ?? 'None';

    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(children: [
          CircleAvatar(
            radius: 22,
            backgroundColor: AppTheme.primaryLight,
            backgroundImage: u['profile_photo_url'] != null
                ? NetworkImage(u['profile_photo_url']) : null,
            child: u['profile_photo_url'] == null
                ? Text(name[0].toUpperCase(),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 18))
                : null,
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              Text(role, style: const TextStyle(fontSize: 12, color: AppTheme.accent)),
            ],
          )),
        ]),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Divider(),
              _detailRow(Icons.phone, 'Phone', phone),
              _detailRow(Icons.email, 'Email', email),
              _detailRow(Icons.cake, 'Date of Birth', dob),
              _detailRow(Icons.church, 'Stake', stakeName),
              _detailRow(Icons.calendar_today, 'Joined', createdAt),
              _detailRow(Icons.verified_user,  'Approved', approved ? 'Yes' : 'No'),
              if (missionary)
                _detailRow(Icons.flag, 'Missionary', 'Active'),
              if (suspended)
                _detailRow(Icons.block, 'Status', 'Suspended'),
              if (!suspended)
                _detailRow(Icons.check_circle, 'Status', 'Active'),
            ],
          ),
        ),
        actions: [
          if (!suspended)
            TextButton(
              onPressed: () { Navigator.pop(context); _suspend(u['id'], true); },
              child: const Text('Suspend', style: TextStyle(color: AppTheme.danger)),
            ),
          if (suspended)
            TextButton(
              onPressed: () { Navigator.pop(context); _suspend(u['id'], false); },
              child: const Text('Reinstate', style: TextStyle(color: AppTheme.success)),
            ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _detailRow(IconData icon, String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(children: [
      Icon(icon, size: 18, color: AppTheme.accent),
      const SizedBox(width: 10),
      Text('$label: ', style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
      Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
    ]),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Manage users')),
    body: Column(children: [
      // Search + filters
      Padding(
        padding: const EdgeInsets.all(12),
        child: Column(children: [
          TextField(
            controller: _searchCtrl,
            onSubmitted: (_) => _load(reset: true),
            decoration: InputDecoration(
              hintText: 'Search name or phone…',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                icon: const Icon(Icons.clear),
                onPressed: () { _searchCtrl.clear(); _load(reset: true); },
              ),
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              _FilterChip(label: 'All roles', selected: _filterRole == null,
                onTap: () { setState(() => _filterRole = null); _load(reset: true); }),
              _FilterChip(label: 'YSA', selected: _filterRole == 'ysa_member',
                onTap: () { setState(() => _filterRole = 'ysa_member'); _load(reset: true); }),
              _FilterChip(label: 'Missionary', selected: _filterRole == 'missionary',
                onTap: () { setState(() => _filterRole = 'missionary'); _load(reset: true); }),
              _FilterChip(label: 'Bishop', selected: _filterRole == 'bishop',
                onTap: () { setState(() => _filterRole = 'bishop'); _load(reset: true); }),
              _FilterChip(label: 'Suspended', selected: _filterStatus == 'suspended',
                onTap: () {
                  setState(() => _filterStatus = _filterStatus == 'suspended' ? null : 'suspended');
                  _load(reset: true);
                }),
            ]),
          ),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Align(alignment: Alignment.centerLeft,
          child: Text('$_total user${_total != 1 ? 's' : ''}',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13))),
      ),
      const SizedBox(height: 4),
      Expanded(
        child: _loading && _users.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : ListView.builder(
                itemCount: _users.length + (_users.length < _total ? 1 : 0),
                itemBuilder: (_, i) {
                  if (i == _users.length) {
                    // Load more
                    if (!_loading) { _page++; _load(); }
                    return const Padding(
                      padding: EdgeInsets.all(16),
                      child: Center(child: CircularProgressIndicator()));
                  }
                  final u = _users[i];
                  final suspended = u['status'] == 'suspended';
                  return ListTile(
                    onTap: () => _showUserDetail(u),
                    leading: CircleAvatar(
                      backgroundColor: suspended
                          ? Colors.grey.shade300 : AppTheme.primaryLight,
                      child: Text(
                        (u['full_name'] as String? ?? '?')[0].toUpperCase(),
                        style: TextStyle(
                          color: suspended ? Colors.grey : Colors.white,
                          fontWeight: FontWeight.w600)),
                    ),
                    title: Text(u['full_name'] ?? '',
                      style: TextStyle(
                        decoration: suspended ? TextDecoration.lineThrough : null)),
                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(u['phone_number'] ?? '',
                        style: const TextStyle(fontSize: 12)),
                      Row(children: [
                        _StatusBadge(label: u['role'] ?? '', color: AppTheme.accent),
                        const SizedBox(width: 4),
                        if (suspended)
                          const _StatusBadge(label: 'Suspended', color: AppTheme.danger),
                        if (u['missionary_mode_active'] == true)
                          const _StatusBadge(label: 'Missionary', color: AppTheme.missionary),
                        if (!(u['is_approved'] as bool? ?? true))
                          const _StatusBadge(label: 'Pending', color: AppTheme.accent),
                      ]),
                    ]),
                    trailing: PopupMenuButton<String>(
                      onSelected: (action) {
                        if (action == 'suspend')  _suspend(u['id'], true);
                        if (action == 'reinstate') _suspend(u['id'], false);
                      },
                      itemBuilder: (_) => [
                        if (!suspended)
                          const PopupMenuItem(value: 'suspend',
                            child: Text('Suspend account', style: TextStyle(color: AppTheme.danger))),
                        if (suspended)
                          const PopupMenuItem(value: 'reinstate',
                            child: Text('Reinstate account', style: TextStyle(color: AppTheme.success))),
                      ],
                    ),
                  );
                },
              ),
      ),
    ]),
  );

  @override
  void dispose() { _searchCtrl.dispose(); super.dispose(); }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({required this.label, required this.selected, required this.onTap});
  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(
        color: selected ? AppTheme.accent : AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: selected ? AppTheme.accent : AppTheme.divider),
      ),
      child: Text(label, style: TextStyle(
        fontSize: 12, fontWeight: FontWeight.w500,
        color: selected ? AppTheme.primary : AppTheme.textPrimary)),
    ),
  );
}

class _StatusBadge extends StatelessWidget {
  final String label;
  final Color color;
  const _StatusBadge({required this.label, required this.color});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(
      color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(6)),
    child: Text(label.replaceAll('_', ' '), style: TextStyle(fontSize: 10, color: color)),
  );
}
