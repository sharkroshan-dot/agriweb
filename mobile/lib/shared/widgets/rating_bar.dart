import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// Star rating display. [rating] is 0–5; [size] controls icon size.
/// [interactive] renders tappable stars that report via [onChanged].
class RatingBar extends StatelessWidget {
  final double rating;
  final double size;
  final bool interactive;
  final ValueChanged<double>? onChanged;

  const RatingBar({
    super.key,
    this.rating = 0,
    this.size = 16,
    this.interactive = false,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (i) {
        final filled = i < rating.round();
        final star = Icon(
          filled ? Icons.star : Icons.star_border,
          size: size,
          color: AppTheme.accent,
        );
        if (!interactive) return star;
        return GestureDetector(
          onTap: onChanged == null ? null : () => onChanged!((i + 1).toDouble()),
          child: star,
        );
      }),
    );
  }
}