import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// Friendly error state with a retry action. [compact] renders a smaller inline
/// variant suitable for embedding inside list sections.
class AppErrorView extends StatelessWidget {
  final String? message;
  final VoidCallback? onRetry;
  final bool compact;

  const AppErrorView({super.key, this.message, this.onRetry, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: EdgeInsets.all(compact ? 12 : 18),
          decoration: BoxDecoration(
            color: AppTheme.error.withValues(alpha: 0.08),
            shape: BoxShape.circle,
          ),
          child: Icon(
            Icons.cloud_off_outlined,
            size: compact ? 26 : 40,
            color: AppTheme.error.withValues(alpha: 0.8),
          ),
        ),
        SizedBox(height: compact ? 8 : 14),
        Text(
          message ?? 'Something went wrong',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: compact ? 12 : 14,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        if (onRetry != null) ...[
          SizedBox(height: compact ? 8 : 16),
          TextButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Try Again'),
          ),
        ],
      ],
    );

    return compact
        ? Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Center(child: content))
        : Center(child: content);
  }
}