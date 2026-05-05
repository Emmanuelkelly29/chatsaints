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
  static const List<String> _continents = [
    'Africa', 'North America', 'South America', 'Europe', 'Asia', 'Oceania',
  ];

  final _api = ApiService();
  late final TabController _tabs;

  List<Map<String, dynamic>> _stakes = [];
  List<Map<String, dynamic>> _districts = [];
  bool _loadingStakes = true;
  bool _loadingDistricts = true;
  String _stakeSearch = '';
  String _districtSearch = '';
  String _continentFilter = 'All';
  // continent -> set of expanded letters
  final Map<String, Set<String>> _expandedLetters = {};

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _tabs.addListener(() => setState(() {}));
    _loadAll();
  }

  @override
  void dispose() { _tabs.dispose(); super.dispose(); }

  // ── Helpers ───────────────────────────────────────────────────────────────

  List<String> _availableContinents(List<Map<String, dynamic>> items) {
    final seen = <String>{};
    for (final item in items) {
      final c = (item['continent'] ?? '').toString().trim();
      if (c.isNotEmpty) seen.add(c);
    }
    final list = seen.toList()..sort();
    return ['All', ...list];
  }

  List<Map<String, dynamic>> _filtered(
      List<Map<String, dynamic>> items, String search) {
    final q = search.trim().toLowerCase();
    return items.where((item) {
      final name = (item['name'] ?? '').toString().toLowerCase();
      final country = (item['country'] ?? '').toString().toLowerCase();
      final continent = (item['continent'] ?? '').toString();
      final continentOk =
          _continentFilter == 'All' || continent == _continentFilter;
      final queryOk = q.isEmpty || name.contains(q) || country.contains(q);
      return continentOk && queryOk;
    }).toList();
  }

  /// Groups items: continent -> first-letter-of-country -> country -> [items]
  Map<String, Map<String, Map<String, List<Map<String, dynamic>>>>> _groupByLetterAndCountry(
      List<Map<String, dynamic>> items) {
    final result =
        <String, Map<String, Map<String, List<Map<String, dynamic>>>>>{};
    for (final item in items) {
      final continent = (item['continent'] ?? '').toString().trim();
      final country = (item['country'] ?? 'Unknown').toString().trim();
      final letter = country.isNotEmpty ? country[0].toUpperCase() : '?';
      result.putIfAbsent(continent, () => {});
      result[continent]!.putIfAbsent(letter, () => {});
      result[continent]![letter]!.putIfAbsent(country, () => []);
      result[continent]![letter]![country]!.add(item);
    }
    for (final contMap in result.values) {
      for (final letterMap in contMap.values) {
        for (final units in letterMap.values) {
          units.sort((a, b) =>
              (a['name'] ?? '').toString().compareTo((b['name'] ?? '').toString()));
        }
      }
    }
    return result;
  }

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
    String selectedContinent = _continents.first;
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
                  labelText: 'Country *',
                  prefixIcon: Icon(Icons.flag),
                  hintText: 'e.g. Nigeria',
                ),
                validator: (v) => (v?.isEmpty ?? true) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: selectedContinent,
                decoration: const InputDecoration(
                  labelText: 'Continent',
                  prefixIcon: Icon(Icons.public),
                ),
                items: _continents
                    .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                    .toList(),
                onChanged: (v) { if (v != null) setSt(() => selectedContinent = v); },
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
                    'country': countryCtrl.text.trim(),
                    'continent': selectedContinent,
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
        _buildHierarchicalList(
          items: _stakes,
          loading: _loadingStakes,
          search: _stakeSearch,
          onSearch: (v) => setState(() => _stakeSearch = v),
          isStake: true,
        ),
        _buildHierarchicalList(
          items: _districts,
          loading: _loadingDistricts,
          search: _districtSearch,
          onSearch: (v) => setState(() => _districtSearch = v),
          isStake: false,
        ),
      ],
    ),
  );

  Widget _buildHierarchicalList({
    required List<Map<String, dynamic>> items,
    required bool loading,
    required String search,
    required ValueChanged<String> onSearch,
    required bool isStake,
  }) {
    if (loading) return const Center(child: CircularProgressIndicator());

    final availContinents = _availableContinents(items);
    final filtered = _filtered(items, search);
    final unmapped = filtered
        .where((i) => (i['continent'] ?? '').toString().trim().isEmpty)
        .toList();
    final mapped = filtered
        .where((i) => (i['continent'] ?? '').toString().trim().isNotEmpty)
        .toList();
    final grouped = _groupByLetterAndCountry(mapped);
    final sortedContinents = grouped.keys.toList()..sort();

    return RefreshIndicator(
      onRefresh: isStake ? _loadStakes : _loadDistricts,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 100),
        children: [
          // ── Search bar ─────────────────────────────────────────────
          TextField(
            onChanged: onSearch,
            decoration: InputDecoration(
              hintText: 'Search ${isStake ? 'stakes' : 'districts'}...',
              prefixIcon: const Icon(Icons.search),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12),
            ),
          ),
          const SizedBox(height: 8),
          // ── Continent filter ───────────────────────────────────────
          DropdownButtonFormField<String>(
            initialValue: availContinents.contains(_continentFilter) ? _continentFilter : 'All',
            decoration: const InputDecoration(labelText: 'Filter by continent'),
            items: availContinents
                .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                .toList(),
            onChanged: (v) { if (v != null) setState(() => _continentFilter = v); },
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              '${filtered.length} ${isStake ? 'stake' : 'district'}(s)',
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
          ),
          // ── Unmapped (no continent) ────────────────────────────────
          if (unmapped.isNotEmpty)
            Card(
              color: AppTheme.danger.withValues(alpha: 0.1),
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(children: [
                      Icon(Icons.warning_amber_rounded, color: AppTheme.danger, size: 16),
                      SizedBox(width: 6),
                      Text('No Continent Assigned',
                          style: TextStyle(color: AppTheme.danger,
                              fontWeight: FontWeight.w700, fontSize: 13)),
                    ]),
                    const SizedBox(height: 4),
                    const Text(
                      'These units are hidden from continent groups until a continent is assigned via the YSA Pool tab.',
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                    ),
                    const SizedBox(height: 8),
                    ...unmapped.map((item) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(children: [
                        Icon(isStake ? Icons.location_city : Icons.map_outlined,
                            color: AppTheme.textSecondary, size: 14),
                        const SizedBox(width: 8),
                        Expanded(child: Text(
                          '${item['name'] ?? ''}'
                          '${item['country'] != null ? ' — ${item['country']}' : ''}',
                          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                        )),
                        _itemMenu(item, isStake: isStake),
                      ]),
                    )),
                  ],
                ),
              ),
            ),
          // ── Empty state ────────────────────────────────────────────
          if (filtered.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(top: 40),
                child: Text(
                  items.isEmpty
                      ? 'No ${isStake ? 'stakes' : 'districts'} yet.\nTap + to add one.'
                      : 'No results for "$search"',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppTheme.textSecondary),
                ),
              ),
            ),
          // ── Continent → Letter → Country → Units ──────────────────
          ...sortedContinents.map((continent) {
            final letterMap = grouped[continent]!;
            final sortedLetters = letterMap.keys.toList()..sort();
            final total = letterMap.values.fold<int>(
                0, (s, m) => s + m.values.fold(0, (a, b) => a + b.length));

            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ExpansionTile(
                initiallyExpanded: sortedContinents.length == 1,
                tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                title: Row(children: [
                  const Icon(Icons.public, size: 16, color: AppTheme.accent),
                  const SizedBox(width: 8),
                  Text(continent,
                      style: const TextStyle(color: AppTheme.accent,
                          fontWeight: FontWeight.w700, fontSize: 13)),
                  const Spacer(),
                  Text('$total',
                      style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                ]),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                    child: Column(
                      children: sortedLetters.map((letter) {
                        final countryMap = letterMap[letter]!;
                        final sortedCountries = countryMap.keys.toList()..sort();
                        final letterCount =
                            countryMap.values.fold<int>(0, (s, l) => s + l.length);
                        final isExpanded =
                            _expandedLetters[continent]?.contains(letter) ?? false;

                        return Column(children: [
                          InkWell(
                            onTap: () => setState(() {
                              _expandedLetters.putIfAbsent(continent, () => {});
                              if (isExpanded) {
                                _expandedLetters[continent]!.remove(letter);
                              } else {
                                _expandedLetters[continent]!.add(letter);
                              }
                            }),
                            borderRadius: BorderRadius.circular(6),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                              child: Row(children: [
                                Icon(
                                  isExpanded ? Icons.expand_less : Icons.chevron_right,
                                  color: AppTheme.accent, size: 20,
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  width: 28, height: 28,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    color: AppTheme.accent.withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(letter,
                                      style: const TextStyle(color: AppTheme.accent,
                                          fontWeight: FontWeight.w800, fontSize: 14)),
                                ),
                                const SizedBox(width: 10),
                                Text('$letterCount item${letterCount == 1 ? '' : 's'}',
                                    style: const TextStyle(
                                        color: AppTheme.textSecondary, fontSize: 12)),
                              ]),
                            ),
                          ),
                          if (isExpanded)
                            Padding(
                              padding: const EdgeInsets.only(left: 12),
                              child: Column(
                                children: sortedCountries.map((country) {
                                  final units = countryMap[country]!;
                                  return Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Padding(
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 6, horizontal: 4),
                                        child: Row(children: [
                                          const Icon(Icons.flag_outlined,
                                              size: 13, color: Colors.white54),
                                          const SizedBox(width: 6),
                                          Text(country,
                                              style: const TextStyle(
                                                  color: Colors.white70,
                                                  fontWeight: FontWeight.w600,
                                                  fontSize: 12)),
                                        ]),
                                      ),
                                      ...units.map((item) =>
                                          _unitRow(item, isStake: isStake)),
                                    ],
                                  );
                                }).toList(),
                              ),
                            ),
                          if (sortedLetters.indexOf(letter) < sortedLetters.length - 1)
                            const Divider(height: 1, indent: 8),
                        ]);
                      }).toList(),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _unitRow(Map<String, dynamic> item, {required bool isStake}) {
    final name = (item['name'] ?? '').toString();
    final cc = (item['coordinating_council_name'] ?? '').toString();
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: AppTheme.primaryLight.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
      ),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
        leading: Icon(isStake ? Icons.location_city : Icons.map_outlined,
            color: AppTheme.accent, size: 18),
        title: Text(name,
            style: const TextStyle(color: AppTheme.textPrimary,
                fontWeight: FontWeight.w500, fontSize: 13)),
        subtitle: cc.isNotEmpty
            ? Text(cc,
                style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11))
            : null,
        trailing: _itemMenu(item, isStake: isStake),
      ),
    );
  }

  Widget _itemMenu(Map<String, dynamic> item, {required bool isStake}) {
    return PopupMenuButton<String>(
      color: AppTheme.primaryLight,
      icon: const Icon(Icons.more_vert, color: AppTheme.textSecondary, size: 18),
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
    );
  }
}
