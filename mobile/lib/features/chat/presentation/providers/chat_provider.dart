import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../../../core/services/api_service.dart';
import '../../data/models/chat_model.dart';
import '../../data/models/message_model.dart';
import '../../data/repositories/chat_repository.dart';

/// Manages conversation list and the active conversation's message stream.
class ChatProvider extends ChangeNotifier {
  ChatProvider({ChatRepository? repository}) : _repository = repository ?? ChatRepository();

  final ChatRepository _repository;

  bool isLoading = false;
  bool messagesLoading = false;
  String? error;
  List<ChatConversation> conversations = [];
  List<ChatMessage> messages = [];
  StreamSubscription<ChatMessage>? _subscription;
  ChatConversation? activeConversation;

  /// A supplier for the current user id (used to decide bubble alignment).
  /// Defaults to the signed-in user, falling back to the backend sample data.
  String Function() currentUserId = () => ApiService.currentUserId;

  Future<void> loadConversations() async {
    isLoading = true;
    error = null;
    notifyListeners();
    try {
      conversations = await _repository.getConversations();
    } catch (e) {
      error = 'Unable to load conversations';
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<void> openConversation(ChatConversation conversation) async {
    activeConversation = conversation;
    messagesLoading = true;
    error = null;
    notifyListeners();
    await _subscription?.cancel();
    try {
      messages = await _repository.getMessages(conversation.id);
      _subscription = _repository.connect(conversation.id).listen((msg) {
        if (!_contains(msg)) {
          messages = [...messages, msg];
          notifyListeners();
        }
      });
    } catch (_) {
      error = 'Unable to load messages';
    } finally {
      messagesLoading = false;
      notifyListeners();
    }
  }

  bool _contains(ChatMessage msg) {
    if (msg.id.isNotEmpty) {
      return messages.any((m) => m.id == msg.id);
    }
    return false;
  }

  Future<void> send(String content) async {
    final conv = activeConversation;
    if (conv == null || content.trim().isEmpty) return;
    try {
      final msg = await _repository.sendMessage(
        conversationId: conv.id,
        content: content.trim(),
      );
      _repository.sendOverSocket(conv.id, content.trim());
      if (!_contains(msg)) {
        messages = [...messages, msg];
        notifyListeners();
      }
    } catch (_) {
      error = 'Failed to send message';
      notifyListeners();
    }
  }

  bool isMe(ChatMessage message) {
    return message.senderId == currentUserId();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _repository.dispose();
    super.dispose();
  }
}