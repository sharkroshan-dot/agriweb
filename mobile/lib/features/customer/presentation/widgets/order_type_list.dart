import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';

class OrderTypeList extends StatefulWidget {
  final bool isPickup;
  const OrderTypeList({super.key, required this.isPickup});

  @override
  State<OrderTypeList> createState() => _OrderTypeListState();
}

class _OrderTypeListState extends State<OrderTypeList> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _allOrders = [];
  Set<String> _ratedOrderIds = {};
  String _tab = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/orders', params: {'limit': '100'});
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ??
          (res['data'] as Map<String, dynamic>?)?['orders'] as List<dynamic>? ??
          (res['orders'] as List<dynamic>?) ??
          (res is List ? res : null) ??
          [];
      setState(() => _allOrders = data.cast<Map<String, dynamic>>());
    } catch (_) {
      if (mounted) setState(() => _allOrders = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
    _loadRated();
  }

  Future<void> _loadRated() async {
    try {
      final res = await ApiService.get('/delivery-ratings/me', params: {'limit': '100'});
      if (!mounted) return;
      final data = (res['data'] as Map<String, dynamic>?)?['ratings'] as List<dynamic>? ?? [];
      setState(() {
        _ratedOrderIds = data.map((r) {
          final m = r is Map ? r as Map<String, dynamic> : <String, dynamic>{};
          return (m['orderId'] as String? ?? '').toString();
        }).toSet();
      });
    } catch (_) {}
  }

  bool get _isPickup => widget.isPickup;

  List<Map<String, dynamic>> get _typeOrders {
    return _allOrders.where((o) {
      final type = ((o['deliveryType'] as String?) ?? (o['type'] as String?) ?? 'delivery').toLowerCase();
      return (type == 'pickup') == _isPickup;
    }).toList();
  }

  List<Map<String, dynamic>> get _filtered {
    if (_tab == 'active') {
      return _typeOrders.where((o) {
        final s = _statusOf(o);
        return !['delivered', 'cancelled', 'picked_up', 'refunded'].contains(s);
      }).toList();
    }
    if (_tab == 'delivered') {
      return _typeOrders.where((o) {
        final s = _statusOf(o);
        return s == 'delivered' || s == 'picked_up';
      }).toList();
    }
    return _typeOrders;
  }

  String _statusOf(Map<String, dynamic> o) =>
      ((o['orderStatus'] as String?) ?? (o['status'] as String?) ?? 'pending').toLowerCase();

  String _orderNumber(Map<String, dynamic> o) =>
      o['orderNumber'] as String? ?? o['_id'] as String? ?? o['id'] as String? ?? 'Order';

  double _total(Map<String, dynamic> o) => (o['totalAmount'] as num?)?.toDouble() ?? 0;

  Color _statusColor(String status) {
    switch (status) {
      case 'pending': return AppTheme.accent;
      case 'confirmed': return const Color(0xFF3B82F6);
      case 'processing': return const Color(0xFF8B5CF6);
      case 'ready_for_delivery':
      case 'ready_for_pickup': return const Color(0xFF6366F1);
      case 'dispatched': return const Color(0xFF8B5CF6);
      case 'in_transit': return const Color(0xFF3B82F6);
      case 'delivered':
      case 'picked_up': return AppTheme.success;
      case 'cancelled':
      case 'refunded': return AppTheme.error;
      default: return AppTheme.textSecondary;
    }
  }

  void _addToCart(Map<String, dynamic> order) {
    final items = (order['items'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    final reorderable = items.where((i) => (i['productId'] as String? ?? i['product_id'] as String? ?? '') != '').toList();
    if (reorderable.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('This order has no items to reorder'),
        backgroundColor: AppTheme.error,
      ));
      return;
    }
    for (final item in reorderable) {
      final id = item['productId'] as String? ?? item['product_id'] as String? ?? '';
      context.push('/customer/product/$id');
    }
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('${reorderable.length} item(s) ready to reorder'),
      backgroundColor: AppTheme.success,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isPickup ? 'Farm Pickup' : 'Deliveries'),
      ),
      body: Column(
        children: [
          Container(
            margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border),
            ),
            child: Row(
              children: [
                _tabBtn('all', 'All'),
                _tabBtn('active', 'Active'),
                _tabBtn('delivered', 'Completed'),
                const Spacer(),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Text(
                    '${_typeOrders.length} ${_isPickup ? 'pickups' : 'deliveries'}',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: AppTheme.textSecondary),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: _isLoading
              ? const Center(child: CircularProgressIndicator())
              : _filtered.isEmpty
                ? _emptyState()
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (_, i) => _orderCard(_filtered[i]),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _tabBtn(String key, String label) {
    final selected = _tab == key;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _tab = key),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? AppTheme.primaryGreen : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: selected ? Colors.white : AppTheme.textSecondary,
            ),
          ),
        ),
      ),
    );
  }

  Widget _emptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            _isPickup ? Icons.store_outlined : Icons.local_shipping_outlined,
            size: 80,
            color: AppTheme.textSecondary.withValues(alpha: 0.4),
          ),
          const SizedBox(height: 16),
          Text(
            _isPickup ? 'No farm pickup orders' : 'No deliveries yet',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: () => context.push('/customer/nearby'), child: const Text('Browse Products')),
        ],
      ),
    );
  }

  Widget _orderCard(Map<String, dynamic> order) {
    final id = order['_id'] as String? ?? order['id'] as String? ?? '';
    final status = _statusOf(order);
    final rated = _ratedOrderIds.contains(id);
    return GestureDetector(
      onTap: () => context.push('/customer/orders/$id'),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 1))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(
                      _isPickup ? Icons.store : Icons.local_shipping,
                      size: 18,
                      color: _isPickup ? AppTheme.accent : AppTheme.primaryGreen,
                    ),
                    const SizedBox(width: 8),
                    Text('Order ${_orderNumber(order).length > 8 ? _orderNumber(order).substring(_orderNumber(order).length - 8) : _orderNumber(order)}',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: _statusColor(status).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(status.replaceAll('_', ' '), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _statusColor(status))),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('${(order['items'] as List<dynamic>?)?.length ?? 0} item(s)',
                style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('$kPriceSymbol${_total(order).toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                Text(shortDate(order['createdAt'] ?? order['orderDate']), style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
            if (status == 'delivered') ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _addToCart(order),
                      icon: const Icon(Icons.replay, size: 16),
                      label: const Text('Buy Again'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 40),
                        side: const BorderSide(color: AppTheme.primaryGreen),
                        foregroundColor: AppTheme.primaryGreen,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (rated)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppTheme.success.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.check_circle, size: 16, color: AppTheme.success),
                          SizedBox(width: 4),
                          Text('Rated', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.success)),
                        ],
                      ),
                    )
                  else
                    OutlinedButton.icon(
                      onPressed: () => context.push('/customer/orders/$id'),
                      icon: const Icon(Icons.star_outline, size: 16, color: Color(0xFFF59E0B)),
                      label: const Text('Rate Delivery'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 40),
                        side: const BorderSide(color: Color(0xFFF59E0B)),
                        foregroundColor: const Color(0xFFB45309),
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}