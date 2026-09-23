import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// Network image with a branded placeholder. Used for products, farms and
/// avatars. [height] and [width] control the box; the image always fills it.
class AppNetworkImage extends StatelessWidget {
  final String? url;
  final double? height;
  final double? width;
  final double borderRadius;
  final BoxFit fit;
  final IconData placeholderIcon;

  const AppNetworkImage({
    super.key,
    required this.url,
    this.height,
    this.width,
    this.borderRadius = AppTheme.radiusLg,
    this.fit = BoxFit.cover,
    this.placeholderIcon = Icons.image_outlined,
  });

  @override
  Widget build(BuildContext context) {
    final hasUrl = url != null && url!.isNotEmpty;
    Widget child;

    if (hasUrl) {
      child = Image.network(
        url!,
        fit: fit,
        errorBuilder: (_, __, ___) => _placeholder(),
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return Container(
            color: AppTheme.surfaceVariant,
            alignment: Alignment.center,
            child: const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
          );
        },
      );
    } else {
      child = _placeholder();
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: SizedBox(height: height, width: width, child: child),
    );
  }

  Widget _placeholder() {
    return Container(
      color: AppTheme.primarySoft.withValues(alpha: 0.6),
      alignment: Alignment.center,
      child: Icon(
        placeholderIcon,
        size: 32,
        color: AppTheme.primaryGreen.withValues(alpha: 0.4),
      ),
    );
  }
}