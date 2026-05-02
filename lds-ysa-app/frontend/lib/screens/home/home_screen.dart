import 'package:flutter/material.dart';
import '../../services/auth_service.dart';
import '../../theme/app_theme.dart';
import '../calls/call_history_screen.dart';
import '../chat/conversations_screen.dart';
import '../profile/profile_screen.dart';
import '../missionary/missionary_screen.dart';
import '../leaders/leaders_screen.dart';
import '../admin/admin_dashboard_screen.dart';
import '../status/status_feed_screen.dart';
import '../pool/pool_screen.dart';
import '../meetings/meetings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;
  final _user = AuthService().currentUser;

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    super.dispose();
  }

  // Role tier helper
  static const _adminRoles = {
    'it_support', 'bishop', 'stake_presidency', 'coordinating_council', 'mission_president',
    'area_authority', 'area_presidency', 'general_authority', 'apostle', 'first_presidency',
  };

  bool get _isAdmin    => _adminRoles.contains(_user?.role);
  bool get _isLeader   => (_user?.isLeader ?? false);
  bool get _isMission  => (_user?.isMissionary ?? false);

  List<Widget> get _screens {
    final s = <Widget>[
      const ConversationsScreen(),  // 0 — Chats
      const CallHistoryScreen(),    // 1 — Calls
      const StatusFeedScreen(),     // 2 — Status
      const MeetingsScreen(),       // 3 — Meetings
    ];
    if (_isAdmin)   s.add(const AdminDashboardScreen());
    if (_isLeader)  s.add(const LeadersScreen());
    if (_isMission) s.add(const MissionaryScreen());
    if (_isMission) {
      s.add(const PoolScreen(globalMode: true));
    } else {
      s.add(const PoolScreen());
    }
    s.add(const ProfileScreen());
    return s;
  }

  List<BottomNavigationBarItem> get _navItems {
    final items = <BottomNavigationBarItem>[
      const BottomNavigationBarItem(
        icon: Icon(Icons.chat_bubble_outline),
        activeIcon: Icon(Icons.chat_bubble),
        label: 'Chats',
      ),
      const BottomNavigationBarItem(
        icon: Icon(Icons.call_outlined),
        activeIcon: Icon(Icons.call),
        label: 'Calls',
      ),
      const BottomNavigationBarItem(
        icon: Icon(Icons.circle_outlined),
        activeIcon: Icon(Icons.circle),
        label: 'Status',
      ),
      const BottomNavigationBarItem(
        icon: Icon(Icons.video_camera_front_outlined),
        activeIcon: Icon(Icons.video_camera_front),
        label: 'Meetings',
      ),
    ];
    if (_isAdmin) {
      items.add(const BottomNavigationBarItem(
          icon: Icon(Icons.bar_chart_outlined), activeIcon: Icon(Icons.bar_chart), label: 'Admin'));
    }
    if (_isLeader) {
      items.add(const BottomNavigationBarItem(
          icon: Icon(Icons.admin_panel_settings_outlined),
          activeIcon: Icon(Icons.admin_panel_settings), label: 'Leaders'));
    }
    if (_isMission) {
      items.add(const BottomNavigationBarItem(
          icon: Icon(Icons.flag_outlined), activeIcon: Icon(Icons.flag), label: 'Mission'));
    }
    items.add(_isMission
        ? const BottomNavigationBarItem(
            icon: Icon(Icons.travel_explore_outlined),
            activeIcon: Icon(Icons.travel_explore),
            label: 'YSA Global')
        : const BottomNavigationBarItem(
            icon: Icon(Icons.public_outlined),
            activeIcon: Icon(Icons.public),
            label: 'Pool'));
    items.add(const BottomNavigationBarItem(
        icon: Icon(Icons.person_outline), activeIcon: Icon(Icons.person), label: 'Profile'));
    return items;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppTheme.background,
    body: IndexedStack(index: _tab, children: _screens),
    bottomNavigationBar: BottomNavigationBar(
      currentIndex: _tab.clamp(0, _navItems.length - 1),
      onTap: (i) => setState(() => _tab = i),
      items: _navItems,
    ),
  );
}
