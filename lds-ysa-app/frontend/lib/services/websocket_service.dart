import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../utils/constants.dart';

enum WsStatus { disconnected, connecting, connected }

class WebSocketService {
  static final WebSocketService _instance = WebSocketService._internal();
  factory WebSocketService() => _instance;
  WebSocketService._internal();

  WebSocketChannel? _channel;
  WsStatus _status = WsStatus.disconnected;
  Timer? _pingTimer;
  Timer? _reconnectTimer;
  String? _token;

  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  WsStatus get status => _status;

  void connect(String token) {
    _token = token;
    _connect();
  }

  void _connect() {
    if (_status == WsStatus.connecting || _status == WsStatus.connected) return;
    _status = WsStatus.connecting;

    try {
      _channel = WebSocketChannel.connect(Uri.parse('${AppConstants.wsUrl}?token=$_token'));
      _status = WsStatus.connected;

      _channel!.stream.listen(
        (raw) {
          final msg = jsonDecode(raw as String) as Map<String, dynamic>;
          _messageController.add(msg);
        },
        onDone: _onDisconnect,
        onError: (_) => _onDisconnect(),
      );

      // Heartbeat every 30s
      _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) => send('ping', {}));
    } catch (e) {
      _onDisconnect();
    }
  }

  void _onDisconnect() {
    _status = WsStatus.disconnected;
    _pingTimer?.cancel();
    _channel = null;
    // Reconnect after 3s
    _reconnectTimer = Timer(const Duration(seconds: 3), () {
      if (_token != null) _connect();
    });
  }

  void send(String type, Map<String, dynamic> payload) {
    if (_status != WsStatus.connected) return;
    _channel?.sink.add(jsonEncode({'type': type, 'payload': payload}));
  }

  void sendMessage({
    required String conversationId,
    required String content,
    String messageType = 'text',
    String? replyToMessageId,
  }) {
    send('send_message', {
      'conversation_id': conversationId,
      'content': content,
      'message_type': messageType,
      if (replyToMessageId != null) 'reply_to_message_id': replyToMessageId,
    });
  }

  void sendTyping(String conversationId) =>
      send('typing', {'conversation_id': conversationId});

  void markRead(String messageId) =>
      send('mark_read', {'message_id': messageId});

  void initiateCall(String conversationId, String callType) =>
      send('initiate_call', {'conversation_id': conversationId, 'call_type': callType});

  void endCall(String callId, String conversationId) =>
      send('end_call', {'call_id': callId, 'conversation_id': conversationId});

  // ── Meeting helpers ─────────────────────────────────────────────

  void joinedMeeting(String meetingId) =>
      send('meeting_joined', {'meeting_id': meetingId});

  void leaveMeeting(String meetingId) =>
      send('leave_meeting', {'meeting_id': meetingId});

  void endMeeting(String meetingId) =>
      send('end_meeting', {'meeting_id': meetingId});

  void sendMeetingChat(String meetingId, String message) =>
      send('meeting_chat', {'meeting_id': meetingId, 'message': message});

  void raiseHand(String meetingId, {bool raised = true}) =>
      send('raise_hand', {'meeting_id': meetingId, 'raised': raised});

  void muteParticipant(String meetingId, String targetUserId) =>
      send('mute_participant', {'meeting_id': meetingId, 'target_user_id': targetUserId});

  void approveJoinRequest(String meetingId, String targetUserId) =>
      send('approve_join_request', {'meeting_id': meetingId, 'target_user_id': targetUserId});

  void rejectJoinRequest(String meetingId, String targetUserId) =>
      send('reject_join_request', {'meeting_id': meetingId, 'target_user_id': targetUserId});

  void sendMeetingWebRtcOffer(String meetingId, String targetUserId, Map<String, dynamic> sdp) =>
      send('meeting_webrtc_offer', {'meeting_id': meetingId, 'target_user_id': targetUserId, 'sdp': sdp});

  void sendMeetingWebRtcAnswer(String meetingId, String targetUserId, Map<String, dynamic> sdp) =>
      send('meeting_webrtc_answer', {'meeting_id': meetingId, 'target_user_id': targetUserId, 'sdp': sdp});

  void sendMeetingIceCandidate(String meetingId, String targetUserId, Map<String, dynamic> candidate) =>
      send('meeting_webrtc_ice', {'meeting_id': meetingId, 'target_user_id': targetUserId, 'candidate': candidate});

  // ────────────────────────────────────────────────────────────────

  void disconnect() {
    _pingTimer?.cancel();
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _status = WsStatus.disconnected;
    _token = null;
  }
}
