import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Voice note recording widget with live waveform visualization.
/// Shows animated waveform bars while recording, then playback bar after.
///
/// Usage in ChatScreen:
///   Hold the mic button → VoiceNoteRecorder appears
///   Slide left to cancel, release to send
///
/// Dependencies: record package for recording, audio_waveforms for playback waveform
class VoiceNoteRecorder extends StatefulWidget {
  final void Function(File audioFile, Duration duration, List<double> waveform) onSend;
  final VoidCallback onCancel;

  const VoiceNoteRecorder({
    super.key,
    required this.onSend,
    required this.onCancel,
  });

  @override
  State<VoiceNoteRecorder> createState() => _VoiceNoteRecorderState();
}

class _VoiceNoteRecorderState extends State<VoiceNoteRecorder>
    with SingleTickerProviderStateMixin {
  // Recording state
  bool _isRecording = true;
  Duration _elapsed  = Duration.zero;
  Timer? _timer;

  // Waveform data (simulated amplitude — replace with real mic amplitude in production)
  final List<double> _waveformData = [];
  Timer? _waveformTimer;
  final _random = math.Random();

  // Animation for the recording dot
  late AnimationController _pulseCtrl;
  late Animation<double>    _pulseAnim;

  @override
  void initState() {
    super.initState();

    _pulseCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 800))
      ..repeat(reverse: true);
    _pulseAnim = Tween(begin: 0.6, end: 1.0).animate(_pulseCtrl);

    // Start elapsed timer
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsed += const Duration(seconds: 1));
    });

    // Simulate waveform amplitude (in production, poll mic amplitude from record package)
    _waveformTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (!mounted || !_isRecording) return;
      setState(() {
        // Real implementation: use record.getAmplitude() here
        final amp = 0.2 + _random.nextDouble() * 0.8;
        _waveformData.add(amp);
        if (_waveformData.length > 60) _waveformData.removeAt(0);
      });
    });

    // TODO: Start actual recording
    // final record = Record();
    // final dir = await getTemporaryDirectory();
    // _filePath = '${dir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
    // await record.start(path: _filePath, encoder: AudioEncoder.aacLc, bitRate: 128000, samplingRate: 44100);
  }

  String get _elapsedLabel {
    final m = _elapsed.inMinutes.toString().padLeft(2, '0');
    final s = (_elapsed.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  Future<void> _stopAndSend() async {
    _timer?.cancel();
    _waveformTimer?.cancel();
    setState(() => _isRecording = false);

    // TODO: Stop recording and get file
    // await record.stop();
    // final file = File(_filePath);

    // For now, pass a placeholder
    // widget.onSend(file, _elapsed, List.from(_waveformData));
    widget.onCancel(); // Remove this line when real recording is wired up
  }

  @override
  Widget build(BuildContext context) => Container(
    height: 72,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: const BoxDecoration(
      color: AppTheme.surface,
      border: Border(top: BorderSide(color: AppTheme.divider)),
    ),
    child: Row(children: [
      // Cancel (swipe left hint)
      GestureDetector(
        onTap: () { _timer?.cancel(); _waveformTimer?.cancel(); widget.onCancel(); },
        child: Container(
          padding: const EdgeInsets.all(8),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.chevron_left, color: AppTheme.textSecondary),
            Text('Cancel', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
          ]),
        ),
      ),

      // Live waveform
      Expanded(
        child: _WaveformBar(
          amplitudes: _waveformData,
          isRecording: _isRecording,
        ),
      ),

      // Recording indicator + elapsed time
      Row(mainAxisSize: MainAxisSize.min, children: [
        AnimatedBuilder(
          animation: _pulseAnim,
          builder: (_, __) => Container(
            width: 10, height: 10,
            decoration: BoxDecoration(
              color: Colors.red.withOpacity(_pulseAnim.value),
              shape: BoxShape.circle,
            ),
          ),
        ),
        const SizedBox(width: 6),
        Text(_elapsedLabel,
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 15,
            fontWeight: FontWeight.w600,
            fontFeatures: [FontFeature.tabularFigures()],
          )),
      ]),

      const SizedBox(width: 12),

      // Send button
      GestureDetector(
        onTap: _stopAndSend,
        child: Container(
          width: 48, height: 48,
          decoration: const BoxDecoration(
            color: AppTheme.accent,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.send, color: Colors.white, size: 22),
        ),
      ),
    ]),
  );

  @override
  void dispose() {
    _timer?.cancel();
    _waveformTimer?.cancel();
    _pulseCtrl.dispose();
    super.dispose();
  }
}

// ── Waveform Bar Widget ──────────────────────────────────────────
class _WaveformBar extends StatelessWidget {
  final List<double> amplitudes;
  final bool isRecording;
  const _WaveformBar({required this.amplitudes, required this.isRecording});

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: const Size(double.infinity, 40),
    painter: _WaveformPainter(
      amplitudes: amplitudes,
      color: isRecording ? AppTheme.primary : AppTheme.textSecondary,
    ),
  );
}

class _WaveformPainter extends CustomPainter {
  final List<double> amplitudes;
  final Color color;
  const _WaveformPainter({required this.amplitudes, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    if (amplitudes.isEmpty) return;

    final paint = Paint()
      ..color = color
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 3;

    const barWidth = 3.0;
    const barSpacing = 2.0;
    final totalBars = (size.width / (barWidth + barSpacing)).floor();
    final startIdx = amplitudes.length > totalBars
        ? amplitudes.length - totalBars : 0;
    final displayAmps = amplitudes.sublist(startIdx);

    for (int i = 0; i < displayAmps.length; i++) {
      final x = i * (barWidth + barSpacing) + barWidth / 2;
      final amp = displayAmps[i].clamp(0.05, 1.0);
      final barH = amp * size.height * 0.9;
      final cy = size.height / 2;

      // Fade older bars
      final alpha = (i / displayAmps.length * 0.6 + 0.4);
      paint.color = color.withOpacity(alpha);

      canvas.drawLine(
        Offset(x, cy - barH / 2),
        Offset(x, cy + barH / 2),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_WaveformPainter old) =>
      old.amplitudes != amplitudes || old.color != color;
}

// ── Voice Note Playback Bubble ───────────────────────────────────
/// Displays a played/unplayed voice note in the chat bubble
class VoiceNoteBubble extends StatefulWidget {
  final String mediaUrl;
  final String duration;
  final bool isMe;
  const VoiceNoteBubble({
    super.key,
    required this.mediaUrl,
    required this.duration,
    required this.isMe,
  });
  @override
  State<VoiceNoteBubble> createState() => _VoiceNoteBubbleState();
}

class _VoiceNoteBubbleState extends State<VoiceNoteBubble> {
  bool _playing = false;
  double _progress = 0.0;
  Timer? _mockTimer;

  void _togglePlay() {
    setState(() => _playing = !_playing);
    if (_playing) {
      // TODO: Use just_audio package to play from widget.mediaUrl
      // final player = AudioPlayer();
      // await player.setUrl(widget.mediaUrl);
      // player.play();
      _mockTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
        setState(() {
          _progress += 0.01;
          if (_progress >= 1.0) {
            _progress = 0.0;
            _playing = false;
            _mockTimer?.cancel();
          }
        });
      });
    } else {
      _mockTimer?.cancel();
    }
  }

  @override
  Widget build(BuildContext context) {
    final fgColor = widget.isMe ? Colors.white : AppTheme.primary;
    final trackColor = widget.isMe ? Colors.white24 : Colors.grey.shade200;
    final fillColor = widget.isMe ? Colors.white : AppTheme.primary;

    return Row(mainAxisSize: MainAxisSize.min, children: [
      GestureDetector(
        onTap: _togglePlay,
        child: Container(
          width: 36, height: 36,
          decoration: BoxDecoration(
            color: fgColor.withOpacity(0.15),
            shape: BoxShape.circle,
          ),
          child: Icon(
            _playing ? Icons.pause : Icons.play_arrow,
            color: fgColor, size: 22,
          ),
        ),
      ),
      const SizedBox(width: 10),
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Waveform track
        SizedBox(
          width: 120, height: 28,
          child: Stack(children: [
            // Background track
            Positioned.fill(child: Container(
              decoration: BoxDecoration(
                color: trackColor,
                borderRadius: BorderRadius.circular(4),
              ),
            )),
            // Progress fill
            Positioned(
              left: 0, top: 0, bottom: 0,
              width: 120 * _progress,
              child: Container(
                decoration: BoxDecoration(
                  color: fillColor.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            // Mini waveform bars (static visual)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: List.generate(20, (i) {
                  final h = (math.sin(i * 0.8) * 0.5 + 0.5) * 14 + 2;
                  return Container(
                    width: 2.5, height: h,
                    decoration: BoxDecoration(
                      color: i / 20 <= _progress
                          ? fillColor : fgColor.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  );
                }),
              ),
            ),
          ]),
        ),
        const SizedBox(height: 2),
        Text(widget.duration,
          style: TextStyle(fontSize: 10, color: fgColor.withOpacity(0.7))),
      ]),
    ]);
  }

  @override
  void dispose() { _mockTimer?.cancel(); super.dispose(); }
}
