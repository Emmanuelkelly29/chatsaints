import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../../utils/constants.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});
  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _api  = ApiService();
  final _auth = AuthService();
  final _nameCtrl  = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _bioCtrl   = TextEditingController();
  File? _newPhoto;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final user = _auth.currentUser;
    _nameCtrl.text  = user?.fullName ?? '';
    _emailCtrl.text = user?.email ?? '';
    _bioCtrl.text   = user?.bio ?? '';
  }

  Future<void> _pickPhoto() async {
    final xf = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 80);
    if (xf != null) setState(() => _newPhoto = File(xf.path));
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      String? photoUrl;
      if (_newPhoto != null) {
        final res = await _api.uploadFile('/media/upload', _newPhoto!);
        photoUrl = res['url'] as String?;
      }

      await _api.patch('/settings/profile', {
        'full_name':         _nameCtrl.text.trim(),
        'email':             _emailCtrl.text.trim().isEmpty ? null : _emailCtrl.text.trim(),
        'bio':               _bioCtrl.text.trim().isEmpty ? null : _bioCtrl.text.trim(),
        if (photoUrl != null) 'profile_photo_url': photoUrl,
      });

      // Refresh local user cache
      await _auth.refreshMe();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated'), backgroundColor: AppTheme.success));
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = _auth.currentUser;
    final currentPhoto = user?.profilePhotoUrl != null
        ? '${AppConstants.uploadsBase}/${user!.profilePhotoUrl!.split('/').last}'
        : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Edit Profile'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(width: 20, height: 20,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('Save', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(children: [
          // Avatar picker
          Center(child: Stack(children: [
            CircleAvatar(
              radius: 52,
              backgroundColor: AppTheme.primaryLight,
              backgroundImage: _newPhoto != null
                  ? FileImage(_newPhoto!) as ImageProvider
                  : (currentPhoto != null ? NetworkImage(currentPhoto) : null),
              child: (_newPhoto == null && currentPhoto == null)
                  ? Text((user?.fullName ?? '?')[0].toUpperCase(),
                      style: const TextStyle(fontSize: 40, color: Colors.white, fontWeight: FontWeight.w600))
                  : null,
            ),
            Positioned(
              bottom: 0, right: 0,
              child: GestureDetector(
                onTap: _pickPhoto,
                child: Container(
                  width: 32, height: 32,
                  decoration: const BoxDecoration(color: AppTheme.primary, shape: BoxShape.circle),
                  child: const Icon(Icons.camera_alt, color: Colors.white, size: 18),
                ),
              ),
            ),
          ])),
          const SizedBox(height: 28),

          TextFormField(
            controller: _nameCtrl,
            decoration: const InputDecoration(labelText: 'Full name', prefixIcon: Icon(Icons.person)),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _emailCtrl,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email (optional)', prefixIcon: Icon(Icons.email)),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _bioCtrl,
            maxLines: 4,
            maxLength: 200,
            decoration: const InputDecoration(
              labelText: 'Bio (optional)',
              prefixIcon: Icon(Icons.info_outline),
              alignLabelWithHint: true,
            ),
          ),

          const SizedBox(height: 24),
          // Phone (read-only — changing phone requires re-verification)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.divider),
            ),
            child: Row(children: [
              const Icon(Icons.phone, color: AppTheme.textSecondary),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Phone number', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                Text(user?.phoneNumber ?? '', style: const TextStyle(fontWeight: FontWeight.w500)),
              ])),
              const Text('Cannot be changed', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
            ]),
          ),
        ]),
      ),
    );
  }

  @override
  void dispose() { _nameCtrl.dispose(); _emailCtrl.dispose(); _bioCtrl.dispose(); super.dispose(); }
}
