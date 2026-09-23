import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerProductsScreen extends StatefulWidget {
  const FarmerProductsScreen({super.key});
  @override
  State<FarmerProductsScreen> createState() => _FarmerProductsScreenState();
}

class _FarmerProductsScreenState extends State<FarmerProductsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _products = [];

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  Future<void> _loadProducts() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/products');
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() => _products = data.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _deleteProduct(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Product'),
        content: const Text('Are you sure? This action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error), child: const Text('Delete')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await ApiService.delete('/products/$id');
      if (!mounted) return;
      setState(() => _products.removeWhere((p) => p['_id'] == id));
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Product deleted'), backgroundColor: AppTheme.success));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to delete'), backgroundColor: AppTheme.error));
    }
  }

  Future<void> _toggleAvailability(Map<String, dynamic> product) async {
    final id = product['_id'] as String;
    final current = product['isAvailable'] as bool? ?? true;
    try {
      await ApiService.put('/products/$id', body: {'isAvailable': !current});
      if (!mounted) return;
      _loadProducts();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to update'), backgroundColor: AppTheme.error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Products'),
        actions: [
          IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: () => context.push('/farmer/products/add')),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _products.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.inventory_2_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                    const SizedBox(height: 16),
                    Text('No products yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                    const SizedBox(height: 8),
                    Text('Add your first product to start selling', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                    const SizedBox(height: 24),
                    ElevatedButton.icon(
                      onPressed: () => context.push('/farmer/products/add'),
                      icon: const Icon(Icons.add),
                      label: const Text('Add Product'),
                    ),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _loadProducts,
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _products.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final product = _products[i];
                    final id = product['_id'] as String? ?? '';
                    final name = product['name'] as String? ?? 'Product';
                    final price = (product['price'] as num?)?.toDouble() ?? 0;
                    final unit = product['unit'] as String? ?? 'kg';
                    final quantity = (product['quantity'] as num?)?.toDouble() ?? 0;
                    final isAvailable = product['isAvailable'] as bool? ?? true;
                    final image = product['images'] is List && (product['images'] as List).isNotEmpty
                        ? (product['images'] as List).first as String? : product['image'] as String?;

                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 1))],
                      ),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: Container(width: 72, height: 72, color: AppTheme.background,
                              child: image != null && image.isNotEmpty
                                ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Icon(Icons.image, color: AppTheme.textSecondary.withValues(alpha: 0.4)))
                                : Icon(Icons.image, color: AppTheme.textSecondary.withValues(alpha: 0.4))),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
                                const SizedBox(height: 4),
                                Row(
                                  children: [
                                    Text('Rs $price/$unit', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                                    const SizedBox(width: 12),
                                    Text('Stock: $quantity $unit', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: isAvailable ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.error.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(isAvailable ? 'Available' : 'Unavailable', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: isAvailable ? AppTheme.success : AppTheme.error)),
                                    ),
                                    const Spacer(),
                                    IconButton(
                                      icon: const Icon(Icons.edit_outlined, size: 18),
                                      onPressed: () => context.push('/farmer/products/add', extra: product),
                                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                                      padding: EdgeInsets.zero,
                                    ),
                                    IconButton(
                                      icon: const Icon(Icons.delete_outline, size: 18, color: AppTheme.error),
                                      onPressed: () => _deleteProduct(id),
                                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                                      padding: EdgeInsets.zero,
                                    ),
                                    Switch(
                                      value: isAvailable,
                                      onChanged: (_) => _toggleAvailability(product),
                                      activeColor: AppTheme.primaryGreen,
                                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
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
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/farmer/products/add'),
        backgroundColor: AppTheme.primaryGreen,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
}
