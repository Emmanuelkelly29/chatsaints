import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../models/user_model.dart';
import '../../models/conversation_model.dart';
import '../../theme/app_theme.dart';
import 'chat_screen.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});
  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _api = ApiService();
  final _ctrl = TextEditingController();
  List<UserModel> _results = [];
  bool _loading = false;
  String _lastQuery = '';

  Future<void> _search(String q) async {
    if (q.length < 2 || q == _lastQuery) return;
    _lastQuery = q;
    setState(() => _loading = true);
    try {
      final res = await _api.get('/users/search?q=${Uri.encodeComponent(q)}');
      final list = (res is List ? res : (res['data'] as List? ?? [])) as List<dynamic>;
      if (mounted) {
        setState(() {
        _results = list.whereType<Map<String,dynamic>>().map((j) => UserModel.fromJson(j)).toList();
        _loading = false;
      });
      }
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  Future<String?> _promptIntro(UserModel user) async {
    final controller = TextEditingController();
    final intro = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Request ${user.fullName}'),
        content: TextField(
          controller: controller,
          maxLength: 180,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'Add a short introduction (optional)',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Send Request'),
          ),
        ],
      ),
    );
    controller.dispose();
    return intro;
  }

  Future<void> _sendConnectionRequest(UserModel user) async {
    final intro = await _promptIntro(user);
    if (intro == null || !mounted) return;

    try {
      final res = await _api.post('/contact-requests', {
        'target_user_id': user.id,
        'intro_message': intro,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res['message']?.toString() ?? 'Connection request sent'),
          backgroundColor: AppTheme.success,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message), backgroundColor: AppTheme.danger),
      );
    }
  }

  Future<void> _openOrRequest(UserModel user) async {
    try {
      final res = await _api.post('/conversations/1on1', {
        'target_user_id': user.id,
      });
      if (!mounted) return;
      final conv = ConversationModel.fromJson(res);
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => ChatScreen(conversation: conv)),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.statusCode == 403 && error.data?['requires_request'] == true) {
        await _sendConnectionRequest(user);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message), backgroundColor: AppTheme.danger),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not start chat: $error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Search People')),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _ctrl,
            autofocus: true,
            onChanged: _search,
            decoration: InputDecoration(
              hintText: 'Search by name, phone or email...',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _ctrl.text.isNotEmpty
                  ? IconButton(icon: const Icon(Icons.clear),
                      onPressed: () { _ctrl.clear(); setState(() => _results = []); })
                  : null,
            ),
          ),
        ),
        if (_loading) const LinearProgressIndicator(),
        Expanded(
          child: _results.isEmpty
              ? Center(
                  child: _ctrl.text.isEmpty
                      ? const Text('Search for church members by name,\nphone number or email',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppTheme.textSecondary))
                      : const Text('No results found', style: TextStyle(color: AppTheme.textSecondary)),
                )
              : ListView.builder(
                  itemCount: _results.length,
                  itemBuilder: (_, i) {
                    final u = _results[i];
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundImage: u.profilePhotoUrl != null ? NetworkImage(u.profilePhotoUrl!) : null,
                        backgroundColor: AppTheme.primaryLight,
                        child: u.profilePhotoUrl == null
                            ? Text(u.fullName[0].toUpperCase(), style: const TextStyle(color: Colors.white))
                            : null,
                      ),
                      title: Text(u.fullName),
                      subtitle: Row(children: [
                        Text(u.displayRole, style: const TextStyle(fontSize: 12)),
                        if (u.isMissionary) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppTheme.missionary.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(color: AppTheme.accent),
                            ),
                            child: const Text('Missionary', style: TextStyle(fontSize: 10, color: AppTheme.missionary)),
                          ),
                        ],
                      ]),
                      trailing: u.stakeName != null
                          ? Text(u.stakeName!, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary))
                          : null,
                      onTap: () => _openOrRequest(u),
                    );
                  },
                ),
        ),
      ],
    ),
  );

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }
}
