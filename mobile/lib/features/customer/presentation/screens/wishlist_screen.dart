import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/empty_state.dart';
import '../../../../shared/widgets/skeleton.dart';
import 'cart_screen.dart';

class WishlistScreen extends StatefulWidget {
  const WishlistScreen({super.key});
  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _items = [];

  @override
  void initState() {
    super.initState();
    _loadWishlist();
  }

  Future<void> _loadWishlist() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/customers/me/wishlist');
      if (!mounted) return;
      setState(() => _items = ApiService.asList(res).cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _removeFromWishlist(String id) async {
    final previous = List<Map<String, dynamic>>.from(_items);
    setState(() => _items.removeWhere((item) => item['_id'] == id || (item['product'] is Map && (item['product'] as Map)['_id'] == id)));
    try {
      await ApiService.delete('/customers/me/wishlist/$id');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Removed from wishlist'), backgroundColor: AppTheme.success, behavior: SnackBarBehavior.floating));
      }
    } catch (e) {
      setState(() => _items = previous);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to remove'), backgroundColor: AppTheme.error, behavior: SnackBarBehavior.floating));
      }
    }
  }

  void _addToCart(Map<String, dynamic> item) {
    final product = item['product'] is Map ? item['product'] as Map<String, dynamic> : item;
    final id = product['_id'] as String? ?? '';
    final name = product['name'] as String? ?? 'Product';
    final price = (product['price'] as num?)?.toDouble() ?? 0;
    final image = product['images'] is List && (product['images'] as List).isNotEmpty
        ? (product['images'] as List).first as String?
        : product['image'] as String? ?? '';

    CartService.instance.addItem(CartItem(id: id, name: name, price: price, image: image ?? ''));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$name added to cart'),
        backgroundColor: AppTheme.primaryGreen,
        behavior: SnackBarBehavior.floating,
        action: SnackBarAction(label: 'View Cart', textColor: Colors.white, onPressed: () => context.push('/customer/cart')),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Wishlist'),
        actions: [
          if (_items.isNotEmpty) TextButton(onPressed: () => context.push('/customer/cart'), child: const Text('View Cart')),
        ],
      ),
      body: _isLoading
          ? const PageSkeleton(items: 4)
          : _items.isEmpty
              ? EmptyState(
                  icon: Icons.favorite_outline,
                  title: 'Your wishlist is empty',
                  message: 'Tap the heart on any product to save it here for later.',
                  actionLabel: 'Browse Products',
                  onAction: () => context.go('/customer/home'),
                )
              : RefreshIndicator(
                  onRefresh: _loadWishlist,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) {
                      final item = _items[i];
                      final product = item['product'] is Map ? item['product'] as Map<String, dynamic> : item;
                      final id = product['_id'] as String? ?? '';
                      final name = product['name'] as String? ?? 'Product';
                      final price = (product['price'] as num?)?.toDouble() ?? 0;
                      final rating = (product['rating'] as num?)?.toDouble() ?? 0;
                      final images = product['images'] as List<dynamic>? ?? [];
                      final image = images.isNotEmpty && images.first is String ? images.first as String : product['image'] as String? ?? '';

                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppTheme.surface,
                          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
                          border: Border.all(color: AppTheme.border.withValues(alpha: 0.7)),
                          boxShadow: AppTheme.cardShadow,
                        ),
                        child: Row(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: Container(
                                width: 80,
                                height: 80,
                                color: AppTheme.background,
                                child: image.isNotEmpty
                                    ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.image, color: AppTheme.textSecondary))
                                    : const Icon(Icons.image, color: AppTheme.textSecondary),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  const SizedBox(height: 4),
                                  Text('Rs ${price.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.primaryGreen)),
                                  if (rating > 0) ...[
                                    const SizedBox(height: 4),
                                    Row(
                                      children: [
                                        const Icon(Icons.star, size: 14, color: AppTheme.accent),
                                        const SizedBox(width: 2),
                                        Text(rating.toStringAsFixed(1), style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                      ],
                                    ),
                                  ],
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: SizedBox(
                                          height: 34,
                                          child: ElevatedButton.icon(
                                            onPressed: () => _addToCart(item),
                                            icon: const Icon(Icons.add_shopping_cart, size: 15),
                                            label: const Text('Add', style: TextStyle(fontSize: 12)),
                                            style: ElevatedButton.styleFrom(minimumSize: Size.zero, padding: const EdgeInsets.symmetric(horizontal: 8)),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Container(
                                        decoration: BoxDecoration(border: Border.all(color: AppTheme.error.withValues(alpha: 0.3)), borderRadius: BorderRadius.circular(8)),
                                        child: IconButton(
                                          icon: const Icon(Icons.favorite, color: AppTheme.error, size: 18),
                                          onPressed: () => _removeFromWishlist(item['_id'] as String? ?? id),
                                          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                                          padding: EdgeInsets.zero,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}