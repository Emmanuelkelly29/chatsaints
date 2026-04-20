import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../models/status_model.dart';
import '../../theme/app_theme.dart';
import '../../utils/constants.dart';
import 'status_post_screen.dart';

class MyStatusScreen extends StatefulWidget {
  final List<StatusModel> statuses;
  const MyStatusScreen({super.key, required this.statuses});
  @override
  State<MyStatusScreen> createState() => _MyStatusScreenState();
}

class _MyStatusScreenState extends State<MyStatusScreen> {
  final _api = ApiService();
  List<StatusModel> _statuses = [];
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _statuses = widget.statuses;
    // Reload with full viewer data
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    try {
      final res = await _api.get('/statuses/mine');
      final list = (res is List ? res : (res['data'] as List? ?? [])) as List<dynamic>;
      if (mounted) {
        setState(() {
        _statuses = list.whereType<Map<String,dynamic>>()
            .map((j) => StatusModel.fromJson(j)).toList();
        _loading = false;
      });
      }
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _delete(String statusId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete status?'),
        content: const Text('This will remove the status immediately for everyone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/statuses/$statusId');
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('My Status'),
      actions: [
        IconButton(
          icon: const Icon(Icons.add_circle_outline),
          onPressed: () => Navigator.push(context,
            MaterialPageRoute(builder: (_) => const StatusPostScreen()))
              .then((_) => _reload()),
        ),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _statuses.isEmpty
            ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Icon(Icons.circle_outlined, size: 72, color: AppTheme.textSecondary),
                const SizedBox(height: 16),
                const Text('You have no active statuses',
                    style: TextStyle(fontSize: 16, color: AppTheme.textSecondary)),
                const SizedBox(height: 24),
                ElevatedButton.icon(
                  onPressed: () => Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const StatusPostScreen()))
                      .then((_) => _reload()),
                  icon: const Icon(Icons.add),
                  label: const Text('Add a status'),
                ),
              ]))
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _statuses.length,
                itemBuilder: (_, i) {
                  final s = _statuses[i];
                  final rawUrl = s.mediaUrl ?? '';
                  final mediaUrl = rawUrl.startsWith('http')
                      ? rawUrl
                      : rawUrl.isNotEmpty
                          ? '${AppConstants.uploadsBase}/${rawUrl.split('/').last}'
                          : '';

                  return Card(
                    margin: const EdgeInsets.only(bottom: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Thumbnail
                        GestureDetector(
                          onTap: () {
                            // Preview your own status
                          },
                          child: ClipRRect(
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
                            child: AspectRatio(
                              aspectRatio: 16 / 9,
                              child: s.mediaType == 'text'
                                  ? Container(
                                      color: Color(int.parse(
                                        (s.backgroundColor ?? '#0A1628').replaceFirst('#', '0xFF'))),
                                      child: Center(
                                        child: Padding(
                                          padding: const EdgeInsets.all(16),
                                          child: Text(
                                            s.textContent ?? s.caption ?? '',
                                            textAlign: TextAlign.center,
                                            maxLines: 4,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              color: Colors.white, fontSize: 18,
                                              fontWeight: FontWeight.w600),
                                          ),
                                        ),
                                      ),
                                    )
                                  : s.mediaType == 'voice'
                                      ? const ColoredBox(color: Color(0xFF0A1628),
                                          child: Center(child: Icon(Icons.audiotrack,
                                              color: Color(0xFFC9A84C), size: 56)))
                                      : s.mediaType == 'image' && mediaUrl.isNotEmpty
                                          ? Image.network(mediaUrl, fit: BoxFit.cover,
                                              errorBuilder: (_, __, ___) =>
                                                  const ColoredBox(color: AppTheme.surface,
                                                    child: Center(child: Icon(Icons.image, color: AppTheme.textSecondary, size: 48))))
                                          : const ColoredBox(color: Colors.black,
                                              child: Center(child: Icon(Icons.play_circle_fill,
                                                  color: Colors.white, size: 56))),
                            ),
                          ),
                        ),

                        Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Caption
                              if (s.caption != null && s.caption!.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 10),
                                  child: Text(s.caption!,
                                      style: const TextStyle(fontSize: 15)),
                                ),

                              // Metadata row
                              Row(children: [
                                const Icon(Icons.access_time, size: 14, color: AppTheme.textSecondary),
                                const SizedBox(width: 4),
                                Text(s.timeLeftLabel,
                                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                                const SizedBox(width: 16),
                                const Icon(Icons.remove_red_eye_outlined, size: 14, color: AppTheme.textSecondary),
                                const SizedBox(width: 4),
                                Text('${s.viewCount ?? 0} view${(s.viewCount ?? 0) != 1 ? 's' : ''}',
                                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                                if ((s.stealthViewCount ?? 0) > 0) ...[
                                  const SizedBox(width: 8),
                                  const Icon(Icons.visibility_off, size: 13, color: AppTheme.textSecondary),
                                  const SizedBox(width: 3),
                                  Text('+${s.stealthViewCount} anonymous',
                                      style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                ],
                              ]),

                              // Viewers list (non-stealth)
                              if (s.viewers != null && s.viewers!.isNotEmpty) ...[
                                const SizedBox(height: 10),
                                const Divider(height: 1),
                                const SizedBox(height: 10),
                                const Text('Viewed by',
                                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                                const SizedBox(height: 8),
                                ...s.viewers!.take(5).map((v) => Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Row(children: [
                                    CircleAvatar(
                                      radius: 14,
                                      backgroundColor: AppTheme.primaryLight,
                                      backgroundImage: v.profilePhoto != null
                                          ? NetworkImage(v.profilePhoto!) : null,
                                      child: v.profilePhoto == null
                                          ? Text(v.fullName[0].toUpperCase(),
                                              style: const TextStyle(color: Colors.white, fontSize: 11))
                                          : null,
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(child: Text(v.fullName,
                                        style: const TextStyle(fontSize: 13))),
                                    Text(
                                      '${v.viewedAt.hour.toString().padLeft(2,'0')}:${v.viewedAt.minute.toString().padLeft(2,'0')}',
                                      style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                                    ),
                                  ]),
                                )),
                                if (s.viewers!.length > 5)
                                  Text('+ ${s.viewers!.length - 5} more',
                                      style: const TextStyle(fontSize: 12, color: AppTheme.accent)),
                              ],

                              const SizedBox(height: 10),

                              // Actions
                              Row(children: [
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: () => _delete(s.id),
                                    icon: const Icon(Icons.delete_outline, size: 16),
                                    label: const Text('Delete'),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: AppTheme.danger,
                                      side: const BorderSide(color: AppTheme.danger),
                                    ),
                                  ),
                                ),
                              ]),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
  );
}
