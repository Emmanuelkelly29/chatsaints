import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../services/api_service.dart';
import '../../models/user_model.dart';
import '../../theme/app_theme.dart';

class CreateGroupScreen extends StatefulWidget {
  const CreateGroupScreen({super.key});
  @override
  State<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends State<CreateGroupScreen> {
  final _api       = ApiService();
  final _nameCtrl  = TextEditingController();
  final _descCtrl  = TextEditingController();
  final _searchCtrl= TextEditingController();

  File? _groupPhoto;
  List<UserModel> _searchResults = [];
  final List<UserModel> _selectedMembers = [];
  bool _searching = false;
  bool _creating  = false;
  int _step = 0; // 0=details, 1=members

  Future<void> _search(String q) async {
    if (q.length < 2) { setState(() => _searchResults = []); return; }
    setState(() => _searching = true);
    try {
      final res  = await _api.get('/users/search?q=${Uri.encodeComponent(q)}');
      final list = (res is List ? res : (res['data'] as List? ?? [])) as List<dynamic>;
      if (mounted) {
        setState(() {
        _searchResults = list
            .whereType<Map<String, dynamic>>()
            .map((j) => UserModel.fromJson(j))
            .where((u) => !_selectedMembers.any((s) => s.id == u.id))
            .toList();
        _searching = false;
      });
      }
    } catch (_) { if (mounted) setState(() => _searching = false); }
  }

  void _toggleMember(UserModel user) {
    setState(() {
      if (_selectedMembers.any((m) => m.id == user.id)) {
        _selectedMembers.removeWhere((m) => m.id == user.id);
      } else {
        if (_selectedMembers.length >= 999) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Maximum 1,000 members (including you)')));
          return;
        }
        _selectedMembers.add(user);
      }
      _searchResults = _searchResults.where((u) => !_selectedMembers.any((s) => s.id == u.id)).toList();
    });
  }

  Future<void> _create() async {
    if (_nameCtrl.text.trim().length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Group name must be at least 2 characters')));
      return;
    }
    setState(() => _creating = true);
    try {
      String? photoUrl;
      if (_groupPhoto != null) {
        final res = await _api.uploadFile('/media/upload', _groupPhoto!);
        photoUrl = res['url'] as String?;
      }

      final res = await _api.post('/groups', {
        'name':        _nameCtrl.text.trim(),
        'description': _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
        'member_ids':  _selectedMembers.map((m) => m.id).toList(),
        if (photoUrl != null) 'photo_url': photoUrl,
      });

      if (mounted) {
        Navigator.pop(context, res); // Return the new group to caller
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(_step == 0 ? 'New Group' : 'Add Members'),
      actions: [
        if (_step == 1)
          TextButton(
            onPressed: _creating ? null : _create,
            child: _creating
                ? const SizedBox(width: 18, height: 18,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('Create', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          ),
      ],
    ),
    body: _step == 0 ? _buildDetailsStep() : _buildMembersStep(),
  );

  Widget _buildDetailsStep() => SingleChildScrollView(
    padding: const EdgeInsets.all(20),
    child: Column(children: [
      // Group photo
      Center(child: GestureDetector(
        onTap: () async {
          final xf = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 80);
          if (xf != null) setState(() => _groupPhoto = File(xf.path));
        },
        child: Stack(children: [
          CircleAvatar(
            radius: 48,
            backgroundColor: AppTheme.primaryLight,
            backgroundImage: _groupPhoto != null ? FileImage(_groupPhoto!) : null,
            child: _groupPhoto == null
                ? const Icon(Icons.group, size: 40, color: Colors.white)
                : null,
          ),
          Positioned(bottom: 0, right: 0,
            child: Container(
              padding: const EdgeInsets.all(6),
              decoration: const BoxDecoration(color: AppTheme.primary, shape: BoxShape.circle),
              child: const Icon(Icons.camera_alt, size: 16, color: Colors.white),
            )),
        ]),
      )),
      const SizedBox(height: 24),
      TextField(
        controller: _nameCtrl,
        maxLength: 60,
        decoration: const InputDecoration(
          labelText: 'Group name *',
          prefixIcon: Icon(Icons.group),
        ),
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _descCtrl,
        maxLines: 3,
        maxLength: 200,
        decoration: const InputDecoration(
          labelText: 'Description (optional)',
          prefixIcon: Icon(Icons.info_outline),
          alignLabelWithHint: true,
        ),
      ),
      const SizedBox(height: 28),
      SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () {
            if (_nameCtrl.text.trim().length < 2) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Please enter a group name')));
              return;
            }
            setState(() => _step = 1);
          },
          child: const Text('Next: Add members'),
        ),
      ),
    ]),
  );

  Widget _buildMembersStep() => Column(children: [
    // Selected members chips
    if (_selectedMembers.isNotEmpty)
      Container(
        height: 80,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        color: Colors.white,
        child: ListView.builder(
          scrollDirection: Axis.horizontal,
          itemCount: _selectedMembers.length,
          itemBuilder: (_, i) {
            final m = _selectedMembers[i];
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Stack(children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppTheme.primaryLight,
                    backgroundImage: m.profilePhotoUrl != null ? NetworkImage(m.profilePhotoUrl!) : null,
                    child: m.profilePhotoUrl == null
                        ? Text(m.fullName[0].toUpperCase(), style: const TextStyle(color: Colors.white))
                        : null,
                  ),
                  Positioned(top: 0, right: 0,
                    child: GestureDetector(
                      onTap: () => _toggleMember(m),
                      child: Container(
                        width: 16, height: 16,
                        decoration: const BoxDecoration(color: AppTheme.danger, shape: BoxShape.circle),
                        child: const Icon(Icons.close, size: 10, color: Colors.white),
                      ),
                    )),
                ]),
                const SizedBox(height: 2),
                Text(m.fullName.split(' ').first,
                  style: const TextStyle(fontSize: 11),
                  overflow: TextOverflow.ellipsis),
              ]),
            );
          },
        ),
      ),

    // Search bar
    Padding(
      padding: const EdgeInsets.all(12),
      child: TextField(
        controller: _searchCtrl,
        onChanged: _search,
        decoration: InputDecoration(
          hintText: 'Search for members...',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: _searching ? const Padding(
            padding: EdgeInsets.all(12),
            child: SizedBox(width: 16, height: 16,
              child: CircularProgressIndicator(strokeWidth: 2))) : null,
        ),
      ),
    ),

    // Member count indicator
    Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(children: [
        Text('${_selectedMembers.length} member${_selectedMembers.length != 1 ? 's' : ''} selected',
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
        const Spacer(),
        const Text('Max 999 + you', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
      ]),
    ),
    const SizedBox(height: 4),

    // Results
    Expanded(
      child: _searchResults.isEmpty
          ? Center(
              child: Text(
                _searchCtrl.text.length < 2
                    ? 'Type a name to search for members'
                    : 'No results',
                style: const TextStyle(color: AppTheme.textSecondary),
              ),
            )
          : ListView.builder(
              itemCount: _searchResults.length,
              itemBuilder: (_, i) {
                final u = _searchResults[i];
                final selected = _selectedMembers.any((m) => m.id == u.id);
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppTheme.primaryLight,
                    backgroundImage: u.profilePhotoUrl != null ? NetworkImage(u.profilePhotoUrl!) : null,
                    child: u.profilePhotoUrl == null
                        ? Text(u.fullName[0].toUpperCase(), style: const TextStyle(color: Colors.white))
                        : null,
                  ),
                  title: Text(u.fullName),
                  subtitle: Text(u.displayRole,
                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  trailing: selected
                      ? const Icon(Icons.check_circle, color: AppTheme.accent)
                      : const Icon(Icons.add_circle_outline, color: AppTheme.textSecondary),
                  onTap: () => _toggleMember(u),
                );
              },
            ),
    ),
  ]);

  @override
  void dispose() { _nameCtrl.dispose(); _descCtrl.dispose(); _searchCtrl.dispose(); super.dispose(); }
}
