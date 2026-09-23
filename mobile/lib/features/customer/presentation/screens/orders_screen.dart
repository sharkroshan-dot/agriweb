import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/empty_state.dart';
import '../../../../shared/widgets/skeleton.dart';
import '../../../../shared/widgets/status_chip.dart';
import 'refund_details_screen.dart' show refundStatusMeta;

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});
  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _orders = [];
  Set<String> _ratedOrderIds = {};

  bool _loadingRefunds = true;
  List<Map<String, dynamic>> _refunds = [];

  @override
  void initState() {
    super.initState();
    _loadOrders();
    _loadRefunds();
  }

  Future<void> _loadRefunds() async {
    setState(() => _loadingRefunds = true);
    try {
      final res = await ApiService.get('/customers/me/refunds');
      if (!mounted) return;
      final data = (res['data'] as List<dynamic>? ?? []);
      setState(() => _refunds = data.whereType<Map<String, dynamic>>().toList());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingRefunds = false);
    }
  }

  Future<void> _loadOrders() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/orders');
      if (!mounted) return;
      final data = ApiService.asList(res);
      setState(() => _orders = data.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
    _loadRatedOrders();
  }

  Future<void> _loadRatedOrders() async {
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

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My Orders'),
          bottom: TabBar(
            tabs: const [
              Tab(text: 'Orders'),
              Tab(text: 'Refunds & Returns'),
            ],
            labelColor: AppTheme.primaryGreen,
            unselectedLabelColor: AppTheme.textSecondary,
            indicatorColor: AppTheme.primaryGreen,
          ),
        ),
        body: TabBarView(
          children: [
            _buildOrdersTab(),
            _buildRefundsTab(),
          ],
        ),
      ),
    );
  }

  Widget _buildOrdersTab() {
    return RefreshIndicator(
      onRefresh: _loadOrders,
      child: _isLoading
          ? const PageSkeleton(items: 5)
          : _orders.isEmpty
              ? EmptyState(
                  icon: Icons.receipt_long_outlined,
                  title: 'No orders yet',
                  message: 'Your placed orders will show up here. Start shopping for fresh farm produce!',
                  actionLabel: 'Start Shopping',
                  onAction: () => context.go('/customer/home'),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _orders.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final order = _orders[i];
                    return _OrderCard(order: order, rated: _ratedOrderIds.contains(order['_id'] as String? ?? ''));
                  },
                ),
    );
  }

  Widget _buildRefundsTab() {
    return RefreshIndicator(
      onRefresh: _loadRefunds,
      child: _loadingRefunds
          ? const PageSkeleton(items: 4)
          : _refunds.isEmpty
              ? EmptyState(
                  icon: Icons.replay_circle_filled_outlined,
                  title: 'No refunds yet',
                  message: 'Cancellation and problem refunds appear here.',
                  actionLabel: 'View All',
                  onAction: () => context.push('/customer/refunds'),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _refunds.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final refund = _refunds[i];
                    return _RefundCard(refund: refund);
                  },
                ),
    );
  }
}

class _RefundCard extends StatelessWidget {
  final Map<String, dynamic> refund;
  const _RefundCard({required this.refund});

  double get _amount =>
      (refund['approvedAmount'] as num?)?.toDouble() ??
      (refund['requestedAmount'] as num?)?.toDouble() ??
      0;

  String _date(dynamic value) {
    if (value == null) return '';
    try {
      final dt = DateTime.parse(value.toString()).toLocal();
      return DateFormat('dd MMM yyyy').format(dt);
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = (refund['status'] as String? ?? 'requested').toLowerCase();
    final meta = refundStatusMeta(status);
    final refundId = refund['refundId'] as String? ?? 'Refund';
    final orderNumber = refund['orderNumber'] as String?;
    final amount = _amount;
    final date = _date(refund['requestedAt'] ?? refund['createdAt']);

    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => context.push('/customer/refunds/${refund['id'] ?? refund['_id']}'),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border.withValues(alpha: 0.7)),
          boxShadow: AppTheme.cardShadow,
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: meta.color.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                status == 'rejected'
                    ? Icons.cancel_outlined
                    : status == 'refunded'
                        ? Icons.check_circle_outline
                        : Icons.replay_circle_filled_outlined,
                color: meta.color,
                size: 22,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$refundId', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  if (orderNumber != null)
                    Text('Order ${orderNumber}', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  Text('$kPriceSymbol${amount.toStringAsFixed(2)}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.success)),
                  if (date.isNotEmpty)
                    Text(date, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                ],
              ),
            ),
            StatusChip(status: meta.label, color: meta.color),
          ],
        ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  final Map<String, dynamic> order;
  final bool rated;
  const _OrderCard({required this.order, required this.rated});

  @override
  Widget build(BuildContext context) {
    final id = order['_id'] as String? ?? '';
    final status = (order['orderStatus'] as String? ?? order['status'] as String? ?? 'pending').toLowerCase();
    final total = (order['totalAmount'] as num?)?.toDouble() ?? 0;
    final items = order['items'] as List<dynamic>? ?? [];
    final createdAt = order['createdAt'] as String? ?? '';
    final isDelivered = status == 'delivered' || status == 'picked_up';

    return GestureDetector(
      onTap: () => context.push('/customer/orders/$id'),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border.withValues(alpha: 0.7)),
          boxShadow: AppTheme.cardShadow,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Order ${id.length >= 8 ? '#${id.substring(0, 8).toUpperCase()}' : 'Details'}',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                ),
                StatusChip(status: status),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('$items item${items == 1 ? '' : 's'}', style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                _PaymentChip(method: order['paymentMethod'] as String?),
              ],
            ),
            if (isDelivered) ...[
              const SizedBox(height: 8),
              InkWell(
                onTap: () => context.push('/customer/orders/$id'),
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: rated ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.warning.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(rated ? Icons.check_circle : Icons.star_border, size: 14, color: rated ? AppTheme.success : AppTheme.warning),
                      const SizedBox(width: 4),
                      Text(
                        rated ? 'Rated' : 'Rate Delivery Partner',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: rated ? AppTheme.success : AppTheme.warning,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Rs ${total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppTheme.primaryGreen)),
                Text(_formatDate(createdAt), style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _formatDate(String createdAt) {
    try {
      final date = DateTime.parse(createdAt);
      return DateFormat('dd MMM yyyy, hh:mm a').format(date);
    } catch (_) {
      return createdAt;
    }
  }
}

class _PaymentChip extends StatelessWidget {
  final String? method;
  const _PaymentChip({this.method});

  @override
  Widget build(BuildContext context) {
    final m = (method ?? '').toLowerCase();
    final cod = m == 'cash' || m == 'cod' || m == 'cash_on_delivery';
    final label = cod ? 'COD' : (m.isEmpty ? '' : 'Online');
    if (label.isEmpty) return const SizedBox.shrink();
    final color = cod ? AppTheme.accent : AppTheme.info;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color)),
    );
  }
}