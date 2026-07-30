import 'dart:async';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:video_player/video_player.dart';
import '../../services/api_service.dart';
import '../../models/status_model.dart';
import '../../theme/app_theme.dart';
import '../../utils/constants.dart';
import '../../widgets/voice_note_recorder.dart';

class StatusViewerScreen extends StatefulWidget {
  final StatusContact contact;
  const StatusViewerScreen({super.key, required this.contact});
  @override
  State<StatusViewerScreen> createState() => _StatusViewerScreenState();
}

class _StatusViewerScreenState extends State<StatusViewerScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  late int _currentIndex;
  late AnimationController _progressCtrl;
  Timer? _autoAdvance;
  bool _paused = false;
  bool _stealthThisView = false;

  String _formatDuration(int seconds) {
    final total = seconds < 0 ? 0 : seconds;
    final m = (total ~/ 60).toString().padLeft(2, '0');
    final s = (total % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  List<StatusModel> get _statuses => widget.contact.statuses;
  StatusModel get _current => _statuses[_currentIndex];

  @override
  void initState() {
    super.initState();
    _currentIndex = 0;
    _progressCtrl = AnimationController(vsync: this);
    _startCurrentStatus();
  }

  void _startCurrentStatus() {
    _progressCtrl.stop();
    _progressCtrl.reset();

    final durationSecs = _current.mediaType == 'video'
        ? _current.durationSecs
        : _current.durationSecs.clamp(3, 8);

    _progressCtrl.duration = Duration(seconds: durationSecs);

    // Record view
    _recordView();

    _progressCtrl.forward();
    _autoAdvance?.cancel();
    _autoAdvance = Timer(Duration(seconds: durationSecs), _next);
  }

  Future<void> _recordView() async {
    try {
      await _api.post('/statuses/${_current.id}/view', {'stealth': _stealthThisView});
    } catch (_) {}
  }

  void _next() {
    if (_currentIndex < _statuses.length - 1) {
      setState(() => _currentIndex++);
      _startCurrentStatus();
    } else {
      Navigator.pop(context);
    }
  }

  void _prev() {
    if (_currentIndex > 0) {
      setState(() => _currentIndex--);
      _startCurrentStatus();
    }
  }

  void _pause() {
    setState(() => _paused = true);
    _progressCtrl.stop();
    _autoAdvance?.cancel();
  }

  void _resume() {
    setState(() => _paused = false);
    _progressCtrl.forward();
    final remaining = Duration(
      milliseconds: ((_current.durationSecs) * 1000 * (1 - _progressCtrl.value)).toInt(),
    );
    _autoAdvance = Timer(remaining, _next);
  }

  @override
  Widget build(BuildContext context) {
    final rawUrl = _current.mediaUrl ?? '';
    final mediaUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl.isNotEmpty
            ? '${AppConstants.uploadsBase}/${rawUrl.split('/').last}'
            : '';

    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onTapDown: (_) => _pause(),
        onTapUp: (details) {
          _resume();
          final x = details.globalPosition.dx;
          final w = MediaQuery.of(context).size.width;
          if (x < w / 3) {
            _prev();
          } else if (x > w * 2 / 3) _next();
        },
        onLongPressStart: (_) => _pause(),
        onLongPressEnd: (_) => _resume(),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // ── Media ────────────────────────────────────────────
            if (_current.mediaType == 'text')
              Container(
                color: Color(int.parse(
                  (_current.backgroundColor ?? '#0A1628').replaceFirst('#', '0xFF'))),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Text(
                      _current.textContent ?? _current.caption ?? '',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white, fontSize: 24,
                        fontWeight: FontWeight.w600, height: 1.4),
                    ),
                  ),
                ),
              )
            else if (_current.mediaType == 'voice')
              Container(
                color: const Color(0xFF0A1628),
                child: Center(
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    const Icon(Icons.audiotrack, color: Color(0xFFC9A84C), size: 56),
                    const SizedBox(height: 16),
                    const Text('Voice Note', style: TextStyle(
                      color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 14),
                    if (mediaUrl.isNotEmpty)
                      VoiceNoteBubble(
                        mediaUrl: mediaUrl,
                        duration: _formatDuration(_current.durationSecs),
                        isMe: false,
                      ),
                    if (_current.caption != null) ...[
                      const SizedBox(height: 8),
                      Text(_current.caption!, style: const TextStyle(
                        color: Colors.white70, fontSize: 14)),
                    ],
                  ]),
                ),
              )
            else if (_current.mediaType == 'image')
              CachedNetworkImage(
                imageUrl: mediaUrl,
                fit: BoxFit.contain,
                placeholder: (_, __) => const Center(
                  child: CircularProgressIndicator(color: Colors.white)),
                errorWidget: (_, __, ___) => const Center(
                  child: Icon(Icons.broken_image, color: Colors.white, size: 64)),
              )
            else if (_current.mediaType == 'video' && mediaUrl.isNotEmpty)
              _StatusVideoPlayer(mediaUrl: mediaUrl)
            else
              const Center(child: Icon(Icons.play_circle_fill,
                  color: Colors.white, size: 72)),

            // ── Gradient overlays ─────────────────────────────────
            const Positioned(
              top: 0, left: 0, right: 0, height: 120,
              child: DecoratedBox(decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter, end: Alignment.bottomCenter,
                  colors: [Colors.black54, Colors.transparent]),
              )),
            ),
            const Positioned(
              bottom: 0, left: 0, right: 0, height: 160,
              child: DecoratedBox(decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter, end: Alignment.topCenter,
                  colors: [Colors.black54, Colors.transparent]),
              )),
            ),

            // ── Progress bars ─────────────────────────────────────
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              left: 8, right: 8,
              child: Row(
                children: List.generate(_statuses.length, (i) => Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: AnimatedBuilder(
                      animation: _progressCtrl,
                      builder: (_, __) {
                        double val = i < _currentIndex
                            ? 1.0
                            : i == _currentIndex
                                ? _progressCtrl.value
                                : 0.0;
                        return LinearProgressIndicator(
                          value: val,
                          backgroundColor: Colors.white38,
                          valueColor: const AlwaysStoppedAnimation(Colors.white),
                          minHeight: 2.5,
                        );
                      },
                    ),
                  ),
                )),
              ),
            ),

            // ── Header: author info ───────────────────────────────
            Positioned(
              top: MediaQuery.of(context).padding.top + 20,
              left: 12, right: 12,
              child: Row(children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: AppTheme.primaryLight,
                  backgroundImage: widget.contact.authorPhoto != null
                      ? NetworkImage(widget.contact.authorPhoto!) : null,
                  child: widget.contact.authorPhoto == null
                      ? Text(widget.contact.authorName[0].toUpperCase(),
                          style: const TextStyle(color: Colors.white))
                      : null,
                ),
                const SizedBox(width: 10),
                Expanded(child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.contact.authorName,
                        style: const TextStyle(color: Colors.white,
                            fontWeight: FontWeight.w600, fontSize: 15)),
                    Text(_current.timeLeftLabel,
                        style: const TextStyle(color: Colors.white70, fontSize: 12)),
                  ],
                )),
                // Stealth toggle
                GestureDetector(
                  onTap: () => setState(() => _stealthThisView = !_stealthThisView),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: _stealthThisView
                          ? Colors.white.withOpacity(0.3)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: Colors.white54),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(_stealthThisView ? Icons.visibility_off : Icons.visibility,
                          color: Colors.white, size: 14),
                      const SizedBox(width: 4),
                      Text(_stealthThisView ? 'Hidden' : 'Visible',
                          style: const TextStyle(color: Colors.white, fontSize: 12)),
                    ]),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.close, color: Colors.white),
                  onPressed: () => Navigator.pop(context),
                ),
              ]),
            ),

            // ── Caption ───────────────────────────────────────────
            if (_current.caption != null && _current.caption!.isNotEmpty)
              Positioned(
                bottom: 80, left: 16, right: 16,
                child: Text(
                  _current.caption!,
                  style: const TextStyle(color: Colors.white, fontSize: 16,
                      shadows: [Shadow(blurRadius: 8)]),
                  textAlign: TextAlign.center,
                ),
              ),

            // ── Paused indicator ──────────────────────────────────
            if (_paused)
              const Center(
                child: Icon(Icons.pause_circle_outline, color: Colors.white54, size: 64)),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _progressCtrl.dispose();
    _autoAdvance?.cancel();
    super.dispose();
  }
}

class _StatusVideoPlayer extends StatefulWidget {
  final String mediaUrl;
  const _StatusVideoPlayer({required this.mediaUrl});

  @override
  State<_StatusVideoPlayer> createState() => _StatusVideoPlayerState();
}

class _StatusVideoPlayerState extends State<_StatusVideoPlayer> {
  VideoPlayerController? _controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.mediaUrl))
      ..setLooping(true)
      ..initialize().then((_) {
        if (!mounted || _controller == null) return;
        setState(() => _ready = true);
        _controller!.play();
      });
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready || _controller == null) {
      return const Center(child: CircularProgressIndicator(color: Colors.white));
    }
    return Stack(
      alignment: Alignment.bottomCenter,
      children: [
        Center(
          child: AspectRatio(
            aspectRatio: _controller!.value.aspectRatio > 0 ? _controller!.value.aspectRatio : (16 / 9),
            child: VideoPlayer(_controller!),
          ),
        ),
        VideoProgressIndicator(_controller!, allowScrubbing: true,
            colors: const VideoProgressColors(playedColor: Color(0xFFC9A84C))),
      ],
    );
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }
}
