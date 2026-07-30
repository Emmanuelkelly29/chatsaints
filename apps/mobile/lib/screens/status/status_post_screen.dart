import 'dart:async';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class StatusPostScreen extends StatefulWidget {
  const StatusPostScreen({super.key});
  @override
  State<StatusPostScreen> createState() => _StatusPostScreenState();
}

class _StatusPostScreenState extends State<StatusPostScreen> {
  final _api = ApiService();
  final _captionCtrl = TextEditingController();
  final _textCtrl = TextEditingController();

  // Current mode: text, image, video, voice
  String _mode = 'text';

  // For image/video/voice
  XFile? _pickedFile;
  String? _pickedFileName;
  int _videoDurationSecs = 120;

  // For text status
  String _bgColor = '#0A1628';
  static const _bgColors = [
    '#0A1628', '#1A2E4A', '#C9A84C', '#2E7D32',
    '#C62828', '#4A148C', '#E65100', '#00695C',
    '#1565C0', '#AD1457',
  ];

  String _visibility = 'contacts_only';
  bool _posting = false;

  Future<void> _pickImage() async {
    final xfile = await ImagePicker().pickImage(
      source: ImageSource.gallery, imageQuality: 85);
    if (xfile != null) {
      setState(() {
        _pickedFile = xfile;
        _pickedFileName = xfile.name;
        _mode = 'image';
      });
    }
  }

  Future<void> _pickVideo() async {
    final xfile = await ImagePicker().pickVideo(
      source: ImageSource.gallery,
      maxDuration: const Duration(seconds: 120),
    );
    if (xfile != null) {
      setState(() {
        _pickedFile = xfile;
        _pickedFileName = xfile.name;
        _mode = 'video';
        _videoDurationSecs = 120;
      });
    }
  }

  Future<void> _recordVideo() async {
    final xfile = await ImagePicker().pickVideo(
      source: ImageSource.camera,
      maxDuration: const Duration(seconds: 120),
    );
    if (xfile != null) {
      setState(() {
        _pickedFile = xfile;
        _pickedFileName = xfile.name;
        _mode = 'video';
        _videoDurationSecs = 120;
      });
    }
  }

  Future<void> _pickVoice() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.audio,
      allowMultiple: false,
    );
    if (result != null && result.files.isNotEmpty) {
      final file = result.files.first;
      setState(() {
        _pickedFile = XFile(file.path ?? '', name: file.name, bytes: file.bytes);
        _pickedFileName = file.name;
        _mode = 'voice';
      });
    }
  }

  Future<void> _recordVoice() async {
    final recorder = AudioRecorder();
    Timer? recordingTicker;
    var elapsedSeconds = 0;
    var showRecordingDot = true;
    try {
      final hasPermission = await recorder.hasPermission();
      if (!hasPermission) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Microphone permission is required to record voice notes')),
          );
        }
        return;
      }

      final path = await _buildVoiceRecordingPath();
      await recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 128000, sampleRate: 44100),
        path: path,
      );

      if (!mounted) return;
      final recordedPath = await showModalBottomSheet<String>(
        context: context,
        backgroundColor: const Color(0xFF1A2E4A),
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
        builder: (sheetContext) => StatefulBuilder(
          builder: (sheetContext, setModalState) {
            recordingTicker ??= Timer.periodic(const Duration(seconds: 1), (_) {
              if (!sheetContext.mounted) return;
              setModalState(() {
                elapsedSeconds += 1;
                showRecordingDot = !showRecordingDot;
              });
            });

            final mm = (elapsedSeconds ~/ 60).toString().padLeft(2, '0');
            final ss = (elapsedSeconds % 60).toString().padLeft(2, '0');

            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.mic, color: Color(0xFFC9A84C), size: 44),
                  const SizedBox(height: 8),
                  const Text('Recording voice note...', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      AnimatedOpacity(
                        opacity: showRecordingDot ? 1 : 0.25,
                        duration: const Duration(milliseconds: 250),
                        child: const Icon(Icons.fiber_manual_record, color: Colors.redAccent, size: 14),
                      ),
                      const SizedBox(width: 6),
                      Text('$mm:$ss', style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w600)),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Row(children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          recordingTicker?.cancel();
                          await recorder.stop();
                          if (sheetContext.mounted) Navigator.pop(sheetContext);
                        },
                        icon: const Icon(Icons.close),
                        label: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () async {
                          recordingTicker?.cancel();
                          final recorded = await recorder.stop();
                          if (sheetContext.mounted) Navigator.pop(sheetContext, recorded);
                        },
                        icon: const Icon(Icons.stop),
                        label: const Text('Stop & Use'),
                      ),
                    ),
                  ]),
                ]),
              ),
            );
          },
        ),
      );

      recordingTicker?.cancel();

      if (recordedPath != null && recordedPath.isNotEmpty && mounted) {
        setState(() {
          _pickedFile = XFile(recordedPath);
          _pickedFileName = p.basename(recordedPath);
          _mode = 'voice';
        });
      }
    } catch (e) {
      recordingTicker?.cancel();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to record voice note: $e'), backgroundColor: AppTheme.danger),
        );
      }
    } finally {
      recordingTicker?.cancel();
      await recorder.dispose();
    }
  }

  Future<String> _buildVoiceRecordingPath() async {
    if (kIsWeb) return 'status_voice_note.webm';
    final dir = await getTemporaryDirectory();
    return '${dir.path}/status_voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
  }

  Future<void> _onModeSelected(String mode) async {
    setState(() => _mode = mode);
    if (mode == 'image') {
      await _showImageOptions();
      return;
    }
    if (mode == 'video') {
      await _showVideoOptions();
      return;
    }
    if (mode == 'voice') {
      await _showVoiceOptions();
    }
  }

  Future<void> _takePhoto() async {
    final xfile = await ImagePicker().pickImage(
      source: ImageSource.camera, imageQuality: 85);
    if (xfile != null) {
      setState(() {
        _pickedFile = xfile;
        _pickedFileName = xfile.name;
        _mode = 'image';
      });
    }
  }

  Future<void> _post() async {
    if (_mode == 'text' && _textCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter some text for your status')));
      return;
    }
    if (_mode != 'text' && _pickedFile == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a file first')));
      return;
    }

    setState(() => _posting = true);

    try {
      String? mediaUrl;

      if (_mode != 'text' && _pickedFile != null) {
        final uploadRes = await _api.uploadXFile('/media/upload', _pickedFile!);
        mediaUrl = uploadRes['url'] as String;
      }

      final body = <String, dynamic>{
        'media_type': _mode,
        'visibility': _visibility,
        'duration_secs': _mode == 'video' ? _videoDurationSecs.clamp(1, 120) : (_mode == 'voice' ? 10 : 5),
      };

      if (_mode == 'text') {
        body['text_content'] = _textCtrl.text.trim();
        body['background_color'] = _bgColor;
      } else {
        body['media_url'] = mediaUrl;
      }

      if (_captionCtrl.text.trim().isNotEmpty) {
        body['caption'] = _captionCtrl.text.trim();
      }

      await _api.post('/statuses', body);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Status posted! Disappears in 24 hours.'),
            backgroundColor: AppTheme.success,
          ));
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('New Status'),
        actions: [
          TextButton(
            onPressed: _posting ? null : _post,
            child: _posting
                ? const SizedBox(width: 20, height: 20,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('Post',
                    style: TextStyle(color: Colors.white,
                        fontWeight: FontWeight.w700, fontSize: 16)),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildModeSelector(),
            const SizedBox(height: 20),

            if (_mode == 'text') _buildTextEditor(),
            if (_mode == 'image' || _mode == 'video') _buildMediaPreview(),
            if (_mode == 'voice') _buildVoiceSection(),

            if (_mode == 'video')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Video status limit: up to 120 seconds',
                  style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ),

            const SizedBox(height: 16),

            if (_mode != 'text') ...[
              TextField(
                controller: _captionCtrl,
                maxLines: 3,
                maxLength: 300,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'Add a caption (optional)...',
                  hintStyle: TextStyle(color: Colors.white.withOpacity(0.5)),
                  border: const OutlineInputBorder(),
                  enabledBorder: OutlineInputBorder(
                    borderSide: BorderSide(color: Colors.white.withOpacity(0.3)),
                  ),
                ),
              ),
              const SizedBox(height: 20),
            ],

            Text('WHO CAN SEE THIS?',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 11,
                    color: Colors.white.withOpacity(0.6), letterSpacing: 1.1)),
            const SizedBox(height: 10),

            ..._buildVisibilityOptions(),

            const SizedBox(height: 80),
          ],
        ),
      ),
    );
  }

  Widget _buildModeSelector() {
    final modes = [
      ('text',  Icons.text_fields, 'Text'),
      ('image', Icons.image,       'Photo'),
      ('video', Icons.videocam,    'Video'),
      ('voice', Icons.mic,         'Voice'),
    ];

    return Row(
      children: modes.map((m) {
        final active = _mode == m.$1;
        return Expanded(
          child: GestureDetector(
            onTap: () => _onModeSelected(m.$1),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.symmetric(horizontal: 4),
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: active ? const Color(0xFFC9A84C) : const Color(0xFF1A2E4A),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(m.$2, color: active ? Colors.black : Colors.white70, size: 24),
                const SizedBox(height: 4),
                Text(m.$3, style: TextStyle(
                  color: active ? Colors.black : Colors.white70,
                  fontSize: 12, fontWeight: FontWeight.w600,
                )),
              ]),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildTextEditor() {
    return Column(children: [
      SizedBox(
        height: 48,
        child: ListView.builder(
          scrollDirection: Axis.horizontal,
          itemCount: _bgColors.length,
          itemBuilder: (_, i) {
            final c = _bgColors[i];
            final selected = _bgColor == c;
            final color = Color(int.parse(c.replaceFirst('#', '0xFF')));
            return GestureDetector(
              onTap: () => setState(() => _bgColor = c),
              child: Container(
                width: 36, height: 36,
                margin: const EdgeInsets.symmetric(horizontal: 4),
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                  border: selected
                      ? Border.all(color: Colors.white, width: 3)
                      : Border.all(color: Colors.white24, width: 1),
                ),
              ),
            );
          },
        ),
      ),
      const SizedBox(height: 16),

      Container(
        height: 280,
        decoration: BoxDecoration(
          color: Color(int.parse(_bgColor.replaceFirst('#', '0xFF'))),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: TextField(
              controller: _textCtrl,
              maxLines: 6,
              maxLength: 500,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w600,
                height: 1.4,
              ),
              decoration: InputDecoration(
                hintText: 'Type your status...',
                hintStyle: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 22),
                border: InputBorder.none,
                counterStyle: const TextStyle(color: Colors.white54),
              ),
            ),
          ),
        ),
      ),
    ]);
  }

  Widget _buildMediaPreview() {
    return GestureDetector(
      onTap: _mode == 'image' ? _showImageOptions : _showVideoOptions,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        height: 300,
        decoration: BoxDecoration(
          color: const Color(0xFF1A2E4A),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white24),
        ),
        child: _pickedFile == null
            ? Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(_mode == 'image' ? Icons.add_photo_alternate_outlined : Icons.video_library_outlined,
                    size: 56, color: const Color(0xFFC9A84C)),
                const SizedBox(height: 12),
                Text('Tap to add ${_mode == 'image' ? 'photo' : 'video'}',
                    style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 16)),
                const SizedBox(height: 6),
                Text('Your status disappears after 24 hours',
                    style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 13)),
              ])
            : Stack(children: [
                _filePlaceholder(),
                Positioned(
                  top: 8, right: 8,
                  child: IconButton(
                    onPressed: () => setState(() { _pickedFile = null; _pickedFileName = null; }),
                    icon: const Icon(Icons.close, color: Colors.white),
                    style: IconButton.styleFrom(backgroundColor: Colors.black54),
                  ),
                ),
              ]),
      ),
    );
  }

  Widget _filePlaceholder() {
    return Container(
      width: double.infinity, height: 300,
      decoration: BoxDecoration(
        color: const Color(0xFF1A2E4A),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(_mode == 'video' ? Icons.play_circle_fill : Icons.image,
            color: const Color(0xFFC9A84C), size: 64),
        const SizedBox(height: 8),
        Text(_pickedFileName ?? 'File selected',
            style: const TextStyle(color: Colors.white70, fontSize: 14)),
      ]),
    );
  }

  Widget _buildVoiceSection() {
    return GestureDetector(
      onTap: _showVoiceOptions,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        height: 200,
        decoration: BoxDecoration(
          color: const Color(0xFF1A2E4A),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white24),
        ),
        child: _pickedFile == null
            ? Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Icon(Icons.mic, size: 56, color: Color(0xFFC9A84C)),
                const SizedBox(height: 12),
                Text('Tap to select a voice note',
                    style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 16)),
                const SizedBox(height: 6),
                Text('Record now or choose from device',
                    style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 13)),
              ])
            : Stack(children: [
                Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.audiotrack, size: 56, color: Color(0xFFC9A84C)),
                  const SizedBox(height: 8),
                  Text(_pickedFileName ?? 'Voice note selected',
                      style: const TextStyle(color: Colors.white70, fontSize: 14)),
                  const SizedBox(height: 4),
                  const Text('Ready to post',
                      style: TextStyle(color: Colors.white38, fontSize: 12)),
                ])),
                Positioned(
                  top: 8, right: 8,
                  child: IconButton(
                    onPressed: () => setState(() { _pickedFile = null; _pickedFileName = null; }),
                    icon: const Icon(Icons.close, color: Colors.white),
                    style: IconButton.styleFrom(backgroundColor: Colors.black54),
                  ),
                ),
              ]),
      ),
    );
  }

  List<Widget> _buildVisibilityOptions() {
    final options = [
      ('contacts_only', Icons.group,        'My contacts',      'People I chat with'),
      ('everyone',      Icons.public,       'Everyone',         'All users'),
      ('selected',      Icons.person_add,   'Selected people',  'Only specific contacts'),
      ('except',        Icons.person_remove,'Everyone except…', 'Hide from specific contacts'),
    ];

    return options.map((opt) {
      final selected = _visibility == opt.$1;
      return GestureDetector(
        onTap: () => setState(() => _visibility = opt.$1),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: selected ? const Color(0xFFC9A84C).withOpacity(0.15) : const Color(0xFF1A2E4A),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected ? const Color(0xFFC9A84C) : Colors.white24,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(children: [
            Icon(opt.$2, color: selected ? const Color(0xFFC9A84C) : Colors.white54, size: 22),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(opt.$3, style: TextStyle(
                fontWeight: FontWeight.w600,
                color: selected ? const Color(0xFFC9A84C) : Colors.white,
              )),
              Text(opt.$4, style: TextStyle(fontSize: 12, color: Colors.white.withOpacity(0.5))),
            ])),
            if (selected) const Icon(Icons.check_circle, color: Color(0xFFC9A84C), size: 20),
          ]),
        ),
      );
    }).toList();
  }

  Future<void> _showImageOptions() {
    return showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A2E4A),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.image, color: Color(0xFFC9A84C)),
            title: const Text('Choose photo from gallery', style: TextStyle(color: Colors.white)),
            onTap: () { Navigator.pop(context); _pickImage(); },
          ),
          ListTile(
            leading: const Icon(Icons.camera_alt, color: Color(0xFFC9A84C)),
            title: const Text('Take a photo now', style: TextStyle(color: Colors.white)),
            onTap: () { Navigator.pop(context); _takePhoto(); },
          ),
        ]),
      ),
    );
  }

  Future<void> _showVideoOptions() {
    return showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A2E4A),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.video_library, color: Color(0xFFC9A84C)),
            title: const Text('Choose video from gallery (<=120s)', style: TextStyle(color: Colors.white)),
            onTap: () { Navigator.pop(context); _pickVideo(); },
          ),
          ListTile(
            leading: const Icon(Icons.videocam, color: Color(0xFFC9A84C)),
            title: const Text('Record video now (<=120s)', style: TextStyle(color: Colors.white)),
            onTap: () { Navigator.pop(context); _recordVideo(); },
          ),
        ]),
      ),
    );
  }

  Future<void> _showVoiceOptions() {
    return showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A2E4A),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.mic, color: Color(0xFFC9A84C)),
            title: const Text('Record voice note now (live)', style: TextStyle(color: Colors.white)),
            onTap: () { Navigator.pop(context); _recordVoice(); },
          ),
          ListTile(
            leading: const Icon(Icons.audio_file, color: Color(0xFFC9A84C)),
            title: const Text('Choose voice note from device', style: TextStyle(color: Colors.white)),
            onTap: () { Navigator.pop(context); _pickVoice(); },
          ),
        ]),
      ),
    );
  }

  @override
  void dispose() { _captionCtrl.dispose(); _textCtrl.dispose(); super.dispose(); }
}
