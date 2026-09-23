import '../../data/repositories/chat_repository.dart';

class SendMessageUsecase {
  final ChatRepository repository;
  SendMessageUsecase(this.repository);

  Future<dynamic> send(String conversationId, String content) =>
      repository.sendMessage(conversationId: conversationId, content: content);
}