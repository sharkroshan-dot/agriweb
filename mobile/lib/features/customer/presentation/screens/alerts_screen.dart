import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});
  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  bool _isLoading = true;
  bool _isError = false;
  List<Map<String, dynamic>> _alerts = [];
  String? _removingId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _isError = false; });
    try {
      final res = await ApiService.get('/customers/me/alerts');
      if (!mounted) return;
      setState(() {
        _alerts = ApiService.asList(res).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _isError = true);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _removeAlert(String alertId) async {
    setState(() => _removingId = alertId);
    try {
      await ApiService.delete('/customers/me/alerts/$alertId');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Alert removed'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString()),
        backgroundColor: AppTheme.error,
      ));
    } finally {
      if (mounted) setState(() => _removingId = null);
    }
  }

  String _alertTypeLabel(String type) {
    switch (type) {
      case 'back_in_stock':
        return 'Back in stock';
      case 'price_drop':
        return 'Price drop';
      default:
        return type;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Product Alerts'),
        actions: [
          IconButton(
            icon: const Icon(Icons.shopping_bag_outlined),
            tooltip: 'Browse products',
            onPressed: () => context.push('/customer/nearby'),
          ),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _isError
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, size: 56, color: AppTheme.error),
                  const SizedBox(height: 12),
                  const Text('Unable to load alerts'),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            )
          : _alerts.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.notifications_off_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                    const SizedBox(height: 16),
                    Text('No alerts active yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                    const SizedBox(height: 8),
                    Text('Set back-in-stock or price-drop alerts on product pages', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary), textAlign: TextAlign.center),
                    const SizedBox(height: 24),
                    ElevatedButton(onPressed: () => context.push('/customer/nearby'), child: const Text('Browse Products')),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _alerts.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final alert = _alerts[i];
                    final id = alert['id'] as String? ?? alert['_id'] as String? ?? '';
                    final productId = alert['productId'] as String? ?? '';
                    final name = alert['productName'] as String? ?? 'Product';
                    final type = alert['alertType'] as String? ?? '';
                    final targetPrice = (alert['targetPrice'] as num?)?.toDouble();
                    final price = (alert['price'] as num?)?.toDouble() ?? (alert['priceAtSubscribe'] as num?)?.toDouble() ?? 0;
                    final image = alert['productImage'] as String? ?? productImage(alert);
                    return Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppTheme.border),
                      ),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: image != null && image.isNotEmpty
                              ? Image.network(image, width: 60, height: 60, fit: BoxFit.cover, errorBuilder: (_, __, ___) => _imagePlaceholder())
                              : _imagePlaceholder(),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                GestureDetector(
                                  onTap: productId.isNotEmpty ? () => context.push('/customer/product/$productId') : null,
                                  child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                ),
                                const SizedBox(height: 4),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 4,
                                  children: [
                                    _tag(_alertTypeLabel(type)),
                                    if (type == 'price_drop' && targetPrice != null)
                                      _tag('Target: $kPriceSymbol${targetPrice.toStringAsFixed(0)}'),
                                    _tag('Created ${shortDate(alert['createdAt'])}'),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Text('Current price: $kPriceSymbol${price.toStringAsFixed(0)}',
                                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: _removingId == id
                              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.delete_outline, color: AppTheme.error),
                            onPressed: _removingId == null ? () => _removeAlert(id) : null,
                            tooltip: 'Remove',
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
    );
  }

  Widget _imagePlaceholder() {
    return Container(
      width: 60,
      height: 60,
      color: AppTheme.background,
      child: const Icon(Icons.image, color: AppTheme.textSecondary),
    );
  }

  Widget _tag(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppTheme.primaryGreen.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(text, style: const TextStyle(fontSize: 10, color: AppTheme.primaryGreen, fontWeight: FontWeight.w500)),
    );
  }
}