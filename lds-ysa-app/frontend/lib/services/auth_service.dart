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

  Future<UserModel> register({
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
    String? email,
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
      if (email != null) 'email': email,
    });
    await _api.saveToken(res['token']);
    _currentUser = UserModel.fromJson(res['user']);
    await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
    return _currentUser!;
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
    _currentUser = UserModel.fromJson(res['user']);
    await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
    return _currentUser!;
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
    _currentUser = UserModel.fromJson(res['user']);
    await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
    return _currentUser!;
  }

  Future<UserModel> login({
    required String phoneNumber,
    required String password,
  }) async {
    final res = await _api.post('/auth/login', {
      'phone_number': phoneNumber,
      'password': password,
    });
    await _api.saveToken(res['token']);
    _currentUser = UserModel.fromJson(res['user']);
    await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res['user']));
    return _currentUser!;
  }

  Future<void> logout() async {
    await _api.clearToken();
    await _storage.delete(key: StorageKeys.currentUser);
    _currentUser = null;
  }

  Future<UserModel> refreshMe() async {
    final res = await _api.get('/users/me');
    _currentUser = UserModel.fromJson(res);
    await _storage.write(key: StorageKeys.currentUser, value: jsonEncode(res));
    return _currentUser!;
  }
}
