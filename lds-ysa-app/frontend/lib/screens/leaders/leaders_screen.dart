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
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _loadApprovals();
  }

  Future<void> _loadApprovals() async {
    try {
      final res = await _api.get('/leaders/approvals');
      final list = (res is List ? res : (res['data'] as List? ?? [])) as List<dynamic>;
      if (mounted) {
        setState(() {
        _approvals = list.whereType<Map<String,dynamic>>().toList();
        _loading = false;
      });
      }
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _approve(String id) async {
    await _api.post('/leaders/approvals/$id/approve', {});
    _loadApprovals();
  }

  Future<void> _reject(String id) async {
    await _api.post('/leaders/approvals/$id/reject', {'notes': 'Rejected by reviewer'});
    _loadApprovals();
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
        tabs: const [Tab(text: 'Approvals'), Tab(text: 'Stake Pool')],
      ),
    ),
    body: TabBarView(
      controller: _tabs,
      children: [
        // Approvals tab
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
                                  onPressed: () => _reject(a['id']),
                                  style: OutlinedButton.styleFrom(foregroundColor: AppTheme.danger),
                                  child: const Text('Reject'),
                                )),
                                const SizedBox(width: 12),
                                Expanded(child: ElevatedButton(
                                  onPressed: () => _approve(a['id']),
                                  child: const Text('Approve'),
                                )),
                              ]),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
        // Stake pool tab
        const Center(child: Text('Stake pool management\ncoming in next release',
            textAlign: TextAlign.center, style: TextStyle(color: AppTheme.textSecondary))),
      ],
    ),
  );

  @override
  void dispose() { _tabs.dispose(); super.dispose(); }
}
