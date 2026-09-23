import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:flutter_tts/flutter_tts.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class VoiceAssistantWidget extends StatefulWidget {
  const VoiceAssistantWidget({super.key});

  @override
  State<VoiceAssistantWidget> createState() => _VoiceAssistantWidgetState();
}

class _VoiceAssistantWidgetState extends State<VoiceAssistantWidget>
    with SingleTickerProviderStateMixin {
  late final stt.SpeechToText _speech;
  late final FlutterTts _tts;
  late final AnimationController _animationController;
  late final Animation<double> _pulseAnimation;

  bool _isListening = false;
  bool _isSpeaking = false;
  bool _isProcessing = false;
  String _transcript = '';
  String _lastResponse = '';
  final List<VoiceMessage> _messages = [];
  OverlayEntry? _overlayEntry;
  bool _isExpanded = false;

  @override
  void initState() {
    super.initState();
    _speech = stt.SpeechToText();
    _tts = FlutterTts();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.2).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeInOut),
    );

    _initSpeech();
    _initTts();
    _addWelcomeMessage();
  }

  Future<void> _initSpeech() async {
    final available = await _speech.initialize(
      onError: (error) => debugPrint('Speech error: $error'),
      onStatus: (status) {
        if (status == 'done' || status == 'notListening') {
          if (mounted) setState(() => _isListening = false);
        }
      },
    );
    if (!available) {
      debugPrint('Speech recognition not available');
    }
  }

  Future<void> _initTts() async {
    await _tts.setLanguage('en-IN');
    await _tts.setSpeechRate(0.5);
    await _tts.setVolume(1.0);
    await _tts.setPitch(1.0);

    _tts.setCompletionHandler(() {
      if (mounted) setState(() => _isSpeaking = false);
    });
  }

  void _addWelcomeMessage() {
    _messages.add(VoiceMessage(
      role: 'assistant',
      content: 'Hello! I\'m your AI Farm Assistant. How can I help you today?',
      timestamp: DateTime.now(),
    ));
  }

  Future<void> _toggleListening() async {
    if (_isListening) {
      await _speech.stop();
      setState(() => _isListening = false);
    } else {
      final available = await _speech.initialize();
      if (!available) {
        _showToast('Speech recognition not available');
        return;
      }

      setState(() {
        _isListening = true;
        _transcript = '';
      });

      _speech.listen(
        onResult: (result) {
          if (mounted) {
            setState(() => _transcript = result.recognizedWords);
            if (result.finalResult && _transcript.isNotEmpty) {
              _processVoiceCommand(_transcript);
            }
          }
        },
        listenOptions: stt.SpeechListenOptions(
          listenFor: const Duration(seconds: 10),
          pauseFor: const Duration(seconds: 3),
          localeId: 'en_IN',
        ),
      );
    }
  }

  Future<void> _processVoiceCommand(String command) async {
    if (command.trim().isEmpty) return;

    setState(() {
      _isProcessing = true;
      _messages.add(VoiceMessage(
        role: 'user',
        content: command,
        timestamp: DateTime.now(),
      ));
      _transcript = '';
    });

    try {
      final response = await ApiService.post('/ai/voice/process', body: {
        'command': command,
      });

      final reply = response['response'] as String? ??
          'I\'m not sure how to help with that. Try asking about demand, pricing, or delivery.';

      if (mounted) {
        setState(() {
          _messages.add(VoiceMessage(
            role: 'assistant',
            content: reply,
            timestamp: DateTime.now(),
          ));
          _lastResponse = reply;
        });
        await _speak(reply);
      }
    } catch (e) {
      const errorMsg = 'Sorry, I couldn\'t process that. Please try again.';
      if (mounted) {
        setState(() {
          _messages.add(VoiceMessage(
            role: 'assistant',
            content: errorMsg,
            timestamp: DateTime.now(),
          ));
        });
        await _speak(errorMsg);
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  Future<void> _speak(String text) async {
    if (text.isEmpty) return;
    setState(() => _isSpeaking = true);
    await _tts.speak(text);
  }

  void _showToast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppTheme.error),
    );
  }

  void _toggleExpanded() {
    setState(() => _isExpanded = !_isExpanded);
    if (_isExpanded) {
      _showOverlay();
    } else {
      _removeOverlay();
    }
  }

  void _showOverlay() {
    _overlayEntry = OverlayEntry(
      builder: (context) => Positioned(
        bottom: 90,
        left: 16,
        right: 16,
        child: Material(
          color: Colors.transparent,
          child: _VoiceAssistantPanel(
            messages: _messages,
            isListening: _isListening,
            isSpeaking: _isSpeaking,
            isProcessing: _isProcessing,
            transcript: _transcript,
            onToggleListening: _toggleListening,
            onClose: () => setState(() => _isExpanded = false),
            onSendMessage: (msg) => _processVoiceCommand(msg),
            quickCommands: _quickCommands,
            onQuickCommand: _processVoiceCommand,
          ),
        ),
      ),
    );
    Overlay.of(context).insert(_overlayEntry!);
  }

  void _removeOverlay() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  final List<String> _quickCommands = [
    'Tomato demand forecast this week',
    'Best price for onions',
    'Optimize my delivery route',
    'Check harvest quality',
    'Show my earnings',
    'High risk deliveries today',
  ];

  @override
  void dispose() {
    _speech.stop();
    _tts.stop();
    _animationController.dispose();
    _removeOverlay();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _toggleExpanded,
      child: AnimatedBuilder(
        animation: _pulseAnimation,
        builder: (context, child) => Transform.scale(
          scale: _isListening || _isSpeaking ? _pulseAnimation.value : 1.0,
          child: Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              gradient: AppTheme.brandGradient,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primaryGreen.withValues(alpha: 0.3),
                  blurRadius: _isListening || _isSpeaking ? 20 : 12,
                  spreadRadius: _isListening || _isSpeaking ? 4 : 0,
                ),
              ],
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(
                  _isListening
                      ? Icons.mic_none
                      : _isSpeaking
                          ? Icons.graphic_eq
                          : Icons.smart_toy_outlined,
                  color: Colors.white,
                  size: 28,
                ),
                if (_isProcessing)
                  const Positioned(
                    right: 8,
                    top: 8,
                    child: SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class VoiceMessage {
  final String role;
  final String content;
  final DateTime timestamp;

  VoiceMessage({
    required this.role,
    required this.content,
    required this.timestamp,
  });
}

class _VoiceAssistantPanel extends StatelessWidget {
  final List<VoiceMessage> messages;
  final bool isListening;
  final bool isSpeaking;
  final bool isProcessing;
  final String transcript;
  final VoidCallback onToggleListening;
  final VoidCallback onClose;
  final Function(String) onSendMessage;
  final List<String> quickCommands;
  final Function(String) onQuickCommand;

  const _VoiceAssistantPanel({
    required this.messages,
    required this.isListening,
    required this.isSpeaking,
    required this.isProcessing,
    required this.transcript,
    required this.onToggleListening,
    required this.onClose,
    required this.onSendMessage,
    required this.quickCommands,
    required this.onQuickCommand,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.6,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 20,
            offset: const Offset(0, -5),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: AppTheme.brandGradient,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.smart_toy, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'AI Farm Assistant',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        isListening
                            ? 'Listening...'
                            : isSpeaking
                                ? 'Speaking...'
                                : isProcessing
                                    ? 'Thinking...'
                                    : 'Tap mic to speak',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.8),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: onClose,
                  icon: const Icon(Icons.close, color: Colors.white),
                ),
              ],
            ),
          ),
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              reverse: true,
              padding: const EdgeInsets.all(16),
              itemCount: messages.length,
              itemBuilder: (context, index) {
                final msg = messages[messages.length - 1 - index];
                final isUser = msg.role == 'user';
                return Align(
                  alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    constraints: BoxConstraints(
                      maxWidth: MediaQuery.of(context).size.width * 0.75,
                    ),
                    decoration: BoxDecoration(
                      color: isUser ? AppTheme.primaryGreen : AppTheme.primarySoft,
                      borderRadius: BorderRadius.circular(16).copyWith(
                        bottomRight: isUser ? const Radius.circular(4) : null,
                        bottomLeft: isUser ? null : const Radius.circular(4),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          msg.content,
                          style: TextStyle(
                            color: isUser ? Colors.white : AppTheme.textPrimary,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${msg.timestamp.hour.toString().padLeft(2, '0')}:${msg.timestamp.minute.toString().padLeft(2, '0')}',
                          style: TextStyle(
                            color: isUser ? Colors.white70 : AppTheme.textSecondary,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          if (transcript.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: AppTheme.primarySoft.withValues(alpha: 0.3),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      transcript,
                      style: const TextStyle(
                        fontSize: 14,
                        color: AppTheme.textPrimary,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: transcript.isNotEmpty ? () => onSendMessage(transcript) : null,
                    icon: const Icon(Icons.send, color: AppTheme.primaryGreen),
                  ),
                ],
              ),
            ),
          Container(
            padding: const EdgeInsets.all(12),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: quickCommands.map((cmd) => ActionChip(
                label: Text(cmd, style: const TextStyle(fontSize: 11)),
                onPressed: () => onQuickCommand(cmd),
                backgroundColor: AppTheme.primarySoft,
                side: BorderSide.none,
              )).toList(),
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      decoration: InputDecoration(
                        hintText: 'Type a message...',
                        filled: true,
                        fillColor: AppTheme.surfaceVariant,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        suffixIcon: IconButton(
                          icon: const Icon(Icons.send, color: AppTheme.primaryGreen),
                          onPressed: () => onSendMessage(''),
                        ),
                      ),
                      onSubmitted: (value) => onSendMessage(value),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Container(
                    decoration: BoxDecoration(
                      gradient: AppTheme.brandGradient,
                      shape: BoxShape.circle,
                    ),
                    child: IconButton(
                      onPressed: onToggleListening,
                      icon: Icon(
                        isListening ? Icons.mic_off : Icons.mic,
                        color: Colors.white,
                        size: 24,
                      ),
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

class VoiceAssistantButton extends StatelessWidget {
  const VoiceAssistantButton({super.key});

  @override
  Widget build(BuildContext context) {
    return const VoiceAssistantWidget();
  }
}