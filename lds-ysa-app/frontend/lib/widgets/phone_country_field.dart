import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

// [dialCode, flagEmoji, countryName]
const List<List<String>> kCountries = [
  ['+1',    '🇺🇸', 'United States'],
  ['+1',    '🇨🇦', 'Canada'],
  ['+44',   '🇬🇧', 'United Kingdom'],
  ['+61',   '🇦🇺', 'Australia'],
  ['+64',   '🇳🇿', 'New Zealand'],
  ['+27',   '🇿🇦', 'South Africa'],
  ['+234',  '🇳🇬', 'Nigeria'],
  ['+254',  '🇰🇪', 'Kenya'],
  ['+233',  '🇬🇭', 'Ghana'],
  ['+256',  '🇺🇬', 'Uganda'],
  ['+255',  '🇹🇿', 'Tanzania'],
  ['+260',  '🇿🇲', 'Zambia'],
  ['+263',  '🇿🇼', 'Zimbabwe'],
  ['+267',  '🇧🇼', 'Botswana'],
  ['+243',  '🇨🇩', 'DR Congo'],
  ['+237',  '🇨🇲', 'Cameroon'],
  ['+221',  '🇸🇳', 'Senegal'],
  ['+225',  '🇨🇮', 'Ivory Coast'],
  ['+52',   '🇲🇽', 'Mexico'],
  ['+55',   '🇧🇷', 'Brazil'],
  ['+54',   '🇦🇷', 'Argentina'],
  ['+56',   '🇨🇱', 'Chile'],
  ['+51',   '🇵🇪', 'Peru'],
  ['+57',   '🇨🇴', 'Colombia'],
  ['+58',   '🇻🇪', 'Venezuela'],
  ['+591',  '🇧🇴', 'Bolivia'],
  ['+593',  '🇪🇨', 'Ecuador'],
  ['+595',  '🇵🇾', 'Paraguay'],
  ['+598',  '🇺🇾', 'Uruguay'],
  ['+503',  '🇸🇻', 'El Salvador'],
  ['+502',  '🇬🇹', 'Guatemala'],
  ['+504',  '🇭🇳', 'Honduras'],
  ['+506',  '🇨🇷', 'Costa Rica'],
  ['+507',  '🇵🇦', 'Panama'],
  ['+63',   '🇵🇭', 'Philippines'],
  ['+62',   '🇮🇩', 'Indonesia'],
  ['+60',   '🇲🇾', 'Malaysia'],
  ['+65',   '🇸🇬', 'Singapore'],
  ['+66',   '🇹🇭', 'Thailand'],
  ['+84',   '🇻🇳', 'Vietnam'],
  ['+82',   '🇰🇷', 'South Korea'],
  ['+81',   '🇯🇵', 'Japan'],
  ['+86',   '🇨🇳', 'China'],
  ['+91',   '🇮🇳', 'India'],
  ['+92',   '🇵🇰', 'Pakistan'],
  ['+880',  '🇧🇩', 'Bangladesh'],
  ['+94',   '🇱🇰', 'Sri Lanka'],
  ['+977',  '🇳🇵', 'Nepal'],
  ['+856',  '🇱🇦', 'Laos'],
  ['+855',  '🇰🇭', 'Cambodia'],
  ['+95',   '🇲🇲', 'Myanmar'],
  ['+675',  '🇵🇬', 'Papua New Guinea'],
  ['+679',  '🇫🇯', 'Fiji'],
  ['+685',  '🇼🇸', 'Samoa'],
  ['+676',  '🇹🇴', 'Tonga'],
  ['+677',  '🇸🇧', 'Solomon Islands'],
  ['+678',  '🇻🇺', 'Vanuatu'],
  ['+686',  '🇰🇮', 'Kiribati'],
  ['+49',   '🇩🇪', 'Germany'],
  ['+33',   '🇫🇷', 'France'],
  ['+39',   '🇮🇹', 'Italy'],
  ['+34',   '🇪🇸', 'Spain'],
  ['+351',  '🇵🇹', 'Portugal'],
  ['+31',   '🇳🇱', 'Netherlands'],
  ['+46',   '🇸🇪', 'Sweden'],
  ['+47',   '🇳🇴', 'Norway'],
  ['+45',   '🇩🇰', 'Denmark'],
  ['+358',  '🇫🇮', 'Finland'],
  ['+353',  '🇮🇪', 'Ireland'],
  ['+48',   '🇵🇱', 'Poland'],
  ['+380',  '🇺🇦', 'Ukraine'],
  ['+7',    '🇷🇺', 'Russia'],
  ['+7',    '🇰🇿', 'Kazakhstan'],
  ['+972',  '🇮🇱', 'Israel'],
  ['+971',  '🇦🇪', 'UAE'],
  ['+966',  '🇸🇦', 'Saudi Arabia'],
  ['+965',  '🇰🇼', 'Kuwait'],
  ['+968',  '🇴🇲', 'Oman'],
  ['+974',  '🇶🇦', 'Qatar'],
  ['+20',   '🇪🇬', 'Egypt'],
  ['+212',  '🇲🇦', 'Morocco'],
  ['+216',  '🇹🇳', 'Tunisia'],
  ['+213',  '🇩🇿', 'Algeria'],
  ['+251',  '🇪🇹', 'Ethiopia'],
  ['+252',  '🇸🇴', 'Somalia'],
  ['+250',  '🇷🇼', 'Rwanda'],
  ['+258',  '🇲🇿', 'Mozambique'],
];

/// Detect the country (dialCode, flag, name) from a phone number string.
/// Returns the longest-matching dial code entry.
List<String>? detectCountryFromPhone(String phone) {
  if (!phone.startsWith('+')) return null;
  final sorted = [...kCountries]
    ..sort((a, b) => b[0].length.compareTo(a[0].length));
  for (final c in sorted) {
    if (phone.startsWith(c[0])) return c;
  }
  return null;
}

/// A phone input row with:
///  • A tappable flag button (opens bottom-sheet country picker)
///  • A small editable dial-code field (e.g. "+1") — flag auto-updates as typed
///  • The main phone-number text field
///
/// The full value (dialCode + localNumber) is provided via [onChanged].
/// [controller] holds only the local portion of the number.
class PhoneCountryField extends StatefulWidget {
  final TextEditingController controller;
  final String? hintText;
  final String? Function(String?)? validator; // null = use TextField, non-null = TextFormField
  final void Function(String fullNumber)? onChanged;
  final FocusNode? focusNode;

  const PhoneCountryField({
    super.key,
    required this.controller,
    this.hintText,
    this.validator,
    this.onChanged,
    this.focusNode,
  });

  @override
  State<PhoneCountryField> createState() => _PhoneCountryFieldState();
}

class _PhoneCountryFieldState extends State<PhoneCountryField> {
  final _codeCtrl = TextEditingController(text: '+1');
  String _flag = '🇺🇸';

  @override
  void initState() {
    super.initState();
    _codeCtrl.addListener(_onCodeChanged);
  }

  @override
  void dispose() {
    _codeCtrl.removeListener(_onCodeChanged);
    _codeCtrl.dispose();
    super.dispose();
  }

  void _onCodeChanged() {
    final code = _codeCtrl.text.trim();
    final sorted = [...kCountries]
      ..sort((a, b) => b[0].length.compareTo(a[0].length));
    for (final c in sorted) {
      if (c[0] == code || (code.startsWith(c[0]) && code.length <= c[0].length + 2)) {
        if (c[1] != _flag) setState(() => _flag = c[1]);
        return;
      }
    }
    if (code.isEmpty || code == '+') {
      if (_flag != '🌐') setState(() => _flag = '🌐');
    }
    _notifyChanged();
  }

  void _notifyChanged() {
    final code = _codeCtrl.text.trim();
    final local = widget.controller.text.trim();
    widget.onChanged?.call(local.isEmpty ? code : '$code$local');
  }

  void _showCountryPicker() {
    final _searchCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) {
          final query = _searchCtrl.text.toLowerCase();
          final filtered = kCountries
            .where((c) =>
              c[2].toLowerCase().contains(query) ||
              c[0].contains(query))
            .toList();
          return DraggableScrollableSheet(
            initialChildSize: 0.65,
            maxChildSize: 0.92,
            minChildSize: 0.4,
            expand: false,
            builder: (_, scrollCtrl) => Column(children: [
              const SizedBox(height: 8),
              Container(width: 40, height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2))),
              const SizedBox(height: 12),
              const Text('Select Country',
                style: TextStyle(color: Colors.white,
                  fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  controller: _searchCtrl,
                  autofocus: true,
                  style: const TextStyle(color: Colors.white),
                  onChanged: (_) => setModal(() {}),
                  decoration: InputDecoration(
                    hintText: 'Search country or code...',
                    hintStyle: const TextStyle(color: Colors.white38),
                    prefixIcon: const Icon(Icons.search, color: Colors.white54),
                    filled: true,
                    fillColor: AppTheme.primaryLight,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: ListView.builder(
                  controller: scrollCtrl,
                  itemCount: filtered.length,
                  itemBuilder: (_, i) {
                    final c = filtered[i];
                    final selected = c[0] == _codeCtrl.text.trim() && c[1] == _flag;
                    return ListTile(
                      leading: Text(c[1], style: const TextStyle(fontSize: 24)),
                      title: Text(c[2],
                        style: TextStyle(
                          color: selected ? AppTheme.accent : Colors.white,
                          fontWeight: selected ? FontWeight.w700 : FontWeight.normal)),
                      trailing: Text(c[0],
                        style: const TextStyle(color: Colors.white54, fontSize: 13)),
                      onTap: () {
                        setState(() {
                          _flag = c[1];
                          _codeCtrl.text = c[0];
                          _codeCtrl.selection = TextSelection.collapsed(offset: c[0].length);
                        });
                        Navigator.pop(ctx);
                        _notifyChanged();
                      },
                    );
                  },
                ),
              ),
            ]),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final inputDecoration = InputDecoration(
      hintText: widget.hintText ?? '555-2847',
      hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
      filled: true,
      fillColor: AppTheme.primaryLight,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3))),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3))),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.7))),
    );

    return Row(children: [
      // ── Flag button (tappable → picker) ──────────────────────────────────
      GestureDetector(
        onTap: _showCountryPicker,
        child: Container(
          height: 52,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: AppTheme.primaryLight,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.accent.withOpacity(0.3)),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(_flag, style: const TextStyle(fontSize: 22)),
            const SizedBox(width: 4),
            Icon(Icons.arrow_drop_down,
              color: Colors.white.withOpacity(0.5), size: 18),
          ]),
        ),
      ),
      const SizedBox(width: 6),
      // ── Dial code field (auto-updates flag) ──────────────────────────────
      SizedBox(
        width: 60,
        height: 52,
        child: TextField(
          controller: _codeCtrl,
          keyboardType: TextInputType.phone,
          style: const TextStyle(color: Colors.white, fontSize: 14),
          textAlign: TextAlign.center,
          decoration: InputDecoration(
            filled: true,
            fillColor: AppTheme.primaryLight,
            contentPadding: EdgeInsets.zero,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3))),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.3))),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: AppTheme.accent.withOpacity(0.7))),
          ),
        ),
      ),
      const SizedBox(width: 6),
      // ── Local phone number field ──────────────────────────────────────────
      Expanded(
        child: widget.validator != null
          ? TextFormField(
              controller: widget.controller,
              focusNode: widget.focusNode,
              keyboardType: TextInputType.phone,
              style: const TextStyle(color: Colors.white),
              decoration: inputDecoration,
              validator: widget.validator,
              onChanged: (_) => _notifyChanged(),
            )
          : TextField(
              controller: widget.controller,
              focusNode: widget.focusNode,
              keyboardType: TextInputType.phone,
              style: const TextStyle(color: Colors.white),
              decoration: inputDecoration,
              onChanged: (_) => _notifyChanged(),
            ),
      ),
    ]);
  }

  /// Returns the full phone number: dialCode + localNumber
  String get fullNumber {
    final code = _codeCtrl.text.trim();
    final local = widget.controller.text.trim();
    return '$code$local';
  }
}
