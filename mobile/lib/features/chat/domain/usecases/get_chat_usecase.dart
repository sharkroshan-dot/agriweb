import '../../data/repositories/chat_repository.dart';

class GetChatUsecase {
  final ChatRepository repository;
  GetChatUsecase(this.repository);

  Future<dynamic> getConversations() => repository.getConversations();
}