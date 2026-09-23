import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/widgets/product_card.dart';

class AIRecommendationsWidget extends StatefulWidget {
  final String? userId;
  final int limit;
  final VoidCallback? onViewAll;

  const AIRecommendationsWidget({
    super.key,
    this.userId,
    this.limit = 4,
    this.onViewAll,
  });

  @override
  State<AIRecommendationsWidget> createState() => _AIRecommendationsWidgetState();
}

class _AIRecommendationsWidgetState extends State<AIRecommendationsWidget> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _recommendations = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadRecommendations();
  }

  Future<void> _loadRecommendations() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final userId = widget.userId;
      final response = await ApiService.post('/ai/recommendations', body: {
        'userId': userId,
        'limit': widget.limit,
        'type': 'personalized',
      });

      if (!mounted) return;

      final data = response['data'] ?? response;
      final recommendations = (data['recommendations'] as List<dynamic>?) ?? [];

      setState(() {
        _recommendations = recommendations.cast<Map<String, dynamic>>();
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load recommendations';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _recommendations.isEmpty) {
      return _buildErrorState();
    }

    if (_recommendations.isEmpty && !_isLoading) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryGreen.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.psychology_outlined,
                    size: 18,
                    color: AppTheme.primaryGreen,
                  ),
                ),
                const SizedBox(width: 8),
                const Text(
                  'Recommended For You',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ],
            ),
            if (widget.onViewAll != null)
              TextButton(
                onPressed: widget.onViewAll,
                child: Row(
                  children: [
                    Text('View All', style: TextStyle(color: AppTheme.primaryGreen)),
                    const SizedBox(width: 4),
                    Icon(Icons.arrow_forward_ios, size: 12, color: AppTheme.primaryGreen),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (_isLoading)
          SizedBox(
            height: 200,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: 3,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (_, __) => const ProductCardSkeleton(),
            ),
          )
        else if (_recommendations.isNotEmpty)
          SizedBox(
            height: 210,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _recommendations.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (_, index) {
                final product = _recommendations[index];
                final id = product['productId'] as String? ?? product['_id'] as String? ?? '';
                return _RecommendationCard(
                  product: product,
                  onTap: () {
                    if (id.isNotEmpty) {
                      context.push('/customer/product/$id');
                    }
                  },
                );
              },
            ),
          ),
      ],
    );
  }

  Widget _buildErrorState() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.error.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.error.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, color: AppTheme.error, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _error!,
              style: TextStyle(fontSize: 13, color: AppTheme.error),
            ),
          ),
          TextButton(
            onPressed: _loadRecommendations,
            child: Text('Retry', style: TextStyle(color: AppTheme.error)),
          ),
        ],
      ),
    );
  }
}

class _RecommendationCard extends StatelessWidget {
  final Map<String, dynamic> product;
  final VoidCallback onTap;

  const _RecommendationCard({required this.product, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final id = product['productId'] as String? ?? product['_id'] as String? ?? '';
    final name = product['name'] as String? ?? product['productName'] as String? ?? 'Product';
    final price = (product['price'] as num?)?.toDouble() ?? 0;
    final unit = product['unit'] as String? ?? 'kg';
    final image = product['imageUrl'] as String? ?? product['image'] as String?;
    final farmerName = product['farmName'] as String? ?? product['farmerName'] as String? ?? 'Local Farmer';
    final score = (product['score'] as num?)?.toDouble() ?? 0.8;
    final reason = product['reason'] as String? ?? 'Based on your preferences';

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 160,
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border.withValues(alpha: 0.6)),
          boxShadow: AppTheme.cardShadow,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image
            Stack(
              children: [
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
                  child: image != null && image.isNotEmpty
                      ? Image.network(
                          image,
                          width: 160,
                          height: 110,
                          fit: BoxFit.cover,
                          loadingBuilder: (context, child, loadingProgress) {
                            if (loadingProgress == null) return child;
                            return Container(
                              width: 160,
                              height: 110,
                              color: AppTheme.surfaceVariant,
                              child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                            );
                          },
                          errorBuilder: (context, error, stackTrace) => Container(
                            width: 160,
                            height: 110,
                            color: AppTheme.surfaceVariant,
                            child: const Icon(Icons.image, color: AppTheme.textSecondary, size: 40),
                          ),
                        )
                      : Container(
                          width: 160,
                          height: 110,
                          color: AppTheme.surfaceVariant,
                          child: const Icon(Icons.image, color: AppTheme.textSecondary, size: 40),
                        ),
                ),
                // AI badge
                Positioned(
                  top: 8,
                  left: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.primaryGreen,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.auto_awesome, size: 10, color: Colors.white),
                        const SizedBox(width: 2),
                        Text(
                          '${(score * 100).round()}%',
                          style: const TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            // Info
            Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    farmerName,
                    style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Text(
                        'Rs ${price == price.roundToDouble() ? price.toInt().toString() : price.toStringAsFixed(2)}',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.primaryGreen,
                        ),
                      ),
                      Text(
                        '/$unit',
                        style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    reason,
                    style: TextStyle(
                      fontSize: 10,
                      color: AppTheme.textTertiary,
                      fontStyle: FontStyle.italic,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}