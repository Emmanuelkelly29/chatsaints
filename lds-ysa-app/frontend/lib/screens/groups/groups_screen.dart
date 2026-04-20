import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../models/conversation_model.dart';
import '../../theme/app_theme.dart';
import '../chat/chat_screen.dart';

class GroupsScreen extends StatefulWidget {
  const GroupsScreen({super.key});
  @override
  State<GroupsScreen> createState() => _GroupsScreenState();
}

class _GroupsScreenState extends State<GroupsScreen> {
  final _api = ApiService();
  List<ConversationModel> _groups = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get('/conversations?type=group');
      if (!mounted) return;
      setState(() {
        _groups = (res['data'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map((j) => ConversationModel.fromJson(j))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppTheme.background,
    body: SafeArea(
      child: Column(children: [
        // ── Header ──
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
          child: Row(children: [
            const Text('Groups',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Colors.white)),
            const Spacer(),
            GestureDetector(
              onTap: _showCreateGroupDialog,
              child: Container(
                width: 36, height: 36,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppTheme.accent,
                ),
                child: const Icon(Icons.group_add, color: AppTheme.primary, size: 18),
              ),
            ),
          ]),
        ),
        const SizedBox(height: 16),
        // ── List ──
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
              : RefreshIndicator(
                  color: AppTheme.accent,
                  backgroundColor: AppTheme.surface,
                  onRefresh: _load,
                  child: _groups.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 120),
                          Icon(Icons.group_outlined, size: 64,
                              color: AppTheme.textSecondary.withOpacity(0.4)),
                          const SizedBox(height: 16),
                          const Text('No groups yet.\nCreate or join a group to get started.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppTheme.textSecondary)),
                        ])
                      : ListView.builder(
                          itemCount: _groups.length,
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          itemBuilder: (ctx, i) {
                            final g = _groups[i];
                            return InkWell(
                              onTap: () => Navigator.push(context,
                                MaterialPageRoute(builder: (_) => ChatScreen(conversation: g))),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 10),
                                child: Row(children: [
                                  Container(
                                    width: 50, height: 50,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      gradient: LinearGradient(
                                        colors: [AppTheme.accent, Colors.amber.shade700],
                                        begin: Alignment.topLeft, end: Alignment.bottomRight,
                                      ),
                                    ),
                                    padding: const EdgeInsets.all(2.5),
                                    child: CircleAvatar(
                                      radius: 23,
                                      backgroundColor: AppTheme.surface,
                                      backgroundImage: g.photoUrl != null
                                          ? NetworkImage(g.photoUrl!) : null,
                                      child: g.photoUrl == null
                                          ? const Icon(Icons.group, color: AppTheme.accent, size: 22)
                                          : null,
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(g.name ?? 'Group',
                                        style: const TextStyle(color: Colors.white, fontSize: 15,
                                            fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 3),
                                      Text('${g.memberCount} members',
                                        style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.7),
                                            fontSize: 12)),
                                    ],
                                  )),
                                  if (g.unreadCount > 0)
                                    Container(
                                      width: 22, height: 22,
                                      decoration: const BoxDecoration(
                                        color: AppTheme.accent, shape: BoxShape.circle),
                                      alignment: Alignment.center,
                                      child: Text('${g.unreadCount}',
                                        style: const TextStyle(color: AppTheme.primary,
                                            fontSize: 11, fontWeight: FontWeight.w800)),
                                    ),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
        ),
      ]),
    ),
  );

  void _showCreateGroupDialog() {
    final nameCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Create Group', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: nameCtrl,
          autofocus: true,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'Group name',
            hintStyle: TextStyle(color: Colors.white.withOpacity(0.4)),
            enabledBorder: UnderlineInputBorder(
              borderSide: BorderSide(color: Colors.white.withOpacity(0.3))),
            focusedBorder: const UnderlineInputBorder(
              borderSide: BorderSide(color: AppTheme.accent)),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          TextButton(
            onPressed: () async {
              final name = nameCtrl.text.trim();
              if (name.isEmpty) return;
              Navigator.pop(context);
              try {
                await _api.post('/conversations', {
                  'type': 'group',
                  'name': name,
                  'member_ids': <String>[],
                });
                _load();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(e.toString())));
                }
              }
            },
            child: const Text('Create', style: TextStyle(color: AppTheme.accent)),
          ),
        ],
      ),
    );
  }
}
