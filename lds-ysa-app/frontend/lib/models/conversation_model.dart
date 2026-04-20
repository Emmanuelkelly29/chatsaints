class ConversationModel {
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
  final String? role; // e.g. 'bishop', 'stake_presidency', etc.

  const ConversationModel({
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
    this.role,
  });

  factory ConversationModel.fromJson(Map<String, dynamic> json) => ConversationModel(
    id:            json['id'] ?? '',
    name:          json['name'],
    isGroup:       json['is_group'] ?? false,
    photoUrl:      json['photo_url'],
    lastMessage:   json['last_message'],
    lastMessageAt: json['last_message_at'] != null ? DateTime.tryParse(json['last_message_at']) : null,
    memberCount:   int.tryParse(json['member_count']?.toString() ?? '0') ?? 0,
    unreadCount:   int.tryParse(json['unread_count']?.toString() ?? '0') ?? 0,
    isAdmin:       json['is_admin'] ?? false,
    isPinned:      json['is_pinned'] ?? false,
    role:          json['role'],
  );

  /// Display badge text for role
  String? get badgeLabel {
    if (role == null) return null;
    switch (role) {
      case 'bishop': return 'BISHOP';
      case 'stake_presidency': return 'STAKE';
      case 'mission_president': return 'MISSION';
      case 'ysa_member': return null;
      default: return role!.toUpperCase().replaceAll('_', ' ');
    }
  }
}
