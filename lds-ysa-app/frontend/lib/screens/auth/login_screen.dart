import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../../services/api_service.dart';
import '../../services/auth_service.dart';
import '../../services/websocket_service.dart';
import '../../theme/app_theme.dart';
import 'register_screen.dart';
import '../home/home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneCtrl = TextEditingController();
  final _passCtrl  = TextEditingController();
  final _otpCtrl   = TextEditingController();
  final _emailCtrl = TextEditingController();
  bool _loading      = false;
  bool _otpSent      = false;
  bool _showOtpField = false;
  bool _usePhoneLogin = false; // false = email OTP (default), true = phone+password

  // ─── Send Email OTP ───────────────────────────────────────────────────────
  Future<void> _sendEmailOtp() async {
    final email = _emailCtrl.text.trim();
    if (email.isEmpty || !email.contains('@')) { _snack('Please enter a valid email address'); return; }
    setState(() => _loading = true);
    try {
      await ApiService().post('/auth/send-otp', {'email': email});
      setState(() { _otpSent = true; _showOtpField = true; });
      _snack('Verification code sent to $email', success: true);
    } catch (e) {
      _snack(e.toString().replaceAll('ApiException', '').trim());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // ─── Verify Email OTP ────────────────────────────────────────────────────
  Future<void> _verifyEmailOtp() async {
    final otp = _otpCtrl.text.trim();
    if (otp.length < 4) { _snack('Enter the verification code'); return; }
    setState(() => _loading = true);
    try {
      await AuthService().loginWithEmailOtp(
        email: _emailCtrl.text.trim(),
        otp: otp,
      );
      final token = await ApiService().getToken();
      if (token != null) WebSocketService().connect(token);
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomeScreen()));
    } catch (e) {
      _snack(e.toString().replaceAll('ApiException', '').trim());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // ─── Phone + Password Login ───────────────────────────────────────────────
  Future<void> _loginWithPhone() async {
    final phone = _phoneCtrl.text.trim();
    final pass  = _passCtrl.text;
    if (phone.isEmpty) { _snack('Please enter your phone number'); return; }
    if (pass.isEmpty)  { _snack('Please enter your password'); return; }
    setState(() => _loading = true);
    try {
      await AuthService().login(phoneNumber: phone, password: pass);
      final token = await ApiService().getToken();
      if (token != null) WebSocketService().connect(token);
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomeScreen()));
    } catch (e) {
      _snack(e.toString().replaceAll('ApiException', '').trim());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _snack(String msg, {bool success = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: success ? AppTheme.success : AppTheme.danger,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final isWide = size.width > 700;

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: size.height - MediaQuery.of(context).padding.top),
            child: isWide ? _wideLayout() : _narrowLayout(),
          ),
        ),
      ),
    );
  }

  // ─── Feature tile ─────────────────────────────────────────────────────────
  Widget _featureTile(IconData icon, String label) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, color: AppTheme.accent, size: 16),
      const SizedBox(width: 8),
      Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
    ]),
  );

  // ─── Wide / Web layout ────────────────────────────────────────────────────
  Widget _wideLayout() => Row(
    children: [
      // Left feature panel
      Expanded(
        flex: 4,
        child: Container(
          color: AppTheme.primaryLight,
          padding: const EdgeInsets.all(40),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _logo(),
              const SizedBox(height: 40),
              const Text('Everything your ward needs',
                style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 24),
              Wrap(
                spacing: 32,
                runSpacing: 8,
                children: [
                  Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                    _featureTile(Icons.group, 'Groups & YSA Pool'),
                    _featureTile(Icons.search, 'Member Search'),
                    _featureTile(Icons.folder, 'File Sharing'),
                    _featureTile(Icons.video_call, 'Video Calls'),
                    _featureTile(Icons.circle_outlined, 'Status Updates'),
                  ]),
                  Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                    _featureTile(Icons.lock, 'End-to-End Encryption'),
                    _featureTile(Icons.verified_user, 'Leader Approval'),
                    _featureTile(Icons.flag, 'Missionary Mode'),
                    _featureTile(Icons.church, 'Stake Connect'),
                    _featureTile(Icons.book, 'Daily Scripture'),
                  ]),
                ],
              ),
            ],
          ),
        ),
      ),
      // Right login panel
      Expanded(
        flex: 3,
        child: Container(
          color: AppTheme.background,
          padding: const EdgeInsets.all(48),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: _loginForm(),
          ),
        ),
      ),
    ],
  );

  // ─── Narrow / Mobile layout (matches screenshot) ──────────────────────────
  Widget _narrowLayout() => Center(
    child: Container(
      width: double.infinity,
      constraints: const BoxConstraints(maxWidth: 400),
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 20),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(height: 40),
          // ── Church icon ──
          Icon(Icons.church, size: 70, color: AppTheme.accent.withOpacity(0.85)),
          const SizedBox(height: 20),
          // ── ChatSaints title: "Chat" in white, "Saints" in gold ──
          RichText(
            text: const TextSpan(children: [
              TextSpan(
                text: 'Chat',
                style: TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.w900,
                  color: Colors.white,
                  letterSpacing: 0.5,
                ),
              ),
              TextSpan(
                text: 'Saints',
                style: TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.w900,
                  color: AppTheme.accent,
                  letterSpacing: 0.5,
                ),
              ),
            ]),
          ),
          const SizedBox(height: 8),
          // ── Subtitle ──
          Text(
            'YOUNG SINGLE ADULTS \u00B7 GLOBAL',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: Colors.white.withOpacity(0.5),
              letterSpacing: 2.5,
            ),
          ),
          const SizedBox(height: 48),
          ..._loginForm(),
          const SizedBox(height: 40),
        ],
      ),
    ),
  );

  // ─── Logo (for wide layout) ───────────────────────────────────────────────
  Widget _logo() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(children: [
        const Icon(Icons.church, size: 36, color: AppTheme.accent),
        const SizedBox(width: 10),
        RichText(
          text: const TextSpan(children: [
            TextSpan(
              text: 'Chat',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: 0.5),
            ),
            TextSpan(
              text: 'Saints',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppTheme.accent, letterSpacing: 0.5),
            ),
          ]),
        ),
      ]),
      const SizedBox(height: 6),
      Text('YOUNG SINGLE ADULTS \u00B7 GLOBAL',
        style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 11, letterSpacing: 2.5)),
    ],
  );

  // ─── Login form ───────────────────────────────────────────────────────────
  List<Widget> _loginForm() => [
    // ── Email OTP mode (default) ──
    if (!_usePhoneLogin) ...[
      // Section label
      Align(
        alignment: Alignment.centerLeft,
        child: Text(
          'EMAIL ADDRESS',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppTheme.accent.withOpacity(0.9),
            letterSpacing: 1.5,
          ),
        ),
      ),
      const SizedBox(height: 10),
      // Email field
      TextField(
        controller: _emailCtrl,
        keyboardType: TextInputType.emailAddress,
        enabled: !_otpSent,
        style: const TextStyle(color: Colors.white, fontSize: 16),
        decoration: InputDecoration(
          prefixIcon: const Icon(Icons.email_outlined),
          hintText: 'you@example.com',
          hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
          filled: true,
          fillColor: AppTheme.primaryLight,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppTheme.accent, width: 2),
          ),
        ),
      ),
      const SizedBox(height: 24),

      // Send Verification Code button
      if (!_otpSent)
        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton.icon(
            onPressed: _loading ? null : _sendEmailOtp,
            icon: _loading
                ? const SizedBox(height: 20, width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary))
                : const Icon(Icons.email, size: 20),
            label: Text(_loading ? '' : 'Send Verification Code',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.accent,
              foregroundColor: AppTheme.primary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
              elevation: 4,
            ),
          ),
        ),

      // OTP field (shown after sending)
      if (_showOtpField) ...[
        const SizedBox(height: 24),
        TextField(
          controller: _otpCtrl,
          keyboardType: TextInputType.number,
          maxLength: 8,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          style: const TextStyle(color: Colors.white, fontSize: 22, letterSpacing: 8),
          textAlign: TextAlign.center,
          decoration: InputDecoration(
            labelText: 'Verification code',
            prefixIcon: const Icon(Icons.pin_outlined),
            counterText: '',
            hintText: '------',
            filled: true,
            fillColor: AppTheme.primaryLight,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3)),
            ),
          ),
        ),
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: _loading ? null : _verifyEmailOtp,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.accent,
              foregroundColor: AppTheme.primary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
            ),
            child: _loading
                ? const SizedBox(height: 20, width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary))
                : const Text('Verify & Sign In',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ),
        ),
        const SizedBox(height: 12),
        TextButton(
          onPressed: _loading ? null : () => setState(() {
            _otpSent = false; _showOtpField = false; _otpCtrl.clear();
          }),
          child: const Text('Resend code', style: TextStyle(color: AppTheme.accent)),
        ),
      ],

      // "Already have a code" shortcut
      if (!_otpSent) ...[
        const SizedBox(height: 16),
        // Divider with "or"
        Row(children: [
          Expanded(child: Divider(color: Colors.white.withOpacity(0.15))),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text('or', style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 13)),
          ),
          Expanded(child: Divider(color: Colors.white.withOpacity(0.15))),
        ]),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: OutlinedButton(
            onPressed: () => setState(() { _otpSent = true; _showOtpField = true; }),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.white,
              side: BorderSide(color: Colors.white.withOpacity(0.2)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
            ),
            child: const Text('Already have a code',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
          ),
        ),
      ],
    ],

    // ── Phone + Password mode ──
    if (_usePhoneLogin) ...[
      Align(
        alignment: Alignment.centerLeft,
        child: Text(
          'PHONE NUMBER',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppTheme.accent.withOpacity(0.9),
            letterSpacing: 1.5,
          ),
        ),
      ),
      const SizedBox(height: 10),
      TextField(
        controller: _phoneCtrl,
        keyboardType: TextInputType.phone,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          prefixIcon: Padding(
            padding: const EdgeInsets.only(left: 12, right: 8),
            child: Text('+1', style: TextStyle(
              color: Colors.white.withOpacity(0.7), fontSize: 16)),
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
          hintText: '(801) 555-2847',
          hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
          filled: true,
          fillColor: AppTheme.primaryLight,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3)),
          ),
        ),
      ),
      const SizedBox(height: 16),
      Align(
        alignment: Alignment.centerLeft,
        child: Text(
          'PASSWORD',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppTheme.accent.withOpacity(0.9),
            letterSpacing: 1.5,
          ),
        ),
      ),
      const SizedBox(height: 10),
      TextField(
        controller: _passCtrl,
        obscureText: true,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          prefixIcon: const Icon(Icons.lock_outlined),
          hintText: 'Enter your password',
          hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
          filled: true,
          fillColor: AppTheme.primaryLight,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3)),
          ),
        ),
      ),
      const SizedBox(height: 24),
      SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton(
          onPressed: _loading ? null : _loginWithPhone,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.accent,
            foregroundColor: AppTheme.primary,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
          ),
          child: _loading
              ? const SizedBox(height: 20, width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary))
              : const Text('Sign In',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        ),
      ),
    ],

    const SizedBox(height: 24),

    // ── Toggle login method ──
    TextButton(
      onPressed: () => setState(() {
        _usePhoneLogin = !_usePhoneLogin;
        _otpSent = false; _showOtpField = false;
      }),
      child: Text(
        _usePhoneLogin ? 'Use email verification instead' : 'Use phone & password instead',
        style: const TextStyle(color: AppTheme.accent, fontSize: 13),
      ),
    ),

    const SizedBox(height: 8),
    Divider(color: Colors.white.withOpacity(0.1)),
    const SizedBox(height: 8),

    // Register link
    Wrap(alignment: WrapAlignment.center, children: [
      Text("New to ChatSaints? ", style: TextStyle(color: Colors.white.withOpacity(0.5))),
      GestureDetector(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
        child: const Text('Create account',
          style: TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w700)),
      ),
    ]),
  ];

  @override
  void dispose() { _emailCtrl.dispose(); _otpCtrl.dispose(); _phoneCtrl.dispose(); _passCtrl.dispose(); super.dispose(); }
}
