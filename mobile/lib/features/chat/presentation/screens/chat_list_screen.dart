import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/models/chat_model.dart';
import '../../data/repositories/chat_repository.dart';
import 'chat_screen.dart';

/// Conversation list screen. Shows all conversations with unread badges and
/// the latest message preview. Tapping opens the live [ChatScreen].
class ChatListScreen extends StatefulWidget {
  final String role;
  const ChatListScreen({super.key, this.role = 'customer'});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  final ChatRepository _repository = ChatRepository();
  bool _isLoading = true;
  List<ChatConversation> _conversations = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _repository.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final conversations = await _repository.getConversations();
      if (!mounted) return;
      setState(() => _conversations = conversations);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Unable to load conversations');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.wifi_off_outlined, size: 56, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
                    ],
                  ),
                )
              : _conversations.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.chat_bubble_outline, size: 72, color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
                          const SizedBox(height: 16),
                          const Text('No conversations yet', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 6),
                          Text(
                            'Messages from farmers and support will appear here',
                            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        itemCount: _conversations.length,
                        separatorBuilder: (_, __) =>
                            Divider(height: 1, indent: 76, color: AppTheme.border.withValues(alpha: 0.5)),
                        itemBuilder: (_, i) => _ConversationTile(
                          conversation: _conversations[i],
                          onTap: () async {
                            await Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => ChatScreen(conversation: _conversations[i], role: widget.role),
                              ),
                            );
                            if (mounted) _load();
                          },
                        ),
                      ),
                    ),
    );
  }
}

class _ConversationTile extends StatelessWidget {
  final ChatConversation conversation;
  final VoidCallback onTap;

  const _ConversationTile({required this.conversation, required this.onTap});

  String get _initials {
    final name = conversation.displayName.trim();
    if (name.isEmpty) return '?';
    return name[0].toUpperCase();
  }

  String get _preview {
    final last = conversation.lastMessage;
    if (last == null) return 'Start a conversation';
    final content = last.content;
    if (last.senderName.isNotEmpty) return '${last.senderName}: $content';
    return content;
  }

  String get _time {
    final raw = conversation.updatedAt ?? conversation.createdAt;
    if (raw == null || raw.isEmpty) return '';
    try {
      final dt = DateTime.parse(raw).toLocal();
      final now = DateTime.now();
      if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
        return DateFormat('hh:mm a').format(dt);
      }
      return '${dt.day}/${dt.month}';
    } catch (_) {
      return '';
    }
  }

  String get _roleLabel {
    final role = conversation.participant?.role ??
        (conversation.participants.isNotEmpty ? conversation.participants.first.role : '');
    return role.isEmpty || role == 'customer' ? '' : role;
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: CircleAvatar(
        radius: 24,
        backgroundColor: conversation.unreadCount > 0
            ? AppTheme.primaryGreen
            : AppTheme.primarySoft,
        child: Text(
          _initials,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: conversation.unreadCount > 0 ? Colors.white : AppTheme.primaryDark,
          ),
        ),
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              conversation.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 15,
                fontWeight: conversation.unreadCount > 0 ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
          ),
          if (_roleLabel.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Text(
                _roleLabel,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.primaryGreen,
                ),
              ),
            ),
          if (_time.isNotEmpty)
            Text(_time, style: TextStyle(fontSize: 11, color: AppTheme.textTertiary)),
        ],
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 3),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _preview,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  color: conversation.unreadCount > 0 ? AppTheme.textPrimary : AppTheme.textSecondary,
                ),
              ),
            ),
            if (conversation.unreadCount > 0)
              Container(
                margin: const EdgeInsets.only(left: 8),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.primaryGreen,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${conversation.unreadCount}',
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white),
                ),
              ),
          ],
        ),
      ),
    );
  }
}