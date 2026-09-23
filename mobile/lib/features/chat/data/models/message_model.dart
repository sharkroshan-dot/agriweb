class ChatAttachment {
  final String type;
  final String url;
  final String name;

  const ChatAttachment({required this.type, required this.url, this.name = ''});

  factory ChatAttachment.fromJson(Map<String, dynamic> json) {
    return ChatAttachment(
      type: json['type'] as String? ?? 'image',
      url: json['url'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }
}

class ChatLocation {
  final String kind;
  final String label;
  final double latitude;
  final double longitude;

  const ChatLocation({
    this.kind = 'pickup',
    this.label = 'Shared Location',
    required this.latitude,
    required this.longitude,
  });

  factory ChatLocation.fromJson(Map<String, dynamic> json) {
    return ChatLocation(
      kind: json['kind'] as String? ?? 'pickup',
      label: json['label'] as String? ?? 'Shared Location',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
    );
  }
}

class ChatMessage {
  final String id;
  final String senderId;
  final String senderName;
  final String content;
  final String? createdAt;
  final String messageType;
  final List<ChatAttachment> attachments;
  final ChatLocation? location;

  const ChatMessage({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.content,
    this.createdAt,
    this.messageType = 'text',
    this.attachments = const [],
    this.location,
  });

  bool get isImage =>
      attachments.isNotEmpty &&
      attachments.first.type == 'image' &&
      attachments.first.url.isNotEmpty;

  bool get isLocation => location != null;

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    final attachmentsRaw = json['attachments'];
    final locationRaw = json['location'];
    return ChatMessage(
      id: json['id'] as String? ?? '',
      senderId: json['sender_id'] as String? ?? json['senderId'] as String? ?? '',
      senderName: json['sender_name'] as String? ?? json['senderName'] as String? ?? '',
      content: json['content'] as String? ?? '',
      createdAt: json['created_at'] as String? ?? json['createdAt'] as String?,
      messageType: json['message_type'] as String? ?? json['messageType'] as String? ?? 'text',
      attachments: attachmentsRaw is List
          ? attachmentsRaw
              .whereType<Map<String, dynamic>>()
              .map(ChatAttachment.fromJson)
              .toList()
          : const [],
      location: locationRaw is Map<String, dynamic> ? ChatLocation.fromJson(locationRaw) : null,
    );
  }
}