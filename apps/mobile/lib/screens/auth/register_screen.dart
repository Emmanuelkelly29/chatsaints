import 'package:flutter/material.dart';
import '../../services/auth_service.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/phone_country_field.dart';
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
  String _fullPhoneNumber = '+1'; // updated by PhoneCountryField
  DateTime? _dob;
  String _role = 'ysa_member';
  bool _isSingle = true;
  bool _loading = false;
  bool _obscure = true;
  int _step = 0; // 0=personal, 1=church, 2=account
  // OTP verification step
  final _otpRegCtrl = TextEditingController();
  String _pendingEmail = '';

  // Stakes
  List<Map<String, dynamic>> _stakes = [];
  String? _stakeId;
  bool _stakesLoading = false;

  // Missions (for missionary signup)
  List<Map<String, dynamic>> _missions = [];
  String? _missionId;
  bool _missionsLoading = false;

  // For leader roles: type the stake / district name
  final _stakeNameCtrl    = TextEditingController();
  final _countryCtrl      = TextEditingController();
  final _districtNameCtrl = TextEditingController();
  final _missionNameCtrl  = TextEditingController(); // for mission_president creating a new mission

  // Leader roles CREATE a stake by typing; member roles SELECT from dropdown.
  static const _leaderCreatorRoles = {
    'bishop', 'stake_presidency', 'mission_president',
    'mission_president_wife', 'ysa_couple_adviser',
    'coordinating_council',
  };
  bool get _isLeaderRole => _leaderCreatorRoles.contains(_role);

  @override
  void initState() {
    super.initState();
    _loadStakes();
    _loadMissions();
  }

  Future<void> _loadMissions() async {
    setState(() => _missionsLoading = true);
    try {
      final list = await ApiService().getList('/geography/missions');
      if (mounted) {
        setState(() {
        _missions = list.whereType<Map<String, dynamic>>().toList();
        _missionsLoading = false;
      });
      }
    } catch (_) {
      if (mounted) setState(() => _missionsLoading = false);
    }
  }

  Future<void> _loadStakes() async {
    setState(() => _stakesLoading = true);
    try {
      final list = await ApiService().getList('/geography/stakes');
      if (mounted) {
        setState(() {
        _stakes = list.whereType<Map<String, dynamic>>().toList();
        _stakesLoading = false;
      });
      }
    } catch (_) {
      if (mounted) setState(() => _stakesLoading = false);
    }
  }

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
    if (!_formKey.currentState!.validate() || _dob == null || _emailCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill all required fields including email and date of birth')));
      return;
    }
    final stakeNameVal  = _stakeNameCtrl.text.trim();
    final countryVal    = _countryCtrl.text.trim();
    if (_role == 'stake_presidency') {
      if (stakeNameVal.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Stake Presidency must enter stake name before proceeding')),
        );
        return;
      }
      if (countryVal.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Stake Presidency must enter country before proceeding')),
        );
        return;
      }
    }

    setState(() => _loading = true);
    try {
      final districtNameVal = _districtNameCtrl.text.trim();
      final res = await AuthService().register(
        phoneNumber:    _fullPhoneNumber.trim(),
        fullName:       _nameCtrl.text.trim(),
        dateOfBirth:    _dob!.toIso8601String().split('T').first,
        password:       _passCtrl.text,
        role:           _role,
        isSingle:       _isSingle,
        stakeId:        _isLeaderRole ? null : _stakeId,
        stakeName:      (_isLeaderRole && stakeNameVal.isNotEmpty) ? stakeNameVal : null,
        stakeCountry:   countryVal.isNotEmpty ? countryVal : null,
        districtName:   districtNameVal.isNotEmpty ? districtNameVal : null,
        missionId:      _role == 'missionary' ? _missionId : null,
        email:          _emailCtrl.text.trim(),
      );
      if (!mounted) return;
      if ((res['pending'] == true)) {
        setState(() {
          _pendingEmail = (res['email'] as String?) ?? _emailCtrl.text.trim();
          _step = 3;
        });
      } else {
        Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomeScreen()));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verifyRegistration() async {
    final code = _otpRegCtrl.text.trim();
    if (code.length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter the 6-digit code sent to your email'), backgroundColor: AppTheme.danger));
      return;
    }
    setState(() => _loading = true);
    try {
      await AuthService().verifyRegistration(email: _pendingEmail, otp: code);
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
              Row(children: List.generate(_step == 3 ? 4 : 3, (i) => Expanded(
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  height: 4,
                  decoration: BoxDecoration(
                    color: i <= (_step == 3 ? 3 : _step) ? AppTheme.accent : AppTheme.divider,
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
                PhoneCountryField(
                  controller: _phoneCtrl,
                  hintText: '555-2847',
                  onChanged: (full) => _fullPhoneNumber = full,
                  validator: (v) => (v?.isEmpty ?? true) ? 'Required' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email address *', prefixIcon: Icon(Icons.email)),
                  validator: (v) => (v == null || v.isEmpty || !v.contains('@')) ? 'Valid email address required' : null,
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
                // Stake / District field — leaders type, members pick from dropdown
                if (_role != 'missionary') ...[  
                  if (_isLeaderRole) ...[  
                    TextFormField(
                      controller: _stakeNameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Stake name *',
                        prefixIcon: Icon(Icons.location_city),
                        hintText: 'e.g. Lagos Nigeria Ikeja Stake',
                      ),
                      validator: (v) =>
                        (_role == 'bishop' || _role == 'stake_presidency')
                          ? (v?.isEmpty ?? true) ? 'Enter your stake name' : null
                          : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _countryCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Country *',
                        prefixIcon: Icon(Icons.flag),
                        hintText: 'e.g. Nigeria',
                      ),
                      validator: (v) {
                        if (_role == 'stake_presidency' && (v == null || v.trim().isEmpty)) {
                          return 'Enter your country';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppTheme.accent.withOpacity(0.3)),
                      ),
                      child: const Row(children: [
                        Icon(Icons.info_outline, size: 16, color: AppTheme.accent),
                        SizedBox(width: 8),
                        Expanded(child: Text(
                          'If this stake and country are already in the app they will be matched automatically. '
                          'If no match exists, it will be created and future members can select it.',
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        )),
                      ]),
                    ),
                    const SizedBox(height: 14),
                  ] else ...[  
                    _stakesLoading
                      ? const LinearProgressIndicator(color: AppTheme.accent)
                      : DropdownButtonFormField<String>(
                          initialValue: _stakeId,
                          decoration: const InputDecoration(
                            labelText: 'Your Stake *',
                            prefixIcon: Icon(Icons.location_city),
                            hintText: 'Select your stake',
                          ),
                          items: _stakes.isEmpty
                            ? [const DropdownMenuItem(value: '__none', child: Text('No stakes registered yet'))]
                            : _stakes.map((s) => DropdownMenuItem<String>(
                                value: s['id'] as String,
                                child: Text(
                                  s['country'] != null
                                    ? '${s['name']} (${s['country']})'
                                    : '${s['name']}',
                                  overflow: TextOverflow.ellipsis),
                              )).toList(),
                          onChanged: _stakes.isEmpty ? null : (v) => setState(() => _stakeId = v),
                          validator: (v) =>
                            (_role == 'ysa_member' || _role == 'ysa_rep')
                              ? (v == null || v == '__none') ? 'Please select your stake' : null
                              : null,
                        ),
                    if (_stakes.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          'No stakes in the app yet. Ask your bishop or stake presidency to sign up first.',
                          style: TextStyle(fontSize: 12, color: AppTheme.accent.withOpacity(0.8)),
                        ),
                      ),
                    const SizedBox(height: 14),
                  ],
                ],
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
                // Missionary mission picker
                if (_role == 'missionary') ...[  
                  _missionsLoading
                    ? const LinearProgressIndicator(color: AppTheme.accent)
                    : DropdownButtonFormField<String>(
                        initialValue: _missionId,
                        decoration: const InputDecoration(
                          labelText: 'Select your mission *',
                          prefixIcon: Icon(Icons.flag),
                          hintText: 'e.g. Nigeria Lagos Mission',
                        ),
                        items: _missions.isEmpty
                          ? [const DropdownMenuItem(value: '__none', child: Text('No missions yet — ask your president'))]
                          : _missions.map((m) => DropdownMenuItem<String>(
                              value: m['id'] as String,
                              child: Text(m['name'] as String? ?? '', overflow: TextOverflow.ellipsis),
                            )).toList(),
                        onChanged: _missions.isEmpty ? null : (v) => setState(() => _missionId = v),
                        validator: (v) => (v == null || v == '__none') ? 'Please select your mission' : null,
                      ),
                  const SizedBox(height: 10),
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
                ],
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

              if (_step == 3) ...[
                const Text('Verify Your Email', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Text(
                  'A 6-digit code was sent to $_pendingEmail. Enter it below to complete your registration.',
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _otpRegCtrl,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  style: const TextStyle(fontSize: 24, letterSpacing: 8),
                  textAlign: TextAlign.center,
                  decoration: const InputDecoration(
                    labelText: 'Verification code',
                    prefixIcon: Icon(Icons.pin),
                    counterText: '',
                    hintText: '------',
                  ),
                ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _loading ? null : _verifyRegistration,
                    child: _loading
                        ? const SizedBox(height: 20, width: 20,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                        : const Text('Verify & Complete Registration'),
                  ),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _loading ? null : _register,
                  child: const Text('Resend code', style: TextStyle(color: AppTheme.accent)),
                ),
              ],

              const SizedBox(height: 32),

              // Navigation buttons
              if (_step < 3) Row(children: [
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
  void dispose() { _nameCtrl.dispose(); _phoneCtrl.dispose(); _emailCtrl.dispose(); _passCtrl.dispose(); _stakeNameCtrl.dispose(); _countryCtrl.dispose(); _districtNameCtrl.dispose(); _missionNameCtrl.dispose(); super.dispose(); }
}
