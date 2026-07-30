import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api_service.dart';
import '../models/user_model.dart';
import '../utils/constants.dart';

class AuthService {
  static final AuthService _i = AuthService._();
  factory AuthService() => _i;
  AuthService._();

  final _api = ApiService();
  final _storage = const FlutterSecureStorage();

  UserModel? _currentUser;
  UserModel? get currentUser => _currentUser;
  bool get isLoggedIn => _currentUser != null;

  Future<UserModel?> loadSavedUser() async {
    final json = await _storage.read(key: StorageKeys.currentUser);
    if (json == null) return null;
    _currentUser = UserModel.fromJson(jsonDecode(json));
    return _currentUser;
  }

  Future<Map<String, dynamic>> register({
    required String phoneNumber,
    required String fullName,
    required String dateOfBirth,
    required String password,
    required String role,
    bool isSingle = true,
    String? stakeId,
    String? stakeName,
    String? stakeCountry,
    String? districtId,
    String? districtName,
    String? districtCountry,
    String? missionId,
    required String email,
  }) async {
    final res = await _api.post('/auth/register', {
      'phone_number': phoneNumber,
      'full_name': fullName,
      'date_of_birth': dateOfBirth,
      'password': password,
      'role': role,
      'is_single': isSingle,
      if (stakeId != null) 'stake_id': stakeId,
      if (stakeName != null) 'stake_name': stakeName,
      if (stakeCountry != null) 'stake_country': stakeCountry,
      if (districtId != null) 'district_id': districtId,
      if (districtName != null) 'district_name': districtName,
      if (districtCountry != null) 'district_country': districtCountry,
      if (missionId != null) 'mission_id': missionId,
      'email': email,
    });
    // Registration now returns { pending: true, email } — no token yet.
    return Map<String, dynamic>.from(res);
  }

  Future<UserModel> verifyRegistration({
    required String email,
    required String otp,
  }) async {
    final res = await _api.post('/auth/verify-registration', {
      'email': email,
      'otp': otp,
    });
    await _api.saveToken(res['token']);
    await _saveLoginTime();
    try {
      return await refreshMe();
    } catch (_) {
      _currentUser = UserModel.fromJson(res['user']);
      await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
      return _currentUser!;
    }
  }

  Future<UserModel> loginWithEmailOtp({
    required String email,
    required String otp,
  }) async {
    final res = await _api.post('/auth/verify-otp', {
      'email': email,
      'otp': otp,
    });
    await _api.saveToken(res['token']);
    await _saveLoginTime();
    try {
      return await refreshMe();
    } catch (_) {
      _currentUser = UserModel.fromJson(res['user']);
      await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
      return _currentUser!;
    }
  }

  Future<UserModel> loginWithPhoneOtp({
    required String phoneNumber,
    required String otp,
  }) async {
    final res = await _api.post('/auth/verify-otp', {
      'phone_number': phoneNumber,
      'otp': otp,
    });
    await _api.saveToken(res['token']);
    await _saveLoginTime();
    try {
      return await refreshMe();
    } catch (_) {
      _currentUser = UserModel.fromJson(res['user']);
      await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
      return _currentUser!;
    }
  }

  Future<UserModel> login({
    String? phoneNumber,
    String? email,
    required String password,
  }) async {
    if ((phoneNumber == null || phoneNumber.isEmpty) && (email == null || email.isEmpty)) {
      throw Exception('Provide phone number or email');
    }
    final res = await _api.post('/auth/login', {
      if (phoneNumber != null && phoneNumber.isNotEmpty) 'phone_number': phoneNumber,
      if (email != null && email.isNotEmpty) 'email': email,
      'password': password,
    });
    await _api.saveToken(res['token']);
    await _saveLoginTime();
    try {
      return await refreshMe();
    } catch (_) {
      _currentUser = UserModel.fromJson(res['user']);
      await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
      return _currentUser!;
    }
  }

  Future<void> logout() async {
    await _api.clearToken();
    await _storage.delete(key: StorageKeys.currentUser);
    await _storage.delete(key: StorageKeys.loginTimeKey);
    _currentUser = null;
  }

  // ── Session helpers ──────────────────────────────────────────────────────────
  Future<void> _saveLoginTime() async {
    await _storage.write(
      key: StorageKeys.loginTimeKey,
      value: DateTime.now().millisecondsSinceEpoch.toString(),
    );
  }

  /// Returns true if the user has been logged in for more than 30 days.
  Future<bool> isSessionExpired() async {
    final raw = await _storage.read(key: StorageKeys.loginTimeKey);
    if (raw == null) return false;
    final loginMs = int.tryParse(raw);
    if (loginMs == null) return false;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return DateTime.now().millisecondsSinceEpoch - loginMs > thirtyDays;
  }

  Future<Map<String, dynamic>> sendSessionOtp(String identifier) async {
    final body = identifier.contains('@')
        ? {'email': identifier}
        : {'phone_number': identifier};
    return await _api.post('/auth/send-session-otp', body);
  }

  Future<UserModel> verifySessionOtp({
    required String identifier,
    required String otp,
  }) async {
    final body = {
      if (identifier.contains('@')) 'email': identifier else 'phone_number': identifier,
      'otp': otp,
    };
    final res = await _api.post('/auth/verify-session-otp', body);
    await _api.saveToken(res['token']);
    await _saveLoginTime();
    try {
      return await refreshMe();
    } catch (_) {
      _currentUser = UserModel.fromJson(res['user']);
      await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
      return _currentUser!;
    }
  }

  Future<UserModel> refreshMe() async {
    final res = await _api.get('/users/me');
    _currentUser = UserModel.fromJson(res);
    await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res));
    return _currentUser!;
  }
}
