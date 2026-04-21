import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class PoolScreen extends StatefulWidget {
  final bool globalMode;
  const PoolScreen({super.key, this.globalMode = false});
  @override
  State<PoolScreen> createState() => _PoolScreenState();
}

class _PoolScreenState extends State<PoolScreen> {
  final _api = ApiService();

  // Stake pool data (normal mode)
  List<Map<String, dynamic>> _members = [];
  Map<String, dynamic>? _stake;
  String _myStatus = 'loading'; // loading | no_stake | not_in_pool | pending | approved

  // Global mode data (missionaries)
  List<Map<String, dynamic>> _globalMembers = [];
  List<String> _continents = [];
  String _selectedContinent = 'All';
  bool _globalLoading = false;

  String _search = '';

  @override
  void initState() {
    super.initState();
    if (widget.globalMode) {
      _loadGlobal();
    } else {
      _loadMyStake();
    }
  }

  Future<void> _loadMyStake() async {
    setState(() => _myStatus = 'loading');
    try {
      final res = await _api.get('/ysa-pool/my-stake');
      final members = (res['members'] as List? ?? []).whereType<Map<String, dynamic>>().toList();
      final status = res['myStatus'] as String? ?? 'no_stake';
      final stake = res['stake'] as Map<String, dynamic>?;
      if (mounted) setState(() {
        _members = members;
        _myStatus = status;
        _stake = stake;
      });
    } catch (_) {
      if (mounted) setState(() => _myStatus = 'no_stake');
    }
  }

  Future<void> _loadGlobal() async {
    setState(() => _globalLoading = true);
    try {
      final res = await _api.get('/ysa-pool/global');
      final list = (res['contacts'] as List? ?? []).whereType<Map<String, dynamic>>().toList();
      final conts = <String>{};
      for (final m in list) {
        final c = m['continent'] as String?;
        if (c != null && c.isNotEmpty) conts.add(c);
      }
      if (mounted) setState(() {
        _globalMembers = list;
        _continents = conts.toList()..sort();
        _globalLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _globalLoading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final src = widget.globalMode ? _globalMembers : _members;
    var list = src;
    if (widget.globalMode && _selectedContinent != 'All') {
      list = list.where((m) => (m['continent'] as String?) == _selectedContinent).toList();
    }
    if (_search.isNotEmpty) {
      final q = _search.toLowerCase();
      list = list.where((m) {
        final name = (m['full_name'] as String? ?? '').toLowerCase();
        final stake = (m['stake_name'] as String? ?? '').toLowerCase();
        return name.contains(q) || stake.contains(q);
      }).toList();
    }
    return list;
  }

  Color _avatarColor(String name) {
    const colors = [
      Color(0xFF1565C0), Color(0xFF6A1B9A), Color(0xFF2E7D32),
      Color(0xFFC62828), Color(0xFF00838F), Color(0xFFE65100),
    ];
    return colors[name.isNotEmpty ? name.codeUnitAt(0) % colors.length : 0];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: widget.globalMode ? _buildGlobalBody() : _buildStakeBody(),
      ),
    );
  }

  // global mode (missionaries)
  Widget _buildGlobalBody() {
    return RefreshIndicator(
      color: AppTheme.accent,
      backgroundColor: AppTheme.surface,
      onRefresh: _loadGlobal,
      child: CustomScrollView(slivers: [
        SliverToBoxAdapter(child: _buildHeader('YSA Global', Icons.travel_explore)),
        SliverToBoxAdapter(child: _buildGlobalBanner()),
        SliverToBoxAdapter(child: _buildSearchBar()),
        SliverToBoxAdapter(child: _buildContinentFilter()),
        if (_globalLoading)
          const SliverFillRemaining(child: Center(child: CircularProgressIndicator(color: AppTheme.accent)))
        else
          _buildMembersList(_filtered),
      ]),
    );
  }

  Widget _buildGlobalBanner() => Container(
    margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppTheme.accent.withOpacity(0.07),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppTheme.accent.withOpacity(0.25)),
    ),
    child: Row(children: [
      Icon(Icons.public, color: AppTheme.accent, size: 20),
      const SizedBox(width: 12),
      const Expanded(child: Text(
        'Browsing approved YSA members worldwide from all open stakes.',
        style: TextStyle(color: Colors.white70, fontSize: 13, height: 1.4),
      )),
    ]),
  );

  Widget _buildContinentFilter() {
    final chips = ['All', ..._continents];
    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        itemCount: chips.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final c = chips[i];
          final sel = _selectedContinent == c;
          return FilterChip(
            label: Text(c, style: TextStyle(
              fontSize: 12,
              color: sel ? AppTheme.background : Colors.white70,
              fontWeight: sel ? FontWeight.bold : FontWeight.normal,
            )),
            selected: sel,
            onSelected: (_) => setState(() => _selectedContinent = c),
            selectedColor: AppTheme.accent,
            backgroundColor: AppTheme.surface,
            side: BorderSide(color: sel ? AppTheme.accent : Colors.white24),
            showCheckmark: false,
            padding: const EdgeInsets.symmetric(horizontal: 4),
          );
        },
      ),
    );
  }

  // stake mode (YSA / leaders)
  Widget _buildStakeBody() {
    if (_myStatus == 'loading') {
      return const Center(child: CircularProgressIndicator(color: AppTheme.accent));
    }
    return RefreshIndicator(
      color: AppTheme.accent,
      backgroundColor: AppTheme.surface,
      onRefresh: _loadMyStake,
      child: CustomScrollView(slivers: [
        SliverToBoxAdapter(child: _buildHeader('YSA Stake Pool', Icons.groups)),
        SliverToBoxAdapter(child: _buildStatusBanner()),
        if (_myStatus != 'no_stake') ...[
          SliverToBoxAdapter(child: _buildStakeCard()),
          SliverToBoxAdapter(child: _buildSearchBar()),
          if (_members.isEmpty)
            SliverFillRemaining(child: _buildEmptyStake())
          else
            _buildMembersList(_filtered),
        ],
      ]),
    );
  }

  Widget _buildStatusBanner() {
    switch (_myStatus) {
      case 'no_stake':
        return _infoBanner(icon: Icons.location_off, color: Colors.orange,
          title: 'No Stake Assigned',
          body: 'You need to select your stake when registering to join a stake pool. Contact your leader to update your profile.');
      case 'not_in_pool':
        return _infoBanner(icon: Icons.info_outline, color: Colors.blueGrey,
          title: 'Not in Pool',
          body: 'You are not currently in the stake pool. Contact your YSA Rep or Bishop.');
      case 'pending':
        return _infoBanner(icon: Icons.hourglass_top, color: Colors.amber,
          title: 'Your Approval is Pending',
          body: 'You have been added to the stake pool and are awaiting approval from your leader. You can view approved members below.');
      case 'approved':
        return _infoBanner(icon: Icons.verified, color: Colors.green,
          title: 'You are in the Pool!',
          body: 'You are an approved member of your stake\'s YSA pool.');
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildStakeCard() {
    final stakeName = _stake?['name'] as String? ?? 'Your Stake';
    final stakeCountry = _stake?['country'] as String? ?? '';
    final poolActive = _stake?['ysa_pool_active'] as bool? ?? false;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.divider),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: AppTheme.accent.withOpacity(0.12), shape: BoxShape.circle),
          child: const Icon(Icons.location_city, color: AppTheme.accent, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(stakeName,
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
          if (stakeCountry.isNotEmpty)
            Text(stakeCountry, style: const TextStyle(color: Colors.white54, fontSize: 12)),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: (poolActive ? Colors.green : Colors.grey).withOpacity(0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(poolActive ? 'Pool Open' : 'Pool Closed',
            style: TextStyle(color: poolActive ? Colors.green : Colors.grey, fontSize: 11, fontWeight: FontWeight.w600)),
        ),
      ]),
    );
  }

  Widget _buildEmptyStake() => Center(child: Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      Icon(Icons.group_outlined, size: 64, color: AppTheme.textSecondary.withOpacity(0.3)),
      const SizedBox(height: 16),
      const Text('No approved members yet.', style: TextStyle(color: Colors.white54), textAlign: TextAlign.center),
      const SizedBox(height: 8),
      const Text('Members appear here when approved by a leader.',
        style: TextStyle(color: Colors.white38, fontSize: 13), textAlign: TextAlign.center),
    ],
  ));

  // shared widgets
  Widget _buildHeader(String title, IconData icon) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
    child: Row(children: [
      Icon(icon, color: AppTheme.accent, size: 24),
      const SizedBox(width: 10),
      Text(title, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
      const Spacer(),
      GestureDetector(
        onTap: widget.globalMode ? _loadGlobal : _loadMyStake,
        child: Container(
          width: 34, height: 34,
          decoration: const BoxDecoration(shape: BoxShape.circle, color: AppTheme.primaryLight),
          child: Icon(Icons.refresh, color: AppTheme.accent, size: 18),
        ),
      ),
    ]),
  );

  Widget _buildSearchBar() => Container(
    margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(24),
      border: Border.all(color: AppTheme.divider, width: 0.5),
    ),
    child: Row(children: [
      Icon(Icons.search, color: AppTheme.textSecondary.withOpacity(0.5), size: 18),
      const SizedBox(width: 10),
      Expanded(child: TextField(
        onChanged: (v) => setState(() => _search = v),
        style: const TextStyle(color: Colors.white, fontSize: 14),
        decoration: InputDecoration.collapsed(
          hintText: widget.globalMode ? 'Search by name, stake...' : 'Search members...',
          hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5), fontSize: 14),
        ),
      )),
    ]),
  );

  Widget _infoBanner({required IconData icon, required Color color, required String title, required String body}) =>
    Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, color: color, size: 22),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 4),
          Text(body, style: const TextStyle(color: Colors.white60, fontSize: 12, height: 1.4)),
        ])),
      ]),
    );

  SliverList _buildMembersList(List<Map<String, dynamic>> members) {
    final tiles = <Widget>[
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Row(children: [
          Text(
            widget.globalMode ? 'WORLDWIDE MEMBERS' : 'STAKE MEMBERS',
            style: TextStyle(
              fontSize: 11, fontWeight: FontWeight.w700,
              color: AppTheme.textSecondary.withOpacity(0.7), letterSpacing: 1.5,
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(
              color: AppTheme.accent.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text('${members.length}',
              style: const TextStyle(color: AppTheme.accent, fontSize: 11, fontWeight: FontWeight.w700)),
          ),
        ]),
      ),
    ];
    if (members.isEmpty) {
      tiles.add(Center(child: Padding(
        padding: const EdgeInsets.only(top: 40),
        child: Column(children: [
          Icon(Icons.search_off, size: 48, color: AppTheme.textSecondary.withOpacity(0.3)),
          const SizedBox(height: 12),
          Text(_search.isNotEmpty ? 'No results for "$_search"' : 'No members yet.',
            style: const TextStyle(color: Colors.white54)),
        ]),
      )));
    } else {
      for (final m in members) tiles.add(_memberTile(m));
    }
    return SliverList(delegate: SliverChildListDelegate(tiles));
  }

  Widget _memberTile(Map<String, dynamic> m) {
    final name = m['full_name'] as String? ?? 'Unknown';
    final stake = m['stake_name'] as String?;
    final country = m['country'] as String?;
    final photo = m['profile_photo_url'] as String?;
    final role = m['role'] as String?;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        leading: CircleAvatar(
          radius: 22,
          backgroundColor: _avatarColor(name),
          backgroundImage: (photo != null && photo.isNotEmpty) ? NetworkImage(photo) : null,
          child: (photo == null || photo.isEmpty)
              ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))
              : null,
        ),
        title: Text(name,
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14)),
        subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (stake != null && stake.isNotEmpty)
            Text(stake, style: const TextStyle(color: Colors.white54, fontSize: 12)),
          if (country != null && country.isNotEmpty && widget.globalMode)
            Text(country, style: TextStyle(color: AppTheme.accent.withOpacity(0.7), fontSize: 11)),
        ]),
        trailing: role != null && _roleBadge(role) != null
            ? Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                decoration: BoxDecoration(
                  color: _roleColor(role).withOpacity(0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(_roleBadge(role)!,
                  style: TextStyle(color: _roleColor(role), fontSize: 9, fontWeight: FontWeight.w700)),
              )
            : const Icon(Icons.chevron_right, color: Colors.white24, size: 20),
      ),
    );
  }

  String? _roleBadge(String role) {
    switch (role) {
      case 'ysa_rep': return 'YSA REP';
      case 'bishop': return 'BISHOP';
      case 'stake_presidency': return 'STAKE PRES.';
      default: return null;
    }
  }

  Color _roleColor(String role) {
    switch (role) {
      case 'ysa_rep': return Colors.teal;
      case 'bishop': return Colors.deepPurple;
      case 'stake_presidency': return const Color(0xFF1A6B3C);
      default: return AppTheme.accent;
    }
  }
}
