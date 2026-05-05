import 'package:flutter/material.dart';
import '../../services/auth_service.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class LeadersScreen extends StatefulWidget {
  const LeadersScreen({super.key});
  @override
  State<LeadersScreen> createState() => _LeadersScreenState();
}

class _LeadersScreenState extends State<LeadersScreen> with SingleTickerProviderStateMixin {
  static const Set<String> _globalRoles = {
    'area_authority',
    'area_presidency',
    'general_authority',
    'apostle',
    'first_presidency',
  };

  static const List<String> _continents = [
    'Africa',
    'North America',
    'South America',
    'Europe',
    'Asia',
    'Oceania',
  ];

  late TabController _tabs;
  final _api = ApiService();
  final TextEditingController _poolSearchController = TextEditingController();
  List<Map<String, dynamic>> _approvals = [];
  List<Map<String, dynamic>> _stakes = [];
  List<Map<String, dynamic>> _districts = [];
  List<Map<String, dynamic>> _skippedUnits = [];
  bool _loading = true;
  bool _poolLoading = true;
  bool _bulkUpdating = false;
  String _poolSearch = '';
  String _continentFilter = 'All';
  final Map<String, Set<String>> _expandedLetters = {}; // continent -> set of expanded letters

  String? get _viewerRole => AuthService().currentUser?.role;
  bool get _isItSupport => _viewerRole == 'it_support';
  bool get _isGlobalAdmin => _globalRoles.contains(_viewerRole);
  bool get _showPowerBadge => _isItSupport || _isGlobalAdmin;

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
      final res = await _api.get('/ysa-pool/members?includeMembers=false');
      final stakeList = (res['stakes'] as List? ?? []);
      final districtList = (res['districts'] as List? ?? []);
      final skippedList = (res['skipped_units'] as List? ?? []);
      if (mounted) {
        setState(() {
          _stakes = stakeList.whereType<Map<String, dynamic>>().toList();
          _districts = districtList.whereType<Map<String, dynamic>>().toList();
          _skippedUnits = skippedList.whereType<Map<String, dynamic>>().toList();
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

  Future<void> _togglePool(String stakeId) async {
    await _api.post('/ysa-pool/toggle/$stakeId', {});
    _loadPool();
  }

  Future<void> _toggleDistrict(String districtId) async {
    await _api.post('/ysa-pool/toggle-district/$districtId', {});
    _loadPool();
  }

  Future<void> _setAllPoolStatus(bool active) async {
    setState(() => _bulkUpdating = true);
    try {
      await _api.post('/ysa-pool/toggle-all', {
        'active': active,
        'target': 'all',
        'continent': _continentFilter == 'All' ? null : _continentFilter,
        'query': _poolSearch.trim().isEmpty ? null : _poolSearch.trim(),
      });
      await _loadPool();
    } finally {
      if (mounted) setState(() => _bulkUpdating = false);
    }
  }

  Future<void> _deletePoolUnit(String type, String id, String unitName) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Unit?'),
        content: Text('Are you sure you want to delete "$unitName"?\n\nThis action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.danger),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      // Send DELETE request to backend
      await _api.delete('/ysa-pool/units/$type/$id');
      await _loadPool();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Unit deleted successfully'), backgroundColor: AppTheme.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppTheme.danger),
        );
      }
    }
  }

  Future<void> _editUnitLocation(Map<String, dynamic> unit) async {
    if (!_showPowerBadge) return;
    final unitType = (unit['unit_type'] ?? '').toString();
    final id = (unit['id'] ?? '').toString();
    if (unitType.isEmpty || id.isEmpty) return;

    final countryController = TextEditingController(text: (unit['country'] ?? '').toString());
    String selectedContinent = (unit['continent'] ?? unit['unit_continent'] ?? unit['area_continent'] ?? '').toString();
    if (!_continents.contains(selectedContinent)) {
      selectedContinent = _continents.first;
    }

    final shouldSave = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: Text('Edit ${unitType[0].toUpperCase()}${unitType.substring(1)} Location'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: countryController,
                  decoration: const InputDecoration(
                    labelText: 'Country',
                    prefixIcon: Icon(Icons.flag),
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: selectedContinent,
                  decoration: const InputDecoration(
                    labelText: 'Continent',
                    prefixIcon: Icon(Icons.public),
                  ),
                  items: _continents
                      .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                      .toList(),
                  onChanged: (value) {
                    if (value == null) return;
                    setDialogState(() => selectedContinent = value);
                  },
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
              ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
            ],
          ),
        );
      },
    );

    if (shouldSave != true) return;
    final country = countryController.text.trim();
    if (country.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Country is required')),
        );
      }
      return;
    }

    try {
      await _api.patch('/ysa-pool/units/$unitType/$id/location', {
        'country': country,
        'continent': selectedContinent,
      });
      await _loadPool();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Location updated successfully'), backgroundColor: AppTheme.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger),
        );
      }
    }
  }

  List<String> _allContinents() {
    final values = <String>{};
    for (final item in [..._stakes, ..._districts]) {
      final continent = (item['continent'] ?? '').toString().trim();
      if (continent.isNotEmpty) values.add(continent);
    }
    final list = values.toList()..sort();
    return ['All', ...list];
  }

  bool _matchesPoolFilters(Map<String, dynamic> item) {
    final continent = (item['continent'] ?? '').toString().trim();
    final name = (item['name'] ?? '').toString();
    final country = (item['country'] ?? '').toString();
    final query = _poolSearch.trim().toLowerCase();
    final continentOk = _continentFilter == 'All' || continent == _continentFilter;
    final queryOk = query.isEmpty || '$name $country $continent'.toLowerCase().contains(query);
    return continentOk && queryOk;
  }

  int _poolSort(Map<String, dynamic> a, Map<String, dynamic> b) {
    final ca = (a['continent'] ?? 'ZZZ').toString();
    final cb = (b['continent'] ?? 'ZZZ').toString();
    final continentCmp = ca.compareTo(cb);
    if (continentCmp != 0) return continentCmp;
    return (a['name'] ?? '').toString().compareTo((b['name'] ?? '').toString());
  }

  List<Map<String, dynamic>> _filteredAndSorted(List<Map<String, dynamic>> source) {
    final list = source.where(_matchesPoolFilters).toList();
    list.sort(_poolSort);
    return list;
  }

  Map<String, List<Map<String, dynamic>>> _groupPoolUnitsByContinent({
    required List<Map<String, dynamic>> stakes,
    required List<Map<String, dynamic>> districts,
  }) {
    final grouped = <String, List<Map<String, dynamic>>>{};

    for (final s in stakes) {
      final continent = (s['continent'] ?? '').toString().trim();
      if (continent.isEmpty) continue;
      grouped.putIfAbsent(continent, () => <Map<String, dynamic>>[]).add({
        ...s,
        'is_district': false,
      });
    }

    for (final d in districts) {
      final continent = (d['continent'] ?? '').toString().trim();
      if (continent.isEmpty) continue;
      grouped.putIfAbsent(continent, () => <Map<String, dynamic>>[]).add({
        ...d,
        'is_district': true,
      });
    }

    for (final entry in grouped.entries) {
      entry.value.sort((a, b) {
        final nameCmp = (a['name'] ?? '').toString().compareTo((b['name'] ?? '').toString());
        if (nameCmp != 0) return nameCmp;
        final aDistrict = a['is_district'] == true ? 1 : 0;
        final bDistrict = b['is_district'] == true ? 1 : 0;
        return aDistrict.compareTo(bDistrict);
      });
    }

    return grouped;
  }

  /// Groups pool units by continent -> first letter -> country
  Map<String, Map<String, Map<String, List<Map<String, dynamic>>>>> _groupPoolByLetterAndCountry({
    required List<Map<String, dynamic>> units,
  }) {
    final result = <String, Map<String, Map<String, List<Map<String, dynamic>>>>>{};

    for (final unit in units) {
      final continent = (unit['continent'] ?? '').toString().trim();
      if (continent.isEmpty) continue;

      final country = (unit['country'] ?? 'Unknown').toString();
      final firstLetter = country.isNotEmpty ? country[0].toUpperCase() : '?';

      result.putIfAbsent(continent, () => {});
      result[continent]!.putIfAbsent(firstLetter, () => {});
      result[continent]![firstLetter]!.putIfAbsent(country, () => []);
      result[continent]![firstLetter]![country]!.add(unit);
    }

    return result;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Leaders'),
      actions: [
        if (_showPowerBadge)
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppTheme.accent.withValues(alpha: 0.45)),
                ),
                child: Text(
                  _isItSupport ? 'IT SUPPORT FULL ACCESS' : 'GLOBAL ADMIN ACCESS',
                  style: const TextStyle(
                    color: AppTheme.accent,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                  ),
                ),
              ),
            ),
          ),
      ],
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
        _loading ? const Center(child: CircularProgressIndicator()) : _buildApprovalsTab(),
        _poolLoading
            ? const Center(child: CircularProgressIndicator())
            : _buildPoolTab(),
      ],
    ),
  );

  Widget _buildApprovalsTab() {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (_showPowerBadge)
          Card(
            color: AppTheme.accent.withValues(alpha: 0.12),
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Worldwide pending leader approvals are listed below across all categories and stakes.',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
              ),
            ),
          ),
        if (_showPowerBadge)
          const SizedBox(height: 8),
        if (_approvals.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 30),
            child: Center(
              child: Text('No pending approvals', style: TextStyle(color: AppTheme.textSecondary)),
            ),
          )
        else
          ..._approvals.map((a) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(a['full_name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                      const SizedBox(height: 4),
                      Text('Role requested: ${a['declared_role'] ?? ''}',
                          style: const TextStyle(color: AppTheme.accent)),
                      const SizedBox(height: 4),
                      const Text('Approvals here are for new leader sign-ups only.',
                          style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
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
              )),
      ],
    );
  }

  Widget _buildPoolTab() {
    final continents = _allContinents();
    final visibleStakes = _filteredAndSorted(_stakes);
    final visibleDistricts = _filteredAndSorted(_districts);
    final allVisibleUnits = [...visibleStakes.map((s) => {...s, 'is_district': false}),
      ...visibleDistricts.map((d) => {...d, 'is_district': true})];
    final groupedByLetter = _groupPoolByLetterAndCountry(units: allVisibleUnits);
    final sortedContinents = groupedByLetter.keys.toList()..sort();

    return RefreshIndicator(
      onRefresh: _loadPool,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (_showPowerBadge && _skippedUnits.isNotEmpty)
            Card(
              color: AppTheme.danger.withValues(alpha: 0.1),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.warning_amber_rounded, color: AppTheme.danger, size: 18),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Unmapped Pool Units',
                            style: TextStyle(
                              color: AppTheme.danger,
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'These units are hidden from continent groups until country is mapped to a continent.',
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: 8),
                    ..._skippedUnits.map((u) {
                      final type = (u['unit_type'] ?? '').toString();
                      final name = (u['name'] ?? 'Unknown').toString();
                      final country = (u['country'] ?? '').toString();
                      return InkWell(
                        onTap: () => _editUnitLocation(u),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '• ${type.toUpperCase()}: $name${country.isNotEmpty ? ' ($country)' : ''}',
                                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                                ),
                              ),
                              const Icon(Icons.edit, size: 14, color: AppTheme.accent),
                            ],
                          ),
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
          if (_showPowerBadge && _skippedUnits.isNotEmpty)
            const SizedBox(height: 10),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Pool Controls',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _poolSearchController,
                    onChanged: (v) => setState(() => _poolSearch = v),
                    decoration: const InputDecoration(
                      hintText: 'Search stake or district',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: continents.contains(_continentFilter) ? _continentFilter : 'All',
                    decoration: const InputDecoration(
                      labelText: 'Filter by continent',
                    ),
                    items: continents
                        .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                        .toList(),
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() => _continentFilter = value);
                    },
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _bulkUpdating ? null : () => _setAllPoolStatus(true),
                          icon: const Icon(Icons.toggle_on),
                          label: const Text('Turn ON All Visible'),
                          style: ElevatedButton.styleFrom(backgroundColor: AppTheme.success),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _bulkUpdating ? null : () => _setAllPoolStatus(false),
                          icon: const Icon(Icons.toggle_off),
                          label: const Text('Turn OFF All Visible'),
                          style: ElevatedButton.styleFrom(backgroundColor: AppTheme.danger),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          if (_stakes.isNotEmpty || _districts.isNotEmpty) ...[
            const Text('Stake & District Pool Status',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: Colors.white)),
            const SizedBox(height: 8),
            ...sortedContinents.map((continent) {
              final letterMap = groupedByLetter[continent]!;
              final sortedLetters = letterMap.keys.toList()..sort();

              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ExpansionTile(
                  initiallyExpanded: sortedContinents.length == 1,
                  tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  title: Row(
                    children: [
                      const Icon(Icons.public, size: 16, color: AppTheme.accent),
                      const SizedBox(width: 8),
                      Text(
                        continent,
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${allVisibleUnits.where((u) => (u['continent'] ?? '').toString() == continent).length}',
                        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                      ),
                    ],
                  ),
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(8),
                      child: Column(
                        children: sortedLetters.map((letter) {
                          final countryMap = letterMap[letter]!;
                          final sortedCountries = countryMap.keys.toList()..sort();
                          final isExpanded = _expandedLetters[continent]?.contains(letter) ?? false;

                          return Column(
                            children: [
                              InkWell(
                                onTap: () {
                                  setState(() {
                                    _expandedLetters.putIfAbsent(continent, () => {});
                                    if (isExpanded) {
                                      _expandedLetters[continent]!.remove(letter);
                                    } else {
                                      _expandedLetters[continent]!.add(letter);
                                    }
                                  });
                                },
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                                  child: Row(
                                    children: [
                                      Icon(
                                        isExpanded ? Icons.expand_less : Icons.chevron_right,
                                        color: AppTheme.accent,
                                        size: 20,
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        letter,
                                        style: const TextStyle(
                                          color: AppTheme.accent,
                                          fontWeight: FontWeight.w700,
                                          fontSize: 14,
                                        ),
                                      ),
                                      const Spacer(),
                                      Text(
                                        '${countryMap.values.fold<int>(0, (sum, list) => sum + list.length)} items',
                                        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              if (isExpanded)
                                Padding(
                                  padding: const EdgeInsets.only(left: 16),
                                  child: Column(
                                    children: sortedCountries.map((country) {
                                      final units = countryMap[country]!;
                                      return Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Padding(
                                            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                                            child: Text(
                                              country,
                                              style: const TextStyle(
                                                color: Colors.white70,
                                                fontWeight: FontWeight.w600,
                                                fontSize: 12,
                                              ),
                                            ),
                                          ),
                                          ...units.map((unit) => _poolUnitCard(unit, isDistrict: unit['is_district'] == true)),
                                        ],
                                      );
                                    }).toList(),
                                  ),
                                ),
                              if (sortedLetters.indexOf(letter) < sortedLetters.length - 1)
                                const Divider(height: 1),
                            ],
                          );
                        }).toList(),
                      ),
                    ),
                  ],
                ),
              );
            }),
            if (visibleStakes.isEmpty && visibleDistricts.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('No stake or district matched your filter.',
                    style: TextStyle(color: AppTheme.textSecondary)),
              ),
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }

  Widget _poolUnitCard(Map<String, dynamic> item, {required bool isDistrict}) {
    final name = (item['name'] ?? '').toString();
    final continent = (item['continent'] ?? '').toString();
    final country = (item['country'] ?? '').toString();
    final isActive = item['ysa_pool_active'] == true;
    final id = (item['id'] ?? '').toString();

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Row(
          children: [
            Icon(
              isActive ? Icons.lock_open : Icons.lock_outline,
              color: isActive ? AppTheme.success : AppTheme.textSecondary,
              size: 18,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name.isEmpty ? (isDistrict ? 'Unknown District' : 'Unknown Stake') : name,
                    style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13),
                  ),
                  Row(
                    children: [
                      Text(
                        isActive ? 'OPEN' : 'CLOSED',
                        style: TextStyle(
                          color: isActive ? AppTheme.success : AppTheme.textSecondary,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (isDistrict)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                          decoration: BoxDecoration(
                            color: AppTheme.accent.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(3),
                          ),
                          child: const Text('District',
                              style: TextStyle(color: AppTheme.accent, fontSize: 9)),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            // Toggle switch
            Switch(
              value: isActive,
              activeThumbColor: AppTheme.accent,
              onChanged: (_) => isDistrict ? _toggleDistrict(id) : _togglePool(id),
            ),
            // Edit button
            if (_showPowerBadge)
              IconButton(
                icon: const Icon(Icons.edit, color: AppTheme.accent, size: 18),
                onPressed: () => _editUnitLocation({
                  ...item,
                  'unit_type': isDistrict ? 'district' : 'stake',
                }),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            const SizedBox(width: 4),
            // Delete button
            if (_showPowerBadge)
              IconButton(
                icon: const Icon(Icons.delete_outline, color: AppTheme.danger, size: 18),
                onPressed: () => _deletePoolUnit(isDistrict ? 'district' : 'stake', id, name),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _tabs.dispose();
    _poolSearchController.dispose();
    super.dispose();
  }
}