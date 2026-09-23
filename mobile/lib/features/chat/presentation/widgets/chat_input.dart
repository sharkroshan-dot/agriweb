import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// Message composer with a rounded text field, optional attachment + location
/// buttons and a send button. Handles multiline input and clears after send.
class ChatInput extends StatefulWidget {
  final Future<void> Function(String text) onSend;
  final Future<void> Function()? onAttach;
  final Future<void> Function()? onShareLocation;

  const ChatInput({
    super.key,
    required this.onSend,
    this.onAttach,
    this.onShareLocation,
  });

  @override
  State<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends State<ChatInput> {
  final _controller = TextEditingController();
  bool _hasText = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    setState(() => _hasText = false);
    await widget.onSend(text);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          border: Border(top: BorderSide(color: AppTheme.border.withValues(alpha: 0.7))),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, -2))],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (widget.onShareLocation != null)
              IconButton(
                onPressed: widget.onShareLocation,
                icon: const Icon(Icons.location_on_outlined, size: 20),
                color: AppTheme.primaryGreen,
                tooltip: 'Share location',
              ),
            if (widget.onAttach != null)
              IconButton(
                onPressed: widget.onAttach,
                icon: const Icon(Icons.attach_file, size: 22),
                color: AppTheme.primaryGreen,
                tooltip: 'Attach image',
              ),
            Expanded(
              child: TextField(
                controller: _controller,
                minLines: 1,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                onChanged: (v) => setState(() => _hasText = v.trim().isNotEmpty),
                onSubmitted: (_) => _send(),
                textInputAction: TextInputAction.send,
                decoration: const InputDecoration(
                  hintText: 'Type a message...',
                  prefixIcon: Icon(Icons.chat_bubble_outline, size: 20),
                  contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                ),
              ),
            ),
            const SizedBox(width: 8),
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              decoration: BoxDecoration(
                color: _hasText ? AppTheme.primaryGreen : AppTheme.primarySoft,
                borderRadius: BorderRadius.circular(28),
              ),
              child: IconButton(
                onPressed: _hasText ? _send : null,
                color: _hasText ? Colors.white : AppTheme.primaryGreen,
                icon: const Icon(Icons.send),
                tooltip: 'Send',
              ),
            ),
          ],
        ),
      ),
    );
  }
}