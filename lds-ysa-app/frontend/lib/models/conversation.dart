class Conversation {
  final String id;
  final String? name;
  final bool isGroup;
  final String? photoUrl;
  final String? lastMessage;
  final DateTime? lastMessageAt;
  final int memberCount;
  final int unreadCount;
  final bool isAdmin;
  final bool isPinned;

  Conversation({
    required this.id,
    this.name,
    this.isGroup = false,
    this.photoUrl,
    this.lastMessage,
    this.lastMessageAt,
    this.memberCount = 0,
    this.unreadCount = 0,
    this.isAdmin = false,
    this.isPinned = false,
  });

  factory Conversation.fromJson(Map<String, dynamic> j) => Conversation(
    id: j['id'],
    name: j['name'],
    isGroup: j['is_group'] ?? false,
    photoUrl: j['photo_url'],
    lastMessage: j['last_message'],
    lastMessageAt: j['last_message_at'] != null ? DateTime.parse(j['last_message_at']) : null,
    memberCount: int.tryParse(j['member_count']?.toString() ?? '0') ?? 0,
    unreadCount: int.tryParse(j['unread_count']?.toString() ?? '0') ?? 0,
    isAdmin: j['is_admin'] ?? false,
    isPinned: j['is_pinned'] ?? false,
  );
}
