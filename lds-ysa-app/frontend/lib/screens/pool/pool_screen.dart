import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';
import '../chat/chat_screen.dart';
import '../../models/conversation_model.dart';

class PoolScreen extends StatefulWidget {
  final bool globalMode;
  const PoolScreen({super.key, this.globalMode = false});
  @override
  State<PoolScreen> createState() => _PoolScreenState();
}

class _PoolScreenState extends State<PoolScreen> {
  final _api = ApiService();

  bool _showGlobal = false;

  // My-stake data
  Map<String, dynamic>? _myStake;
  List<Map<String, dynamic>> _myStakeMembers = [];
  String _myStatus = 'loading';

  // Global browse — stakes-first (source of truth is stakes table)
  bool _loadingGlobal = false;
  List<Map<String, dynamic>> _stakeGroups = [];  // each has stake metadata + 'member_count' (no members list)
  Map<String, dynamic>? _expandedStake;           // currently open stake
  List<Map<String, dynamic>> _expandedStakeMembers = []; // lazy-loaded members for _expandedStake
  bool _loadingStakeMembers = false;
  Set<String> _expandedContinents = {};

  // Sent requests
  List<Map<String, dynamic>> _sentRequests = [];

  // Incoming connection requests
  List<Map<String, dynamic>> _incomingRequests = [];

  // Filters
  final _ageRanges = ['18-22', '23-26', '27-30', '31-35'];
  Set<String> _selectedAges = {};
  String _genderFilter = 'all';
  bool _showFilterPanel = false;

  // Search
  String _search = '';
  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _showGlobal = widget.globalMode;
    _loadMyStake();
    if (_showGlobal) _loadGlobal();
    _loadSentRequests();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  // ─── Data loading ─────────────────────────────────────────────────

  Future<void> _loadMyStake() async {
    setState(() => _myStatus = 'loading');
    try {
      final res = await _api.get('/ysa-pool/my-stake');
      final members = (res['members'] as List? ?? []).whereType<Map<String, dynamic>>().toList();
      final status = res['myStatus'] as String? ?? 'no_stake';
      final stake = res['stake'] as Map<String, dynamic>?;
      if (mounted) setState(() {
        _myStakeMembers = members;
        _myStatus = status;
        _myStake = stake;
      });
    } catch (_) {
      if (mounted) setState(() => _myStatus = 'no_stake');
    }
  }

  Future<void> _loadGlobal() async {
    setState(() { _loadingGlobal = true; _expandedStake = null; _expandedStakeMembers = []; _expandedContinents = {}; });
    try {
      // Always query /directory-stakes — source of truth is the stakes table.
      // New stakes, renamed stakes, deleted stakes all reflect automatically.
      final res = await _api.get('/ysa-pool/directory-stakes');
      final list = (res['stakes'] as List? ?? []).whereType<Map<String, dynamic>>().toList();
      if (mounted) setState(() {
        _stakeGroups = list; // each entry: stake_id, stake_name, country, continent, member_count
        _loadingGlobal = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingGlobal = false);
    }
  }

  Future<void> _loadStakeMembers(Map<String, dynamic> stake) async {
    setState(() { _expandedStake = stake; _expandedStakeMembers = []; _loadingStakeMembers = true; });
    try {
      final stakeId = stake['stake_id'] as String;
      final res = await _api.get('/ysa-pool/stake-members/$stakeId');
      final members = (res['members'] as List? ?? []).whereType<Map<String, dynamic>>().toList();
      if (mounted) setState(() {
        _expandedStakeMembers = members;
        _loadingStakeMembers = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingStakeMembers = false);
    }
  }

  Future<void> _loadSentRequests() async {
    try {
      final res = await _api.get('/contact-requests');
      if (mounted) setState(() {
        _sentRequests = (res['outgoing'] as List? ?? []).whereType<Map<String, dynamic>>().toList();
        _incomingRequests = (res['incoming'] as List? ?? []).whereType<Map<String, dynamic>>().toList();
      });
    } catch (_) {}
  }

  Future<void> _acceptRequest(Map<String, dynamic> requestData) async {
    try {
      final res = await _api.post('/contact-requests/${requestData['id']}/accept', {});
      if (!mounted) return;
      await _loadSentRequests();
      final conv = res['conversation'] as Map?;
      if (conv != null && (conv['id'] as String? ?? '').isNotEmpty) {
        Navigator.push(context, MaterialPageRoute(
          builder: (_) => ChatScreen(conversation: ConversationModel.fromJson(Map<String, dynamic>.from(conv))),
        ));
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: AppTheme.danger));
    }
  }

  // ─── Filtering ─────────────────────────────────────────────────────

  List<Map<String, dynamic>> _applyFilters(List<Map<String, dynamic>> src) {
    var list = src;
    if (_search.isNotEmpty) {
      final q = _search.toLowerCase();
      list = list.where((m) =>
        (m['full_name'] as String? ?? '').toLowerCase().contains(q) ||
        (m['stake_name'] as String? ?? '').toLowerCase().contains(q) ||
        (m['country'] as String? ?? '').toLowerCase().contains(q)
      ).toList();
    }
    if (_selectedAges.isNotEmpty) {
      list = list.where((m) => _selectedAges.contains(m['age_range'] as String?)).toList();
    }
    if (_genderFilter != 'all') {
      list = list.where((m) => (m['gender'] as String? ?? '').toLowerCase() == _genderFilter).toList();
    }
    return list;
  }

  bool get _hasActiveFilter => _selectedAges.isNotEmpty || _genderFilter != 'all';

  // Stake groups filtered by search (stake name, country, continent)
  List<Map<String, dynamic>> get _filteredStakeGroups {
    if (_search.isEmpty) return _stakeGroups;
    final q = _search.toLowerCase();
    return _stakeGroups.where((sg) {
      final name = (sg['stake_name'] as String? ?? '').toLowerCase();
      final country = (sg['country'] as String? ?? '').toLowerCase();
      final continent = (sg['continent'] as String? ?? '').toLowerCase();
      return name.contains(q) || country.contains(q) || continent.contains(q);
    }).toList();
  }

  // Group filtered stakes by continent
  Map<String, List<Map<String, dynamic>>> get _stakesByContinent {
    final map = <String, List<Map<String, dynamic>>>{};
    for (final sg in _filteredStakeGroups) {
      final c = (sg['continent'] as String?)?.trim();
      final key = (c != null && c.isNotEmpty) ? c : 'Other';
      map.putIfAbsent(key, () => []).add(sg);
    }
    return map;
  }

  // ─── Actions ───────────────────────────────────────────────────────

  Future<String?> _promptIntro(String name) async {
    final ctrl = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: Text('Connect with $name',
          style: const TextStyle(color: Colors.white, fontSize: 17)),
        content: TextField(
          controller: ctrl,
          maxLength: 200,
          maxLines: 3,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'Write a short introduction (optional)...',
            hintStyle: const TextStyle(color: Colors.white38),
            filled: true,
            fillColor: AppTheme.background,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
            counterStyle: const TextStyle(color: Colors.white38),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppTheme.accent),
            onPressed: () => Navigator.pop(context, ctrl.text.trim()),
            child: const Text('Send Request'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    return result;
  }

  Future<void> _sendRequest(Map<String, dynamic> member) async {
    final name = member['full_name'] as String? ?? 'this user';
    final intro = await _promptIntro(name);
    if (intro == null || !mounted) return;
    try {
      await _api.post('/contact-requests', {
        'target_user_id': member['id'],
        'intro_message': intro,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Connection request sent to $name'),
        backgroundColor: AppTheme.success,
      ));
      _loadSentRequests();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.message), backgroundColor: AppTheme.danger,
      ));
    }
  }

  // ─── Requests modal (tabbed: Incoming / Sent) ───────────────────────

  void _showRequestsModal() {
    _loadSentRequests();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetCtx) {
        final incoming = List<Map<String, dynamic>>.from(_incomingRequests);
        final sent = List<Map<String, dynamic>>.from(_sentRequests);
        return StatefulBuilder(
          builder: (ctx, setSheet) => Container(
            height: MediaQuery.of(ctx).size.height * 0.78,
            decoration: const BoxDecoration(
              color: AppTheme.background,
              borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: DefaultTabController(
              length: 2,
              child: Column(children: [
                // Drag handle
                Container(
                  margin: const EdgeInsets.only(top: 10),
                  width: 36, height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24, borderRadius: BorderRadius.circular(2)),
                ),
                // Title row
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 8, 0),
                  child: Row(children: [
                    const Icon(Icons.people_outline, color: AppTheme.accent, size: 18),
                    const SizedBox(width: 8),
                    const Text('Connection Requests',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white54, size: 20),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ]),
                ),
                const SizedBox(height: 4),
                // Tab bar
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: AppTheme.surface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: TabBar(
                    tabs: [
                      Tab(text: 'Incoming (${incoming.length})'),
                      Tab(text: 'Sent (${sent.length})'),
                    ],
                    indicator: BoxDecoration(
                      color: AppTheme.accent.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    indicatorSize: TabBarIndicatorSize.tab,
                    dividerColor: Colors.transparent,
                    labelColor: AppTheme.accent,
                    unselectedLabelColor: Colors.white38,
                    labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                ),
                const SizedBox(height: 4),
                const Divider(color: Colors.white10, height: 1),
                // Tab content
                Expanded(child: TabBarView(children: [
                  // ── Incoming tab ──
                  incoming.isEmpty
                    ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.inbox_outlined, size: 52, color: Colors.white12),
                        SizedBox(height: 12),
                        Text('No incoming requests', style: TextStyle(color: Colors.white38, fontSize: 14)),
                      ]))
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                        itemCount: incoming.length,
                        itemBuilder: (_, i) {
                          final r = incoming[i];
                          final name = r['full_name'] as String? ?? 'Unknown';
                          final stake = r['stake_name'] as String?;
                          final photo = r['profile_photo_url'] as String?;
                          final intro = r['intro_message'] as String?;
                          final id = r['id'].toString();
                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: AppTheme.surface,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: Colors.green.withOpacity(0.25)),
                            ),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                CircleAvatar(
                                  radius: 22,
                                  backgroundColor: _avatarColor(name),
                                  backgroundImage: (photo != null && photo.isNotEmpty)
                                      ? NetworkImage(photo) : null,
                                  child: (photo == null || photo.isEmpty)
                                    ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                                        style: const TextStyle(color: Colors.white,
                                          fontWeight: FontWeight.bold, fontSize: 16))
                                    : null,
                                ),
                                const SizedBox(width: 12),
                                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(name, style: const TextStyle(
                                    color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14)),
                                  if (stake != null && stake.isNotEmpty)
                                    Text(stake, style: const TextStyle(color: Colors.white38, fontSize: 11)),
                                ])),
                              ]),
                              if (intro != null && intro.isNotEmpty) ...[
                                const SizedBox(height: 10),
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: AppTheme.background,
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text('"$intro"', style: const TextStyle(
                                    color: Colors.white60, fontSize: 12,
                                    fontStyle: FontStyle.italic, height: 1.4)),
                                ),
                              ],
                              const SizedBox(height: 12),
                              Row(children: [
                                Expanded(
                                  child: GestureDetector(
                                    onTap: () {
                                      Navigator.pop(ctx);
                                      _acceptRequest(r);
                                    },
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(vertical: 9),
                                      decoration: BoxDecoration(
                                        color: Colors.green.withOpacity(0.15),
                                        borderRadius: BorderRadius.circular(8),
                                        border: Border.all(color: Colors.green.withOpacity(0.4)),
                                      ),
                                      child: const Center(child: Text('Accept',
                                        style: TextStyle(color: Colors.greenAccent,
                                          fontSize: 13, fontWeight: FontWeight.w700))),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: GestureDetector(
                                    onTap: () async {
                                      try {
                                        await _api.post('/contact-requests/$id/decline', {});
                                        if (!ctx.mounted) return;
                                        setSheet(() => incoming.removeWhere(
                                          (x) => x['id'].toString() == id));
                                        _loadSentRequests();
                                      } catch (_) {}
                                    },
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(vertical: 9),
                                      decoration: BoxDecoration(
                                        color: Colors.red.withOpacity(0.10),
                                        borderRadius: BorderRadius.circular(8),
                                        border: Border.all(color: Colors.red.withOpacity(0.3)),
                                      ),
                                      child: const Center(child: Text('Decline',
                                        style: TextStyle(color: Colors.redAccent,
                                          fontSize: 13, fontWeight: FontWeight.w700))),
                                    ),
                                  ),
                                ),
                              ]),
                            ]),
                          );
                        },
                      ),
                  // ── Sent tab ──
                  sent.isEmpty
                    ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.send_outlined, size: 52, color: Colors.white12),
                        SizedBox(height: 12),
                        Text('No sent requests pending', style: TextStyle(color: Colors.white38, fontSize: 14)),
                      ]))
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                        itemCount: sent.length,
                        itemBuilder: (_, i) {
                          final r = sent[i];
                          final name = r['full_name'] as String? ?? 'Unknown';
                          final stake = r['stake_name'] as String?;
                          final photo = r['profile_photo_url'] as String?;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            decoration: BoxDecoration(
                              color: AppTheme.surface,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: AppTheme.divider),
                            ),
                            child: Row(children: [
                              CircleAvatar(
                                radius: 20,
                                backgroundColor: _avatarColor(name),
                                backgroundImage: (photo != null && photo.isNotEmpty)
                                    ? NetworkImage(photo) : null,
                                child: (photo == null || photo.isEmpty)
                                  ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                                      style: const TextStyle(color: Colors.white, fontSize: 14))
                                  : null,
                              ),
                              const SizedBox(width: 12),
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(name, style: const TextStyle(
                                  color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
                                if (stake != null && stake.isNotEmpty)
                                  Text(stake, style: const TextStyle(color: Colors.white38, fontSize: 11)),
                              ])),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.amber.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Text('Pending', style: TextStyle(
                                  color: Colors.amber, fontSize: 10, fontWeight: FontWeight.w600)),
                              ),
                            ]),
                          );
                        },
                      ),
                ])),
              ]),
            ),
          ),
        );
      },
    );
  }

  // ─── Build ─────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(child: Column(children: [
        _buildTopBar(),
        _buildTabToggle(),
        if (_showFilterPanel) _buildFilterPanel(),
        Expanded(child: _showGlobal ? _buildGlobalView() : _buildMyStakeView()),
      ])),
    );
  }

  Widget _buildTopBar() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    child: Row(children: [
      const Icon(Icons.public, color: AppTheme.accent, size: 22),
      const SizedBox(width: 8),
      const Text('YSA Pool', style: TextStyle(
        color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
      const Spacer(),
      // Requests icon with badge — opens tabbed modal
      GestureDetector(
        onTap: _showRequestsModal,
        child: Container(
          margin: const EdgeInsets.only(right: 8),
          child: Stack(clipBehavior: Clip.none, children: [
            Container(
              width: 36, height: 36,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.surface,
                border: Border.all(color: AppTheme.divider),
              ),
              child: const Icon(Icons.people_outline,
                color: AppTheme.accent, size: 17),
            ),
            if (_incomingRequests.isNotEmpty)
              Positioned(
                right: -2, top: -2,
                child: Container(
                  width: 16, height: 16,
                  decoration: const BoxDecoration(
                    color: Colors.redAccent, shape: BoxShape.circle),
                  child: Center(
                    child: Text(
                      _incomingRequests.length > 9 ? '9+' : '${_incomingRequests.length}',
                      style: const TextStyle(color: Colors.white, fontSize: 8,
                        fontWeight: FontWeight.w700)),
                  ),
                ),
              ),
          ]),
        ),
      ),
      GestureDetector(
        onTap: () => setState(() => _showFilterPanel = !_showFilterPanel),
        child: Container(
          width: 34, height: 34,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _hasActiveFilter ? AppTheme.accent : AppTheme.surface,
          ),
          child: Icon(Icons.tune,
            color: _hasActiveFilter ? AppTheme.background : AppTheme.accent, size: 17),
        ),
      ),
    ]),
  );

  Widget _buildTabToggle() => Container(
    margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    padding: const EdgeInsets.all(4),
    decoration: BoxDecoration(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppTheme.divider),
    ),
    child: Row(children: [
      _tabBtn('My Stake', Icons.location_city, !_showGlobal, () {
        setState(() { _showGlobal = false; _showFilterPanel = false; });
      }),
      _tabBtn('Global', Icons.travel_explore, _showGlobal, () {
        setState(() { _showGlobal = true; _showFilterPanel = false; });
        if (_stakeGroups.isEmpty) _loadGlobal();
      }),
    ]),
  );

  Widget _tabBtn(String label, IconData icon, bool active, VoidCallback onTap) => Expanded(
    child: GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: BoxDecoration(
          color: active ? AppTheme.accent : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, size: 15, color: active ? AppTheme.background : Colors.white54),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(
            color: active ? AppTheme.background : Colors.white54,
            fontWeight: FontWeight.w700, fontSize: 13)),
        ]),
      ),
    ),
  );

  Widget _buildFilterPanel() => Container(
    margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppTheme.divider),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        const Text('FILTER BY', style: TextStyle(
          color: Colors.white54, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
        const Spacer(),
        if (_hasActiveFilter)
          GestureDetector(
            onTap: () => setState(() { _selectedAges = {}; _genderFilter = 'all'; }),
            child: const Text('Clear All', style: TextStyle(color: AppTheme.accent, fontSize: 12)),
          ),
      ]),
      const SizedBox(height: 10),
      const Text('Age Range', style: TextStyle(color: Colors.white70, fontSize: 12)),
      const SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 6, children: _ageRanges.map((r) {
        final sel = _selectedAges.contains(r);
        return GestureDetector(
          onTap: () => setState(() {
            if (sel) _selectedAges.remove(r); else _selectedAges.add(r);
          }),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: sel ? AppTheme.accent : AppTheme.background,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: sel ? AppTheme.accent : Colors.white24),
            ),
            child: Text(r, style: TextStyle(
              color: sel ? AppTheme.background : Colors.white70,
              fontSize: 12, fontWeight: FontWeight.w600)),
          ),
        );
      }).toList()),
      const SizedBox(height: 12),
      const Text('Gender', style: TextStyle(color: Colors.white70, fontSize: 12)),
      const SizedBox(height: 6),
      Row(children: [
        for (final entry in <List<String>>[['all','All'],['male','Brothers'],['female','Sisters']])
          GestureDetector(
            onTap: () => setState(() => _genderFilter = entry[0]),
            child: Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: _genderFilter == entry[0] ? AppTheme.accent : AppTheme.background,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: _genderFilter == entry[0] ? AppTheme.accent : Colors.white24),
              ),
              child: Text(entry[1], style: TextStyle(
                color: _genderFilter == entry[0] ? AppTheme.background : Colors.white70,
                fontSize: 12, fontWeight: FontWeight.w600)),
            ),
          ),
      ]),
    ]),
  );

  // ─── My Stake view ──────────────────────────────────────────────────

  Widget _buildMyStakeView() {
    if (_myStatus == 'loading') {
      return const Center(child: CircularProgressIndicator(color: AppTheme.accent));
    }
    return RefreshIndicator(
      color: AppTheme.accent,
      backgroundColor: AppTheme.surface,
      onRefresh: _loadMyStake,
      child: ListView(children: [
        _buildStatusBanner(),
        if (_myStake != null) _buildStakeInfoCard(_myStake!),
        _buildSearchBar(),
        if (_myStakeMembers.isNotEmpty)
          _buildSectionHeader('STAKE MEMBERS', _applyFilters(_myStakeMembers).length),
        ..._applyFilters(_myStakeMembers).map(_buildMemberCard),
        if (_myStatus != 'no_stake' && _myStakeMembers.isEmpty)
          _buildEmpty('No members in your stake pool yet.'),
        if (_myStatus != 'no_stake' && _myStakeMembers.isNotEmpty &&
            _applyFilters(_myStakeMembers).isEmpty)
          _buildEmpty('No members match the filters.'),
        const SizedBox(height: 80),
      ]),
    );
  }

  Widget _buildStatusBanner() {
    switch (_myStatus) {
      case 'no_stake':
        return _infoBanner(Icons.location_off, Colors.orange, 'No Stake Assigned',
          'Contact your leader to assign your stake.');
      case 'not_in_pool':
        return _infoBanner(Icons.info_outline, Colors.blueGrey, 'Not in Pool',
          'Ask your YSA Rep or Bishop to add you to the pool.');
      case 'pending':
        return _infoBanner(Icons.hourglass_top, Colors.amber, 'Approval Pending',
          'Awaiting leader approval.');
      case 'approved':
        return _infoBanner(Icons.verified, Colors.green, 'You are in the Pool!',
          'You are an approved member of your stake YSA pool.');
      default: return const SizedBox.shrink();
    }
  }

  // ─── Global view ────────────────────────────────────────────────────

  Widget _buildGlobalView() {
    if (_loadingGlobal) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.accent));
    }
    return RefreshIndicator(
      color: AppTheme.accent,
      backgroundColor: AppTheme.surface,
      onRefresh: _loadGlobal,
      child: ListView(children: [
        _buildGlobalBanner(),
        _buildSearchBar(),
        if (_expandedStake != null) ...[   // members view for a selected stake
          _buildExpandedStakeHeader(),
          if (_loadingStakeMembers)
            const Padding(padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator(color: AppTheme.accent)))
          else if (_expandedStakeMembers.isEmpty)
            _buildEmpty('No YSA members in this stake yet.')
          else ..._applyFilters(_expandedStakeMembers).map(_buildMemberCard),
          if (!_loadingStakeMembers && _expandedStakeMembers.isNotEmpty &&
              _applyFilters(_expandedStakeMembers).isEmpty)
            _buildEmpty('No members match the filters.'),
        ] else ...[                        // continent-grouped stake list
          _buildSectionHeader('WORLDWIDE STAKES', _filteredStakeGroups.length),
          if (_filteredStakeGroups.isEmpty)
            _buildEmpty(_search.isNotEmpty ? 'No stakes match "$_search".' : 'No stakes found worldwide.')
          else
            ..._buildContinentGroupedView(),
        ],
        const SizedBox(height: 80),
      ]),
    );
  }

  List<Widget> _buildContinentGroupedView() {
    final byContinent = _stakesByContinent;
    final continents = byContinent.keys.toList()..sort();
    final widgets = <Widget>[];
    for (final continent in continents) {
      final units = byContinent[continent]!;
      final isExpanded = _expandedContinents.contains(continent) || _search.isNotEmpty;
      final totalYsa = units.fold<int>(0, (sum, sg) {
        return sum + (int.tryParse(sg['member_count']?.toString() ?? '0') ?? 0);
      });
      final stakeCount = units.where((u) => (u['unit_type'] ?? 'stake') == 'stake').length;
      final districtCount = units.where((u) => u['unit_type'] == 'district').length;
      widgets.add(_buildContinentHeader(continent, stakeCount, districtCount, totalYsa, isExpanded));
      if (isExpanded) widgets.addAll(units.map(_buildStakeRow));
    }
    return widgets;
  }

  Widget _buildContinentHeader(String continent, int stakeCount, int districtCount, int ysaCount, bool isExpanded) {
    final subLabel = districtCount > 0
      ? '$stakeCount stake${stakeCount != 1 ? "s" : ""}, $districtCount district${districtCount != 1 ? "s" : ""} · $ysaCount YSA'
      : '$stakeCount stake${stakeCount != 1 ? "s" : ""} · $ysaCount YSA';
    return GestureDetector(
      onTap: () => setState(() {
        if (_expandedContinents.contains(continent)) {
          _expandedContinents.remove(continent);
        } else {
          _expandedContinents.add(continent);
        }
      }),
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: isExpanded ? AppTheme.accent.withOpacity(0.12) : AppTheme.surface.withOpacity(0.7),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isExpanded ? AppTheme.accent.withOpacity(0.3) : Colors.white.withOpacity(0.06)),
        ),
        child: Row(children: [
          Container(
            width: 36, height: 36,
            decoration: BoxDecoration(
              color: AppTheme.accent.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.public, color: AppTheme.accent, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(continent, style: const TextStyle(
              color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14)),
            const SizedBox(height: 2),
            Text(subLabel,
              style: const TextStyle(color: Colors.white54, fontSize: 11)),
          ])),
          AnimatedRotation(
            turns: isExpanded ? 0.25 : 0,
            duration: const Duration(milliseconds: 200),
            child: const Icon(Icons.chevron_right, color: AppTheme.accent, size: 20),
          ),
        ]),
      ),
    );
  }

  Widget _buildExpandedStakeHeader() {
    final name = _expandedStake?['stake_name'] as String? ?? '';
    final country = _expandedStake?['country'] as String? ?? '';
    final label = [if (country.isNotEmpty) country, if (name.isNotEmpty) name].join(' · ');
    final filteredCount = _applyFilters(_expandedStakeMembers).length;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      GestureDetector(
        onTap: () => setState(() { _expandedStake = null; _expandedStakeMembers = []; }),
        child: Container(
          margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: AppTheme.surface, borderRadius: BorderRadius.circular(10)),
          child: const Row(children: [
            Icon(Icons.arrow_back, color: AppTheme.accent, size: 16),
            SizedBox(width: 6),
            Text('Back to All Stakes', style: TextStyle(color: AppTheme.accent, fontSize: 13)),
          ]),
        ),
      ),
      _buildSectionHeader(label.toUpperCase(), _loadingStakeMembers ? 0 : filteredCount),
    ]);
  }

  Widget _buildGlobalBanner() => Container(
    margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: AppTheme.accent.withOpacity(0.07),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppTheme.accent.withOpacity(0.2)),
    ),
    child: const Row(children: [
      Icon(Icons.travel_explore, color: AppTheme.accent, size: 18),
      SizedBox(width: 10),
      Expanded(child: Text(
        'Browse YSA by continent and stake. Search by country, stake, or continent name.',
        style: TextStyle(color: Colors.white60, fontSize: 12, height: 1.4),
      )),
    ]),
  );

  Widget _buildStakeRow(Map<String, dynamic> stakeGroup) {
    final stakeName = stakeGroup['stake_name'] as String? ?? 'Unknown Stake';
    final country = stakeGroup['country'] as String? ?? '';
    final displayName = country.isNotEmpty ? '$country · $stakeName' : stakeName;
    final isDistrict = (stakeGroup['unit_type'] as String? ?? 'stake') == 'district';
    // member_count comes live from DB — reflects current pool membership in real time
    final memberCount = int.tryParse(stakeGroup['member_count']?.toString() ?? '0') ?? 0;

    return GestureDetector(
      onTap: () => _loadStakeMembers(stakeGroup),
      child: Container(
        margin: const EdgeInsets.fromLTRB(28, 2, 16, 2),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withOpacity(0.06)),
        ),
        child: Row(children: [
          Container(
            width: 36, height: 36,
            decoration: BoxDecoration(
              color: (isDistrict ? Colors.orange : AppTheme.accent).withOpacity(0.10),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              isDistrict ? Icons.church : Icons.location_city,
              color: isDistrict ? Colors.orange : AppTheme.accent,
              size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(displayName, style: const TextStyle(
                color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13))),
              if (isDistrict)
                Container(
                  margin: const EdgeInsets.only(left: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text('District', style: TextStyle(
                    color: Colors.orange, fontSize: 9, fontWeight: FontWeight.w700)),
                ),
            ]),
            const SizedBox(height: 2),
            Text('$memberCount YSA member${memberCount != 1 ? "s" : ""}',
              style: const TextStyle(color: Colors.white54, fontSize: 11)),
          ])),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: (isDistrict ? Colors.orange : AppTheme.accent).withOpacity(0.15),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text('$memberCount YSA', style: TextStyle(
              color: isDistrict ? Colors.orange : AppTheme.accent,
              fontSize: 12, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 6),
          const Icon(Icons.chevron_right, color: Colors.white24, size: 20),
        ]),
      ),
    );
  }


  // ─── Shared widgets ──────────────────────────────────────────────────

  Widget _buildSearchBar() => Container(
    margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(24),
      border: Border.all(color: AppTheme.divider, width: 0.5),
    ),
    child: Row(children: [
      const Icon(Icons.search, color: Colors.white38, size: 18),
      const SizedBox(width: 10),
      Expanded(child: TextField(
        controller: _searchCtrl,
        onChanged: (v) => setState(() => _search = v),
        style: const TextStyle(color: Colors.white, fontSize: 14),
        decoration: const InputDecoration.collapsed(
          hintText: 'Search by name, stake, country...',
          hintStyle: TextStyle(color: Colors.white38, fontSize: 14),
        ),
      )),
      if (_search.isNotEmpty)
        GestureDetector(
          onTap: () { _searchCtrl.clear(); setState(() => _search = ''); },
          child: const Icon(Icons.close, color: Colors.white38, size: 16),
        ),
    ]),
  );

  Widget _buildStakeInfoCard(Map<String, dynamic> stake) {
    final name = stake['name'] as String? ?? 'Your Stake';
    final country = stake['country'] as String? ?? '';
    final active = stake['ysa_pool_active'] as bool? ?? false;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.divider),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppTheme.accent.withOpacity(0.12), shape: BoxShape.circle),
          child: const Icon(Icons.location_city, color: AppTheme.accent, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, style: const TextStyle(
            color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
          if (country.isNotEmpty)
            Text(country, style: const TextStyle(color: Colors.white54, fontSize: 12)),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: (active ? Colors.green : Colors.grey).withOpacity(0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(active ? 'Pool Open' : 'Pool Closed', style: TextStyle(
            color: active ? Colors.green : Colors.grey,
            fontSize: 11, fontWeight: FontWeight.w600)),
        ),
      ]),
    );
  }

  Widget _buildSectionHeader(String label, int count) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
    child: Row(children: [
      Text(label, style: TextStyle(
        fontSize: 11, fontWeight: FontWeight.w700,
        color: Colors.white.withOpacity(0.45), letterSpacing: 1.4)),
      const SizedBox(width: 8),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: AppTheme.accent.withOpacity(0.15),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text('$count', style: const TextStyle(
          color: AppTheme.accent, fontSize: 11, fontWeight: FontWeight.w700)),
      ),
    ]),
  );

  Widget _buildMemberCard(Map<String, dynamic> m) {
    final name = m['full_name'] as String? ?? 'Unknown';
    final gender = (m['gender'] as String? ?? '').toLowerCase();
    final ageRange = m['age_range'] as String?;
    final bio = m['bio'] as String? ?? '';
    final photo = m['profile_photo_url'] as String?;
    final stake = m['stake_name'] as String?;
    final country = m['country'] as String?;

    final genderIcon = gender == 'female'
        ? Icons.female : gender == 'male' ? Icons.male : Icons.person_outline;
    final genderColor = gender == 'female'
        ? const Color(0xFFE91E8C)
        : gender == 'male' ? const Color(0xFF1E88E5) : Colors.white38;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: _avatarColor(name),
              backgroundImage: (photo != null && photo.isNotEmpty) ? NetworkImage(photo) : null,
              child: (photo == null || photo.isEmpty)
                  ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18))
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: const TextStyle(
                color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
              const SizedBox(height: 3),
              Row(children: [
                Icon(genderIcon, color: genderColor, size: 14),
                const SizedBox(width: 3),
                if (gender.isNotEmpty)
                  Text(gender[0].toUpperCase() + gender.substring(1),
                    style: TextStyle(color: genderColor, fontSize: 11)),
                if (ageRange != null && ageRange.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text('Age $ageRange', style: const TextStyle(
                      color: AppTheme.accent, fontSize: 10, fontWeight: FontWeight.w600)),
                  ),
                ],
              ]),
            ])),
          ]),
          // Stake/country — NO ward, NO phone, NO email, NO actual age
          if ((stake != null && stake.isNotEmpty) || (country != null && country.isNotEmpty))
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(children: [
                const Icon(Icons.location_on_outlined, size: 12, color: Colors.white38),
                const SizedBox(width: 4),
                Expanded(child: Text(
                  [if (stake != null && stake.isNotEmpty) stake,
                   if (country != null && country.isNotEmpty) country].join(', '),
                  style: const TextStyle(color: Colors.white38, fontSize: 11),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                )),
              ]),
            ),
          if (bio.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(bio,
                style: const TextStyle(color: Colors.white54, fontSize: 12, height: 1.4),
                maxLines: 2, overflow: TextOverflow.ellipsis),
            ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _sendRequest(m),
              icon: const Icon(Icons.person_add_outlined, size: 15),
              label: const Text('Send Connection Request'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.accent,
                side: BorderSide(color: AppTheme.accent.withOpacity(0.5)),
                padding: const EdgeInsets.symmetric(vertical: 10),
                textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _buildEmpty(String msg) => Center(child: Padding(
    padding: const EdgeInsets.symmetric(vertical: 40),
    child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.group_outlined, size: 52, color: Colors.white12),
      const SizedBox(height: 12),
      Text(msg, style: const TextStyle(color: Colors.white38, fontSize: 13),
        textAlign: TextAlign.center),
    ]),
  ));

  Widget _infoBanner(IconData icon, Color color, String title, String body) => Container(
    margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: color.withOpacity(0.08),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withOpacity(0.3)),
    ),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(icon, color: color, size: 20),
      const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13)),
        const SizedBox(height: 3),
        Text(body, style: const TextStyle(color: Colors.white54, fontSize: 12, height: 1.4)),
      ])),
    ]),
  );

  Color _avatarColor(String name) {
    const colors = [
      Color(0xFF1565C0), Color(0xFF6A1B9A), Color(0xFF2E7D32),
      Color(0xFFC62828), Color(0xFF00838F), Color(0xFFE65100),
    ];
    return colors[name.isNotEmpty ? name.codeUnitAt(0) % colors.length : 0];
  }
}
