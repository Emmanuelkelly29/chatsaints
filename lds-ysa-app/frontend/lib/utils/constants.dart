class AppConstants {
  // Set at build time via --dart-define=API_BASE_URL=https://your-server.com
  // Example: flutter run --dart-define=API_BASE_URL=http://192.168.1.10:4000
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000',
  );
  static const String apiBase     = '$baseUrl/api';
  // wsUrl can't be const because it computes from a String.fromEnvironment value
  static String get wsUrl => '${baseUrl.replaceFirst(RegExp(r'^http'), 'ws')}/ws';
  static const String uploadsBase = '$baseUrl/uploads';

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
