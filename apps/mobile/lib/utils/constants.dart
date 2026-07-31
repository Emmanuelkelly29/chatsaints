// `defaultTargetPlatform` rather than `dart:io`'s `Platform`, because dart:io
// does not exist on the web target and importing it fails the build outright.
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;

class AppConstants {
  // Set at build time via --dart-define=API_BASE_URL=https://your-server.com
  // Example: flutter run --dart-define=API_BASE_URL=http://192.168.1.10:4000
  static const String _envBaseUrl = String.fromEnvironment('API_BASE_URL');

  /// Where the API lives.
  ///
  /// The fallbacks exist only so a local run works with no extra flags. A real
  /// build must pass --dart-define=API_BASE_URL, otherwise it ships pointing at
  /// the device itself.
  static String get baseUrl {
    if (_envBaseUrl.isNotEmpty) return _envBaseUrl;

    // Browsers share the host's network, so localhost is correct.
    if (kIsWeb) return 'http://localhost:4000';

    // Android emulators reach the host machine through 10.0.2.2. iOS
    // simulators and desktop share the host network, so localhost works.
    return defaultTargetPlatform == TargetPlatform.android
        ? 'http://10.0.2.2:4000'
        : 'http://localhost:4000';
  }
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
