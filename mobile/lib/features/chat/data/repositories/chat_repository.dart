import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import '../../../../core/services/api_service.dart';
import '../models/chat_model.dart';
import '../models/message_model.dart';

/// Repository for the realtime chat feature. Talks to the backend REST
/// endpoints for conversation + message history and opens a WebSocket for
/// live delivery of new messages.
class ChatRepository {
  ChatRepository({String? userId, String? userName, String? userRole, String? token})
      : _userId = userId,
        _userName = userName,
        _userRole = userRole,
        _token = token;

  final String? _userId;
  final String? _userName;
  final String? _userRole;
  final String? _token;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  StreamController<ChatMessage>? _controller;

  String? get currentUserId => _userId ?? ApiService.currentUserId;
  String get _senderName => _userName ?? ApiService.currentUserName;
  String get _senderRole => _userRole ?? ApiService.currentUserRole;
  String get _accessToken => _token ?? ApiService.accessToken;

  String get _wsBaseUrl {
    var url = ApiService.baseUrl;
    url = url.replaceFirst(RegExp(r'^http'), 'ws');
    return url;
  }

  /// Fetches the list of conversations for the current user.
  Future<List<ChatConversation>> getConversations() async {
    final res = await ApiService.get('/chat/conversations', params: {
      'user_id': currentUserId ?? 'user-1',
    });
    final list = ApiService.asList(res, key: 'conversations');
    return list
        .whereType<Map<String, dynamic>>()
        .map(ChatConversation.fromJson)
        .toList();
  }

  /// Fetches message history for a conversation.
  Future<List<ChatMessage>> getMessages(String conversationId) async {
    final res = await ApiService.get('/chat/conversations/$conversationId/messages');
    final list = ApiService.asList(res, key: 'messages');
    return list
        .whereType<Map<String, dynamic>>()
        .map(ChatMessage.fromJson)
        .toList();
  }

  /// Sends a message over REST and returns the created message.
  Future<ChatMessage> sendMessage({
    required String conversationId,
    required String content,
  }) async {
    final res = await ApiService.post('/chat/messages', body: {
      'conversation_id': conversationId,
      'content': content,
      'sender_id': currentUserId ?? 'user-1',
      'sender_name': _senderName,
      'sender_role': _senderRole,
    });
    final data = res['data'];
    if (data is Map<String, dynamic>) return ChatMessage.fromJson(data);
    if (res is Map<String, dynamic>) return ChatMessage.fromJson(res);
    return ChatMessage(
      id: '',
      senderId: currentUserId ?? 'user-1',
      senderName: _senderName,
      content: content,
      createdAt: DateTime.now().toUtc().toIso8601String(),
    );
  }

  /// Uploads an image/PDF attachment and returns the resulting chat message.
  Future<ChatMessage> sendAttachment({
    required String conversationId,
    required List<int> bytes,
    required String filename,
    String caption = '',
  }) async {
    final uri = Uri.parse(
        '${ApiService.baseUrl}/chat/messages/attachment?conversation_id=$conversationId');
    final request = http.MultipartRequest('POST', uri)
      ..headers['Authorization'] = 'Bearer $_accessToken'
      ..fields['caption'] = caption
      ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    final data = body['data'];
    if (data is Map<String, dynamic>) return ChatMessage.fromJson(data);
    throw Exception('Failed to send attachment');
  }

  /// Shares a controlled location point in a conversation.
  Future<ChatMessage> shareLocation({
    required String conversationId,
    required double latitude,
    required double longitude,
    String kind = 'pickup',
    String label = 'Farm Pickup Location',
  }) async {
    final res = await ApiService.post('/chat/messages/location', body: {
      'conversation_id': conversationId,
      'sender_id': currentUserId ?? 'user-1',
      'sender_name': _senderName,
      'sender_role': _senderRole,
      'latitude': latitude,
      'longitude': longitude,
      'share_kind': kind,
      'label': label,
    });
    final data = res['data'];
    if (data is Map<String, dynamic>) return ChatMessage.fromJson(data);
    throw Exception('Failed to share location');
  }

  /// Opens a WebSocket stream for live messages in a conversation.
  ///
  /// Returns a broadcast stream that emits [ChatMessage] events as they
  /// arrive. Call [dispose] when the screen is left.
  Stream<ChatMessage> connect(String conversationId) {
    _controller ??= StreamController<ChatMessage>.broadcast();

    final tokenParam =
        _accessToken.isNotEmpty ? '&token=${Uri.encodeQueryComponent(_accessToken)}' : '';
    final uri = Uri.parse(
      '$_wsBaseUrl/chat/ws/$conversationId'
      '?user_id=${Uri.encodeQueryComponent(currentUserId ?? 'user-1')}'
      '&user_name=${Uri.encodeQueryComponent(_senderName)}'
      '&user_role=${Uri.encodeQueryComponent(_senderRole)}$tokenParam',
    );
    _channel = WebSocketChannel.connect(uri);
    _subscription = _channel!.stream.listen((event) {
      if (event is! String) return;
      try {
        final payload = jsonDecode(event) as Map<String, dynamic>;
        final type = payload['type'] as String?;
        if (type == 'new_message' || type == 'message_sent') {
          final data = payload['data'];
          if (data is Map<String, dynamic>) {
            _controller?.add(ChatMessage.fromJson(data));
          }
        }
      } catch (_) {
        // Ignore malformed frames.
      }
    }, onError: (_) {}, onDone: () {});

    return _controller!.stream;
  }

  /// Sends a message over the live WebSocket (used in addition to REST so the
  /// peer receives it immediately). Falls back to REST if no socket is open.
  void sendOverSocket(String conversationId, String content) {
    final channel = _channel;
    if (channel == null) return;
    try {
      channel.sink.add(jsonEncode({'content': content}));
    } catch (_) {
      // Fall back to REST in [sendMessage].
    }
  }

  void dispose() {
    _subscription?.cancel();
    try {
      _channel?.sink.close();
    } catch (_) {}
    _subscription = null;
    _channel = null;
    _controller?.close();
    _controller = null;
  }
}