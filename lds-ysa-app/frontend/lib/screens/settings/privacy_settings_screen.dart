import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class PrivacySettingsScreen extends StatefulWidget {
  const PrivacySettingsScreen({super.key});
  @override
  State<PrivacySettingsScreen> createState() => _PrivacySettingsScreenState();
}

class _PrivacySettingsScreenState extends State<PrivacySettingsScreen> {
  final _api = ApiService();
  bool _stealth = false;
  String _defaultVis = 'contacts_only';
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final res = await _api.get('/settings');
      if (mounted) {
        setState(() {
        _stealth    = res['stealth_status_view'] ?? false;
        _defaultVis = res['status_visibility_default'] ?? 'contacts_only';
        _loading    = false;
      });
      }
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await _api.patch('/settings/privacy', {
        'stealth_status_view':      _stealth,
        'status_visibility_default': _defaultVis,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Privacy settings saved'), backgroundColor: AppTheme.success));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    } finally { if (mounted) setState(() => _saving = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Privacy'),
      actions: [
        TextButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(width: 18, height: 18,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
              : const Text('Save', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        ),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Stealth mode
              const Text('STATUS PRIVACY', style: TextStyle(fontSize: 11,
                  fontWeight: FontWeight.w700, color: AppTheme.textSecondary, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              Card(child: SwitchListTile(
                value: _stealth,
                onChanged: (v) => setState(() => _stealth = v),
                activeThumbColor: AppTheme.accent,
                title: const Text('View statuses anonymously', style: TextStyle(fontWeight: FontWeight.w600)),
                subtitle: const Text('When on, people will not see that you viewed their status update'),
              )),
              const SizedBox(height: 20),
              const Text('DEFAULT STATUS AUDIENCE', style: TextStyle(fontSize: 11,
                  fontWeight: FontWeight.w700, color: AppTheme.textSecondary, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              Card(child: Column(children: [
                ...[
                  ('contacts_only', 'My contacts only',   'People I chat with or share a stake with'),
                  ('everyone',      'Everyone',            'All users on the platform who can find my profile'),
                  ('selected',      'Selected contacts',   'Choose specific people each time you post'),
                  ('except',        'Everyone except…',    'Exclude specific people each time you post'),
                ].map((opt) => RadioListTile<String>(
                  value: opt.$1,
                  groupValue: _defaultVis,
                  onChanged: (v) => setState(() => _defaultVis = v!),
                  activeColor: AppTheme.accent,
                  title: Text(opt.$2),
                  subtitle: Text(opt.$3, style: const TextStyle(fontSize: 12)),
                )),
              ])),
            ],
          ),
  );
}
