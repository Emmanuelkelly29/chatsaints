class MessageModel {
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

  const MessageModel({
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
  });

  factory MessageModel.fromJson(Map<String, dynamic> json) => MessageModel(
    id:                 json['id'] ?? '',
    conversationId:     json['conversation_id'] ?? '',
    senderId:           json['sender_id'] ?? '',
    senderName:         json['sender_name'] ?? '',
    senderPhoto:        json['sender_photo'],
    type:               json['type'] ?? 'text',
    content:            json['content'],
    mediaUrl:           json['media_url'],
    replyToMessageId:   json['reply_to_message_id'],
    isDeleted:          json['is_deleted'] ?? false,
    createdAt:          DateTime.tryParse(json['created_at'] ?? '') ?? DateTime.now(),
  );
}
