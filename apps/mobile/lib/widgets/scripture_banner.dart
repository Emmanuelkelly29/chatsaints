import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Auto-rotating scripture banner displayed at the top of the home screen.
/// Fetches a new verse from the server every 5 minutes.
/// Tapping refreshes immediately with a fade animation.
class ScriptureBanner extends StatefulWidget {
  const ScriptureBanner({super.key});
  @override
  State<ScriptureBanner> createState() => _ScriptureBannerState();
}

class _ScriptureBannerState extends State<ScriptureBanner>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  Map<String, dynamic>? _scripture;
  Timer? _timer;
  late AnimationController _fadeCtrl;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _fadeCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fadeAnim = CurvedAnimation(parent: _fadeCtrl, curve: Curves.easeIn);
    _load();
    _timer = Timer.periodic(const Duration(minutes: 5), (_) => _load());
  }

  Future<void> _load() async {
    try {
      final res = await _api.get('/scriptures/random');
      if (!mounted) return;
      await _fadeCtrl.reverse();
      setState(() => _scripture = res);
      await _fadeCtrl.forward();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_scripture == null) return const SizedBox.shrink();

    return GestureDetector(
      onTap: _load,
      child: FadeTransition(
        opacity: _fadeAnim,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          decoration: const BoxDecoration(
            color: AppTheme.primary,
            border: Border(bottom: BorderSide(color: Colors.white12)),
          ),
          child: Row(children: [
            // Gold accent left bar
            Container(width: 3, height: 36, color: AppTheme.accent,
                margin: const EdgeInsets.only(right: 10)),
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '\u201c${_scripture!['text']}\u201d',
                  style: const TextStyle(
                    color: Colors.white, fontSize: 12,
                    fontStyle: FontStyle.italic, height: 1.45),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 3),
                Text(
                  '\u2014 ${_scripture!['book']} ${_scripture!['chapter']}:${_scripture!['verse']}  '
                  '\u2022 ${_scripture!['volume']}',
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.75),
                    fontSize: 10, fontWeight: FontWeight.w600),
                ),
              ],
            )),
            const SizedBox(width: 6),
            Icon(Icons.refresh, color: Colors.white.withOpacity(0.5), size: 16),
          ]),
        ),
      ),
    );
  }

  @override
  void dispose() { _timer?.cancel(); _fadeCtrl.dispose(); super.dispose(); }
}
