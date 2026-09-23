import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/skeleton.dart';
import 'cart_screen.dart';

class ProductDetailsScreen extends StatefulWidget {
  final String productId;
  const ProductDetailsScreen({super.key, required this.productId});
  @override
  State<ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

class _ProductDetailsScreenState extends State<ProductDetailsScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _product;
  int _quantity = 1;
  int _currentImageIndex = 0;
  bool _isWishlisted = false;
  bool _wishlistBusy = false;

  @override
  void initState() {
    super.initState();
    _loadProduct();
  }

  Future<void> _loadProduct() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/products/${widget.productId}');
      if (!mounted) return;
      final product = res['data'] as Map<String, dynamic>? ?? res;
      setState(() {
        _product = product;
        _isWishlisted = product['isWishlisted'] == true;
      });
      if (!_isWishlisted) await _checkWishlisted();
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _checkWishlisted() async {
    try {
      final res = await ApiService.get('/customers/me/wishlist');
      if (!mounted) return;
      final items = ApiService.asList(res);
      final listed = items.any((item) {
        final product = item['product'] is Map ? item['product'] as Map<String, dynamic> : item as Map<String, dynamic>?;
        return product?['_id'] == widget.productId;
      });
      if (listed && mounted) setState(() => _isWishlisted = true);
    } catch (_) {}
  }

  Future<void> _toggleWishlist() async {
    if (_wishlistBusy) return;
    setState(() => _wishlistBusy = true);
    final previous = _isWishlisted;
    setState(() => _isWishlisted = !_isWishlisted);
    try {
      if (_isWishlisted) {
        await ApiService.post('/customers/me/wishlist/${widget.productId}');
      } else {
        await ApiService.delete('/customers/me/wishlist/${widget.productId}');
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_isWishlisted ? 'Added to wishlist' : 'Removed from wishlist'),
          backgroundColor: AppTheme.primaryGreen,
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 1),
        ));
      }
    } catch (_) {
      setState(() => _isWishlisted = previous);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not update wishlist'), backgroundColor: AppTheme.error));
      }
    } finally {
      if (mounted) setState(() => _wishlistBusy = false);
    }
  }

  void _addToCart({bool checkout = false}) {
    final product = _product!;
    final name = product['name'] as String? ?? 'Product';
    final price = (product['price'] as num?)?.toDouble() ?? 0;
    final images = product['images'] as List<dynamic>? ?? [];
    final image = images.isNotEmpty && images.first is String ? images.first as String : product['image'] as String? ?? '';

    CartService.instance.addItem(CartItem(id: widget.productId, name: name, price: price, image: image, quantity: _quantity));
    if (checkout) {
      context.push('/customer/checkout');
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$_quantity x $name added to cart'),
        backgroundColor: AppTheme.primaryGreen,
        behavior: SnackBarBehavior.floating,
        action: SnackBarAction(label: 'View Cart', textColor: Colors.white, onPressed: () => context.push('/customer/cart')),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Scaffold(body: _ProductDetailSkeleton());
    final product = _product;
    if (product == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Product')),
        body: const Center(child: Text('Product not found')),
      );
    }

    final price = (product['price'] as num?)?.toDouble();
    final mrp = (product['mrp'] as num?)?.toDouble();
    final unit = product['unit'] as String? ?? 'kg';
    final rating = (product['rating'] as num?)?.toDouble() ?? 0;
    final reviewCount = (product['reviews'] as List<dynamic>?)?.length ?? 0;
    final isOrganic = product['isOrganic'] == true;
    final isFresh = product['isFresh'] == true;
    final hasDiscount = mrp != null && price != null && mrp > price;
    final farmerName = _farmerName(product);
    final description = product['description'] as String? ?? 'No description available';

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 280,
            pinned: true,
            backgroundColor: AppTheme.surface,
            foregroundColor: AppTheme.textPrimary,
            surfaceTintColor: Colors.transparent,
            actions: [
              IconButton(
                icon: Icon(_isWishlisted ? Icons.favorite : Icons.favorite_border, color: _isWishlisted ? AppTheme.error : null),
                onPressed: _toggleWishlist,
                tooltip: _isWishlisted ? 'Remove from wishlist' : 'Add to wishlist',
              ),
            ],
            flexibleSpace: FlexibleSpaceBar(background: _buildImageGallery()),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildImageDots(),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      if (isOrganic) const _InfoBadge(label: 'Organic', color: AppTheme.success, icon: Icons.eco),
                      if (isFresh) ...[
                        const SizedBox(width: 6),
                        const _InfoBadge(label: 'Fresh', color: AppTheme.info, icon: Icons.local_florist),
                      ],
                      if (hasDiscount) ...[
                        const SizedBox(width: 6),
                        _InfoBadge(label: '${((mrp - price) / mrp * 100).round()}% OFF', color: AppTheme.error, icon: Icons.percent),
                      ],
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    product['name'] as String? ?? '',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppTheme.textPrimary, height: 1.2),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.person_outline, size: 16, color: AppTheme.textSecondary),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(farmerName, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                      if (rating > 0) ...[
                        const SizedBox(width: 8),
                        const Icon(Icons.star, size: 18, color: AppTheme.accent),
                        const SizedBox(width: 4),
                        Text(rating.toStringAsFixed(1), style: const TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(width: 4),
                        Text('($reviewCount)', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                      ],
                    ],
                  ),
                  const SizedBox(height: 18),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        price != null ? 'Rs ${price == price.roundToDouble() ? price.toInt().toString() : price.toStringAsFixed(2)}' : '—',
                        style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: AppTheme.primaryGreen),
                      ),
                      if (unit.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(left: 4, bottom: 4),
                          child: Text('/$unit', style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary)),
                        ),
                      if (hasDiscount)
                        Padding(
                          padding: const EdgeInsets.only(left: 10, bottom: 4),
                          child: Text('Rs ${mrp.toStringAsFixed(0)}', style: const TextStyle(fontSize: 15, color: AppTheme.textTertiary, decoration: TextDecoration.lineThrough)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const _SectionTitle('Description'),
                  const SizedBox(height: 6),
                  Text(description, style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary, height: 1.55)),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      const _SectionTitle('Quantity'),
                      const Spacer(),
                      _QuantityStepper(value: _quantity, onChanged: (v) => setState(() => _quantity = v)),
                    ],
                  ),
                  const SizedBox(height: 80),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
          color: AppTheme.surface,
          boxShadow: AppTheme.cardShadow,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
        ),
        child: SafeArea(
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${_quantity} × ${price != null ? 'Rs $price' : '—'}', style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                    Text('Rs ${(price ?? 0) * _quantity}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: AppTheme.primaryGreen)),
                  ],
                ),
              ),
              Expanded(
                child: ElevatedButton(
                  onPressed: () => _addToCart(),
                  style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                  child: const Text('Add to Cart'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _addToCart(checkout: true),
                  style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                  child: const Text('Buy Now'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _farmerName(Map<String, dynamic> product) {
    final farmer = product['farmer'];
    if (farmer is Map) {
      final name = farmer['name'];
      if (name is String && name.trim().isNotEmpty) return name;
      final farm = farmer['farmName'];
      if (farm is String && farm.trim().isNotEmpty) return farm;
    }
    final farmerName = product['farmerName'];
    if (farmerName is String && farmerName.trim().isNotEmpty) return farmerName;
    return 'Local Farmer';
  }

  Widget _buildImageGallery() {
    final images = _product!['images'] as List<dynamic>? ?? [];
    final singleImage = _product!['image'] as String?;

    Widget image(String url) => Image.network(
          url,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => Center(
            child: Icon(Icons.image, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.3)),
          ),
        );

    if (images.isNotEmpty) {
      return PageView.builder(
        itemCount: images.length,
        onPageChanged: (i) => setState(() => _currentImageIndex = i),
        itemBuilder: (_, i) => Container(color: AppTheme.background, child: image(images[i] as String)),
      );
    }
    return Container(
      color: AppTheme.background,
      child: singleImage != null && singleImage.isNotEmpty
          ? image(singleImage)
          : Center(child: Icon(Icons.image, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.3))),
    );
  }

  Widget _buildImageDots() {
    final images = _product!['images'] as List<dynamic>? ?? [];
    if (images.length <= 1) return const SizedBox.shrink();
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(images.length, (i) => AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        margin: const EdgeInsets.symmetric(horizontal: 3),
        width: _currentImageIndex == i ? 20 : 8,
        height: 8,
        decoration: BoxDecoration(color: _currentImageIndex == i ? AppTheme.primaryGreen : AppTheme.border, borderRadius: BorderRadius.circular(4)),
      )),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;
  const _SectionTitle(this.title);

  @override
  Widget build(BuildContext context) {
    return Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppTheme.textPrimary));
  }
}

class _InfoBadge extends StatelessWidget {
  final String label;
  final Color color;
  final IconData icon;
  const _InfoBadge({required this.label, required this.color, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(50),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
        ],
      ),
    );
  }
}

class _QuantityStepper extends StatelessWidget {
  final int value;
  final ValueChanged<int> onChanged;
  const _QuantityStepper({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(border: Border.all(color: AppTheme.border), borderRadius: BorderRadius.circular(12)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: () {
              if (value > 1) onChanged(value - 1);
            },
            borderRadius: BorderRadius.circular(10),
            child: const Padding(padding: EdgeInsets.all(10), child: Icon(Icons.remove, size: 20, color: AppTheme.primaryGreen)),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: const BoxDecoration(color: AppTheme.primarySoft),
            child: Text('$value', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          ),
          InkWell(
            onTap: () {
              if (value < 99) onChanged(value + 1);
            },
            borderRadius: BorderRadius.circular(10),
            child: const Padding(padding: EdgeInsets.all(10), child: Icon(Icons.add, size: 20, color: AppTheme.primaryGreen)),
          ),
        ],
      ),
    );
  }
}

class _ProductDetailSkeleton extends StatelessWidget {
  const _ProductDetailSkeleton();

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        SliverAppBar(
          expandedHeight: 280,
          pinned: true,
          backgroundColor: AppTheme.surface,
          surfaceTintColor: Colors.transparent,
          flexibleSpace: const FlexibleSpaceBar(background: SkeletonBox(width: double.infinity, height: double.infinity, radius: 0)),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                SkeletonBox(width: 100, height: 22),
                SizedBox(height: 14),
                SkeletonBox(width: 220, height: 18),
                SizedBox(height: 8),
                SkeletonBox(width: 140, height: 12),
                SizedBox(height: 18),
                SkeletonBox(width: 120, height: 26),
                SizedBox(height: 24),
                SkeletonBox(width: 90, height: 16),
                SizedBox(height: 8),
                SkeletonBox(width: double.infinity, height: 60),
              ],
            ),
          ),
        ),
      ],
    );
  }
}