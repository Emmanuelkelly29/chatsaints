import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart' show XFile;
import '../utils/constants.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  final _storage = const FlutterSecureStorage();

  Future<String?> get _token => _storage.read(key: StorageKeys.authToken);

  Future<Map<String, String>> get _headers async {
    final token = await _token;
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> get(String path) async {
    final res = await http.get(
      Uri.parse('${AppConstants.apiBase}$path'),
      headers: await _headers,
    );
    return _handle(res);
  }

  /// Use this when the endpoint returns a JSON array instead of an object.
  Future<List<dynamic>> getList(String path) async {
    final res = await http.get(
      Uri.parse('${AppConstants.apiBase}$path'),
      headers: await _headers,
    );
    if (res.statusCode >= 400) {
      final data = jsonDecode(res.body);
      if (data is Map) throw ApiException((data['error'] as String?) ?? 'Request failed', res.statusCode);
      throw ApiException('Request failed (${res.statusCode})', res.statusCode);
    }
    final decoded = jsonDecode(res.body);
    if (decoded is List) return decoded;
    if (decoded is Map && decoded.containsKey('data')) return decoded['data'] as List;
    return [];
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final res = await http.post(
      Uri.parse('${AppConstants.apiBase}$path'),
      headers: await _headers,
      body: jsonEncode(body),
    );
    return _handle(res);
  }

  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) async {
    final res = await http.patch(
      Uri.parse('${AppConstants.apiBase}$path'),
      headers: await _headers,
      body: jsonEncode(body),
    );
    return _handle(res);
  }

  Future<Map<String, dynamic>> delete(String path) async {
    final res = await http.delete(
      Uri.parse('${AppConstants.apiBase}$path'),
      headers: await _headers,
    );
    return _handle(res);
  }

  Map<String, dynamic> _handle(http.Response res) {
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw ApiException(data['error'] ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  Future<void> saveToken(String token) =>
      _storage.write(key: StorageKeys.authToken, value: token);

  Future<void> clearToken() =>
      _storage.delete(key: StorageKeys.authToken);

  /// Public accessor for the stored auth token (used externally e.g. WebSocket connect).
  Future<String?> getToken() => _token;

  /// Multipart file upload.
  Future<Map<String, dynamic>> uploadFile(String path, dynamic file) async {
    final token = await _token;
    final uri = Uri.parse('${AppConstants.apiBase}$path');
    final request = http.MultipartRequest('POST', uri);
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    request.files.add(await http.MultipartFile.fromPath('file', file.path));
    final streamed = await request.send();
    final res = await http.Response.fromStream(streamed);
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) throw ApiException(data['error'] ?? 'Upload failed', res.statusCode);
    return data;
  }

  /// Multipart upload using XFile (works on web and mobile).
  Future<Map<String, dynamic>> uploadXFile(String path, XFile xfile) async {
    final token = await _token;
    final uri = Uri.parse('${AppConstants.apiBase}$path');
    final request = http.MultipartRequest('POST', uri);
    if (token != null) request.headers['Authorization'] = 'Bearer $token';

    if (kIsWeb) {
      final bytes = await xfile.readAsBytes();
      request.files.add(http.MultipartFile.fromBytes(
        'file', bytes,
        filename: xfile.name,
      ));
    } else {
      request.files.add(await http.MultipartFile.fromPath('file', xfile.path));
    }

    final streamed = await request.send();
    final res = await http.Response.fromStream(streamed);
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) throw ApiException(data['error'] ?? 'Upload failed', res.statusCode);
    return data;
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  const ApiException(this.message, this.statusCode);
  @override
  String toString() => 'ApiException($statusCode): $message';
}
