import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import 'package:intl/intl.dart';

class DeliverySupportChatScreen extends StatefulWidget {
  final String? conversationId;
  const DeliverySupportChatScreen({super.key, this.conversationId});
  @override
  State<DeliverySupportChatScreen> createState() => _DeliverySupportChatScreenState();
}

class _DeliverySupportChatScreenState extends State<DeliverySupportChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final TextEditingController _subjectController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isLoading = true;
  String? _conversationId;
  List<Map<String, dynamic>> _messages = [];

  @override
  void initState() {
    super.initState();
    _conversationId = widget.conversationId;
    _load();
  }

  @override
  void dispose() {
    _controller.dispose();
    _subjectController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      if (_conversationId == null) {
        final convos = await ApiService.get('/delivery/support/conversations');
        final list = (convos['data'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        if (!mounted) return;
        if (list.isNotEmpty) {
          _conversationId = list.first['id'] as String?;
        }
      }
      if (_conversationId != null) {
        final res = await ApiService.get('/delivery/support/conversations/$_conversationId');
        final data = res['data'] as Map<String, dynamic>? ?? {};
        setState(() => _messages = (data['messages'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>());
      }
    } catch (_) {
      if (!mounted) return;
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _openNewRequest() async {
    _subjectController.clear();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Support Request'),
        content: TextField(
          controller: _subjectController,
          autofocus: true,
          maxLines: 3,
          decoration: const InputDecoration(hintText: 'Describe your issue'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Submit')),
        ],
      ),
    );
    if (ok != true) return;
    final subject = _subjectController.text.trim();
    if (subject.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please describe your issue'), backgroundColor: AppTheme.error));
      return;
    }
    try {
      final res = await ApiService.post('/delivery/support/conversations', body: {'subject': subject, 'initialMessage': subject});
      if (!mounted) return;
      setState(() => _conversationId = ((res['data'] as Map<String, dynamic>? ?? {})['id'] as String?));
      _load();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to open request'), backgroundColor: AppTheme.error));
    }
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    try {
      if (_conversationId == null) {
        final res = await ApiService.post('/delivery/support/conversations', body: {'subject': text, 'initialMessage': text});
        if (!mounted) return;
        setState(() => _conversationId = ((res['data'] as Map<String, dynamic>? ?? {})['id'] as String?));
      } else {
        await ApiService.post('/delivery/support/conversations/$_conversationId/messages', body: {'conversationId': _conversationId!, 'content': text});
      }
      if (!mounted) return;
      setState(() {
        _messages.add({'senderRole': 'delivery', 'senderName': 'You', 'content': text, 'createdAt': DateTime.now().toIso8601String()});
      });
      _scrollToBottom();
    } catch (_) {
      if (!mounted) return;
      _controller.text = text;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to send'), backgroundColor: AppTheme.error));
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Help & Support'),
        actions: [
          IconButton(icon: const Icon(Icons.add_comment_outlined), onPressed: _isLoading ? null : _openNewRequest),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              Expanded(
                child: _messages.isEmpty
                  ? const _EmptySupport()
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(16),
                      itemCount: _messages.length,
                      itemBuilder: (_, i) => _MessageBubble(_messages[i]),
                    ),
              ),
              _buildComposer(),
            ],
          ),
    );
  }

  Widget _buildComposer() {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppTheme.border.withValues(alpha: 0.7))),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                textCapitalization: TextCapitalization.sentences,
                minLines: 1,
                maxLines: 4,
                decoration: const InputDecoration(
                  hintText: 'Type a message...',
                  filled: true,
                  contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed: _send,
              icon: const Icon(Icons.send),
              style: IconButton.styleFrom(backgroundColor: AppTheme.primaryGreen),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  const _MessageBubble(this.message);

  @override
  Widget build(BuildContext context) {
    final role = message['senderRole'] as String? ?? 'delivery';
    final isMe = role == 'delivery';
    final content = message['content'] as String? ?? '';
    final createdAt = message['createdAt'] as String? ?? '';
    String time = '';
    try { time = DateFormat('hh:mm a').format(DateTime.parse(createdAt)); } catch (_) { time = ''; }

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: const BoxConstraints(maxWidth: 280),
        decoration: BoxDecoration(
          color: isMe ? AppTheme.primaryGreen : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isMe ? 16 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 16),
          ),
          border: isMe ? null : Border.all(color: AppTheme.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              content,
              style: TextStyle(color: isMe ? Colors.white : AppTheme.textPrimary, fontSize: 14),
            ),
            if (time.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  time,
                  style: TextStyle(fontSize: 10, color: isMe ? Colors.white.withValues(alpha: 0.8) : AppTheme.textSecondary),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _EmptySupport extends StatelessWidget {
  const _EmptySupport();
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.support_agent, size: 80, color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
          const SizedBox(height: 16),
          const Text('Need help? Chat with dispatch', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          Text('Start a new support request', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}