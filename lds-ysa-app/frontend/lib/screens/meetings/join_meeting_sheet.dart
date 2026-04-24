import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';
import 'meeting_lobby_screen.dart';

class JoinMeetingSheet extends StatefulWidget {
  const JoinMeetingSheet({super.key});

  @override
  State<JoinMeetingSheet> createState() => _JoinMeetingSheetState();
}

class _JoinMeetingSheetState extends State<JoinMeetingSheet> {
  final _codeCtrl = TextEditingController();
  final _keyCtrl = TextEditingController();
  bool _showKey = false;
  bool _needsKey = false;
  bool _loading = false;
  Map<String, dynamic>? _preview;

  @override
  void dispose() {
    _codeCtrl.dispose();
    _keyCtrl.dispose();
    super.dispose();
  }

  // Format code as user types: "123456789" → "123-456-789"
  String _format(String raw) {
    final digits = raw.replaceAll('-', '').replaceAll(' ', '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return '${digits.substring(0, 3)}-${digits.substring(3)}';
    return '${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6, 9.clamp(6, digits.length))}';
  }

  Future<void> _lookup() async {
    final code = _codeCtrl.text.trim();
    if (code.replaceAll('-', '').length < 9) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Enter a 9-digit meeting code')));
      return;
    }
    setState(() => _loading = true);
    try {
      final data = await ApiService().get('/meetings/code/$code');
      setState(() {
        _preview = data;
        _needsKey = data['has_key'] == true;
        _loading = false;
      });
    } catch (e) {
      setState(() { _preview = null; _loading = false; });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
    }
  }

  Future<void> _join() async {
    if (_preview == null) return;
    setState(() => _loading = true);
    try {
      final body = <String, dynamic>{};
      if (_keyCtrl.text.trim().isNotEmpty) body['join_key'] = _keyCtrl.text.trim();

      final result = await ApiService().post('/meetings/${_preview!['id']}/join', body);
      if (!mounted) return;

      final status = result['status'];

      if (status == 'pending_approval') {
        // Show lobby / waiting room
        Navigator.pop(context); // close sheet
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => MeetingLobbyScreen(meeting: _preview!),
          ),
        );
        return;
      }

      // Joined directly — return full meeting data
      final meetingDetail = await ApiService().get('/meetings/${_preview!['id']}');
      if (mounted) Navigator.pop(context, meetingDetail);
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36, height: 4,
                margin: const EdgeInsets.only(bottom: 20),
                decoration: BoxDecoration(
                    color: Colors.grey[600],
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const Text('Join a Meeting',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 20),

            // Code field
            TextField(
              controller: _codeCtrl,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: 'Meeting Code (e.g. 123-456-789)',
                border: const OutlineInputBorder(),
                prefixIcon: const Icon(Icons.dialpad),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.search),
                  onPressed: _loading ? null : _lookup,
                ),
              ),
              onChanged: (v) {
                final formatted = _format(v);
                if (formatted != v) {
                  _codeCtrl.value = TextEditingValue(
                    text: formatted,
                    selection: TextSelection.collapsed(offset: formatted.length),
                  );
                }
                setState(() => _preview = null);
              },
              onSubmitted: (_) => _lookup(),
            ),
            const SizedBox(height: 12),

            // Preview card
            if (_preview != null) ...[
              Card(
                color: AppTheme.surface,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_preview!['title'] ?? 'Meeting',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      if ((_preview!['description'] ?? '').isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(_preview!['description'],
                              style: TextStyle(color: Colors.grey[400])),
                        ),
                      const SizedBox(height: 8),
                      Row(children: [
                        Icon(Icons.person_outline, size: 16, color: Colors.grey[400]),
                        const SizedBox(width: 4),
                        Text('Host: ${_preview!['host_name'] ?? ''}',
                            style: TextStyle(color: Colors.grey[400], fontSize: 13)),
                        const SizedBox(width: 16),
                        Icon(Icons.group_outlined, size: 16, color: Colors.grey[400]),
                        const SizedBox(width: 4),
                        Text('${_preview!['participant_count'] ?? 0} in meeting',
                            style: TextStyle(color: Colors.grey[400], fontSize: 13)),
                      ]),
                      if (_preview!['requires_approval'] == true)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Row(children: [
                            Icon(Icons.lock_clock_outlined, size: 14, color: Colors.orange[300]),
                            const SizedBox(width: 4),
                            Text('Requires host approval',
                                style: TextStyle(color: Colors.orange[300], fontSize: 12)),
                          ]),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            // Key field (shown when meeting has a key)
            if (_needsKey) ...[
              TextField(
                controller: _keyCtrl,
                obscureText: !_showKey,
                decoration: InputDecoration(
                  labelText: 'Meeting Key / Password',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.key),
                  suffixIcon: IconButton(
                    icon: Icon(_showKey ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setState(() => _showKey = !_showKey),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            // Join button
            ElevatedButton.icon(
              onPressed: (_loading || _preview == null) ? null : _join,
              icon: _loading
                  ? const SizedBox(
                      width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.login),
              label: Text(_loading ? 'Joining…' : 'Join Meeting'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.accent,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
