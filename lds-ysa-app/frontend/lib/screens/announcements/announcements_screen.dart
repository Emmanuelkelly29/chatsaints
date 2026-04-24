import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../services/websocket_service.dart';
import '../../theme/app_theme.dart';

// â”€â”€ Who can send announcements â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _senderRoles = {
  'bishop', 'stake_presidency', 'district_presidency',
  'coordinating_council', 'area_authority', 'mission_president',
  'mission_president_wife', 'area_presidency', 'general_authority',
  'apostle', 'first_presidency', 'ysa_rep', 'ysa_adviser', 'it_support',
};

class AnnouncementsScreen extends StatefulWidget {
  const AnnouncementsScreen({super.key});
  @override
  State<AnnouncementsScreen> createState() => _AnnouncementsScreenState();
}

class _AnnouncementsScreenState extends State<AnnouncementsScreen>
    with SingleTickerProviderStateMixin {
  final _api  = ApiService();
  final _ws   = WebSocketService();
  StreamSubscription? _wsSub;
  late TabController _tabCtrl;

  List<Map<String, dynamic>> _received = [];
  List<Map<String, dynamic>> _sent     = [];
  bool _loadingReceived = true;
  bool _loadingSent     = true;
  String? _errorReceived;
  String? _errorSent;
  int _unread = 0;

  bool get _canSend => _senderRoles.contains(AuthService().currentUser?.role ?? '');

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: _canSend ? 2 : 1, vsync: this);
    _loadReceived();
    if (_canSend) _loadSent();
    _wsSub = _ws.messages.listen((msg) {
      if (msg['type'] == 'new_announcement') {
        final p = msg['payload'] as Map<String, dynamic>;
        if (mounted) {
          setState(() {
            _received.insert(0, {
              'id': p['id'],
              'title': p['title'],
              'body': p['body'],
              'sender_name': p['sender_name'],
              'sender_role': p['sender_role'],
              'scope': p['scope'],
              'created_at': p['created_at'],
              'is_read': false,
            });
            _unread++;
          });
        }
      }
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    _tabCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadReceived() async {
    setState(() { _loadingReceived = true; _errorReceived = null; });
    try {
      final data = await _api.get('/announcements');
      if (mounted) setState(() {
        _received = List<Map<String, dynamic>>.from(data['announcements'] ?? []);
        _unread   = data['unread_count'] as int? ?? 0;
        _loadingReceived = false;
      });
    } catch (e) {
      if (mounted) setState(() { _loadingReceived = false; _errorReceived = e.toString(); });
    }
  }

  Future<void> _loadSent() async {
    setState(() { _loadingSent = true; _errorSent = null; });
    try {
      final data = await _api.get('/announcements/sent');
      if (mounted) setState(() {
        _sent = List<Map<String, dynamic>>.from(data['announcements'] ?? []);
        _loadingSent = false;
      });
    } catch (e) {
      if (mounted) setState(() { _loadingSent = false; _errorSent = e.toString(); });
    }
  }

  Future<void> _markRead(String id) async {
    try {
      await _api.patch('/announcements/$id/read', {});
      if (mounted) setState(() {
        final idx = _received.indexWhere((a) => a['id'] == id);
        if (idx >= 0 && _received[idx]['is_read'] == false) {
          _received[idx] = {..._received[idx], 'is_read': true};
          if (_unread > 0) _unread--;
        }
      });
    } catch (_) {}
  }

  Future<void> _markAllRead() async {
    try {
      await _api.patch('/announcements/read-all', {});
      if (mounted) setState(() {
        _received = _received.map((a) => {...a, 'is_read': true}).toList();
        _unread = 0;
      });
    } catch (_) {}
  }

  void _openCompose() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ComposeSheet(onSent: () {
        _loadReceived();
        _loadSent();
      }),
    );
  }

  void _openEdit(Map<String, dynamic> ann) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _EditSheet(
        ann: ann,
        onSaved: () => _loadSent(),
      ),
    );
  }

  String _formatTime(String? iso) {
    if (iso == null) return '';
    final dt = DateTime.tryParse(iso)?.toLocal();
    if (dt == null) return '';
    return DateFormat('MMM d, yyyy • h:mm a').format(dt);
  }

  String _scopeLabel(String? scope) {
    switch (scope) {
      case 'global':   return 'All Members';
      case 'mission':  return 'Mission';
      case 'stake':    return 'Stake';
      case 'district': return 'District';
      default:         return scope ?? '';
    }
  }

  String _audienceLabel(String? audienceJson) {
    if (audienceJson == null || audienceJson.isEmpty) return '';
    List<dynamic> list;
    try {
      list = json.decode(audienceJson) as List<dynamic>;
    } catch (_) {
      list = [audienceJson]; // legacy single string
    }
    if (list.isEmpty || list.contains('all')) return '';
    const labels = {
      'ysa_only':                 'YSA Members',
      'missionaries_only':        'Missionaries',
      'ysa_and_missionaries':     'YSA & Missionaries',
      'ward_leaders':             'Ward Leaders',
      'stake_district_presidents':'Stake/District Presidents',
      'all_leaders':              'All Leaders',
    };
    return list.map((v) => labels[v] ?? '').where((s) => s.isNotEmpty).join(', ');
  }

  IconData _scopeIcon(String? scope) {
    switch (scope) {
      case 'global':   return Icons.public;
      case 'mission':  return Icons.flag;
      case 'stake':    return Icons.location_city;
      case 'district': return Icons.map_outlined;
      default:         return Icons.announcement_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: Row(children: [
          const Text('Announcements'),
          if (_unread > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.redAccent,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text('$_unread', style: const TextStyle(color: Colors.white, fontSize: 12)),
            ),
          ],
        ]),
        backgroundColor: AppTheme.surface,
        foregroundColor: AppTheme.textPrimary,
        actions: [
          if (_unread > 0)
            TextButton(
              onPressed: _markAllRead,
              child: const Text('Mark all read', style: TextStyle(fontSize: 13)),
            ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: () {
            _loadReceived();
            if (_canSend) _loadSent();
          }),
        ],
        bottom: _canSend ? TabBar(
          controller: _tabCtrl,
          indicatorColor: AppTheme.accent,
          labelColor: AppTheme.accent,
          unselectedLabelColor: AppTheme.textSecondary,
          tabs: const [
            Tab(text: 'Received'),
            Tab(text: 'Sent'),
          ],
        ) : null,
      ),
      body: _canSend
          ? TabBarView(
              controller: _tabCtrl,
              children: [
                _buildReceivedList(),
                _buildSentList(),
              ],
            )
          : _buildReceivedList(),
      floatingActionButton: _canSend
          ? FloatingActionButton.extended(
              onPressed: _openCompose,
              backgroundColor: AppTheme.accent,
              icon: const Icon(Icons.edit, color: Colors.white),
              label: const Text('New', style: TextStyle(color: Colors.white)),
            )
          : null,
    );
  }

  Widget _buildReceivedList() {
    if (_loadingReceived) return const Center(child: CircularProgressIndicator());
    if (_errorReceived != null) return Center(child: Text(_errorReceived!, style: TextStyle(color: AppTheme.textSecondary)));
    if (_received.isEmpty) return _emptyState('No announcements yet', Icons.announcement_outlined);
    return RefreshIndicator(
      onRefresh: _loadReceived,
      child: ListView.separated(
        itemCount: _received.length,
        separatorBuilder: (_, __) => Divider(height: 1, color: AppTheme.surface),
        itemBuilder: (_, i) {
          final ann = _received[i];
          final isUnread = ann['is_read'] == false;
          return InkWell(
            onTap: () {
              if (isUnread) _markRead(ann['id'] as String);
              _showDetail(ann, isSent: false);
            },
            child: _buildAnnouncementTile(ann, isUnread: isUnread),
          );
        },
      ),
    );
  }

  Widget _buildSentList() {
    if (_loadingSent) return const Center(child: CircularProgressIndicator());
    if (_errorSent != null) return Center(child: Text(_errorSent!, style: TextStyle(color: AppTheme.textSecondary)));
    if (_sent.isEmpty) return _emptyState('No sent announcements', Icons.send_outlined);
    return RefreshIndicator(
      onRefresh: _loadSent,
      child: ListView.separated(
        itemCount: _sent.length,
        separatorBuilder: (_, __) => Divider(height: 1, color: AppTheme.surface),
        itemBuilder: (_, i) {
          final ann = _sent[i];
          final recipientCount = ann['recipient_count'] ?? 0;
          final readCount      = ann['read_count'] ?? 0;
          return InkWell(
            onTap: () => _showDetail(ann, isSent: true),
            child: Container(
              color: Colors.transparent,
              padding: const EdgeInsets.all(16),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Icon(_scopeIcon(ann['scope'] as String?), color: AppTheme.accent, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(
                        child: Text(ann['title'] as String? ?? '',
                          style: TextStyle(fontWeight: FontWeight.w600, color: AppTheme.textPrimary, fontSize: 15),
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                      Text(_formatTime(ann['created_at'] as String?),
                          style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                    ]),
                    const SizedBox(height: 4),
                    Text(ann['body'] as String? ?? '',
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                        maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 6),
                    Row(children: [
                      Icon(Icons.done_all, size: 13, color: AppTheme.accent),
                      const SizedBox(width: 4),
                      Text('$readCount / $recipientCount read',
                          style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                      const Spacer(),
                      GestureDetector(
                        onTap: () => _openEdit(ann),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppTheme.accent.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Row(mainAxisSize: MainAxisSize.min, children: [
                            Icon(Icons.edit_outlined, size: 13, color: AppTheme.accent),
                            const SizedBox(width: 4),
                            Text('Edit', style: TextStyle(color: AppTheme.accent, fontSize: 12, fontWeight: FontWeight.w600)),
                          ]),
                        ),
                      ),
                    ]),
                  ]),
                ),
              ]),
            ),
          );
        },
      ),
    );
  }

  Widget _buildAnnouncementTile(Map<String, dynamic> ann, {required bool isUnread}) {
    return Container(
      color: isUnread ? AppTheme.accent.withOpacity(0.07) : Colors.transparent,
      padding: const EdgeInsets.all(16),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 44, height: 44,
          decoration: BoxDecoration(
            color: AppTheme.accent.withOpacity(0.15),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Icon(_scopeIcon(ann['scope'] as String?), color: AppTheme.accent, size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text(ann['title'] as String? ?? '',
                  style: TextStyle(
                    fontWeight: isUnread ? FontWeight.w700 : FontWeight.w600,
                    color: AppTheme.textPrimary,
                    fontSize: 15,
                  ),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(_formatTime(ann['created_at'] as String?),
                  style: TextStyle(
                    color: isUnread ? AppTheme.accent : AppTheme.textSecondary,
                    fontSize: 12,
                  )),
            ]),
            const SizedBox(height: 4),
            Text(ann['body'] as String? ?? '',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 6),
            Row(children: [
              Icon(Icons.person_outline, size: 13, color: AppTheme.textSecondary),
              const SizedBox(width: 4),
              Text(ann['sender_name'] as String? ?? 'Leader',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(_scopeLabel(ann['scope'] as String?),
                    style: TextStyle(color: AppTheme.accent, fontSize: 11)),
              ),
              if (_audienceLabel(ann['audience'] as String?).isNotEmpty) ...[
                const SizedBox(width: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.orangeAccent.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(_audienceLabel(ann['audience'] as String?),
                      style: const TextStyle(color: Colors.orangeAccent, fontSize: 11)),
                ),
              ],
            ]),
          ]),
        ),
        if (isUnread)
          Padding(
            padding: const EdgeInsets.only(left: 8, top: 4),
            child: Container(
              width: 8, height: 8,
              decoration: const BoxDecoration(color: Colors.redAccent, shape: BoxShape.circle),
            ),
          ),
      ]),
    );
  }

  Widget _emptyState(String text, IconData icon) {
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 64, color: AppTheme.textSecondary),
        const SizedBox(height: 16),
        Text(text, style: TextStyle(color: AppTheme.textSecondary, fontSize: 16)),
      ]),
    );
  }

  void _showDetail(Map<String, dynamic> ann, {required bool isSent}) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (_, ctrl) => ListView(controller: ctrl, padding: const EdgeInsets.all(24), children: [
          Row(children: [
            Icon(_scopeIcon(ann['scope'] as String?), color: AppTheme.accent),
            const SizedBox(width: 8),
            Text(_scopeLabel(ann['scope'] as String?),
                style: TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w600)),
            const Spacer(),
            if (isSent)
              TextButton.icon(
                onPressed: () {
                  Navigator.pop(context);
                  _openEdit(ann);
                },
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: const Text('Edit'),
                style: TextButton.styleFrom(foregroundColor: AppTheme.accent),
              ),
          ]),
          const SizedBox(height: 12),
          Text(ann['title'] as String? ?? '',
              style: TextStyle(color: AppTheme.textPrimary, fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (!isSent) ...[
            Row(children: [
              Icon(Icons.person_outline, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 4),
              Text('${ann['sender_name']} · ${(ann['sender_role'] as String?)?.replaceAll('_', ' ') ?? ''}',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
            ]),
            const SizedBox(height: 4),
          ],
          Text(_formatTime(ann['created_at'] as String?),
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
          if (isSent) ...[
            const SizedBox(height: 4),
            Row(children: [
              Icon(Icons.done_all, size: 14, color: AppTheme.accent),
              const SizedBox(width: 4),
              Text('${ann['read_count'] ?? 0} / ${ann['recipient_count'] ?? 0} recipients read',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
            ]),
          ],
          const Divider(height: 24),
          Text(ann['body'] as String? ?? '',
              style: TextStyle(color: AppTheme.textPrimary, fontSize: 15, height: 1.6)),
          const SizedBox(height: 40),
        ]),
      ),
    );
  }
}

// â”€â”€ Compose Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class _AudienceOption {
  final String value;
  final String label;
  final String description;
  final IconData icon;
  const _AudienceOption(this.value, this.label, this.description, this.icon);
}

// Full catalogue of audience options
const _kAudienceOptions = [
  _AudienceOption('ysa_only',                'YSA Members',                 'Young single adults only',                       Icons.people_outline),
  _AudienceOption('missionaries_only',        'Missionaries',                'Full-time missionaries only',                    Icons.flag_outlined),
  _AudienceOption('ysa_and_missionaries',     'YSA & Missionaries',          'Young single adults and missionaries',            Icons.groups),
  _AudienceOption('ward_leaders',             'Ward Leaders',                'Bishops, YSA reps & YSA advisers',               Icons.account_balance),
  _AudienceOption('stake_district_presidents','Stake & District Presidents', 'Stake and district presidency only',             Icons.domain),
  _AudienceOption('all_leaders',              'All Leaders',                 'Every leader in your jurisdiction',              Icons.admin_panel_settings_outlined),
  _AudienceOption('all',                      'Everyone',                    'All members and leaders in your jurisdiction',   Icons.public),
];

_AudienceOption _findOpt(String v) =>
    _kAudienceOptions.firstWhere((o) => o.value == v,
        orElse: () => const _AudienceOption('all', 'Everyone', 'All members', Icons.public));

enum _AudienceMode { locked, single, multi }

class _AudienceConfig {
  final _AudienceMode mode;
  final List<String> values;     // available option values
  final String lockedValue;      // used only in locked mode
  final String lockedLabel;      // display text in locked mode
  const _AudienceConfig.locked(this.lockedValue, this.lockedLabel)
      : mode = _AudienceMode.locked, values = const [];
  const _AudienceConfig.single(this.values)
      : mode = _AudienceMode.single, lockedValue = '', lockedLabel = '';
  const _AudienceConfig.multi(this.values)
      : mode = _AudienceMode.multi, lockedValue = '', lockedLabel = '';
}

_AudienceConfig _configForRole(String role) {
  // Locked â€” no choice
  if (['ysa_rep','ysa_adviser'].contains(role))
    return const _AudienceConfig.locked('ysa_only', 'YSA Members in your stake only');
  if (['mission_president','mission_president_wife'].contains(role))
    return const _AudienceConfig.locked('missionaries_only', 'Missionaries in your mission only');
  // Bishop â€” limited single-select within his ward/stake
  if (role == 'bishop')
    return const _AudienceConfig.single(
        ['ysa_only','missionaries_only','ysa_and_missionaries','ward_leaders','all']);
  // Stake/district-level leaders â€” single-select
  if (['stake_presidency','district_presidency','coordinating_council','area_authority'].contains(role))
    return const _AudienceConfig.single([
      'ysa_only','missionaries_only','ysa_and_missionaries',
      'ward_leaders','stake_district_presidents','all_leaders','all',
    ]);
  // Global leaders â€” multi-select
  return const _AudienceConfig.multi([
    'ysa_only','missionaries_only','ysa_and_missionaries',
    'ward_leaders','stake_district_presidents','all_leaders','all',
  ]);
}

// ── Edit Sheet ────────────────────────────────────────────────────────────────────

class _EditSheet extends StatefulWidget {
  final Map<String, dynamic> ann;
  final VoidCallback onSaved;
  const _EditSheet({required this.ann, required this.onSaved});
  @override
  State<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends State<_EditSheet> {
  late TextEditingController _titleCtrl;
  late TextEditingController _bodyCtrl;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: widget.ann['title'] as String? ?? '');
    _bodyCtrl  = TextEditingController(text: widget.ann['body']  as String? ?? '');
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_titleCtrl.text.trim().isEmpty || _bodyCtrl.text.trim().isEmpty) return;
    setState(() => _saving = true);
    try {
      await ApiService().patch('/announcements/${widget.ann['id']}', {
        'title': _titleCtrl.text.trim(),
        'body':  _bodyCtrl.text.trim(),
      });
      if (mounted) {
        Navigator.pop(context);
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Announcement updated')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.toString()), backgroundColor: Colors.redAccent));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollCtrl) => Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: ListView(controller: scrollCtrl, padding: EdgeInsets.only(
          left: 20, right: 20, top: 12,
          bottom: MediaQuery.of(context).viewInsets.bottom + 24,
        ), children: [
          Center(child: Container(width: 40, height: 4,
              decoration: BoxDecoration(color: AppTheme.textSecondary.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 16),
          Row(children: [
            const Icon(Icons.edit_outlined, color: AppTheme.accent),
            const SizedBox(width: 8),
            Text('Edit Announcement',
                style: TextStyle(color: AppTheme.textPrimary, fontSize: 18, fontWeight: FontWeight.w700)),
            const Spacer(),
            IconButton(icon: Icon(Icons.close, color: AppTheme.textSecondary),
                onPressed: () => Navigator.pop(context)),
          ]),
          const SizedBox(height: 20),
          Text('Title', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          TextField(
            controller: _titleCtrl,
            decoration: InputDecoration(
              fillColor: AppTheme.background,
              filled: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            ),
            style: TextStyle(color: AppTheme.textPrimary),
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 14),
          Text('Message', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          TextField(
            controller: _bodyCtrl,
            maxLines: 6,
            decoration: InputDecoration(
              fillColor: AppTheme.background,
              filled: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              contentPadding: const EdgeInsets.all(14),
            ),
            style: TextStyle(color: AppTheme.textPrimary),
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 20),
          ElevatedButton.icon(
            onPressed: _saving ? null : _save,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.accent,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: _saving
                ? const SizedBox(width: 18, height: 18,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Icon(Icons.check, color: Colors.white, size: 18),
            label: Text(
              _saving ? 'Saving...' : 'Save Changes',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15),
            ),
          ),
        ]),
      ),
    );
  }
}

// ── Compose Sheet ─────────────────────────────────────────────────────────────────

class _ComposeSheet extends StatefulWidget {
  final VoidCallback onSent;
  const _ComposeSheet({required this.onSent});
  @override
  State<_ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<_ComposeSheet> {
  final _titleCtrl = TextEditingController();
  final _bodyCtrl  = TextEditingController();
  bool _sending = false;
  late _AudienceConfig _config;
  late List<String> _audiences; // selected audience values (array)

  @override
  void initState() {
    super.initState();
    final role = AuthService().currentUser?.role ?? '';
    _config = _configForRole(role);
    switch (_config.mode) {
      case _AudienceMode.locked:
        _audiences = [_config.lockedValue];
      case _AudienceMode.single:
        _audiences = [_config.values.first];
      case _AudienceMode.multi:
        _audiences = ['all'];
    }
  }

  Future<void> _send() async {
    if (_titleCtrl.text.trim().isEmpty || _bodyCtrl.text.trim().isEmpty) return;
    if (_audiences.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please select at least one recipient group')));
      return;
    }
    setState(() => _sending = true);
    try {
      await ApiService().post('/announcements', {
        'title':     _titleCtrl.text.trim(),
        'body':      _bodyCtrl.text.trim(),
        'audiences': _audiences,
      });
      if (mounted) {
        Navigator.pop(context);
        widget.onSent();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Announcement sent successfully')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.redAccent));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  // Multi-select modal (area presidency and global leaders)
  void _showMultiSelectSheet() {
    final temp = Set<String>.from(_audiences);
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(builder: (ctx, setSheet) {
        return SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const SizedBox(height: 8),
            Center(child: Container(width: 40, height: 4,
                decoration: BoxDecoration(
                    color: AppTheme.textSecondary.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(2)))),
            Padding(padding: const EdgeInsets.fromLTRB(20, 12, 8, 4),
              child: Row(children: [
                Text('Select Recipients',
                    style: TextStyle(color: AppTheme.textPrimary,
                        fontSize: 16, fontWeight: FontWeight.w700)),
                const Spacer(),
                TextButton(
                  onPressed: () {
                    if (temp.isEmpty) temp.add('all');
                    setState(() => _audiences = temp.toList());
                    Navigator.pop(ctx);
                  },
                  child: Text('Done',
                      style: TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w700)),
                ),
              ]),
            ),
            const Divider(height: 1),
            ..._config.values.map((v) {
              final opt = _findOpt(v);
              final checked = temp.contains(v);
              return CheckboxListTile(
                value: checked,
                activeColor: AppTheme.accent,
                controlAffinity: ListTileControlAffinity.trailing,
                secondary: Icon(opt.icon, color: AppTheme.accent, size: 22),
                title: Text(opt.label,
                    style: TextStyle(color: AppTheme.textPrimary,
                        fontSize: 14, fontWeight: FontWeight.w600)),
                subtitle: Text(opt.description,
                    style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                onChanged: (val) {
                  setSheet(() {
                    if (val == true) {
                      if (opt.value == 'all') {
                        temp.clear(); // 'all' clears specifics
                      } else {
                        temp.remove('all'); // specific removes 'all'
                      }
                      temp.add(opt.value);
                    } else {
                      temp.remove(opt.value);
                    }
                  });
                },
              );
            }),
            const SizedBox(height: 16),
          ]),
        );
      }),
    );
  }

  String get _sendButtonLabel {
    if (_audiences.isEmpty) return 'Select recipients first';
    if (_audiences.contains('all')) return 'Send to Everyone';
    return 'Send to ${_audiences.map((v) => _findOpt(v).label).join(' & ')}';
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollCtrl) => Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: ListView(controller: scrollCtrl, padding: EdgeInsets.only(
          left: 20, right: 20, top: 12,
          bottom: MediaQuery.of(context).viewInsets.bottom + 24,
        ), children: [
          // Drag handle
          Center(child: Container(width: 40, height: 4,
              decoration: BoxDecoration(color: AppTheme.textSecondary.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 16),

          // Header
          Row(children: [
            const Icon(Icons.announcement_outlined, color: AppTheme.accent),
            const SizedBox(width: 8),
            Text('New Announcement',
                style: TextStyle(color: AppTheme.textPrimary, fontSize: 18,
                    fontWeight: FontWeight.w700)),
            const Spacer(),
            IconButton(icon: Icon(Icons.close, color: AppTheme.textSecondary),
                onPressed: () => Navigator.pop(context)),
          ]),
          const SizedBox(height: 20),

          // â”€â”€ Send To â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          Text('Send To',
              style: TextStyle(color: AppTheme.textSecondary,
                  fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),

          // LOCKED â€” ysa_rep, mission_president etc.
          if (_config.mode == _AudienceMode.locked)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              decoration: BoxDecoration(
                color: AppTheme.background.withOpacity(0.6),
                border: Border.all(color: AppTheme.textSecondary.withOpacity(0.2)),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(children: [
                Icon(Icons.lock_outline, size: 16, color: AppTheme.textSecondary),
                const SizedBox(width: 10),
                Expanded(child: Text(_config.lockedLabel,
                    style: TextStyle(color: AppTheme.textPrimary, fontSize: 14))),
              ]),
            ),

          // SINGLE-SELECT â€” bishop, stake/district leaders
          if (_config.mode == _AudienceMode.single)
            Container(
              decoration: BoxDecoration(
                color: AppTheme.background,
                border: Border.all(color: AppTheme.accent.withOpacity(0.3)),
                borderRadius: BorderRadius.circular(10),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _audiences.isNotEmpty ? _audiences.first : _config.values.first,
                  isExpanded: true,
                  dropdownColor: AppTheme.surface,
                  borderRadius: BorderRadius.circular(10),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                  onChanged: (v) { if (v != null) setState(() => _audiences = [v]); },
                  items: _config.values.map((v) {
                    final opt = _findOpt(v);
                    return DropdownMenuItem<String>(
                      value: v,
                      child: Row(children: [
                        Icon(opt.icon, size: 16, color: AppTheme.accent),
                        const SizedBox(width: 10),
                        Expanded(child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(opt.label,
                                style: TextStyle(color: AppTheme.textPrimary,
                                    fontSize: 14, fontWeight: FontWeight.w600)),
                            Text(opt.description,
                                style: TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                          ],
                        )),
                      ]),
                    );
                  }).toList(),
                ),
              ),
            ),

          // MULTI-SELECT â€” area presidency, GA, apostle, first presidency, IT support
          if (_config.mode == _AudienceMode.multi)
            GestureDetector(
              onTap: _showMultiSelectSheet,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: AppTheme.background,
                  border: Border.all(color: AppTheme.accent.withOpacity(0.3)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(children: [
                  Icon(Icons.people_alt_outlined, size: 18, color: AppTheme.accent),
                  const SizedBox(width: 10),
                  Expanded(child: _audiences.isEmpty
                      ? Text('Tap to select recipients...',
                          style: TextStyle(color: AppTheme.textSecondary, fontSize: 14))
                      : Wrap(spacing: 6, runSpacing: 4,
                          children: _audiences.map((v) {
                            final opt = _findOpt(v);
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: AppTheme.accent.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(opt.label,
                                  style: TextStyle(color: AppTheme.accent,
                                      fontSize: 12, fontWeight: FontWeight.w600)),
                            );
                          }).toList(),
                        )),
                  const SizedBox(width: 4),
                  Icon(Icons.arrow_drop_down, color: AppTheme.textSecondary),
                ]),
              ),
            ),

          const SizedBox(height: 20),

          // â”€â”€ Title â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          Text('Title', style: TextStyle(color: AppTheme.textSecondary,
              fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          TextField(
            controller: _titleCtrl,
            decoration: InputDecoration(
              hintText: 'e.g. Stake Conference Reminder',
              fillColor: AppTheme.background,
              filled: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            ),
            style: TextStyle(color: AppTheme.textPrimary),
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 14),

          // â”€â”€ Message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          Text('Message', style: TextStyle(color: AppTheme.textSecondary,
              fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          TextField(
            controller: _bodyCtrl,
            maxLines: 5,
            decoration: InputDecoration(
              hintText: 'Write your announcement here...',
              fillColor: AppTheme.background,
              filled: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              contentPadding: const EdgeInsets.all(14),
            ),
            style: TextStyle(color: AppTheme.textPrimary),
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 20),

          // â”€â”€ Send button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          ElevatedButton.icon(
            onPressed: (_sending || _audiences.isEmpty) ? null : _send,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.accent,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: _sending
                ? const SizedBox(width: 18, height: 18,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Icon(Icons.send, color: Colors.white, size: 18),
            label: Text(
              _sending ? 'Sending...' : _sendButtonLabel,
              style: const TextStyle(color: Colors.white,
                  fontWeight: FontWeight.w700, fontSize: 15),
            ),
          ),
        ]),
      ),
    );
  }
}

