import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../models/status_model.dart';
import '../../theme/app_theme.dart';
import 'status_viewer_screen.dart';
import 'status_post_screen.dart';
import 'my_status_screen.dart';

class StatusFeedScreen extends StatefulWidget {
  const StatusFeedScreen({super.key});
  @override
  State<StatusFeedScreen> createState() => _StatusFeedScreenState();
}

class _StatusFeedScreenState extends State<StatusFeedScreen> {
  final _api = ApiService();
  final _me = AuthService().currentUser;
  List<StatusContact> _contacts = [];
  List<StatusModel> _myStatuses = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      // Both endpoints return JSON arrays — use getList()
      final results = await Future.wait([
        _api.getList('/statuses/feed'),
        _api.getList('/statuses/mine'),
      ]);

      if (!mounted) return;
      setState(() {
        _contacts   = results[0].whereType<Map<String,dynamic>>()
            .map((j) => StatusContact.fromJson(j)).toList();
        _myStatuses = results[1].whereType<Map<String,dynamic>>()
            .map((j) => StatusModel.fromJson(j)).toList();
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openMyStatus() {
    if (_myStatuses.isEmpty) {
      // Go straight to posting
      Navigator.push(context, MaterialPageRoute(builder: (_) => const StatusPostScreen()))
          .then((_) => _load());
    } else {
      Navigator.push(context,
        MaterialPageRoute(builder: (_) => MyStatusScreen(statuses: _myStatuses)))
          .then((_) => _load());
    }
  }

  void _openContactStatus(StatusContact contact) {
    Navigator.push(context,
      MaterialPageRoute(builder: (_) => StatusViewerScreen(contact: contact)))
        .then((_) => _load());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Status'),
      actions: [
        IconButton(
          icon: const Icon(Icons.more_vert),
          onPressed: _showSettingsSheet,
        ),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              children: [
                // ── My Status ────────────────────────────────────
                const _SectionHeader(title: 'My status'),
                _MyStatusTile(
                  name: _me?.fullName ?? 'My Status',
                  photo: _me?.profilePhotoUrl,
                  statusCount: _myStatuses.length,
                  latestText: _myStatuses.isNotEmpty ? (_myStatuses.first.textContent ?? _myStatuses.first.caption ?? '') : '',
                  onTap: _openMyStatus,
                  onPost: () => Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const StatusPostScreen()))
                      .then((_) => _load()),
                ),

                // ── Recent (unviewed) ─────────────────────────────
                if (_contacts.any((c) => !c.allViewed)) ...[
                  const _SectionHeader(title: 'Recent updates'),
                  ..._contacts
                      .where((c) => !c.allViewed)
                      .map((c) => _ContactStatusTile(
                            contact: c,
                            onTap: () => _openContactStatus(c),
                          )),
                ],

                // ── Viewed ────────────────────────────────────────
                if (_contacts.any((c) => c.allViewed)) ...[
                  const _SectionHeader(title: 'Viewed'),
                  ..._contacts
                      .where((c) => c.allViewed)
                      .map((c) => _ContactStatusTile(
                            contact: c,
                            onTap: () => _openContactStatus(c),
                          )),
                ],

                if (_contacts.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(48),
                    child: Column(children: [
                      Icon(Icons.circle_outlined, size: 64, color: AppTheme.textSecondary),
                      SizedBox(height: 16),
                      Text('No status updates yet.\nContacts who post will appear here.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppTheme.textSecondary)),
                    ]),
                  ),
              ],
            ),
          ),
    floatingActionButton: FloatingActionButton(
      heroTag: 'statusFab',
      onPressed: () => Navigator.push(context,
        MaterialPageRoute(builder: (_) => const StatusPostScreen()))
          .then((_) => _load()),
      backgroundColor: AppTheme.accent,
      child: const Icon(Icons.add, color: AppTheme.primary),
    ),
  );

  void _showSettingsSheet() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => _StatusSettingsSheet(onSaved: _load),
    );
  }
}

// ── Section Header ──────────────────────────────────────────────
class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
    child: Text(title.toUpperCase(),
      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
          color: AppTheme.textSecondary, letterSpacing: 1.1)),
  );
}

// ── My Status Tile ───────────────────────────────────────────────
class _MyStatusTile extends StatelessWidget {
  final String name;
  final String? photo;
  final int statusCount;
  final String latestText;
  final VoidCallback onTap, onPost;

  const _MyStatusTile({
    required this.name, this.photo,
    required this.statusCount, this.latestText = '',
    required this.onTap, required this.onPost,
  });

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    leading: Stack(children: [
      _RingAvatar(photo: photo, name: name, hasStatus: statusCount > 0, viewed: false, size: 52),
      Positioned(
        right: 0, bottom: 0,
        child: GestureDetector(
          onTap: onPost,
          child: Container(
            width: 20, height: 20,
            decoration: const BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle),
            child: const Icon(Icons.add, size: 14, color: AppTheme.primary),
          ),
        ),
      ),
    ]),
    title: const Text('My status', style: TextStyle(fontWeight: FontWeight.w600)),
    subtitle: Text(
      statusCount == 0
          ? 'Tap + to add a status update'
          : latestText.isNotEmpty
              ? '$statusCount update${statusCount > 1 ? 's' : ''} · $latestText'
              : '$statusCount status update${statusCount > 1 ? 's' : ''}',
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
    ),
    onTap: onTap,
  );
}

// ── Contact Status Tile ──────────────────────────────────────────
class _ContactStatusTile extends StatelessWidget {
  final StatusContact contact;
  final VoidCallback onTap;
  const _ContactStatusTile({required this.contact, required this.onTap});

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    leading: _RingAvatar(
      photo: contact.authorPhoto,
      name: contact.authorName,
      hasStatus: true,
      viewed: contact.allViewed,
      size: 52,
    ),
    title: Text(contact.authorName, style: const TextStyle(fontWeight: FontWeight.w600)),
    subtitle: Text(
      '${contact.statuses.length} update${contact.statuses.length > 1 ? 's' : ''} · '
      '${contact.statuses.last.timeLeftLabel}',
      style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
    ),
    onTap: onTap,
  );
}

// ── Ring Avatar ──────────────────────────────────────────────────
class _RingAvatar extends StatelessWidget {
  final String? photo;
  final String name;
  final bool hasStatus, viewed;
  final double size;

  const _RingAvatar({
    this.photo, required this.name, required this.hasStatus,
    required this.viewed, required this.size,
  });

  @override
  Widget build(BuildContext context) {
    final ringColor = !hasStatus
        ? Colors.transparent
        : viewed
            ? Colors.grey.shade400
            : AppTheme.accent;

    return Container(
      width: size + 4,
      height: size + 4,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: hasStatus ? Border.all(color: ringColor, width: 2.5) : null,
      ),
      child: Padding(
        padding: const EdgeInsets.all(2),
        child: CircleAvatar(
          radius: size / 2,
          backgroundColor: AppTheme.primaryLight,
          backgroundImage: photo != null ? NetworkImage(photo!) : null,
          child: photo == null
              ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                  style: TextStyle(fontSize: size * 0.35, color: Colors.white,
                      fontWeight: FontWeight.w600))
              : null,
        ),
      ),
    );
  }
}

// ── Status Settings Sheet ────────────────────────────────────────
class _StatusSettingsSheet extends StatefulWidget {
  final VoidCallback onSaved;
  const _StatusSettingsSheet({required this.onSaved});
  @override
  State<_StatusSettingsSheet> createState() => _StatusSettingsSheetState();
}

class _StatusSettingsSheetState extends State<_StatusSettingsSheet> {
  final _api = ApiService();
  bool _stealth = false;
  String _defaultVis = 'contacts_only';
  bool _saving = false;

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await _api.patch('/statuses/settings', {
        'stealth_status_view': _stealth,
        'status_visibility_default': _defaultVis,
      });
      if (mounted) { Navigator.pop(context); widget.onSaved(); }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(24),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Status settings', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 20),
        // Stealth mode
        SwitchListTile(
          tileColor: AppTheme.surface,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          value: _stealth,
          onChanged: (v) => setState(() => _stealth = v),
          activeThumbColor: AppTheme.accent,
          title: const Text('View statuses anonymously', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text('People won\'t know you viewed their status'),
        ),
        const SizedBox(height: 16),
        const Text('Default audience for my statuses',
            style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        ...[
          ('contacts_only', 'My contacts only', 'People I chat with or share a stake with'),
          ('everyone',      'Everyone',          'All app users who can view my profile'),
          ('selected',      'Selected contacts', 'Only specific people you choose per post'),
          ('except',        'Everyone except…',  'Hide from specific people you choose'),
        ].map((opt) => RadioListTile<String>(
          value: opt.$1,
          groupValue: _defaultVis,
          onChanged: (v) => setState(() => _defaultVis = v!),
          activeColor: AppTheme.accent,
          title: Text(opt.$2),
          subtitle: Text(opt.$3, style: const TextStyle(fontSize: 12)),
          contentPadding: EdgeInsets.zero,
        )),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(height: 20, width: 20,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('Save settings'),
          ),
        ),
        const SizedBox(height: 8),
      ],
    ),
  );
}
