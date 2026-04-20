import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class MissionaryOverviewScreen extends StatefulWidget {
  const MissionaryOverviewScreen({super.key});
  @override
  State<MissionaryOverviewScreen> createState() => _MissionaryOverviewScreenState();
}

class _MissionaryOverviewScreenState extends State<MissionaryOverviewScreen> {
  final _api = ApiService();
  Map<String, dynamic>? _data;
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final res = await _api.get('/admin/missionary/overview');
      if (mounted) setState(() { _data = res; _loading = false; });
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final byMission = (_data?['by_mission'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final total     = _data?['total'] ?? 0;
    final enrolled  = _data?['mdm_enrolled'] ?? 0;

    return Scaffold(
      appBar: AppBar(title: const Text('Missionary overview')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(16), children: [
              // Summary cards
              Row(children: [
                Expanded(child: _SummaryCard(label: 'Total missionaries', value: '$total',
                    color: AppTheme.missionary)),
                const SizedBox(width: 12),
                Expanded(child: _SummaryCard(label: 'MDM enrolled', value: '$enrolled',
                    color: AppTheme.accentLight)),
              ]),
              const SizedBox(height: 20),
              const Text('BY MISSION', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                  color: AppTheme.textSecondary, letterSpacing: 1.1)),
              const SizedBox(height: 8),
              ...byMission.map((m) {
                final missionaries = (m['missionaries'] as List?)
                    ?.cast<Map<String, dynamic>>() ?? [];
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: ExpansionTile(
                    leading: const Icon(Icons.flag, color: AppTheme.missionary),
                    title: Text(m['mission'] ?? 'Unknown mission',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${missionaries.length} missionary${missionaries.length != 1 ? 's' : ''}'
                      '${m['country'] != null ? ' · ${m['country']}' : ''}'),
                    children: missionaries.map((missionary) => ListTile(
                      leading: CircleAvatar(
                        backgroundColor: AppTheme.missionary,
                        child: Text((missionary['full_name'] as String? ?? '?')[0].toUpperCase(),
                          style: const TextStyle(color: Colors.white)),
                      ),
                      title: Text(missionary['full_name'] ?? ''),
                      subtitle: Text(
                        'Since: ${_formatDate(missionary['missionary_start_date'])}',
                        style: const TextStyle(fontSize: 12)),
                      trailing: missionary['maas360_enrolled'] == true
                          ? const Tooltip(
                              message: 'MaaS360 MDM enrolled',
                              child: Icon(Icons.phone_android, color: AppTheme.accent, size: 18))
                          : Tooltip(
                              message: 'MDM not enrolled',
                              child: Icon(Icons.phone_android, color: Colors.grey.shade400, size: 18)),
                    )).toList(),
                  ),
                );
              }),
              if (byMission.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(48),
                  child: Column(children: [
                    Icon(Icons.flag_outlined, size: 64, color: AppTheme.textSecondary),
                    SizedBox(height: 16),
                    Text('No active missionaries', style: TextStyle(color: AppTheme.textSecondary)),
                  ]),
                ),
              const SizedBox(height: 40),
            ]),
    );
  }

  String _formatDate(dynamic date) {
    if (date == null) return 'Unknown';
    try {
      final d = DateTime.parse(date.toString());
      return '${d.day}/${d.month}/${d.year}';
    } catch (_) { return date.toString(); }
  }
}

class _SummaryCard extends StatelessWidget {
  final String label, value;
  final Color color;
  const _SummaryCard({required this.label, required this.value, required this.color});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: color.withOpacity(0.08),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withOpacity(0.25)),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(value, style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: color)),
      const SizedBox(height: 4),
      Text(label, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
    ]),
  );
}
