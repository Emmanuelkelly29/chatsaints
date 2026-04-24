import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../services/websocket_service.dart';
import '../../models/conversation_model.dart';
import '../../theme/app_theme.dart';
import '../announcements/announcements_screen.dart';
import 'chat_screen.dart';
import 'search_screen.dart';
import 'create_group_screen.dart';

class ConversationsScreen extends StatefulWidget {
  const ConversationsScreen({super.key});
  @override
  State<ConversationsScreen> createState() => _ConversationsScreenState();
}

class _ConversationsScreenState extends State<ConversationsScreen> {
  final _api = ApiService();
  List<ConversationModel> _pinned = [];
  List<ConversationModel> _all = [];
  Map<String, dynamic>? _scripture;
  Timer? _scriptureTimer;
  int _scriptureCountdown = 35; // seconds until next refresh
  Timer? _countdownTimer;
  bool _loading = true;
  int _unreadAnnouncements = 0;
  StreamSubscription? _announcementSub;

  @override
  void initState() {
    super.initState();
    _load();
    _loadScripture();
    _loadUnreadAnnouncements();
    _scriptureTimer = Timer.periodic(const Duration(seconds: 35), (_) => _loadScripture());
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {
        _scriptureCountdown = (_scriptureCountdown > 0) ? _scriptureCountdown - 1 : 35;
      });
      }
    });
    _announcementSub = WebSocketService().messages.listen((msg) {
      if (msg['type'] == 'new_message') _load();
      if (msg['type'] == 'new_announcement' && mounted) {
        setState(() => _unreadAnnouncements++);
      }
    });
  }

  Future<void> _loadUnreadAnnouncements() async {
    try {
      final data = await _api.get('/announcements/unread-count');
      if (mounted) setState(() => _unreadAnnouncements = data['count'] as int? ?? 0);
    } catch (_) {}
  }

  void _openAnnouncements() async {
    await Navigator.push(context,
        MaterialPageRoute(builder: (_) => const AnnouncementsScreen()));
    _loadUnreadAnnouncements();
  }

  Future<void> _loadScripture() async {
    try {
      final res = await _api.get('/scriptures/current');
      if (mounted) setState(() { _scripture = res; _scriptureCountdown = 35; });
    } catch (_) {}
  }

  Future<void> _load() async {
    try {
      final allRes    = await _api.get('/conversations');
      final pinnedRes = await _api.get('/conversations/pinned');
      if (!mounted) return;
      setState(() {
        _all    = (allRes['data'] as List? ?? allRes.values.first as List? ?? [allRes])
            .whereType<Map<String,dynamic>>()
            .map((j) => ConversationModel.fromJson(j)).toList();
        _pinned = (pinnedRes['data'] as List? ?? [])
            .whereType<Map<String,dynamic>>()
            .map((j) => ConversationModel.fromJson(j)).toList();
        _loading = false;
      });
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _pin(String id) async {
    try { await _api.post('/conversations/$id/pin', {}); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  Future<void> _unpin(String id) async {
    try { await _api.delete('/conversations/$id/pin'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  String _formatTime(DateTime? dt) {
    if (dt == null) return '';
    final now = DateTime.now();
    if (dt.day == now.day && dt.month == now.month && dt.year == now.year) {
      return DateFormat('h:mm a').format(dt);
    }
    return DateFormat('MMM d').format(dt);
  }

  // ─── Build ─────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppTheme.background,
    body: SafeArea(
      child: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
          : RefreshIndicator(
              color: AppTheme.accent,
              backgroundColor: AppTheme.surface,
              onRefresh: _load,
              child: CustomScrollView(
                slivers: [
                  // ── Top bar ──
                  SliverToBoxAdapter(child: _buildTopBar()),
                  // ── Scripture card ──
                  SliverToBoxAdapter(child: _buildScriptureCard()),
                  // ── Search bar ──
                  SliverToBoxAdapter(child: _buildSearchBar()),
                  // ── Pinned section ──────────────────────────────────
                  if (_pinned.isNotEmpty) ...[
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
                        child: Row(children: [
                          const Text('📌', style: TextStyle(fontSize: 12)),
                          const SizedBox(width: 6),
                          Text('PINNED',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                                color: AppTheme.textSecondary.withOpacity(0.7), letterSpacing: 1.5)),
                        ]),
                      ),
                    ),
                    SliverToBoxAdapter(child: _buildStoryRow()),
                  ],
                  // ── "CHATS & GROUPS" header ──────────────────────────────
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                      child: Row(children: [
                        const Text('💬', style: TextStyle(fontSize: 12)),
                        const SizedBox(width: 6),
                        Text('CHATS & GROUPS',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                              color: AppTheme.textSecondary.withOpacity(0.7), letterSpacing: 1.5)),
                        const Spacer(),
                        GestureDetector(
                          onTap: _createGroup,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppTheme.accent.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppTheme.accent.withOpacity(0.3)),
                            ),
                            child: Row(mainAxisSize: MainAxisSize.min, children: [
                              Icon(Icons.group_add, color: AppTheme.accent, size: 13),
                              const SizedBox(width: 4),
                              Text('New Group',
                                style: TextStyle(fontSize: 11, color: AppTheme.accent,
                                    fontWeight: FontWeight.w600)),
                            ]),
                          ),
                        ),
                      ]),
                    ),
                  ),
                  // ── Chat list ──
                  _all.isEmpty && _pinned.isEmpty
                      ? SliverFillRemaining(
                          hasScrollBody: false,
                          child: Center(child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.chat_bubble_outline, size: 64,
                                  color: AppTheme.textSecondary.withOpacity(0.4)),
                              const SizedBox(height: 16),
                              const Text('No chats yet.\nSearch for someone to start a conversation.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: AppTheme.textSecondary)),
                            ],
                          )),
                        )
                      : SliverList(
                          delegate: SliverChildBuilderDelegate(
                            (ctx, i) => _ChatTile(
                              conv: _all[i],
                              timeStr: _formatTime(_all[i].lastMessageAt),
                              onTap: () => Navigator.push(context, MaterialPageRoute(
                                  builder: (_) => ChatScreen(conversation: _all[i]))),
                              onLongPress: () => _showOptions(_all[i]),
                            ),
                            childCount: _all.length,
                          ),
                        ),
                ],
              ),
            ),
    ),
    // ── Compose FAB ──
    floatingActionButton: FloatingActionButton(
      heroTag: 'chatsFab',
      backgroundColor: AppTheme.accent,
      foregroundColor: AppTheme.primary,
      shape: const CircleBorder(),
      onPressed: _showNewChatOptions,
      child: const Icon(Icons.edit, size: 22),
    ),
  );

  // ─── Top bar: ⛪ ChatSaints  📷 🔔 ─────────────────────────────────────
  Widget _buildTopBar() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    child: Row(children: [
      // Church icon and brand
      const Icon(Icons.church, color: AppTheme.accent, size: 22),
      const SizedBox(width: 6),
      RichText(
        text: const TextSpan(children: [
          TextSpan(
            text: 'Chat',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800,
                color: Colors.white, letterSpacing: 0.3),
          ),
          TextSpan(
            text: 'Saints',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800,
                color: AppTheme.accent, letterSpacing: 0.3),
          ),
        ]),
      ),
      const Spacer(),
      // Search icon
      _topIcon(Icons.search, () {
        Navigator.push(context, MaterialPageRoute(builder: (_) => const SearchScreen()));
      }),
      const SizedBox(width: 6),
      // Announcements bell with badge
      GestureDetector(
        onTap: _openAnnouncements,
        child: Stack(children: [
          Container(
            width: 34, height: 34,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: AppTheme.primaryLight,
            ),
            child: const Icon(Icons.notifications_outlined, color: Color(0xFFFFD700), size: 18),
          ),
          if (_unreadAnnouncements > 0)
            Positioned(
              right: 0, top: 0,
              child: Container(
                width: 14, height: 14,
                decoration: const BoxDecoration(color: Colors.redAccent, shape: BoxShape.circle),
                child: Center(
                  child: Text(
                    _unreadAnnouncements > 9 ? '9+' : '$_unreadAnnouncements',
                    style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ),
        ]),
      ),
    ]),
  );

  Widget _topIcon(IconData icon, VoidCallback onTap) => GestureDetector(
    onTap: onTap,
    child: Container(
      width: 34, height: 34,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: AppTheme.primaryLight,
      ),
      child: Icon(icon, color: AppTheme.accent, size: 18),
    ),
  );

  // ─── Scripture card ─────────────────────────────────────────────────────────
  Widget _buildScriptureCard() {
    final text = _scripture?['text'] ?? 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish...';
    final book = _scripture?['book'] ?? 'John';
    final ch   = _scripture?['chapter'] ?? 3;
    final vs   = _scripture?['verse'] ?? 16;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.divider, width: 0.5),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.add, color: AppTheme.accent, size: 14),
          const SizedBox(width: 6),
          const Text('SCRIPTURE OF THE MOMENT',
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800,
                color: AppTheme.accent, letterSpacing: 1.5)),
          const Spacer(),
          GestureDetector(
            onTap: _loadScripture,
            child: Icon(Icons.auto_awesome, color: AppTheme.accent.withOpacity(0.5), size: 18),
          ),
        ]),
        const SizedBox(height: 10),
        Text(
          '\u201c$text\u201d',
          style: const TextStyle(color: Colors.white, fontSize: 14,
              fontStyle: FontStyle.italic, height: 1.6, fontWeight: FontWeight.w300),
        ),
        const SizedBox(height: 10),
        Row(children: [
          Text('$book $ch:$vs',
            style: const TextStyle(color: AppTheme.accent, fontSize: 12, fontWeight: FontWeight.w700)),
          const Spacer(),
          Icon(Icons.refresh, color: AppTheme.textSecondary.withOpacity(0.5), size: 14),
          const SizedBox(width: 4),
          Text('0:${_scriptureCountdown.toString().padLeft(2, '0')}',
            style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5), fontSize: 11)),
        ]),
      ]),
    );
  }

  // ─── Search bar ─────────────────────────────────────────────────────────────
  Widget _buildSearchBar() => GestureDetector(
    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SearchScreen())),
    child: Container(
      margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppTheme.divider, width: 0.5),
      ),
      child: Row(children: [
        Icon(Icons.search, color: AppTheme.textSecondary.withOpacity(0.5), size: 20),
        const SizedBox(width: 10),
        Text('Search members, chats...',
          style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5), fontSize: 14)),
      ]),
    ),
  );

  // ─── Story row (pinned conversations) ──────────────────────────────────────
  Widget _buildStoryRow() => SizedBox(
    height: 90,
    child: ListView.builder(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      itemCount: _pinned.length,
      itemBuilder: (ctx, i) {
        final c = _pinned[i];
        return GestureDetector(
          onTap: () => Navigator.push(context, MaterialPageRoute(
              builder: (_) => ChatScreen(conversation: c))),
          child: Container(
            width: 68,
            margin: const EdgeInsets.only(right: 14),
            child: Column(children: [
              Container(
                width: 52, height: 52,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [AppTheme.accent, Colors.deepPurple.shade400],
                    begin: Alignment.topLeft, end: Alignment.bottomRight,
                  ),
                ),
                padding: const EdgeInsets.all(2.5),
                child: CircleAvatar(
                  radius: 24,
                  backgroundColor: AppTheme.surface,
                  backgroundImage: c.photoUrl != null ? NetworkImage(c.photoUrl!) : null,
                  child: c.photoUrl == null
                      ? Icon(c.isGroup ? Icons.group : Icons.person,
                          color: AppTheme.accent, size: 22)
                      : null,
                ),
              ),
              const SizedBox(height: 6),
              Text(c.name ?? 'Chat',
                style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
                maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center),
            ]),
          ),
        );
      },
    ),
  );

  // ─── Options sheet ──────────────────────────────────────────────────────────
  void _showOptions(ConversationModel c) {
    final isPinned = _pinned.any((p) => p.id == c.id);
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 36, height: 4, margin: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(color: AppTheme.divider, borderRadius: BorderRadius.circular(2))),
        ListTile(
          leading: Icon(isPinned ? Icons.push_pin_outlined : Icons.push_pin, color: AppTheme.accent),
          title: Text(isPinned ? 'Unpin chat' : 'Pin chat', style: const TextStyle(color: Colors.white)),
          onTap: () { Navigator.pop(context); isPinned ? _unpin(c.id) : _pin(c.id); },
        ),
      ])),
    );
  }

  // ─── New chat / new group ───────────────────────────────────────────────────
  void _showNewChatOptions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 36, height: 4, margin: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(color: AppTheme.divider, borderRadius: BorderRadius.circular(2))),
        ListTile(
          leading: const Icon(Icons.edit_outlined, color: AppTheme.accent),
          title: const Text('New Chat', style: TextStyle(color: Colors.white)),
          subtitle: Text('Start a 1-on-1 conversation', style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.7))),
          onTap: () {
            Navigator.pop(context);
            Navigator.push(context, MaterialPageRoute(builder: (_) => const SearchScreen()));
          },
        ),
        ListTile(
          leading: const Icon(Icons.group_add, color: AppTheme.accent),
          title: const Text('New Group', style: TextStyle(color: Colors.white)),
          subtitle: Text('Create a group conversation', style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.7))),
          onTap: () {
            Navigator.pop(context);
            _createGroup();
          },
        ),
      ])),
    );
  }

  void _createGroup() {
    Navigator.push(context, MaterialPageRoute(builder: (_) => const CreateGroupScreen()))
        .then((_) => _load());
  }

  @override
  void dispose() {
    _scriptureTimer?.cancel();
    _countdownTimer?.cancel();
    _announcementSub?.cancel();
    super.dispose();
  }
}

// ─── Chat tile ──────────────────────────────────────────────────────────────
class _ChatTile extends StatelessWidget {
  final ConversationModel conv;
  final String timeStr;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  const _ChatTile({
    required this.conv, required this.timeStr,
    required this.onTap, required this.onLongPress,
  });

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    onLongPress: onLongPress,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(children: [
        // Avatar with gradient ring
        Container(
          width: 52, height: 52,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              colors: conv.isGroup
                  ? [AppTheme.accent, Colors.amber.shade700]
                  : [Colors.deepPurple, Colors.purple.shade300],
              begin: Alignment.topLeft, end: Alignment.bottomRight,
            ),
          ),
          padding: const EdgeInsets.all(2.5),
          child: CircleAvatar(
            radius: 24,
            backgroundColor: AppTheme.surface,
            backgroundImage: conv.photoUrl != null ? NetworkImage(conv.photoUrl!) : null,
            child: conv.photoUrl == null
                ? Icon(conv.isGroup ? Icons.church : Icons.person,
                    color: conv.isGroup ? AppTheme.accent : Colors.deepPurple.shade200, size: 24)
                : null,
          ),
        ),
        const SizedBox(width: 14),
        // Name + badge + message
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (conv.isGroup) ...[
              Container(
                margin: const EdgeInsets.only(right: 6),
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withOpacity(0.18),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text('GROUP',
                  style: TextStyle(color: AppTheme.accent, fontSize: 8,
                      fontWeight: FontWeight.w800, letterSpacing: 0.5)),
              ),
            ],
            Flexible(child: Text(conv.name ?? 'Direct Message',
              style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600),
              overflow: TextOverflow.ellipsis)),
            if (!conv.isGroup && conv.badgeLabel != null) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: _badgeColor(conv.role),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(conv.badgeLabel!,
                  style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w800, letterSpacing: 0.5)),
              ),
            ],
          ]),
          const SizedBox(height: 4),
          Text(conv.lastMessage ?? 'No messages yet',
            maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.7), fontSize: 13)),
        ])),
        const SizedBox(width: 10),
        // Time + unread
        Column(crossAxisAlignment: CrossAxisAlignment.end, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(timeStr,
            style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.6), fontSize: 11)),
          if (conv.unreadCount > 0) ...[
            const SizedBox(height: 6),
            Container(
              width: 22, height: 22,
              decoration: const BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: Text('${conv.unreadCount}',
                style: const TextStyle(color: AppTheme.primary, fontSize: 11, fontWeight: FontWeight.w800)),
            ),
          ],
        ]),
      ]),
    ),
  );

  Color _badgeColor(String? role) {
    switch (role) {
      case 'bishop': return Colors.deepPurple;
      case 'stake_presidency': return const Color(0xFF1A6B3C);
      case 'mission_president': return Colors.teal.shade700;
      default: return AppTheme.primaryLight;
    }
  }
}
