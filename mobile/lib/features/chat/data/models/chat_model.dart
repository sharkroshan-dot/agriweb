class ChatParticipant {
  final String id;
  final String name;
  final String role;

  const ChatParticipant({required this.id, required this.name, required this.role});

  factory ChatParticipant.fromJson(Map<String, dynamic> json) {
    return ChatParticipant(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'User',
      role: json['role'] as String? ?? 'customer',
    );
  }
}

class LastMessage {
  final String content;
  final String senderName;
  final String? createdAt;

  const LastMessage({required this.content, required this.senderName, this.createdAt});

  factory LastMessage.fromJson(Map<String, dynamic> json) {
    return LastMessage(
      content: json['content'] as String? ?? '',
      senderName: json['sender_name'] as String? ?? json['senderName'] as String? ?? '',
      createdAt: json['created_at'] as String? ?? json['createdAt'] as String?,
    );
  }
}

class ChatConversation {
  final String id;
  final List<ChatParticipant> participants;
  final ChatParticipant? participant;
  final String subject;
  final LastMessage? lastMessage;
  final int unreadCount;
  final String status;
  final String? createdAt;
  final String? updatedAt;

  const ChatConversation({
    required this.id,
    required this.participants,
    this.participant,
    required this.subject,
    this.lastMessage,
    this.unreadCount = 0,
    this.status = 'active',
    this.createdAt,
    this.updatedAt,
  });

  factory ChatConversation.fromJson(Map<String, dynamic> json) {
    final participantsRaw = json['participants'];
    final participants = participantsRaw is List
        ? participantsRaw
            .whereType<Map<String, dynamic>>()
            .map(ChatParticipant.fromJson)
            .toList()
        : <ChatParticipant>[];

    final lastRaw = json['last_message'] ?? json['lastMessage'];
    final participantRaw = json['participant'];
    return ChatConversation(
      id: json['id'] as String? ?? '',
      participants: participants,
      participant: participantRaw is Map<String, dynamic>
          ? ChatParticipant.fromJson(participantRaw)
          : null,
      subject: json['subject'] as String? ?? 'Chat',
      lastMessage: lastRaw is Map<String, dynamic> ? LastMessage.fromJson(lastRaw) : null,
      unreadCount: (json['unread_count'] as num?)?.toInt() ?? (json['unreadCount'] as num?)?.toInt() ?? 0,
      status: json['status'] as String? ?? 'active',
      createdAt: json['created_at'] as String? ?? json['createdAt'] as String?,
      updatedAt: json['updated_at'] as String? ?? json['updatedAt'] as String?,
    );
  }

  /// Friendly title for the row/screen: the backend-resolved counterpart first,
  /// then participants, falling back to a generic label for delivery threads.
  String get displayName {
    if (participant != null && participant!.name.isNotEmpty) return participant!.name;
    if (participants.isNotEmpty) return participants.first.name;
    return 'Chat';
  }
}