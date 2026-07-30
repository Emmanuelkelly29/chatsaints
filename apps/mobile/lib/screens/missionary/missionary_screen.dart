import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';

class MissionaryScreen extends StatefulWidget {
  const MissionaryScreen({super.key});
  @override
  State<MissionaryScreen> createState() => _MissionaryScreenState();
}

class _MissionaryScreenState extends State<MissionaryScreen> {
  final _api = ApiService();
  final _user = AuthService().currentUser;
  List<Map<String, dynamic>> _companions = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_user?.missionId == null) { setState(() => _loading = false); return; }
    try {
      final res = await _api.get('/missionary/mission/${_user!.missionId}/members');
      final list = (res is List ? res : (res['data'] as List? ?? [])) as List<dynamic>;
      if (mounted) {
        setState(() {
        _companions = list.whereType<Map<String,dynamic>>().toList();
        _loading = false;
      });
      }
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('My Mission')),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              // Missionary mode badge
              Container(
                margin: const EdgeInsets.all(16),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.missionary.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.accent),
                ),
                child: Row(children: [
                  const Icon(Icons.flag, color: AppTheme.missionary, size: 32),
                  const SizedBox(width: 12),
                  Expanded(child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Missionary Mode Active',
                          style: TextStyle(fontWeight: FontWeight.w700, color: AppTheme.missionary)),
                      Text(_user?.missionName ?? 'Mission',
                          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                      const SizedBox(height: 4),
                      const Text('Contact limited to your mission only.',
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    ],
                  )),
                ]),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Align(alignment: Alignment.centerLeft,
                  child: Text('FELLOW MISSIONARIES', style: TextStyle(fontSize: 11,
                      fontWeight: FontWeight.w700, color: AppTheme.textSecondary, letterSpacing: 1.2))),
              ),
              Expanded(
                child: _companions.isEmpty
                    ? const Center(child: Text('No fellow missionaries found',
                        style: TextStyle(color: AppTheme.textSecondary)))
                    : ListView.builder(
                        itemCount: _companions.length,
                        itemBuilder: (_, i) {
                          final m = _companions[i];
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: AppTheme.missionary,
                              child: Text((m['full_name'] as String? ?? '?')[0].toUpperCase(),
                                  style: const TextStyle(color: Colors.white)),
                            ),
                            title: Text(m['full_name'] ?? ''),
                            subtitle: Text('Started: ${m['missionary_start_date'] ?? 'Unknown'}',
                                style: const TextStyle(fontSize: 12)),
                            onTap: () {},
                          );
                        },
                      ),
              ),
            ],
          ),
  );
}
