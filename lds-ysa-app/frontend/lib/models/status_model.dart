class StatusModel {
  final String id;
  final String? mediaUrl;
  final String mediaType;   // 'image', 'video', 'text', 'voice'
  final String? caption;
  final String? textContent;      // for text-only statuses
  final String? backgroundColor;  // background colour for text statuses
  final String visibility;
  final int durationSecs;
  final DateTime expiresAt;
  final DateTime createdAt;
  final bool viewed;
  final int? viewCount;
  final int? stealthViewCount;
  final List<StatusViewer>? viewers;

  const StatusModel({
    required this.id,
    this.mediaUrl,
    required this.mediaType,
    this.caption,
    this.textContent,
    this.backgroundColor,
    required this.visibility,
    required this.durationSecs,
    required this.expiresAt,
    required this.createdAt,
    this.viewed = false,
    this.viewCount,
    this.stealthViewCount,
    this.viewers,
  });

  bool get isText => mediaType == 'text';
  bool get isVoice => mediaType == 'voice';

  Duration get timeLeft => expiresAt.difference(DateTime.now());

  String get timeLeftLabel {
    final h = timeLeft.inHours;
    final m = timeLeft.inMinutes.remainder(60);
    if (h > 0) return '${h}h ${m}m left';
    return '${m}m left';
  }

  factory StatusModel.fromJson(Map<String, dynamic> j) => StatusModel(
    id:              j['id'] ?? '',
    mediaUrl:        j['media_url'],
    mediaType:       j['media_type'] ?? 'image',
    caption:         j['caption'],
    textContent:     j['text_content'],
    backgroundColor: j['background_color'],
    visibility:      j['visibility'] ?? 'contacts_only',
    durationSecs:    j['duration_secs'] ?? 5,
    expiresAt:       DateTime.tryParse(j['expires_at'] ?? '') ?? DateTime.now(),
    createdAt:       DateTime.tryParse(j['created_at'] ?? '') ?? DateTime.now(),
    viewed:          j['viewed'] ?? false,
    viewCount:       j['view_count'] != null ? int.tryParse(j['view_count'].toString()) : null,
    stealthViewCount: j['stealth_view_count'] != null ? int.tryParse(j['stealth_view_count'].toString()) : null,
    viewers:         (j['viewers'] as List?)?.map((v) => StatusViewer.fromJson(v)).toList(),
  );
}

class StatusContact {
  final String userId;
  final String authorName;
  final String? authorPhoto;
  final String authorRole;
  final bool allViewed;
  final List<StatusModel> statuses;

  const StatusContact({
    required this.userId,
    required this.authorName,
    this.authorPhoto,
    required this.authorRole,
    required this.allViewed,
    required this.statuses,
  });

  factory StatusContact.fromJson(Map<String, dynamic> j) => StatusContact(
    userId:      j['user_id'] ?? '',
    authorName:  j['author_name'] ?? '',
    authorPhoto: j['author_photo'],
    authorRole:  j['author_role'] ?? '',
    allViewed:   j['all_viewed'] ?? false,
    statuses:    (j['statuses'] as List? ?? [])
        .map((s) => StatusModel.fromJson(s as Map<String, dynamic>))
        .toList(),
  );
}

class StatusViewer {
  final String viewerId;
  final String fullName;
  final String? profilePhoto;
  final DateTime viewedAt;

  const StatusViewer({
    required this.viewerId,
    required this.fullName,
    this.profilePhoto,
    required this.viewedAt,
  });

  factory StatusViewer.fromJson(Map<String, dynamic> j) => StatusViewer(
    viewerId:     j['viewer_id'] ?? '',
    fullName:     j['full_name'] ?? '',
    profilePhoto: j['profile_photo_url'],
    viewedAt:     DateTime.tryParse(j['viewed_at'] ?? '') ?? DateTime.now(),
  );
}
