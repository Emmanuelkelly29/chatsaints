class User {
  final String id;
  final String fullName;
  final String phoneNumber;
  final String? email;
  final String role;
  final String status;
  final int? age;
  final bool isSingle;
  final String? profilePhotoUrl;
  final String? bio;
  final bool isApproved;
  final String? stakeId;
  final String? stakeName;
  final String? missionId;
  final String? missionName;
  final bool missionaryModeActive;
  final bool profileHidden;
  final Map<String, bool> features;

  User({
    required this.id,
    required this.fullName,
    required this.phoneNumber,
    this.email,
    required this.role,
    required this.status,
    this.age,
    this.isSingle = true,
    this.profilePhotoUrl,
    this.bio,
    this.isApproved = false,
    this.stakeId,
    this.stakeName,
    this.missionId,
    this.missionName,
    this.missionaryModeActive = false,
    this.profileHidden = false,
    this.features = const {},
  });

  factory User.fromJson(Map<String, dynamic> j) => User(
    id: j['id'],
    fullName: j['full_name'],
    phoneNumber: j['phone_number'],
    email: j['email'],
    role: j['role'] ?? 'ysa_member',
    status: j['status'] ?? 'active',
    age: j['age'],
    isSingle: j['is_single'] ?? true,
    profilePhotoUrl: j['profile_photo_url'],
    bio: j['bio'],
    isApproved: j['is_approved'] ?? false,
    stakeId: j['stake_id'],
    stakeName: j['stake_name'],
    missionId: j['mission_id'],
    missionName: j['mission_name'],
    missionaryModeActive: j['missionary_mode_active'] ?? false,
    profileHidden: j['profile_hidden'] ?? false,
    features: j['features'] != null
        ? Map<String, bool>.from(j['features'])
        : {},
  );

  bool get isMissionary => role == 'missionary' || missionaryModeActive;
  bool get isLeader => !['ysa_member', 'missionary'].contains(role);

  String get roleLabel {
    const labels = {
      'it_support': 'IT Support (Master Admin)',
      'ysa_member': 'YSA Member',
      'ysa_rep': 'YSA Representative',
      'ysa_couple_adviser': 'YSA Adviser',
      'bishop': 'Bishop',
      'stake_presidency': 'Stake Presidency',
      'coordinating_council': 'Coordinating Council',
      'area_authority': 'Area Authority',
      'area_presidency': 'Area Presidency',
      'general_authority': 'General Authority',
      'apostle': 'Apostle',
      'first_presidency': 'First Presidency',
      'mission_president': 'Mission President',
      'mission_president_wife': 'Mission President\'s Wife',
      'missionary': 'Missionary',
    };
    return labels[role] ?? role;
  }
}
