import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/dark_theme.dart';

/// Shimmer-based loading placeholders. Use these instead of bare
/// `CircularProgressIndicator`s so loading screens feel polished and calm.
class SkeletonBox extends StatelessWidget {
  final double? width;
  final double height;
  final double radius;

  const SkeletonBox({
    super.key,
    this.width,
    this.height = 14,
    this.radius = 6,
  });

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).brightness == Brightness.dark
        ? DarkTheme.surfaceVariant
        : AppTheme.shimmerBase;
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: base,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

/// A single shimmering block that animates across placeholder boxes.
class SkeletonShimmer extends StatefulWidget {
  final Widget child;
  final double radius;
  final Color? baseColor;
  final Color? highlightColor;

  const SkeletonShimmer({
    super.key,
    required this.child,
    this.radius = AppTheme.radiusLg,
    this.baseColor,
    this.highlightColor,
  });

  @override
  State<SkeletonShimmer> createState() => _SkeletonShimmerState();
}

class _SkeletonShimmerState extends State<SkeletonShimmer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = widget.baseColor ?? (dark ? DarkTheme.surfaceVariant : AppTheme.shimmerBase);
    final highlight = widget.highlightColor ?? (dark ? AppTheme.primaryGreen.withValues(alpha: 0.10) : AppTheme.shimmerHighlight);

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final gradient = LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            base,
            Color.lerp(base, highlight, 0.5 + 0.5 * _sin(_controller.value))!,
            base,
          ],
          stops: const [0.2, 0.5, 0.8],
        );
        return ShaderMask(
          shaderCallback: (bounds) => gradient.createShader(bounds),
          blendMode: BlendMode.srcATop,
          child: child,
        );
      },
      child: ClipRRect(
        borderRadius: BorderRadius.circular(widget.radius),
        child: widget.child,
      ),
    );
  }

  double _sin(double t) => (1 - math.cos(t * 3.14159 * 2)) / 2;
}

/// Full-screen placeholder shown while a page's first payload loads.
class PageSkeleton extends StatelessWidget {
  final int items;
  const PageSkeleton({super.key, this.items = 6});

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, __) => const ListTileSkeleton(),
    );
  }
}

/// Single list-row placeholder (avatar, two text lines, trailing block).
class ListTileSkeleton extends StatelessWidget {
  const ListTileSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.border.withValues(alpha: 0.5)),
      ),
      child: const Row(
        children: [
          SkeletonBox(width: 52, height: 52, radius: 14),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBox(width: double.infinity, height: 13),
                SizedBox(height: 6),
                SkeletonBox(width: 150, height: 11),
              ],
            ),
          ),
          SizedBox(width: 12),
          SkeletonBox(width: 40, height: 22, radius: 11),
        ],
      ),
    );
  }
}