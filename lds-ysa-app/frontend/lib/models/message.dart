class Message {
  final String id;
  final String conversationId;
  final String senderId;
  final String senderName;
  final String? senderPhoto;
  final String type;
  final String? content;
  final String? mediaUrl;
  final String? replyToMessageId;
  final bool isDeleted;
  final DateTime createdAt;
  bool isRead;

  Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.senderName,
    this.senderPhoto,
    required this.type,
    this.content,
    this.mediaUrl,
    this.replyToMessageId,
    this.isDeleted = false,
    required this.createdAt,
    this.isRead = false,
  });

  factory Message.fromJson(Map<String, dynamic> j) => Message(
    id: j['id'],
    conversationId: j['conversation_id'],
    senderId: j['sender_id'],
    senderName: j['sender_name'] ?? 'Unknown',
    senderPhoto: j['sender_photo'],
    type: j['type'] ?? 'text',
    content: j['content'],
    mediaUrl: j['media_url'],
    replyToMessageId: j['reply_to_message_id'],
    isDeleted: j['is_deleted'] ?? false,
    createdAt: DateTime.parse(j['created_at']),
  );
}
