import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/widgets/status_chip.dart';

/// Combined "Bulk & B2B Orders" screen for the farmer.
///
/// Mirrors the web portal's `/farmer/bulk-orders` page: a Bulk / B2B switcher
/// plus All / Active / Completed / Cancelled filters (with counts) over the
/// orders the farmer won through accepted offers.
class BulkB2BOrdersScreen extends StatefulWidget {
  const BulkB2BOrdersScreen({super.key});

  @override
  State<BulkB2BOrdersScreen> createState() => _BulkB2BOrdersScreenState();
}

class _BulkB2BOrdersScreenState extends State<BulkB2BOrdersScreen> {
  static const _bulkFlow = [
    'confirmed', 'preparing', 'quality_check', 'picked_up', 'dispatched', 'out_for_delivery', 'delivered',
  ];
  static const _b2bFlow = [
    'confirmed', 'preparing', 'quality_check', 'dispatched', 'in_transit', 'delivered', 'completed',
  ];

  bool _isLoading = true;
  List<Map<String, dynamic>> _bulkOrders = [];
  List<Map<String, dynamic>> _b2bOrders = [];
  String _section = 'bulk';
  String _filter = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        ApiService.get('/bulk-orders/orders'),
        ApiService.get('/b2b/orders'),
      ]);
      if (!mounted) return;
      setState(() {
        _bulkOrders = _listOf(results[0], key: 'orders');
        _b2bOrders = _listOf(results[1], key: 'orders');
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _bulkOrders = [];
        _b2bOrders = [];
      });
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<Map<String, dynamic>> _listOf(dynamic res, {required String key}) {
    final data = res is Map ? res['data'] : null;
    if (data is Map) {
      final v = data[key];
      if (v is List) return v.cast<Map<String, dynamic>>();
    }
    if (data is List) return data.cast<Map<String, dynamic>>();
    return [];
  }

  // -------------------------------------------------------------------------
  // Filtering helpers
  // -------------------------------------------------------------------------

  bool _isBulkActive(String status) => !['delivered', 'cancelled'].contains(status);

  bool _isB2bActive(String status) =>
      ['confirmed', 'preparing', 'quality_check', 'dispatched', 'in_transit', 'delivered'].contains(status);

  List<Map<String, dynamic>> get _visibleBulk {
    switch (_filter) {
      case 'active':
        return _bulkOrders.where((o) => _isBulkActive(_statusOf(o))).toList();
      case 'completed':
        return _bulkOrders.where((o) => _statusOf(o) == 'delivered').toList();
      case 'cancelled':
        return _bulkOrders.where((o) => _statusOf(o) == 'cancelled').toList();
      default:
        return _bulkOrders;
    }
  }

  List<Map<String, dynamic>> get _visibleB2b {
    switch (_filter) {
      case 'active':
        return _b2bOrders.where((o) => _isB2bActive(_statusOf(o))).toList();
      case 'completed':
        return _b2bOrders.where((o) => _statusOf(o) == 'completed').toList();
      case 'cancelled':
        return _b2bOrders.where((o) => _statusOf(o) == 'cancelled').toList();
      default:
        return _b2bOrders;
    }
  }

  int get _bulkCountFor {
    switch (_filter) {
      case 'active':
        return _bulkOrders.where((o) => _isBulkActive(_statusOf(o))).length;
      case 'completed':
        return _bulkOrders.where((o) => _statusOf(o) == 'delivered').length;
      case 'cancelled':
        return _bulkOrders.where((o) => _statusOf(o) == 'cancelled').length;
      default:
        return _bulkOrders.length;
    }
  }

  int get _b2bCountFor {
    switch (_filter) {
      case 'active':
        return _b2bOrders.where((o) => _isB2bActive(_statusOf(o))).length;
      case 'completed':
        return _b2bOrders.where((o) => _statusOf(o) == 'completed').length;
      case 'cancelled':
        return _b2bOrders.where((o) => _statusOf(o) == 'cancelled').length;
      default:
        return _b2bOrders.length;
    }
  }

  int get _totalCount => _section == 'bulk' ? _bulkCountFor : _b2bCountFor;

  String _statusOf(Map<String, dynamic> o) => (o['status'] as String? ?? '').toLowerCase();

  String _fmtDate(dynamic value) {
    if (value == null) return '';
    try {
      return DateFormat('dd MMM yyyy').format(DateTime.parse(value.toString()).toLocal());
    } catch (_) {
      return value.toString();
    }
  }

  double _num(dynamic v) => (v as num?)?.toDouble() ?? 0;

  // -------------------------------------------------------------------------
  // Status updates
  // -------------------------------------------------------------------------

  Future<void> _advanceBulk(Map<String, dynamic> o) async {
    final idx = _bulkFlow.indexOf(_statusOf(o));
    final next = _bulkFlow[math.min(idx + 1, _bulkFlow.length - 1)];
    try {
      await ApiService.put('/bulk-orders/orders/${o['id']}/status', body: {'status': next});
      if (!mounted) return;
      _toast('Bulk order marked ${next.replaceAll('_', ' ')}', AppTheme.success);
      _load();
    } catch (e) {
      if (mounted) _toast(e.toString(), AppTheme.error);
    }
  }

  Future<void> _advanceB2b(Map<String, dynamic> o, {String? override}) async {
    final status = override ?? _statusOf(o);
    if (override != null && override == 'cancelled') {
      try {
        await ApiService.put('/b2b/orders/${o['id']}/status', body: {'status': 'cancelled'});
        if (!mounted) return;
        _toast('B2B order cancelled', AppTheme.success);
        _load();
      } catch (e) {
        if (mounted) _toast(e.toString(), AppTheme.error);
      }
      return;
    }
    final idx = _b2bFlow.indexOf(status);
    final next = _b2bFlow[math.min(idx + 1, _b2bFlow.length - 1)];
    final payload = <String, dynamic>{'status': next};
    if (status == 'quality_check') payload['qualityCheck'] = 'passed';
    try {
      await ApiService.put('/b2b/orders/${o['id']}/status', body: payload);
      if (!mounted) return;
      _toast('Order marked ${next.replaceAll('_', ' ')}', AppTheme.success);
      _load();
    } catch (e) {
      if (mounted) _toast(e.toString(), AppTheme.error);
    }
  }

  void _toast(String msg, Color bg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: bg));
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Bulk & B2B Orders')),
      body: Column(
        children: [
          _buildSectionSwitcher(),
          _buildFilterRow(),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _totalCount == 0
                    ? _emptyState()
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _section == 'bulk' ? _visibleBulk.length : _visibleB2b.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 12),
                          itemBuilder: (_, i) {
                            final o = _section == 'bulk' ? _visibleBulk[i] : _visibleB2b[i];
                            return _section == 'bulk' ? _bulkCard(o) : _b2bCard(o);
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionSwitcher() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          _sectionBtn('bulk', Icons.local_shipping_outlined, 'Bulk Orders', _bulkOrders.length),
          _sectionBtn('b2b', Icons.shopping_bag_outlined, 'B2B Orders', _b2bOrders.length),
        ],
      ),
    );
  }

  Widget _sectionBtn(String key, IconData icon, String label, int count) {
    final selected = _section == key;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() {
          _section = key;
          _filter = '';
        }),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            boxShadow: selected ? AppTheme.cardShadow : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: selected ? AppTheme.primaryGreen : AppTheme.textSecondary),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: selected ? AppTheme.primaryGreen : AppTheme.textSecondary,
                ),
              ),
              if (count > 0) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: selected ? AppTheme.primaryGreen.withValues(alpha: 0.12) : AppTheme.surfaceVariant,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: selected ? AppTheme.primaryGreen : AppTheme.textSecondary,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterRow() {
    final active = _section == 'bulk' ? _bulkCountFor : _b2bCountFor;
    final completed = _section == 'bulk'
        ? _bulkOrders.where((o) => _statusOf(o) == 'delivered').length
        : _b2bOrders.where((o) => _statusOf(o) == 'completed').length;
    final cancelled = _section == 'bulk'
        ? _bulkOrders.where((o) => _statusOf(o) == 'cancelled').length
        : _b2bOrders.where((o) => _statusOf(o) == 'cancelled').length;
    final all = _section == 'bulk' ? _bulkOrders.length : _b2bOrders.length;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          _filterTab('', 'All', all),
          _filterTab('active', 'Active', active),
          _filterTab('completed', 'Completed', completed),
          _filterTab('cancelled', 'Cancelled', cancelled),
        ],
      ),
    );
  }

  Widget _filterTab(String key, String label, int count) {
    final selected = _filter == key;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _filter = key),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color: selected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            boxShadow: selected ? AppTheme.cardShadow : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: selected ? AppTheme.primaryGreen : AppTheme.textSecondary,
                ),
              ),
              const SizedBox(width: 5),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: selected
                      ? AppTheme.accent.withValues(alpha: 0.15)
                      : AppTheme.primaryGreen.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: selected ? AppTheme.accent : AppTheme.primaryGreen,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _emptyState() {
    final icon = _section == 'bulk' ? Icons.local_shipping_outlined : Icons.shopping_bag_outlined;
    final title = _section == 'bulk' ? 'No bulk orders yet' : 'No B2B orders yet';
    final subtitle = _section == 'bulk'
        ? 'Once a buyer accepts your bulk offer, it shows up here.'
        : 'Browse Business RFQs and submit quotes to get orders.';
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
          const SizedBox(height: 16),
          Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary.withValues(alpha: 0.8)),
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Bulk order card
  // -------------------------------------------------------------------------

  Widget _bulkCard(Map<String, dynamic> o) {
    final status = _statusOf(o);
    final items = (o['items'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    final orderedKg = items.fold<double>(0, (s, i) => s + _num(i['quantityKg']));
    final preparedKg = (o['preparedKg'] as num?)?.toDouble();
    final diff = preparedKg != null ? preparedKg - orderedKg : null;
    final canAdvance = !['delivered', 'cancelled'].contains(status);
    final meta = [
      if ((o['purpose'] as String? ?? '').isNotEmpty) o['purpose'] as String,
      if ((o['requestedDeliveryDate'] as String? ?? '').isNotEmpty) _fmtDate(o['requestedDeliveryDate']),
      if ((o['deliveryMethod'] as String? ?? '').isNotEmpty) (o['deliveryMethod'] as String).replaceAll('_', ' '),
    ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)],
      ),
      child: Column(
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
                      color: const Color(0xFF8B5CF6).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.local_shipping, color: Color(0xFF8B5CF6), size: 18),
                  ),
                  const SizedBox(width: 10),
                  Text(o['orderNumber'] as String? ?? 'Order', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                ],
              ),
              StatusChip(status: status.isEmpty ? 'pending' : status),
            ],
          ),
          const SizedBox(height: 10),
          Text(o['buyerName'] as String? ?? 'Buyer', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(
            items.map((i) => '${i['name']} ${_num(i['quantityKg']).toStringAsFixed(0)} kg').join(' • '),
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
          if (meta.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(meta.join(' • '), style: const TextStyle(fontSize: 11, color: AppTheme.textTertiary)),
          ],
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '$kPriceSymbol${_num(o['totalAmount']).toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.primaryGreen),
              ),
              Text(_fmtDate(o['createdAt'] ?? o['startedAt']), style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
            ],
          ),
          if (preparedKg != null) ...[
            const Divider(height: 20),
            Row(
              children: [
                _stat('Ordered', '${orderedKg.toStringAsFixed(0)} kg', AppTheme.textPrimary),
                _stat('Prepared', '${preparedKg.toStringAsFixed(0)} kg', AppTheme.info),
                _stat(
                  'Difference',
                  diff == null ? '—' : '${diff > 0 ? '+' : ''}${diff.toStringAsFixed(0)} kg',
                  diff == null || diff == 0
                      ? AppTheme.textSecondary
                      : diff < 0
                          ? AppTheme.error
                          : AppTheme.warning,
                ),
              ],
            ),
          ],
          if (canAdvance) ...[
            const Divider(height: 20),
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 36,
                    child: ElevatedButton(
                      onPressed: () => _advanceBulk(o),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primaryGreen,
                        foregroundColor: Colors.white,
                        minimumSize: Size.zero,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text('Mark Next Stage', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // B2B order card
  // -------------------------------------------------------------------------

  Widget _b2bCard(Map<String, dynamic> o) {
    final status = _statusOf(o);
    final biz = o['businessInfo'] as Map<String, dynamic>? ?? {};
    final flowIdx = _b2bFlow.indexOf(status);
    final next = flowIdx >= 0 && flowIdx < _b2bFlow.length - 1 ? _b2bFlow[flowIdx + 1] : null;
    final canCancel = status == 'confirmed';
    final details = [
      if ((o['deliveryCity'] as String? ?? '').isNotEmpty) o['deliveryCity'] as String,
      if ((o['deliveryMethod'] as String? ?? '').isNotEmpty) (o['deliveryMethod'] as String).replaceAll('_', ' '),
      if ((o['requiredDate'] as String? ?? '').isNotEmpty) 'required ${_fmtDate(o['requiredDate'])}${(o['deliveryTimeSlot'] as String? ?? '').isNotEmpty ? ' (${o['deliveryTimeSlot']})' : ''}',
    ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)],
      ),
      child: Column(
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
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.shopping_bag, color: AppTheme.primaryGreen, size: 18),
                  ),
                  const SizedBox(width: 10),
                  Text(o['orderNumber'] as String? ?? 'Order', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                ],
              ),
              StatusChip(status: status.isEmpty ? 'confirmed' : status),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            '${o['productName'] ?? 'Product'} • ${_num(o['quantityKg']).toStringAsFixed(0)} kg • $kPriceSymbol${_num(o['pricePerKg']).toStringAsFixed(0)}/kg',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 2),
          Text(biz['businessName'] as String? ?? 'Business buyer', style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          if (details.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(details.join(' • '), style: const TextStyle(fontSize: 11, color: AppTheme.textTertiary)),
          ],
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '$kPriceSymbol${_num(o['totalAmount']).toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.primaryGreen),
              ),
              Text(
                '${(o['paymentMode'] as String? ?? '').toUpperCase()} • ${(o['paymentStatus'] as String? ?? '').replaceAll('_', ' ')}',
                style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
              ),
            ],
          ),
          if (next != null || canCancel) ...[
            const Divider(height: 20),
            Row(
              children: [
                if (canCancel) ...[
                  Expanded(
                    child: SizedBox(
                      height: 36,
                      child: OutlinedButton(
                        onPressed: () => _confirmCancel(o),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.error,
                          side: const BorderSide(color: AppTheme.error),
                          minimumSize: Size.zero,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        ),
                        child: const Text('Cancel Order', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                if (next != null) ...[
                  Expanded(
                    child: SizedBox(
                      height: 36,
                      child: ElevatedButton(
                        onPressed: () => _advanceB2b(o),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primaryGreen,
                          foregroundColor: Colors.white,
                          minimumSize: Size.zero,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        ),
                        child: Text(
                          'Mark ${next.replaceAll('_', ' ')}',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _confirmCancel(Map<String, dynamic> o) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel order?'),
        content: Text('Cancel B2B order ${o['orderNumber'] ?? ''}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppTheme.error),
            child: const Text('Yes, Cancel'),
          ),
        ],
      ),
    );
    if (ok == true) _advanceB2b(o, override: 'cancelled');
  }

  Widget _stat(String label, String value, Color color) {
    return Expanded(
      child: Column(
        children: [
          Text(label, style: const TextStyle(fontSize: 10, color: AppTheme.textTertiary)),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }
}