import 'dart:async';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:geolocator/geolocator.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../data/models/chat_model.dart';
import '../../data/models/message_model.dart';
import '../../data/repositories/chat_repository.dart';
import '../widgets/chat_input.dart';
import '../widgets/message_bubble.dart';

/// Live chat screen for a single conversation. Loads message history, opens a
/// WebSocket for realtime messages and renders an input composer.
class ChatScreen extends StatefulWidget {
  final ChatConversation conversation;
  final String role;

  const ChatScreen({super.key, required this.conversation, this.role = 'customer'});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final ChatRepository _repository = ChatRepository();
  final ScrollController _scrollController = ScrollController();
  List<ChatMessage> _messages = [];
  StreamSubscription<ChatMessage>? _subscription;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    setState(() => _isLoading = true);
    try {
      final history = await _repository.getMessages(widget.conversation.id);
      if (!mounted) return;
      setState(() => _messages = history);
      _subscription = _repository.connect(widget.conversation.id).listen((msg) {
        if (!mounted) return;
        setState(() {
          if (!_messages.any((m) => m.id.isNotEmpty && m.id == msg.id)) {
            _messages = [..._messages, msg];
          }
        });
        _scrollToBottom();
      });
      _scrollToBottom();
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Unable to load messages');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _repository.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    // Optimistically append local copy so the UI feels instant.
    setState(() {
      _messages = [
        ..._messages,
        ChatMessage(
          id: '',
          senderId: _repository.currentUserId ?? 'user-1',
          senderName: ApiService.currentUserName,
          content: trimmed,
          createdAt: DateTime.now().toUtc().toIso8601String(),
        ),
      ];
    });
    _scrollToBottom();
    try {
      final created = await _repository.sendMessage(
        conversationId: widget.conversation.id,
        content: trimmed,
      );
      _repository.sendOverSocket(widget.conversation.id, trimmed);
      if (!mounted) return;
      setState(() {
        final idx = _messages.indexWhere((m) => m.id.isEmpty);
        if (idx >= 0 && created.id.isNotEmpty) _messages[idx] = created;
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Message not sent. Check your connection.'), backgroundColor: AppTheme.error),
      );
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _attachImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (file == null) return;
    try {
      final bytes = await file.readAsBytes();
      final message = await _repository.sendAttachment(
        conversationId: widget.conversation.id,
        bytes: bytes,
        filename: file.name,
      );
      if (!mounted) return;
      setState(() {
        if (!_messages.any((m) => m.id == message.id)) {
          _messages = [..._messages, message];
        }
      });
      _scrollToBottom();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Attachment could not be sent.'), backgroundColor: AppTheme.error),
      );
    }
  }

  Future<void> _shareLocation() async {
    try {
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        await Geolocator.requestPermission();
      }
      final pos = await Geolocator.getCurrentPosition();
      final isDelivery = widget.conversation.participants.any((p) =>
          p.role.toLowerCase().contains('delivery') || p.role.toLowerCase().contains('partner'));
      final message = await _repository.shareLocation(
        conversationId: widget.conversation.id,
        latitude: pos.latitude,
        longitude: pos.longitude,
        kind: isDelivery ? 'delivery' : 'pickup',
        label: isDelivery ? 'Delivery Meeting Point' : 'Farm Pickup Location',
      );
      if (!mounted) return;
      setState(() {
        if (!_messages.any((m) => m.id == message.id)) {
          _messages = [..._messages, message];
        }
      });
      _scrollToBottom();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not get your location. Check permissions and try again.'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            Text(widget.conversation.displayName, style: const TextStyle(fontSize: 17)),
            Text(
              _statusLabel,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w400, color: AppTheme.textSecondary),
            ),
          ],
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      backgroundColor: AppTheme.background,
      body: Column(
        children: [
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _error != null && _messages.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.wifi_off_outlined, size: 56, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                            const SizedBox(height: 12),
                            Text(_error!, style: const TextStyle(color: AppTheme.textSecondary)),
                          ],
                        ),
                      )
                    : _messages.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.chat_outlined, size: 64, color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
                                const SizedBox(height: 12),
                                const Text('Say hello to start the conversation', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
                              ],
                            ),
                          )
                        : ListView.builder(
                            controller: _scrollController,
                            padding: const EdgeInsets.all(12),
                            itemCount: _messages.length,
                            itemBuilder: (_, i) {
                              final msg = _messages[i];
                              return MessageBubble(
                                message: msg,
                                isMe: msg.senderId == _repository.currentUserId,
                              );
                            },
                          ),
          ),
          ChatInput(
            onSend: _send,
            onAttach: _attachImage,
            onShareLocation: _shareLocation,
          ),
        ],
      ),
    );
  }

  String get _statusLabel {
    if (widget.conversation.participants.isEmpty) return 'Active';
    final roles = widget.conversation.participants
        .map((p) => p.role)
        .toSet()
        .join(' · ');
    return roles.isEmpty ? 'Active' : roles;
  }
}