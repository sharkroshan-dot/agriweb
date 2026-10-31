import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/helpers.dart';
import 'network_image.dart';
import 'skeleton.dart';

/// Shared product card used across home, marketplace, search and listings.
/// Replaces the inline product cards so pricing/badges/ratings look identical
/// everywhere. [onTap] drives navigation.
class ProductCard extends StatelessWidget {
  final Map<String, dynamic> product;
  final VoidCallback? onTap;
  final double width;

  const ProductCard({
    super.key,
    required this.product,
    this.onTap,
    this.width = 160,
  });

  @override
  Widget build(BuildContext context) {
    final name = product['name'] as String? ?? 'Product';
    final price = (product['price'] as num?)?.toDouble();
    final mrp = (product['mrp'] as num?)?.toDouble();
    final rating = productRating(product);
    final image = productImage(product);
    final farmer = productFarmerName(product);
    final unit = product['unit'] as String? ?? '';
    final isOrganic = product['isOrganic'] == true;
    final isFresh = product['isFresh'] == true;

    int? discountPct;
    if (mrp != null && price != null && mrp > price) {
      discountPct = ((mrp - price) / mrp * 100).round();
    }

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: width,
        margin: const EdgeInsets.only(bottom: 2),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border.withValues(alpha: 0.7)),
          boxShadow: [
            BoxShadow(
              color: const Color(0x120F172A),
              blurRadius: 16,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
                  child: AppNetworkImage(
                    url: image,
                    height: 110,
                    width: double.infinity,
                    borderRadius: 0,
                  ),
                ),
                if (discountPct != null)
                  Positioned(
                    top: 8,
                    left: 8,
                    child: _Badge(
                      label: '$discountPct% OFF',
                      color: AppTheme.error,
                    ),
                  ),
                if (isOrganic || isFresh)
                  Positioned(
                    top: 8,
                    right: 8,
                    child: _Badge(
                      label: isOrganic ? 'Organic' : 'Fresh',
                      color: AppTheme.primaryGreen,
                      icon: isOrganic ? Icons.eco : Icons.local_florist,
                    ),
                  ),
              ],
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, height: 1.2, color: AppTheme.textPrimary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      farmer,
                      style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const Spacer(),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            price != null ? '$kPriceSymbol${_format(price)}${unit.isEmpty ? '' : ' /$unit'}' : '—',
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                              color: AppTheme.primaryGreen,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (rating > 0)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppTheme.accent.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.star, size: 12, color: AppTheme.accent),
                                const SizedBox(width: 2),
                                Text(
                                  rating.toStringAsFixed(1),
                                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _format(double value) {
    return value == value.roundToDouble() ? value.toInt().toString() : value.toStringAsFixed(2);
  }
}

/// Skeleton twin of [ProductCard] used during load.
class ProductCardSkeleton extends StatelessWidget {
  final double width;
  const ProductCardSkeleton({super.key, this.width = 160});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SkeletonBox(width: double.infinity, height: 110, radius: 16),
          const SizedBox(height: 10),
          const SkeletonBox(width: 120, height: 13),
          const SizedBox(height: 6),
          const SkeletonBox(width: 80, height: 11),
          const SizedBox(height: 10),
          const Row(
            children: [
              SkeletonBox(width: 54, height: 14),
              Spacer(),
              SkeletonBox(width: 34, height: 12),
            ],
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  final IconData? icon;
  const _Badge({required this.label, required this.color, this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(50),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11, color: Colors.white),
            const SizedBox(width: 3),
          ],
          Text(
            label,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Colors.white),
          ),
        ],
      ),
    );
  }
}