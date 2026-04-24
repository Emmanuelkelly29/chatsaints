import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';
import 'package:cross_file/cross_file.dart';
import 'package:path_provider/path_provider.dart';
import '../theme/app_theme.dart';

// ── Voice Note Recorder ──────────────────────────────────────────
class VoiceNoteRecorder extends StatefulWidget {
  final void Function(XFile audioFile, Duration duration, List<double> waveform) onSend;
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
  final _recorder = AudioRecorder();

  bool _isRecording = true;
  Duration _elapsed  = Duration.zero;
  Timer? _timer;

  final List<double> _waveformData = [];
  Timer? _waveformTimer;

  late AnimationController _pulseCtrl;
  late Animation<double>    _pulseAnim;

  @override
  void initState() {
    super.initState();

    _pulseCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 800))
      ..repeat(reverse: true);
    _pulseAnim = Tween(begin: 0.6, end: 1.0).animate(_pulseCtrl);

    _startRecording();
  }

  Future<void> _startRecording() async {
    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) {
      widget.onCancel();
      return;
    }

    String path;
    if (kIsWeb) {
      path = 'voice_note.webm';
    } else {
      final dir = await getTemporaryDirectory();
      path = '${dir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
    }

    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 128000, sampleRate: 44100),
      path: path,
    );

    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsed += const Duration(seconds: 1));
    });

    _waveformTimer = Timer.periodic(const Duration(milliseconds: 150), (_) async {
      if (!mounted || !_isRecording) return;
      try {
        final amp = await _recorder.getAmplitude();
        final normalized = ((amp.current + 60) / 60).clamp(0.05, 1.0);
        if (mounted) setState(() {
          _waveformData.add(normalized);
          if (_waveformData.length > 60) _waveformData.removeAt(0);
        });
      } catch (_) {}
    });
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

    final path = await _recorder.stop();
    if (path == null) {
      widget.onCancel();
      return;
    }

    widget.onSend(XFile(path), _elapsed, List.from(_waveformData));
  }

  void _cancel() {
    _timer?.cancel();
    _waveformTimer?.cancel();
    _recorder.stop();
    widget.onCancel();
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
      GestureDetector(
        onTap: _cancel,
        child: Container(
          padding: const EdgeInsets.all(8),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.chevron_left, color: AppTheme.textSecondary),
            Text('Cancel', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
          ]),
        ),
      ),
      Expanded(
        child: _WaveformBar(amplitudes: _waveformData, isRecording: _isRecording),
      ),
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
      GestureDetector(
        onTap: _stopAndSend,
        child: Container(
          width: 48, height: 48,
          decoration: const BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle),
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
    _recorder.dispose();
    super.dispose();
  }
}

// ── Waveform Bar ─────────────────────────────────────────────────
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
    final startIdx = amplitudes.length > totalBars ? amplitudes.length - totalBars : 0;
    final displayAmps = amplitudes.sublist(startIdx);
    for (int i = 0; i < displayAmps.length; i++) {
      final x = i * (barWidth + barSpacing) + barWidth / 2;
      final amp = displayAmps[i].clamp(0.05, 1.0);
      final barH = amp * size.height * 0.9;
      final cy = size.height / 2;
      paint.color = color.withOpacity(i / displayAmps.length * 0.6 + 0.4);
      canvas.drawLine(Offset(x, cy - barH / 2), Offset(x, cy + barH / 2), paint);
    }
  }

  @override
  bool shouldRepaint(_WaveformPainter old) =>
      old.amplitudes != amplitudes || old.color != color;
}

// ── Voice Note Playback Bubble ───────────────────────────────────
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
  final _player = AudioPlayer();
  bool _playing = false;
  double _progress = 0.0;
  StreamSubscription? _posSub;
  StreamSubscription? _stateSub;
  Duration _total = Duration.zero;

  @override
  void initState() {
    super.initState();
    _posSub = _player.positionStream.listen((pos) {
      if (_total.inMilliseconds > 0 && mounted) {
        setState(() => _progress = pos.inMilliseconds / _total.inMilliseconds);
      }
    });
    _stateSub = _player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed && mounted) {
        setState(() { _playing = false; _progress = 0.0; });
      }
      if (mounted) setState(() => _playing = state.playing);
    });
  }

  Future<void> _togglePlay() async {
    if (_playing) {
      await _player.pause();
      return;
    }
    try {
      if (_player.processingState == ProcessingState.idle) {
        final url = widget.mediaUrl.startsWith('http')
            ? widget.mediaUrl
            : 'http://localhost:4000${widget.mediaUrl}';
        final duration = await _player.setUrl(url);
        _total = duration ?? Duration.zero;
      }
      await _player.play();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final fgColor   = widget.isMe ? Colors.white : AppTheme.primary;
    final trackColor = widget.isMe ? Colors.white24 : Colors.grey.shade200;
    final fillColor  = widget.isMe ? Colors.white : AppTheme.primary;

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
        SizedBox(
          width: 120, height: 28,
          child: Stack(children: [
            Positioned.fill(child: Container(
              decoration: BoxDecoration(
                color: trackColor,
                borderRadius: BorderRadius.circular(4),
              ),
            )),
            Positioned(
              left: 0, top: 0, bottom: 0,
              width: 120 * _progress.clamp(0.0, 1.0),
              child: Container(
                decoration: BoxDecoration(
                  color: fillColor.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
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
  void dispose() {
    _posSub?.cancel();
    _stateSub?.cancel();
    _player.dispose();
    super.dispose();
  }
}