import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class StakesManagementScreen extends StatefulWidget {
  const StakesManagementScreen({super.key});
  @override
  State<StakesManagementScreen> createState() => _StakesManagementScreenState();
}

class _StakesManagementScreenState extends State<StakesManagementScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  late final TabController _tabs;

  List<Map<String, dynamic>> _stakes = [];
  List<Map<String, dynamic>> _districts = [];
  bool _loadingStakes = true;
  bool _loadingDistricts = true;
  String _stakeSearch = '';
  String _districtSearch = '';

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _loadAll();
  }

  @override
  void dispose() { _tabs.dispose(); super.dispose(); }

  Future<void> _loadAll() async {
    _loadStakes();
    _loadDistricts();
  }

  Future<void> _loadStakes() async {
    setState(() => _loadingStakes = true);
    try {
      final list = await _api.getList('/geography/stakes');
      if (mounted) {
        setState(() {
        _stakes = list.whereType<Map<String, dynamic>>().toList();
        _loadingStakes = false;
      });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingStakes = false);
    }
  }

  Future<void> _loadDistricts() async {
    setState(() => _loadingDistricts = true);
    try {
      final list = await _api.getList('/geography/districts');
      if (mounted) {
        setState(() {
        _districts = list.whereType<Map<String, dynamic>>().toList();
        _loadingDistricts = false;
      });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingDistricts = false);
    }
  }

  // ── Add ──────────────────────────────────────────────────────────────────
  Future<void> _showAddDialog({required bool isStake}) async {
    final nameCtrl    = TextEditingController();
    final countryCtrl = TextEditingController();
    final formKey     = GlobalKey<FormState>();
    bool saving = false;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          backgroundColor: AppTheme.primaryLight,
          title: Text('Add ${isStake ? 'Stake' : 'District'}',
              style: const TextStyle(color: AppTheme.textPrimary)),
          content: Form(
            key: formKey,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextFormField(
                controller: nameCtrl,
                decoration: InputDecoration(
                  labelText: '${isStake ? 'Stake' : 'District'} name *',
                  prefixIcon: const Icon(Icons.location_city),
                ),
                validator: (v) => (v?.isEmpty ?? true) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: countryCtrl,
                decoration: const InputDecoration(
                  labelText: 'Country',
                  prefixIcon: Icon(Icons.flag),
                  hintText: 'e.g. Nigeria',
                ),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: saving ? null : () async {
                if (!formKey.currentState!.validate()) return;
                setSt(() => saving = true);
                try {
                  final endpoint = isStake ? '/geography/stakes' : '/geography/districts';
                  await _api.post(endpoint, {
                    'name': nameCtrl.text.trim(),
                    if (countryCtrl.text.trim().isNotEmpty) 'country': countryCtrl.text.trim(),
                  });
                  if (ctx.mounted) Navigator.pop(ctx);
                  isStake ? _loadStakes() : _loadDistricts();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('${isStake ? 'Stake' : 'District'} added'),
                          backgroundColor: AppTheme.success));
                  }
                } catch (e) {
                  setSt(() => saving = false);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
                  }
                }
              },
              child: saving
                  ? const SizedBox(width: 18, height: 18,
                      child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Text('Add'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Rename ────────────────────────────────────────────────────────────────
  Future<void> _showRenameDialog(Map<String, dynamic> item, {required bool isStake}) async {
    final nameCtrl = TextEditingController(text: item['name'] as String? ?? '');
    final formKey  = GlobalKey<FormState>();
    bool saving = false;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          backgroundColor: AppTheme.primaryLight,
          title: Text('Rename ${isStake ? 'Stake' : 'District'}',
              style: const TextStyle(color: AppTheme.textPrimary)),
          content: Form(
            key: formKey,
            child: TextFormField(
              controller: nameCtrl,
              decoration: const InputDecoration(labelText: 'New name *'),
              validator: (v) => (v?.isEmpty ?? true) ? 'Required' : null,
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: saving ? null : () async {
                if (!formKey.currentState!.validate()) return;
                setSt(() => saving = true);
                try {
                  final id = item['id'] as String;
                  final endpoint = isStake
                      ? '/geography/stakes/$id'
                      : '/geography/districts/$id';
                  await _api.patch(endpoint, {'name': nameCtrl.text.trim()});
                  if (ctx.mounted) Navigator.pop(ctx);
                  isStake ? _loadStakes() : _loadDistricts();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Renamed successfully'),
                          backgroundColor: AppTheme.success));
                  }
                } catch (e) {
                  setSt(() => saving = false);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
                  }
                }
              },
              child: saving
                  ? const SizedBox(width: 18, height: 18,
                      child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  Future<void> _confirmDelete(Map<String, dynamic> item, {required bool isStake}) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.primaryLight,
        title: Text('Delete ${isStake ? 'Stake' : 'District'}?',
            style: const TextStyle(color: AppTheme.danger)),
        content: Text('Are you sure you want to delete "${item['name']}"?\n\n'
            'This will also remove the stake assignment from any users '
            'and pool members linked to it.',
            style: const TextStyle(color: AppTheme.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final id = item['id'] as String;
      final endpoint = isStake ? '/geography/stakes/$id' : '/geography/districts/$id';
      await _api.delete(endpoint);
      isStake ? _loadStakes() : _loadDistricts();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${isStake ? 'Stake' : 'District'} deleted'),
              backgroundColor: AppTheme.success));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Stakes & Districts'),
      bottom: TabBar(
        controller: _tabs,
        tabs: const [Tab(text: 'STAKES'), Tab(text: 'DISTRICTS')],
        indicatorColor: AppTheme.accent,
        labelColor: AppTheme.accent,
        unselectedLabelColor: AppTheme.textSecondary,
      ),
      actions: [
        IconButton(icon: const Icon(Icons.refresh), onPressed: _loadAll),
      ],
    ),
    floatingActionButton: FloatingActionButton.extended(
      backgroundColor: AppTheme.accent,
      foregroundColor: AppTheme.primary,
      icon: const Icon(Icons.add),
      label: AnimatedBuilder(
        animation: _tabs,
        builder: (_, __) => Text(_tabs.index == 0 ? 'Add Stake' : 'Add District'),
      ),
      onPressed: () => _showAddDialog(isStake: _tabs.index == 0),
    ),
    body: TabBarView(
      controller: _tabs,
      children: [
        _buildList(
          items: _stakes,
          loading: _loadingStakes,
          search: _stakeSearch,
          onSearch: (v) => setState(() => _stakeSearch = v),
          isStake: true,
        ),
        _buildList(
          items: _districts,
          loading: _loadingDistricts,
          search: _districtSearch,
          onSearch: (v) => setState(() => _districtSearch = v),
          isStake: false,
        ),
      ],
    ),
  );

  Widget _buildList({
    required List<Map<String, dynamic>> items,
    required bool loading,
    required String search,
    required ValueChanged<String> onSearch,
    required bool isStake,
  }) {
    if (loading) return const Center(child: CircularProgressIndicator());

    final filtered = search.isEmpty
        ? items
        : items.where((s) {
            final name    = (s['name']    as String? ?? '').toLowerCase();
            final country = (s['country'] as String? ?? '').toLowerCase();
            final q       = search.toLowerCase();
            return name.contains(q) || country.contains(q);
          }).toList();

    return Column(children: [
      // Search bar
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: TextField(
          onChanged: onSearch,
          decoration: InputDecoration(
            hintText: 'Search ${isStake ? 'stakes' : 'districts'}...',
            prefixIcon: const Icon(Icons.search),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12),
          ),
        ),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: Row(children: [
          Text('${filtered.length} ${isStake ? 'stake' : 'district'}(s)',
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
        ]),
      ),
      Expanded(
        child: filtered.isEmpty
            ? Center(child: Text(
                items.isEmpty
                  ? 'No ${isStake ? 'stakes' : 'districts'} yet.\nTap + to add one.'
                  : 'No results for "$search"',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppTheme.textSecondary)))
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (_, i) {
                  final item = filtered[i];
                  return ListTile(
                    leading: CircleAvatar(
                      backgroundColor: AppTheme.accent.withOpacity(0.15),
                      child: Icon(
                        isStake ? Icons.location_city : Icons.map_outlined,
                        color: AppTheme.accent, size: 20),
                    ),
                    title: Text(item['name'] as String? ?? '',
                        style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w500)),
                    subtitle: item['country'] != null
                        ? Text(item['country'] as String,
                            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12))
                        : null,
                    trailing: PopupMenuButton<String>(
                      color: AppTheme.primaryLight,
                      icon: const Icon(Icons.more_vert, color: AppTheme.textSecondary),
                      onSelected: (v) {
                        if (v == 'rename') _showRenameDialog(item, isStake: isStake);
                        if (v == 'delete') _confirmDelete(item, isStake: isStake);
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'rename', child: Row(children: [
                          Icon(Icons.edit, size: 18, color: AppTheme.accent),
                          SizedBox(width: 8),
                          Text('Rename', style: TextStyle(color: AppTheme.textPrimary)),
                        ])),
                        PopupMenuItem(value: 'delete', child: Row(children: [
                          Icon(Icons.delete_outline, size: 18, color: AppTheme.danger),
                          SizedBox(width: 8),
                          Text('Delete', style: TextStyle(color: AppTheme.danger)),
                        ])),
                      ],
                    ),
                  );
                },
              ),
      ),
    ]);
  }
}
