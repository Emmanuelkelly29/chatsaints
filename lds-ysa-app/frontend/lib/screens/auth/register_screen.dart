import 'package:flutter/material.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../home/home_screen.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl  = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl  = TextEditingController();
  DateTime? _dob;
  String _role = 'ysa_member';
  bool _isSingle = true;
  bool _loading = false;
  bool _obscure = true;
  int _step = 0; // 0=personal, 1=church, 2=account

  final List<Map<String, String>> _roles = [
    {'value': 'ysa_member',         'label': 'YSA Member (18–35)'},
    {'value': 'ysa_rep',            'label': 'YSA Representative'},
    {'value': 'ysa_couple_adviser', 'label': 'YSA Couple Adviser'},
    {'value': 'bishop',             'label': 'Bishop'},
    {'value': 'stake_presidency',   'label': 'Stake Presidency'},
    {'value': 'mission_president',  'label': 'Mission President'},
    {'value': 'mission_president_wife', 'label': "Mission President's Wife"},
    {'value': 'missionary',         'label': 'Missionary'},
  ];

  Future<void> _register() async {
    if (!_formKey.currentState!.validate() || _dob == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill all required fields including date of birth')));
      return;
    }
    setState(() => _loading = true);
    try {
      await AuthService().register(
        phoneNumber: _phoneCtrl.text.trim(),
        fullName: _nameCtrl.text.trim(),
        dateOfBirth: _dob!.toIso8601String().split('T').first,
        password: _passCtrl.text,
        role: _role,
        isSingle: _isSingle,
        email: _emailCtrl.text.trim().isEmpty ? null : _emailCtrl.text.trim(),
      );
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomeScreen()));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickDob() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(2000),
      firstDate: DateTime(1940),
      lastDate: DateTime.now().subtract(const Duration(days: 365 * 16)),
    );
    if (picked != null) setState(() => _dob = picked);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Create Account')),
    body: SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Progress
              Row(children: List.generate(3, (i) => Expanded(
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  height: 4,
                  decoration: BoxDecoration(
                    color: i <= _step ? AppTheme.accent : AppTheme.divider,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ))),
              const SizedBox(height: 24),

              if (_step == 0) ...[
                const Text('Personal Information', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _nameCtrl,
                  decoration: const InputDecoration(labelText: 'Full name *', prefixIcon: Icon(Icons.person)),
                  validator: (v) => (v?.isEmpty ?? true) ? 'Required' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Phone number *', prefixIcon: Icon(Icons.phone)),
                  validator: (v) => (v?.isEmpty ?? true) ? 'Required' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email (optional)', prefixIcon: Icon(Icons.email)),
                ),
                const SizedBox(height: 14),
                // DOB picker
                GestureDetector(
                  onTap: _pickDob,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppTheme.primaryLight,
                      border: Border.all(color: AppTheme.divider),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(children: [
                      const Icon(Icons.cake, color: AppTheme.textSecondary),
                      const SizedBox(width: 12),
                      Text(_dob == null ? 'Date of birth *' : '${_dob!.day}/${_dob!.month}/${_dob!.year}',
                        style: TextStyle(color: _dob == null ? AppTheme.textSecondary : AppTheme.textPrimary)),
                    ]),
                  ),
                ),
              ],

              if (_step == 1) ...[
                const Text('Church Information', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 20),
                DropdownButtonFormField<String>(
                  initialValue: _role,
                  decoration: const InputDecoration(labelText: 'Your church role *', prefixIcon: Icon(Icons.church)),
                  items: _roles.map((r) => DropdownMenuItem(value: r['value'], child: Text(r['label']!))).toList(),
                  onChanged: (v) => setState(() => _role = v!),
                ),
                const SizedBox(height: 14),
                SwitchListTile(
                  value: _isSingle,
                  onChanged: (v) => setState(() => _isSingle = v),
                  title: const Text('I am single'),
                  subtitle: const Text('Required for YSA membership'),
                  activeThumbColor: AppTheme.accent,
                  tileColor: AppTheme.primaryLight,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                const SizedBox(height: 14),
                // Missionary note
                if (_role == 'missionary')
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.missionary.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.accent),
                    ),
                    child: const Text(
                      'Missionary accounts are activated by your Stake Presidency. '
                      'Your features will be limited to your mission until you return home.',
                      style: TextStyle(fontSize: 13, color: AppTheme.missionary),
                    ),
                  ),
                if (_role != 'ysa_member' && _role != 'missionary')
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.divider),
                    ),
                    child: const Text(
                      'Leader accounts require approval from an existing verified leader '
                      'before you can access all features.',
                      style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                    ),
                  ),
              ],

              if (_step == 2) ...[
                const Text('Set Your Password', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _passCtrl,
                  obscureText: _obscure,
                  decoration: InputDecoration(
                    labelText: 'Password *',
                    prefixIcon: const Icon(Icons.lock),
                    suffixIcon: IconButton(
                      icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: (v) => (v?.length ?? 0) < 8 ? 'Minimum 8 characters' : null,
                ),
                const SizedBox(height: 14),
                const Text('By registering, your phone number will be your app identity.',
                  style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
              ],

              const SizedBox(height: 32),

              // Navigation buttons
              Row(children: [
                if (_step > 0)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => setState(() => _step--),
                      child: const Text('Back'),
                    ),
                  ),
                if (_step > 0) const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _loading ? null : () {
                      if (_step < 2) {
                        setState(() => _step++);
                      } else {
                        _register();
                      }
                    },
                    child: _loading
                        ? const SizedBox(height: 20, width: 20,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                        : Text(_step < 2 ? 'Continue' : 'Create Account'),
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    ),
  );

  @override
  void dispose() { _nameCtrl.dispose(); _phoneCtrl.dispose(); _emailCtrl.dispose(); _passCtrl.dispose(); super.dispose(); }
}
