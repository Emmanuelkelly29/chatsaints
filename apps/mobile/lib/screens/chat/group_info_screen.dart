import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';

class GroupInfoScreen extends StatefulWidget {
  final String groupId;
  const GroupInfoScreen({super.key, required this.groupId});
  @override
  State<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends State<GroupInfoScreen> {
  final _api = ApiService();
  Map<String, dynamic>? _group;
  bool _loading = true;
  final _me = AuthService().currentUser;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final res = await _api.get('/groups/${widget.groupId}');
      if (mounted) setState(() { _group = res; _loading = false; });
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _leaveGroup() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Leave group?'),
        content: const Text('You will no longer receive messages from this group.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true),
            child: const Text('Leave', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/groups/${widget.groupId}/members/${_me?.id}');
      if (mounted) Navigator.popUntil(context, (r) => r.isFirst);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final members  = (_group?['members'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final isAdmin  = _group?['is_admin'] == true;
    final count    = _group?['member_count'] ?? members.length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Group info'),
        actions: [
          if (isAdmin)
            IconButton(icon: const Icon(Icons.edit), onPressed: () {
              // TODO: navigate to edit group screen
            }),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(children: [
              // Group header
              Container(
                padding: const EdgeInsets.all(24),
                color: Colors.white,
                child: Column(children: [
                  CircleAvatar(
                    radius: 48,
                    backgroundColor: AppTheme.primaryLight,
                    backgroundImage: _group?['photo_url'] != null
                        ? NetworkImage(_group!['photo_url']) : null,
                    child: _group?['photo_url'] == null
                        ? const Icon(Icons.group, size: 48, color: Colors.white)
                        : null,
                  ),
                  const SizedBox(height: 12),
                  Text(_group?['name'] ?? '', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text('$count member${count != 1 ? 's' : ''}',
                    style: const TextStyle(color: AppTheme.textSecondary)),
                  if (_group?['description'] != null) ...[
                    const SizedBox(height: 8),
                    Text(_group!['description'],
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppTheme.textSecondary, fontSize: 14)),
                  ],
                ]),
              ),

              const SizedBox(height: 8),

              // Members list
              Container(
                color: Colors.white,
                child: Column(children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
                    child: Align(alignment: Alignment.centerLeft,
                      child: Text('MEMBERS', style: TextStyle(fontSize: 11,
                          fontWeight: FontWeight.w700, color: AppTheme.textSecondary, letterSpacing: 1.2))),
                  ),
                  ...members.map((m) => ListTile(
                    leading: CircleAvatar(
                      backgroundColor: AppTheme.primaryLight,
                      backgroundImage: m['profile_photo_url'] != null
                          ? NetworkImage(m['profile_photo_url']) : null,
                      child: m['profile_photo_url'] == null
                          ? Text((m['full_name'] as String? ?? '?')[0].toUpperCase(),
                              style: const TextStyle(color: Colors.white))
                          : null,
                    ),
                    title: Text(m['full_name'] ?? ''),
                    subtitle: Text(m['role'] ?? '',
                      style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    trailing: m['is_admin'] == true
                        ? Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppTheme.accent.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(10)),
                            child: const Text('Admin',
                              style: TextStyle(fontSize: 11, color: AppTheme.accent, fontWeight: FontWeight.w600)),
                          )
                        : null,
                    onLongPress: isAdmin && m['id'] != _me?.id ? () {
                      showModalBottomSheet(context: context, builder: (_) => SafeArea(
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          if (!m['is_admin'])
                            ListTile(
                              leading: const Icon(Icons.star),
                              title: const Text('Make admin'),
                              onTap: () async {
                                Navigator.pop(context);
                                await _api.patch('/groups/${widget.groupId}/members/${m['id']}/admin', {'is_admin': true});
                                _load();
                              },
                            ),
                          ListTile(
                            leading: const Icon(Icons.remove_circle_outline, color: AppTheme.danger),
                            title: const Text('Remove from group', style: TextStyle(color: AppTheme.danger)),
                            onTap: () async {
                              Navigator.pop(context);
                              await _api.delete('/groups/${widget.groupId}/members/${m['id']}');
                              _load();
                            },
                          ),
                        ]),
                      ));
                    } : null,
                  )),
                ]),
              ),

              const SizedBox(height: 8),

              // Leave group
              Container(
                color: Colors.white,
                child: ListTile(
                  leading: const Icon(Icons.exit_to_app, color: AppTheme.danger),
                  title: const Text('Leave group', style: TextStyle(color: AppTheme.danger)),
                  onTap: _leaveGroup,
                ),
              ),
              const SizedBox(height: 40),
            ]),
    );
  }
}
