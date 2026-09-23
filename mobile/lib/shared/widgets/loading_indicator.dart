import 'package:flutter/material.dart';

/// Shared loading states. Use [LoadingView] for full-screen loading and
/// [InlineLoader] for embedded sections.
class LoadingView extends StatelessWidget {
  final String? label;
  final bool dark;

  const LoadingView({super.key, this.label, this.dark = false});

  @override
  Widget build(BuildContext context) {
    final color = dark ? Colors.white : null;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 34,
            height: 34,
            child: CircularProgressIndicator(strokeWidth: 3, color: color),
          ),
          if (label != null) ...[
            const SizedBox(height: 14),
            Text(
              label!,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: dark ? Colors.white70 : null,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class InlineLoader extends StatelessWidget {
  final double height;
  const InlineLoader({super.key, this.height = 120});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: const Center(
        child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.6)),
      ),
    );
  }
}