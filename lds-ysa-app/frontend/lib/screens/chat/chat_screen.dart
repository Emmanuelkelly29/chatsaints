import 'dart:async';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import '../../services/api_service.dart';
import '../../services/websocket_service.dart';
import '../../services/auth_service.dart';
import '../../models/message_model.dart';
import '../../models/conversation_model.dart';
import '../../theme/app_theme.dart';
import '../../utils/constants.dart';
import 'group_info_screen.dart';
import '../calls/call_screen.dart';
import '../../widgets/voice_note_recorder.dart';

const _kEmojis = ['👍','❤️','😂','😮','😢','🙏','🔥','✅','👏','💙'];

class ChatScreen extends StatefulWidget {
  final ConversationModel conversation;
  const ChatScreen({super.key, required this.conversation});
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _api        = ApiService();
  final _ws         = WebSocketService();
  final _textCtrl   = TextEditingController();
  final _scrollCtrl = ScrollController();
  final _me         = AuthService().currentUser;
  final List<MessageModel> _messages = [];

  bool _loading      = true;
  bool _sending      = false;
  String? _typingUser;
  Timer? _typingTimer;
  MessageModel? _replyTo;
  StreamSubscription? _wsSub;

  // Reactions overlay
  String? _reactingMessageId;

  // Voice recorder & call
  bool _showVoiceRecorder = false;
  String? _pendingCallType;

  @override
  void initState() {
    super.initState();
    _loadMessages();
    _wsSub = _ws.messages.listen(_onWsMessage);
  }

  Future<void> _loadMessages() async {
    try {
      final res  = await _api.get('/conversations/${widget.conversation.id}/messages');
      final list = (res is List ? res : (res['data'] as List? ?? [])) as List<dynamic>;
      if (mounted) {
        setState(() {
        _messages.addAll(list.whereType<Map<String, dynamic>>()
            .map((j) => MessageModel.fromJson(j)));
        _loading = false;
      });
      }
      _scrollToBottom();
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  void _onWsMessage(Map<String, dynamic> msg) {
    if (!mounted) return;
    switch (msg['type']) {
      case 'new_message':
        final m = MessageModel.fromJson(msg['payload'] as Map<String, dynamic>);
        if (m.conversationId == widget.conversation.id) {
          setState(() => _messages.add(m));
          _ws.markRead(m.id);
          _scrollToBottom();
        }
        break;
      case 'call_initiated':
        final p2 = msg['payload'] as Map<String, dynamic>;
        if (_pendingCallType != null && mounted) {
          final callId          = p2['call_id'] as String? ?? p2['id'] as String? ?? '';
          final callType        = _pendingCallType!;
          final receiverOnline  = p2['any_receiver_online'] as bool? ?? false;
          _pendingCallType = null;
          Navigator.push(context, MaterialPageRoute(
            builder: (_) => CallScreen(
              callId: callId,
              conversationId: widget.conversation.id,
              remoteUserName: widget.conversation.name ?? 'User',
              remoteUserPhoto: widget.conversation.photoUrl,
              callType: callType,
              isOutgoing: true,
              receiverOnline: receiverOnline,
            ),
            fullscreenDialog: true,
          ));
        }
        break;
      case 'user_typing':
        final p = msg['payload'] as Map<String, dynamic>;
        if (p['conversation_id'] == widget.conversation.id && p['user_id'] != _me?.id) {
          setState(() => _typingUser = p['user_name'] as String?);
          _typingTimer?.cancel();
          _typingTimer = Timer(const Duration(seconds: 3), () {
            if (mounted) setState(() => _typingUser = null);
          });
        }
        break;
    }
  }

  void _scrollToBottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (_scrollCtrl.hasClients) {
      _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
    }
  });

  // ── Sending ──────────────────────────────────────────────────
  void _sendText() {
    final text = _textCtrl.text.trim();
    if (text.isEmpty) return;
    _textCtrl.clear();
    _ws.sendMessage(
      conversationId: widget.conversation.id,
      content: text,
      replyToMessageId: _replyTo?.id,
    );
    if (mounted) setState(() => _replyTo = null);
  }

  Future<void> _sendMedia(String type) async {
    setState(() => _sending = true);
    try {
      XFile? xfile;
      if (type == 'image') {
        xfile = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 80);
      } else if (type == 'video') {
        xfile = await ImagePicker().pickVideo(source: ImageSource.gallery);
      } else {
        final result = await FilePicker.platform.pickFiles(
          type: FileType.any,
          withData: kIsWeb,
        );
        if (result != null && result.files.isNotEmpty) {
          final pf = result.files.single;
          if (kIsWeb && pf.bytes != null) {
            // Create XFile from bytes for web
            xfile = XFile.fromData(pf.bytes!, name: pf.name);
          } else if (pf.path != null) {
            xfile = XFile(pf.path!);
          }
        }
      }

      if (xfile == null) {
        if (mounted) setState(() => _sending = false);
        return;
      }

      final uploadRes = await _api.uploadXFile('/media/upload', xfile);
      final mediaUrl  = uploadRes['url'] as String;

      _ws.send('send_message', {
        'conversation_id': widget.conversation.id,
        'content': type == 'image' ? '📷 Photo' : type == 'video' ? '🎥 Video' : '📎 File',
        'message_type': type,
        'media_url': mediaUrl,
        if (_replyTo != null) 'reply_to_message_id': _replyTo!.id,
      });

      if (mounted) setState(() => _replyTo = null);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  // ── Reactions ────────────────────────────────────────────────
  Future<void> _react(String messageId, String emoji) async {
    try {
      await _api.post('/messages/$messageId/reactions', {'emoji': emoji});
      setState(() => _reactingMessageId = null);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // ── Calls ────────────────────────────────────────────────────
  void _initiateCall(String callType) {
    setState(() => _pendingCallType = callType);
    _ws.initiateCall(widget.conversation.id, callType);
  }

  Future<void> _sendVoiceNote(XFile audioFile, Duration duration, List<double> waveform) async {
    setState(() { _showVoiceRecorder = false; _sending = true; });
    try {
      final uploadRes = await _api.uploadXFile('/media/upload', audioFile);
      final mediaUrl  = uploadRes['url'] as String;
      final m = duration.inMinutes.toString().padLeft(2, '0');
      final s = (duration.inSeconds % 60).toString().padLeft(2, '0');
      _ws.send('send_message', {
        'conversation_id': widget.conversation.id,
        'content': '$m:$s',
        'message_type': 'voice_note',
        'media_url': mediaUrl,
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _startGroupVideoCall() async {
    try {
      final res = await _api.post('/video/rooms', {'conversation_id': widget.conversation.id});
      if (!mounted) return;
      if (res['is_mock'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Video call started (dev mode — set LIVEKIT_* env vars for real calls)')));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Joined room: ${res['room_name']}')));
        // TODO: Launch LiveKit Flutter SDK with res['token'] and res['livekit_url']
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.danger));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: GestureDetector(
        onTap: widget.conversation.isGroup
            ? () => Navigator.push(context, MaterialPageRoute(
                builder: (_) => GroupInfoScreen(groupId: widget.conversation.id)))
            : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.conversation.name ?? 'Chat', style: const TextStyle(fontSize: 16)),
            if (_typingUser != null)
              Text('$_typingUser is typing…',
                style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic)),
            if (widget.conversation.isGroup && _typingUser == null)
              Text('${widget.conversation.memberCount} members',
                style: const TextStyle(fontSize: 11)),
          ],
        ),
      ),
      actions: [
        IconButton(icon: const Icon(Icons.call),    onPressed: () => _initiateCall('voice')),
        if (widget.conversation.isGroup)
          IconButton(icon: const Icon(Icons.videocam), onPressed: _startGroupVideoCall)
        else
          IconButton(icon: const Icon(Icons.videocam), onPressed: () => _initiateCall('video')),
        IconButton(icon: const Icon(Icons.more_vert), onPressed: () {}),
      ],
    ),
    body: Column(
      children: [
        // Messages list
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : Stack(children: [
                  ListView.builder(
                    controller: _scrollCtrl,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) => _MessageBubble(
                      message: _messages[i],
                      isMe: _messages[i].senderId == _me?.id,
                      onReply: (m) => setState(() => _replyTo = m),
                      onReact: (m) => setState(() => _reactingMessageId = m.id),
                    ),
                  ),
                  // Emoji reaction overlay
                  if (_reactingMessageId != null)
                    Positioned.fill(
                      child: GestureDetector(
                        onTap: () => setState(() => _reactingMessageId = null),
                        child: Container(
                          color: Colors.black26,
                          alignment: Alignment.center,
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(32),
                              boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.1), blurRadius: 12)],
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: _kEmojis.map((e) => GestureDetector(
                                onTap: () => _react(_reactingMessageId!, e),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 6),
                                  child: Text(e, style: const TextStyle(fontSize: 26)),
                                ),
                              )).toList(),
                            ),
                          ),
                        ),
                      ),
                    ),
                ]),
        ),

        // Reply preview
        if (_replyTo != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: AppTheme.surface,
            child: Row(children: [
              Container(width: 3, height: 36, color: AppTheme.accent),
              const SizedBox(width: 10),
              Expanded(child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_replyTo!.senderName,
                    style: const TextStyle(fontWeight: FontWeight.w600, color: AppTheme.accent, fontSize: 12)),
                  Text(_replyTo!.content ?? '',
                    maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                ],
              )),
              IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () => setState(() => _replyTo = null),
              ),
            ]),
          ),

        // Voice recorder (shown instead of input bar)
        if (_showVoiceRecorder)
          VoiceNoteRecorder(
            onSend: _sendVoiceNote,
            onCancel: () => setState(() => _showVoiceRecorder = false),
          )
        else
        // Input bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: const BoxDecoration(
            color: AppTheme.surface,
            border: Border(top: BorderSide(color: AppTheme.divider)),
          ),
          child: Row(children: [
            // Attachment button
            IconButton(
              icon: _sending
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.attach_file, color: AppTheme.accent),
              onPressed: _sending ? null : _showAttachmentPicker,
            ),
            // Text field
            Expanded(
              child: TextField(
                controller: _textCtrl,
                onChanged: (_) {
                  setState(() {});  // Rebuild to toggle send/mic icon
                  _ws.sendTyping(widget.conversation.id);
                },
                maxLines: null,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  hintText: 'Message…',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  filled: true,
                  fillColor: AppTheme.primaryLight,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                ),
              ),
            ),
            const SizedBox(width: 8),
            // Send / mic button
            GestureDetector(
              onTap: _textCtrl.text.trim().isEmpty
                  ? () => setState(() => _showVoiceRecorder = true)
                  : _sendText,
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: _textCtrl.text.trim().isEmpty
                      ? AppTheme.accent.withOpacity(0.6)
                      : AppTheme.accent,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  _textCtrl.text.trim().isEmpty ? Icons.mic : Icons.send,
                  color: Colors.white, size: 20,
                ),
              ),
            ),
          ]),
        ),
      ],
    ),
  );

  void _showAttachmentPicker() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.image, color: AppTheme.accent),
          title: const Text('Send photo'),
          onTap: () { Navigator.pop(context); _sendMedia('image'); },
        ),
        ListTile(
          leading: const Icon(Icons.videocam, color: AppTheme.accent),
          title: const Text('Send video'),
          onTap: () { Navigator.pop(context); _sendMedia('video'); },
        ),
        ListTile(
          leading: const Icon(Icons.attach_file, color: AppTheme.accent),
          title: const Text('Send file or document'),
          onTap: () { Navigator.pop(context); _sendMedia('file'); },
        ),
        ListTile(
          leading: const Icon(Icons.camera_alt, color: AppTheme.accent),
          title: const Text('Take a photo'),
          onTap: () async {
            Navigator.pop(context);
            final xf = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 80);
            if (xf != null) {
              final res = await _api.uploadXFile('/media/upload', xf);
              _ws.send('send_message', {
                'conversation_id': widget.conversation.id,
                'content': '📷 Photo',
                'message_type': 'image',
                'media_url': res['url'],
              });
            }
          },
        ),
      ])),
    );
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    _textCtrl.dispose();
    _scrollCtrl.dispose();
    _typingTimer?.cancel();
    super.dispose();
  }
}

// ── Message Bubble ───────────────────────────────────────────────
class _MessageBubble extends StatelessWidget {
  final MessageModel message;
  final bool isMe;
  final void Function(MessageModel) onReply;
  final void Function(MessageModel) onReact;

  const _MessageBubble({
    required this.message, required this.isMe,
    required this.onReply, required this.onReact,
  });

  @override
  Widget build(BuildContext context) => GestureDetector(
    onLongPress: () => _showMessageOptions(context),
    child: Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        child: Column(
          crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            // Reply preview thread
            if (message.replyToMessageId != null)
              Container(
                margin: const EdgeInsets.only(bottom: 2),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: isMe ? Colors.white24 : AppTheme.primaryLight,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(children: [
                  Container(width: 2, height: 24, color: AppTheme.accent),
                  const SizedBox(width: 6),
                  const Text('Replying…',
                    style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, fontStyle: FontStyle.italic)),
                ]),
              ),

            // Main bubble
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              decoration: BoxDecoration(
                color: isMe ? AppTheme.accent : AppTheme.surface,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: isMe ? const Radius.circular(16) : const Radius.circular(4),
                  bottomRight: isMe ? const Radius.circular(4) : const Radius.circular(16),
                ),
                boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4, offset: const Offset(0, 2))],
              ),
              child: Column(
                crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                children: [
                  // Sender name in group chats
                  if (!isMe)
                    Text(message.senderName,
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.accent)),

                  // Media content
                  if (message.mediaUrl != null && message.type == 'image')
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.network(
                        message.mediaUrl!.startsWith('http')
                            ? message.mediaUrl!
                            : '${AppConstants.baseUrl}${message.mediaUrl!}',
                        width: 200, height: 140, fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, size: 60),
                      ),
                    )
                  else if (message.mediaUrl != null && message.type == 'video')
                    GestureDetector(
                      onTap: () {
                        final url = message.mediaUrl!.startsWith('http')
                            ? message.mediaUrl!
                            : '${AppConstants.baseUrl}${message.mediaUrl!}';
                        launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
                      },
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          width: 200, height: 140,
                          decoration: BoxDecoration(
                            color: Colors.black87,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Center(
                            child: Icon(Icons.play_circle_fill, color: Colors.white, size: 56),
                          ),
                        ),
                      ),
                    )
                  else if (message.type == 'voice_note')
                    VoiceNoteBubble(
                      mediaUrl: message.mediaUrl ?? '',
                      duration: message.content ?? '0:00',
                      isMe: isMe,
                    )
                  else if (message.type == 'file')
                    Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.attach_file, color: isMe ? Colors.white70 : AppTheme.accent),
                      const SizedBox(width: 6),
                      Text(message.content ?? 'File',
                        style: TextStyle(color: isMe ? Colors.white : AppTheme.textPrimary, fontSize: 14)),
                    ])
                  else
                    Text(message.content ?? '',
                      style: TextStyle(
                        color: isMe ? Colors.white : AppTheme.textPrimary, fontSize: 15)),

                  const SizedBox(height: 3),
                  Text(
                    '${message.createdAt.hour.toString().padLeft(2, '0')}:${message.createdAt.minute.toString().padLeft(2, '0')}',
                    style: TextStyle(fontSize: 10, color: isMe ? Colors.white60 : AppTheme.textSecondary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );

  void _showMessageOptions(BuildContext context) {
    HapticFeedback.mediumImpact();
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        // Emoji row
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: _kEmojis.take(6).map((e) => GestureDetector(
              onTap: () { Navigator.pop(context); onReact(message); },
              child: Text(e, style: const TextStyle(fontSize: 28)),
            )).toList(),
          ),
        ),
        const Divider(height: 1),
        ListTile(
          leading: const Icon(Icons.reply),
          title: const Text('Reply'),
          onTap: () { Navigator.pop(context); onReply(message); },
        ),
        ListTile(
          leading: const Icon(Icons.emoji_emotions_outlined),
          title: const Text('React'),
          onTap: () { Navigator.pop(context); onReact(message); },
        ),
        if (message.content != null)
          ListTile(
            leading: const Icon(Icons.copy),
            title: const Text('Copy'),
            onTap: () {
              Navigator.pop(context);
              Clipboard.setData(ClipboardData(text: message.content!));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Copied to clipboard')));
            },
          ),
      ])),
    );
  }
}
