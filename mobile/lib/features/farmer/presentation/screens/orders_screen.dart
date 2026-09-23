import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import 'package:intl/intl.dart';

class FarmerOrdersScreen extends StatefulWidget {
  const FarmerOrdersScreen({super.key});
  @override
  State<FarmerOrdersScreen> createState() => _FarmerOrdersScreenState();
}

class _FarmerOrdersScreenState extends State<FarmerOrdersScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _orders = [];
  String _statusFilter = 'all';

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    setState(() => _isLoading = true);
    try {
      final params = <String, String>{};
      if (_statusFilter != 'all') params['status'] = _statusFilter;
      final res = await ApiService.get('/farmers/me/orders', params: params);
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() => _orders = data.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _updateStatus(String orderId, String status) async {
    try {
      await ApiService.put('/orders/$orderId/status', body: {'status': status});
      if (!mounted) return;
      _loadOrders();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Order ${status[0].toUpperCase() + status.substring(1)}'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to update'), backgroundColor: AppTheme.error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Farmer Orders'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: ['all', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map((s) {
                  final isActive = _statusFilter == s;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text(s[0].toUpperCase() + s.substring(1), style: TextStyle(fontSize: 12, color: isActive ? Colors.white : AppTheme.textPrimary)),
                      selected: isActive,
                      selectedColor: AppTheme.primaryGreen,
                      onSelected: (_) { setState(() => _statusFilter = s); _loadOrders(); },
                      checkmarkColor: Colors.white,
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
        ),
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _orders.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.receipt_long_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                    const SizedBox(height: 16),
                    Text('No orders found', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _loadOrders,
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _orders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final order = _orders[i];
                    final id = order['_id'] as String? ?? '';
                    final status = order['status'] as String? ?? 'pending';
                    final paymentStatus = (order['paymentStatus'] as String? ?? '').toLowerCase();
                    final isRefunded = paymentStatus == 'refunded' || paymentStatus == 'partially_refunded';
                    final total = (order['totalAmount'] as num?)?.toDouble() ?? 0;
                    final items = order['items'] as List<dynamic>? ?? [];
                    final createdAt = order['createdAt'] as String? ?? '';
                    String date = '';
                    try { date = DateFormat('dd MMM yyyy').format(DateTime.parse(createdAt)); } catch (_) { date = createdAt; }

                    return Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Order #${id.substring(0, 8).toUpperCase()}', style: const TextStyle(fontWeight: FontWeight.w600)),
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (isRefunded) ...[
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(color: AppTheme.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                                      child: const Text('REFUNDED', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.success)),
                                    ),
                                    const SizedBox(width: 6),
                                  ],
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                    decoration: BoxDecoration(color: _statusColor(status).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                                    child: Text(status[0].toUpperCase() + status.substring(1), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _statusColor(status))),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('$items items', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                              _paymentChip(order['paymentMethod'] as String?),
                            ],
                          ),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Rs ${total.toStringAsFixed(2)}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.primaryGreen)),
                              Text(date, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                            ],
                          ),
                          if (status != 'delivered' && status != 'cancelled') ...[
                            const Divider(height: 20),
                            _buildActionButtons(id, status),
                          ],
                        ],
                      ),
                    );
                  },
                ),
              ),
    );
  }

  Widget _buildActionButtons(String orderId, String status) {
    final List<Map<String, dynamic>> actions = [];
    switch (status) {
      case 'pending':
        actions.add({'label': 'Accept', 'status': 'confirmed', 'color': AppTheme.primaryGreen});
        actions.add({'label': 'Reject', 'status': 'cancelled', 'color': AppTheme.error});
        break;
      case 'confirmed':
        actions.add({'label': 'Mark Shipped', 'status': 'shipped', 'color': const Color(0xFF3B82F6)});
        break;
      case 'shipped':
        actions.add({'label': 'Mark Delivered', 'status': 'delivered', 'color': AppTheme.success});
        break;
    }

    return Row(
      children: actions.map((a) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: SizedBox(
            height: 36,
            child: ElevatedButton(
              onPressed: () => _updateStatus(orderId, a['status'] as String),
              style: ElevatedButton.styleFrom(
                backgroundColor: a['color'] as Color,
                foregroundColor: Colors.white,
                minimumSize: Size.zero,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: Text(a['label'] as String, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ),
          ),
        ),
      )).toList(),
    );
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'pending': return AppTheme.accent;
      case 'confirmed': return AppTheme.primaryGreen;
      case 'shipped': return const Color(0xFF3B82F6);
      case 'delivered': return AppTheme.success;
      case 'cancelled': return AppTheme.error;
      default: return AppTheme.textSecondary;
    }
  }

  Widget _paymentChip(String? paymentMethod) {
    final m = (paymentMethod ?? '').toLowerCase();
    final cod = m == 'cash' || m == 'cod' || m == 'cash_on_delivery';
    final label = cod ? 'COD' : (m.isEmpty ? '' : 'Online');
    if (label.isEmpty) return const SizedBox.shrink();
    final color = cod ? AppTheme.accent : const Color(0xFF3B82F6);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color)),
    );
  }
}
