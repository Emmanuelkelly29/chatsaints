import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';
import 'meeting_lobby_screen.dart';
import 'meeting_room_screen.dart';

class MeetingsScreen extends StatefulWidget {
  const MeetingsScreen({super.key});

  @override
  State<MeetingsScreen> createState() => _MeetingsScreenState();
}

class _MeetingsScreenState extends State<MeetingsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _navigateToRoom(Map<String, dynamic> meeting) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => MeetingRoomScreen(meeting: meeting)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.surface,
        title: const Text('Meetings',
            style: TextStyle(fontWeight: FontWeight.bold)),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.accent,
          labelColor: AppTheme.accent,
          unselectedLabelColor: Colors.grey,
          tabs: const [
            Tab(icon: Icon(Icons.video_library_outlined), text: 'My Meetings'),
            Tab(icon: Icon(Icons.login), text: 'Join'),
            Tab(icon: Icon(Icons.video_call), text: 'Create'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _MyMeetingsTab(onEnterRoom: _navigateToRoom),
          _JoinTab(onEnterRoom: _navigateToRoom),
          _CreateTab(onEnterRoom: _navigateToRoom),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────
// TAB 1 — My Meetings
// ─────────────────────────────────────────────────────────

class _MyMeetingsTab extends StatefulWidget {
  final void Function(Map<String, dynamic>) onEnterRoom;
  const _MyMeetingsTab({required this.onEnterRoom});

  @override
  State<_MyMeetingsTab> createState() => _MyMeetingsTabState();
}

class _MyMeetingsTabState extends State<_MyMeetingsTab> {
  List<Map<String, dynamic>> _meetings = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await ApiService().getList('/meetings/my/active');
      setState(() {
        _meetings = data.cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_meetings.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.video_camera_front_outlined,
                size: 72, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text('No active meetings',
                style: TextStyle(color: Colors.grey[500], fontSize: 16)),
            const SizedBox(height: 8),
            Text('Use the Join or Create tab to get started',
                style: TextStyle(color: Colors.grey[400], fontSize: 13)),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: _meetings.length,
        itemBuilder: (ctx, i) {
          final m = _meetings[i];
          final isHost = m['am_host'] == true;
          final code = (m['meeting_code'] as String?) ?? '';
          final count = m['participant_count'] ?? 0;
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            color: AppTheme.surface,
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: isHost
                    ? AppTheme.primary.withOpacity(0.2)
                    : AppTheme.accent.withOpacity(0.2),
                child: Icon(
                  isHost ? Icons.videocam : Icons.person,
                  color: AppTheme.accent,
                ),
              ),
              title: Text(m['title'] ?? 'Untitled Meeting',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Code: $code',
                      style: TextStyle(color: Colors.grey[400], fontSize: 12)),
                  Text('$count participant${count == 1 ? '' : 's'}',
                      style: TextStyle(color: Colors.grey[400], fontSize: 12)),
                ],
              ),
              isThreeLine: true,
              trailing: Chip(
                label: Text(isHost ? 'Host' : (m['my_role'] ?? 'Member'),
                    style: const TextStyle(fontSize: 11)),
                backgroundColor: isHost
                    ? AppTheme.primary.withOpacity(0.15)
                    : Colors.grey.withOpacity(0.15),
              ),
              onTap: () async {
                try {
                  final detail =
                      await ApiService().get('/meetings/${m['id']}');
                  if (mounted) widget.onEnterRoom(detail);
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(e.toString())));
                  }
                }
              },
            ),
          );
        },
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────
// TAB 2 — Join a Meeting
// ─────────────────────────────────────────────────────────

class _JoinTab extends StatefulWidget {
  final void Function(Map<String, dynamic>) onEnterRoom;
  const _JoinTab({required this.onEnterRoom});

  @override
  State<_JoinTab> createState() => _JoinTabState();
}

class _JoinTabState extends State<_JoinTab> {
  final _codeCtrl = TextEditingController();
  final _keyCtrl = TextEditingController();
  bool _showKey = false;
  bool _needsKey = false;
  bool _loading = false;
  Map<String, dynamic>? _preview;

  @override
  void initState() {
    super.initState();
    // Pre-fill code if app was opened via meeting invite link (?meeting=XXX-XXX-XXX)
    final uri = Uri.base;
    final codeParam = uri.queryParameters['meeting'];
    if (codeParam != null && codeParam.isNotEmpty) {
      _codeCtrl.text = codeParam;
      // Auto-lookup after first frame
      WidgetsBinding.instance.addPostFrameCallback((_) => _lookup());
    }
  }

  @override
  void dispose() {
    _codeCtrl.dispose();
    _keyCtrl.dispose();
    super.dispose();
  }

  String _format(String raw) {
    final digits = raw.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) {
      return '${digits.substring(0, 3)}-${digits.substring(3)}';
    }
    final end = digits.length < 9 ? digits.length : 9;
    return '${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6, end)}';
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
      setState(() {
        _preview = null;
        _loading = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
      }
    }
  }

  Future<void> _join() async {
    if (_preview == null) return;
    setState(() => _loading = true);
    try {
      final body = <String, dynamic>{};
      if (_keyCtrl.text.trim().isNotEmpty) body['join_key'] = _keyCtrl.text.trim();

      final result =
          await ApiService().post('/meetings/${_preview!['id']}/join', body);
      if (!mounted) return;

      if (result['status'] == 'pending_approval') {
        Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => MeetingLobbyScreen(meeting: _preview!)),
        );
        setState(() => _loading = false);
        return;
      }

      final detail = await ApiService().get('/meetings/${_preview!['id']}');
      if (mounted) {
        widget.onEnterRoom(detail);
        setState(() => _loading = false);
      }
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          Row(children: [
            CircleAvatar(
              backgroundColor: AppTheme.accent.withOpacity(0.15),
              radius: 24,
              child: const Icon(Icons.login, color: AppTheme.accent),
            ),
            const SizedBox(width: 14),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Join a Meeting',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                Text('Enter the 9-digit meeting code',
                    style: TextStyle(color: Colors.grey, fontSize: 13)),
              ],
            ),
          ]),
          const SizedBox(height: 28),

          // Code field
          TextField(
            controller: _codeCtrl,
            keyboardType: TextInputType.number,
            style: const TextStyle(
                fontSize: 22, letterSpacing: 4, fontWeight: FontWeight.w600),
            textAlign: TextAlign.center,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: 'Meeting Code',
              hintText: '123-456-789',
              border: const OutlineInputBorder(),
              prefixIcon: const Icon(Icons.dialpad),
              suffixIcon: IconButton(
                icon: const Icon(Icons.search),
                onPressed: _loading ? null : _lookup,
                tooltip: 'Look up',
              ),
            ),
            onChanged: (v) {
              final formatted = _format(v);
              _codeCtrl.value = TextEditingValue(
                text: formatted,
                selection: TextSelection.collapsed(offset: formatted.length),
              );
              setState(() => _preview = null);
            },
            onSubmitted: (_) => _lookup(),
          ),
          const SizedBox(height: 16),

          if (_preview == null)
            OutlinedButton.icon(
              onPressed: _loading ? null : _lookup,
              icon: _loading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.search),
              label: Text(_loading ? 'Looking up…' : 'Find Meeting'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side: const BorderSide(color: AppTheme.accent),
                foregroundColor: AppTheme.accent,
              ),
            ),

          if (_preview != null) ...[
            Card(
              color: AppTheme.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: AppTheme.accent.withOpacity(0.4)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Icon(Icons.videocam_outlined,
                          color: AppTheme.accent, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(_preview!['title'] ?? 'Meeting',
                            style: const TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 17)),
                      ),
                    ]),
                    if ((_preview!['description'] ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(_preview!['description'],
                            style: TextStyle(color: Colors.grey[400])),
                      ),
                    const Divider(height: 20),
                    Row(children: [
                      Icon(Icons.person_outline,
                          size: 15, color: Colors.grey[400]),
                      const SizedBox(width: 4),
                      Text('Host: ${_preview!['host_name'] ?? ''}',
                          style: TextStyle(
                              color: Colors.grey[400], fontSize: 13)),
                      const SizedBox(width: 16),
                      Icon(Icons.group_outlined,
                          size: 15, color: Colors.grey[400]),
                      const SizedBox(width: 4),
                      Text('${_preview!['participant_count'] ?? 0} in meeting',
                          style: TextStyle(
                              color: Colors.grey[400], fontSize: 13)),
                    ]),
                    if (_preview!['requires_approval'] == true)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Row(children: [
                          Icon(Icons.lock_clock_outlined,
                              size: 14, color: Colors.orange[300]),
                          const SizedBox(width: 4),
                          Text('Requires host approval',
                              style: TextStyle(
                                  color: Colors.orange[300], fontSize: 12)),
                        ]),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            if (_needsKey) ...[
              TextField(
                controller: _keyCtrl,
                obscureText: !_showKey,
                decoration: InputDecoration(
                  labelText: 'Meeting Key / Password',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.key),
                  suffixIcon: IconButton(
                    icon: Icon(
                        _showKey ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setState(() => _showKey = !_showKey),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            ElevatedButton.icon(
              onPressed: _loading ? null : _join,
              icon: _loading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.login),
              label: Text(_loading ? 'Joining…' : 'Join Meeting'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.accent,
                foregroundColor: AppTheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────
// TAB 3 — Create a Meeting
// ─────────────────────────────────────────────────────────

class _CreateTab extends StatefulWidget {
  final void Function(Map<String, dynamic>) onEnterRoom;
  const _CreateTab({required this.onEnterRoom});

  @override
  State<_CreateTab> createState() => _CreateTabState();
}

class _CreateTabState extends State<_CreateTab> {
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _keyCtrl = TextEditingController();
  bool _requiresApproval = false;
  bool _allowLink = true;
  int _maxParticipants = 100;
  bool _showKey = false;
  bool _loading = false;
  String? _generatedCode;
  String? _generatedLink;

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
        if (_descCtrl.text.trim().isNotEmpty)
          'description': _descCtrl.text.trim(),
        if (_keyCtrl.text.trim().isNotEmpty)
          'join_key': _keyCtrl.text.trim(),
        'requires_approval': _requiresApproval,
        'allow_link_join': _allowLink,
        'max_participants': _maxParticipants,
      });
      if (mounted) {
        setState(() {
          _generatedCode = result['meeting_code'] as String?;
          _generatedLink = 'http://localhost:3000/?meeting=${_generatedCode ?? ''}';
          _loading = false;
        });
        await Future.delayed(const Duration(seconds: 3));
        if (mounted) widget.onEnterRoom(result);
      }
    } catch (e) {
      setState(() => _loading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
                content: Text(e.toString()), backgroundColor: Colors.red));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 8),
            Row(children: [
              CircleAvatar(
                backgroundColor: AppTheme.primary.withOpacity(0.3),
                radius: 24,
                child: const Icon(Icons.video_call, color: AppTheme.accent),
              ),
              const SizedBox(width: 14),
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Create a Meeting',
                      style: TextStyle(
                          fontSize: 20, fontWeight: FontWeight.bold)),
                  Text('A unique code will be generated for you',
                      style: TextStyle(color: Colors.grey, fontSize: 13)),
                ],
              ),
            ]),
            const SizedBox(height: 28),

            // Generated code + link banner
            if (_generatedCode != null) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.accent.withOpacity(0.5)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('Meeting Created!',
                        style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.accent)),
                    const SizedBox(height: 12),

                    // Code row
                    Row(children: [
                      const Icon(Icons.tag, size: 16, color: Colors.grey),
                      const SizedBox(width: 6),
                      const Text('Meeting Code:',
                          style: TextStyle(color: Colors.grey, fontSize: 12)),
                    ]),
                    const SizedBox(height: 4),
                    Row(children: [
                      Expanded(
                        child: Text(
                          _generatedCode!,
                          style: const TextStyle(
                              fontSize: 26,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 5,
                              color: AppTheme.accent),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.copy, size: 18),
                        tooltip: 'Copy code',
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: _generatedCode!));
                          ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Code copied!')));
                        },
                      ),
                    ]),

                    const Divider(height: 20),

                    // Link row
                    Row(children: [
                      const Icon(Icons.link, size: 16, color: Colors.grey),
                      const SizedBox(width: 6),
                      const Text('Invite Link:',
                          style: TextStyle(color: Colors.grey, fontSize: 12)),
                    ]),
                    const SizedBox(height: 4),
                    Row(children: [
                      Expanded(
                        child: Text(
                          _generatedLink!,
                          style: const TextStyle(
                              fontSize: 12,
                              color: Colors.white70,
                              decoration: TextDecoration.underline),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.copy, size: 18),
                        tooltip: 'Copy link',
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: _generatedLink!));
                          ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Link copied!')));
                        },
                      ),
                    ]),

                    const SizedBox(height: 8),
                    const Text(
                      'Share the link. Participants will enter the code manually to join.',
                      style: TextStyle(color: Colors.grey, fontSize: 11),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      SizedBox(
                          width: 14, height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent)),
                      SizedBox(width: 8),
                      Text('Entering meeting room…',
                          style: TextStyle(color: Colors.grey, fontSize: 12)),
                    ]),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],

            TextFormField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: 'Meeting Title *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.title),
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 14),

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
            const SizedBox(height: 14),

            TextFormField(
              controller: _keyCtrl,
              obscureText: !_showKey,
              decoration: InputDecoration(
                labelText: 'Meeting Key / Password (optional)',
                helperText: 'Leave blank for open access',
                border: const OutlineInputBorder(),
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  icon: Icon(
                      _showKey ? Icons.visibility_off : Icons.visibility),
                  onPressed: () => setState(() => _showKey = !_showKey),
                ),
              ),
              textInputAction: TextInputAction.done,
            ),
            const SizedBox(height: 20),

            Row(children: [
              const Icon(Icons.group_outlined, size: 18),
              const SizedBox(width: 8),
              Text('Max participants: $_maxParticipants',
                  style: const TextStyle(fontWeight: FontWeight.w500)),
            ]),
            Slider(
              value: _maxParticipants.toDouble(),
              min: 2,
              max: 1000,
              divisions: 99,
              activeColor: AppTheme.accent,
              label: _maxParticipants.toString(),
              onChanged: (v) => setState(() => _maxParticipants = v.round()),
            ),
            const SizedBox(height: 4),

            Card(
              color: AppTheme.surface,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
              child: Column(
                children: [
                  SwitchListTile(
                    title: const Text('Require approval to join'),
                    subtitle: const Text(
                        'You approve each person before they enter',
                        style: TextStyle(fontSize: 12)),
                    value: _requiresApproval,
                    activeColor: AppTheme.accent,
                    onChanged: (v) =>
                        setState(() => _requiresApproval = v),
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  const Divider(height: 1),
                  SwitchListTile(
                    title: const Text('Allow join via link/code'),
                    subtitle: const Text(
                        'Anyone with the code can request to join',
                        style: TextStyle(fontSize: 12)),
                    value: _allowLink,
                    activeColor: AppTheme.accent,
                    onChanged: (v) => setState(() => _allowLink = v),
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 16),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            ElevatedButton.icon(
              onPressed: _loading ? null : _submit,
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.videocam),
              label: Text(_loading ? 'Creating…' : 'Start Meeting'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.accent,
                foregroundColor: AppTheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 16),
                textStyle: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.bold),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
