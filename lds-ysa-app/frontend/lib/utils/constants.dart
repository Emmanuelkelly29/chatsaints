import 'dart:io' show Platform;

class AppConstants {
  // Set at build time via --dart-define=API_BASE_URL=https://your-server.com
  // Example: flutter run --dart-define=API_BASE_URL=http://192.168.1.10:4000
  static const String _envBaseUrl = String.fromEnvironment('API_BASE_URL');

  // Android emulators reach the host machine via 10.0.2.2, not localhost.
  // iOS simulators and desktop share the host network, so localhost works.
  static String get baseUrl => _envBaseUrl.isNotEmpty
      ? _envBaseUrl
      : (Platform.isAndroid ? 'http://10.0.2.2:4000' : 'http://localhost:4000');
  static String get apiBase => '$baseUrl/api';
  static String get wsUrl => '${baseUrl.replaceFirst(RegExp(r'^http'), 'ws')}/ws';
  static String get uploadsBase => '$baseUrl/uploads';

  static const int maxGroupSize   = 1000;
  static const int maxPinnedChats = 3;
  static const int scriptureRotateMinutes = 5;

  // LDS Volumes for scripture display
  static const List<String> scriptureVolumes = [
    'Book of Mormon',
    'Doctrine and Covenants',
    'Bible',
    'Pearl of Great Price',
  ];
}

class StorageKeys {
  static const String authToken   = 'auth_token';
  static const String currentUser = 'current_user';
  static const String loginTimeKey = 'login_time';
}
