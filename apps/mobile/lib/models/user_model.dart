class UserModel {
  final String id;
  final String fullName;
  final String phoneNumber;
  final String? email;
  final String role;
  final String status;
  final int? age;
  final bool isSingle;
  final bool isApproved;
  final String? profilePhotoUrl;
  final String? bio;
  final String? stakeId;
  final String? stakeName;
  final String? missionId;
  final String? missionName;
  final bool missionaryModeActive;
  final bool profileHidden;
  final DateTime? lastSeen;
  final Map<String, bool>? features;

  const UserModel({
    required this.id,
    required this.fullName,
    required this.phoneNumber,
    this.email,
    required this.role,
    required this.status,
    this.age,
    this.isSingle = true,
    this.isApproved = false,
    this.profilePhotoUrl,
    this.bio,
    this.stakeId,
    this.stakeName,
    this.missionId,
    this.missionName,
    this.missionaryModeActive = false,
    this.profileHidden = false,
    this.lastSeen,
    this.features,
  });

  bool get isMissionary => role == 'missionary' || missionaryModeActive;
  bool get isLeader => ![
    'ysa_member', 'missionary'
  ].contains(role);

  String get displayRole {
    const map = {
      'it_support':             'IT Support (Master Admin)',
      'ysa_member':             'YSA Member',
      'ysa_rep':                'YSA Representative',
      'ysa_couple_adviser':     'YSA Adviser',
      'bishop':                 'Bishop',
      'stake_presidency':       'Stake Presidency',
      'coordinating_council':   'Coordinating Council',
      'area_authority':         'Area Authority',
      'area_presidency':        'Area Presidency',
      'general_authority':      'General Authority',
      'apostle':                'Apostle',
      'first_presidency':       'First Presidency',
      'mission_president':      'Mission President',
      'mission_president_wife': 'Mission President\'s Wife',
      'missionary':             'Missionary',
    };
    return map[role] ?? role;
  }

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
    id:                   json['id'] ?? '',
    fullName:             json['full_name'] ?? '',
    phoneNumber:          json['phone_number'] ?? '',
    email:                json['email'],
    role:                 json['role'] ?? 'ysa_member',
    status:               json['status'] ?? 'active',
    age:                  json['age'],
    isSingle:             json['is_single'] ?? true,
    isApproved:           json['is_approved'] ?? false,
    profilePhotoUrl:      json['profile_photo_url'],
    bio:                  json['bio'],
    stakeId:              json['stake_id'],
    stakeName:            json['stake_name'],
    missionId:            json['mission_id'],
    missionName:          json['mission_name'],
    missionaryModeActive: json['missionary_mode_active'] ?? false,
    profileHidden:        json['profile_hidden'] ?? false,
    lastSeen:             json['last_seen'] != null ? DateTime.tryParse(json['last_seen']) : null,
    features:             json['features'] != null
        ? Map<String, bool>.from(json['features'])
        : null,
  );

  Map<String, dynamic> toJson() => {
    'id': id, 'full_name': fullName, 'phone_number': phoneNumber,
    'email': email, 'role': role, 'status': status,
  };
}
