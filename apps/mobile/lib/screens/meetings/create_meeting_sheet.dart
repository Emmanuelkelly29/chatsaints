import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class CreateMeetingSheet extends StatefulWidget {
  const CreateMeetingSheet({super.key});

  @override
  State<CreateMeetingSheet> createState() => _CreateMeetingSheetState();
}

class _CreateMeetingSheetState extends State<CreateMeetingSheet> {
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _keyCtrl = TextEditingController();
  bool _requiresApproval = false;
  bool _allowLink = true;
  int _maxParticipants = 1000;
  bool _showKey = false;
  bool _loading = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _keyCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      final result = await ApiService().post('/meetings', {
        'title': _titleCtrl.text.trim(),
        if (_descCtrl.text.trim().isNotEmpty) 'description': _descCtrl.text.trim(),
        if (_keyCtrl.text.trim().isNotEmpty) 'join_key': _keyCtrl.text.trim(),
        'requires_approval': _requiresApproval,
        'allow_link_join': _allowLink,
        'max_participants': _maxParticipants,
      });
      if (mounted) Navigator.pop(context, result);
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottom),
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Handle bar
              Center(
                child: Container(
                  width: 36, height: 4,
                  margin: const EdgeInsets.only(bottom: 20),
                  decoration: BoxDecoration(
                    color: Colors.grey[600],
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const Text('New Meeting',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 20),

              // Title
              TextFormField(
                controller: _titleCtrl,
                decoration: const InputDecoration(
                  labelText: 'Meeting Title *',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.title),
                ),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 12),

              // Description
              TextFormField(
                controller: _descCtrl,
                decoration: const InputDecoration(
                  labelText: 'Description (optional)',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.notes),
                ),
                maxLines: 2,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 12),

              // Join key
              TextFormField(
                controller: _keyCtrl,
                obscureText: !_showKey,
                decoration: InputDecoration(
                  labelText: 'Meeting Key / Password (optional)',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(_showKey ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setState(() => _showKey = !_showKey),
                  ),
                ),
                textInputAction: TextInputAction.done,
              ),
              const SizedBox(height: 16),

              // Max participants slider
              Row(children: [
                const Icon(Icons.group_outlined, size: 18),
                const SizedBox(width: 8),
                Text('Max participants: $_maxParticipants'),
              ]),
              Slider(
                value: _maxParticipants.toDouble(),
                min: 2, max: 1000, divisions: 99,
                label: _maxParticipants.toString(),
                onChanged: (v) => setState(() => _maxParticipants = v.round()),
              ),
              const SizedBox(height: 4),

              // Toggles
              SwitchListTile(
                title: const Text('Require approval to join'),
                subtitle: const Text('You approve each person before they enter'),
                value: _requiresApproval,
                onChanged: (v) => setState(() => _requiresApproval = v),
                contentPadding: EdgeInsets.zero,
              ),
              SwitchListTile(
                title: const Text('Allow join via link'),
                subtitle: const Text('Anyone with the meeting code can request to join'),
                value: _allowLink,
                onChanged: (v) => setState(() => _allowLink = v),
                contentPadding: EdgeInsets.zero,
              ),
              const SizedBox(height: 16),

              // Submit
              ElevatedButton.icon(
                onPressed: _loading ? null : _submit,
                icon: _loading
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.videocam),
                label: Text(_loading ? 'Creating…' : 'Start Meeting'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
