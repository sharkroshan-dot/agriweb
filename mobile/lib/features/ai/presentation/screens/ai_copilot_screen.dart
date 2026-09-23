import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/widgets/app_bar.dart';

class AICopilotScreen extends StatefulWidget {
  final String? initialPrompt;
  const AICopilotScreen({super.key, this.initialPrompt});

  @override
  State<AICopilotScreen> createState() => _AICopilotScreenState();
}

class _AICopilotScreenState extends State<AICopilotScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  List<ChatMessage> _messages = [];
  bool _isLoading = false;
  String _userRole = 'customer';

  @override
  void initState() {
    super.initState();
    _loadUserRole();
    _addWelcomeMessage();
    if (widget.initialPrompt != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _sendMessage(widget.initialPrompt!);
      });
    }
  }

  Future<void> _loadUserRole() async {
    final user = await ApiService.getCurrentUser();
    if (user != null && mounted) {
      setState(() => _userRole = user['role'] ?? 'customer');
      _addWelcomeMessage();
    }
  }

  void _addWelcomeMessage() {
    final welcomeMessages = {
      'customer': {
        'greeting': 'Hello! I\'m your AI Shopping Assistant 🛒',
        'help': 'I can help you find products, check prices, and make the best choices for your grocery needs.',
        'suggestions': [
          'Find vegetables under ₹100',
          'What should I buy this week?',
          'Show me organic products',
          'Find nearby farmers',
        ],
      },
      'farmer': {
        'greeting': 'Welcome to your AI Farm Copilot 🌾',
        'help': 'I can help with demand forecasts, pricing advice, inventory planning, and delivery optimization.',
        'suggestions': [
          'What should I stock this week?',
          'Which products need price review?',
          'How can I reduce delivery cost?',
          'Show me demand forecast',
        ],
      },
      'delivery': {
        'greeting': 'Hi! I\'m your AI Delivery Assistant 🚚',
        'help': 'I can help optimize your routes, check delivery risks, and manage your deliveries efficiently.',
        'suggestions': [
          'Show my active deliveries',
          'Which delivery has highest risk?',
          'How can I reduce route distance?',
          'Optimize today\'s route',
        ],
      },
      'business': {
        'greeting': 'Hello! I\'m your AI Procurement Assistant 🏢',
        'help': 'I can help with bulk sourcing, supplier analysis, and demand insights for your business.',
        'suggestions': [
          'Find wholesale suppliers',
          'What are current market prices?',
          'Create bulk order request',
          'Show me seasonal availability',
        ],
      },
    };

    final roleConfig = welcomeMessages[_userRole] ?? welcomeMessages['customer']!;

    setState(() {
      _messages = [
        ChatMessage(
          isUser: false,
          text: '${roleConfig['greeting']}\n\n${roleConfig['help']}',
          timestamp: DateTime.now(),
          suggestions: roleConfig['suggestions'] as List<String>,
        ),
      ];
    });
  }

  Future<void> _sendMessage(String message) async {
    if (message.trim().isEmpty) return;

    final userMessage = ChatMessage(
      isUser: true,
      text: message,
      timestamp: DateTime.now(),
    );

    setState(() {
      _messages.add(userMessage);
      _isLoading = true;
    });
    _messageController.clear();
    _scrollToBottom();

    try {
      final response = await ApiService.post('/ai/chatbot', body: {
        'message': message,
        'language': 'english',
        'role': _userRole,
      });

      if (!mounted) return;

      final reply = response['reply'] as String? ?? 'I\'m not sure how to help with that. Try asking about products, orders, or farming advice.';

      setState(() {
        _messages.add(ChatMessage(
          isUser: false,
          text: reply,
          timestamp: DateTime.now(),
        ));
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _messages.add(ChatMessage(
          isUser: false,
          text: 'Sorry, I couldn\'t process that. Please try again or check your connection.',
          timestamp: DateTime.now(),
        ));
        _isLoading = false;
      });
    }
    _scrollToBottom();
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

  void _handleQuickAction(String prompt) {
    _sendMessage(prompt);
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final roleColors = {
      'customer': AppTheme.primaryGreen,
      'farmer': AppTheme.warning,
      'delivery': AppTheme.info,
      'business': AppTheme.accent,
    };

    final roleColor = roleColors[_userRole] ?? AppTheme.primaryGreen;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: roleColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                _userRole == 'customer' ? Icons.shopping_bag_outlined :
                _userRole == 'farmer' ? Icons.agriculture_outlined :
                _userRole == 'delivery' ? Icons.local_shipping_outlined :
                Icons.business_outlined,
                color: roleColor,
                size: 20,
              ),
            ),
            const SizedBox(width: 10),
            Text('AI Copilot'),
          ],
        ),
        actions: [
          IconButton(
            onPressed: () {
              setState(() {
                _messages = [];
                _addWelcomeMessage();
              });
            },
            icon: const Icon(Icons.refresh),
            tooltip: 'New Conversation',
          ),
        ],
      ),
      body: Column(
        children: [
          // Chat messages
          Expanded(
            child: _messages.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final msg = _messages[index];
                      return _ChatBubble(
                        message: msg,
                        roleColor: roleColor,
                        onSuggestionTap: _handleQuickAction,
                      );
                    },
                  ),
          ),

          // Loading indicator
          if (_isLoading)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: roleColor,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'AI is thinking...',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                ],
              ),
            ),

          // Input area
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: AppTheme.border)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.05),
                    blurRadius: 10,
                    offset: const Offset(0, -2),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      decoration: InputDecoration(
                        hintText: 'Ask me anything...',
                        hintStyle: TextStyle(color: AppTheme.textTertiary),
                        filled: true,
                        fillColor: AppTheme.surfaceVariant,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        prefixIcon: Icon(Icons.chat_bubble_outline, color: AppTheme.textSecondary),
                      ),
                      textCapitalization: TextCapitalization.sentences,
                      onSubmitted: _sendMessage,
                      maxLines: null,
                      keyboardType: TextInputType.multiline,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    decoration: BoxDecoration(
                      gradient: AppTheme.brandGradient,
                      shape: BoxShape.circle,
                    ),
                    child: IconButton(
                      onPressed: _isLoading
                          ? null
                          : () {
                              final text = _messageController.text.trim();
                              if (text.isNotEmpty) {
                                _sendMessage(text);
                              }
                            },
                      icon: const Icon(Icons.send, color: Colors.white),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class ChatMessage {
  final bool isUser;
  final String text;
  final DateTime timestamp;
  final List<String>? suggestions;

  ChatMessage({
    required this.isUser,
    required this.text,
    required this.timestamp,
    this.suggestions,
  });
}

class _ChatBubble extends StatelessWidget {
  final ChatMessage message;
  final Color roleColor;
  final Function(String) onSuggestionTap;

  const _ChatBubble({
    required this.message,
    required this.roleColor,
    required this.onSuggestionTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: message.isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!message.isUser) ...[
            CircleAvatar(
              radius: 16,
              backgroundColor: roleColor.withValues(alpha: 0.15),
              child: Icon(
                Icons.smart_toy_outlined,
                size: 16,
                color: roleColor,
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: message.isUser
                    ? roleColor
                    : AppTheme.surfaceVariant,
                borderRadius: BorderRadius.circular(16).copyWith(
                  bottomRight: message.isUser ? const Radius.circular(4) : null,
                  bottomLeft: message.isUser ? null : const Radius.circular(4),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    message.text,
                    style: TextStyle(
                      color: message.isUser ? Colors.white : AppTheme.textPrimary,
                      fontSize: 14,
                      height: 1.4,
                    ),
                  ),
                  if (message.suggestions != null && message.suggestions!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: message.suggestions!.map((s) => ActionChip(
                        label: Text(s, style: const TextStyle(fontSize: 11)),
                        onPressed: () => onSuggestionTap(s),
                        backgroundColor: message.isUser
                            ? Colors.white.withValues(alpha: 0.2)
                            : roleColor.withValues(alpha: 0.1),
                        labelStyle: TextStyle(
                          color: message.isUser ? Colors.white : roleColor,
                          fontWeight: FontWeight.w600,
                        ),
                        side: BorderSide.none,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      )).toList(),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (message.isUser) ...[
            const SizedBox(width: 8),
            CircleAvatar(
              radius: 16,
              backgroundColor: AppTheme.primarySoft,
              child: const Icon(Icons.person_outline, size: 16, color: AppTheme.primaryGreen),
            ),
          ],
        ],
      ),
    );
  }
}