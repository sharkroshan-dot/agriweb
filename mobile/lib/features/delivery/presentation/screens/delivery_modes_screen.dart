import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

/// All deliveries assigned to this partner.
///
/// The backend currently serves a single stream of assignments (local/nearby
/// deliveries), so the earlier Nearby / State / National tab split was
/// misleading — every row fell into the first tab and the other two were
/// permanently empty. This is now one honest list.
class DeliveryModesScreen extends StatefulWidget {
  const DeliveryModesScreen({super.key});
  @override
  State<DeliveryModesScreen> createState() => _DeliveryModesScreenState();
}

class _DeliveryModesScreenState extends State<DeliveryModesScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _deliveries = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery/assignments', params: {'limit': '50'});
      if (!mounted) return;
      setState(() => _deliveries = (res['data'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>());
    } catch (_) {
      if (mounted) setState(() => _deliveries = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _status(Map<String, dynamic> d) =>
      (d['status'] as String? ?? '').toLowerCase();

  String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

  String _orderLabel(Map<String, dynamic> d) {
    final id = (d['orderNumber'] as String?) ?? (d['orderId'] as String?) ?? (d['id'] as String?) ?? '';
    return id.length >= 8 ? id.substring(0, 8).toUpperCase() : id;
  }

  String _customerName(Map<String, dynamic> d) =>
      d['customerName'] as String? ?? 'Customer';

  String _addressLine(Map<String, dynamic> d) {
    final addr = d['address'] is Map ? d['address'] as Map<String, dynamic> : <String, dynamic>{};
    final parts = [
      addr['street'],
      addr['city'],
      addr['state'],
    ].where((p) => p != null && '$p'.isNotEmpty).toList();
    return parts.isEmpty ? 'Address unavailable' : parts.join(', ');
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'pending':
      case 'assigned': return AppTheme.accent;
      case 'accepted':
      case 'picked_up':
      case 'in_transit':
      case 'dispatched':
      case 'ready_for_delivery': return AppTheme.info;
      case 'delivered':
      case 'completed': return AppTheme.success;
      case 'cancelled':
      case 'failed': return AppTheme.error;
      default: return AppTheme.textSecondary;
    }
  }

  Widget _paymentChip(String? paymentMethod) {
    final m = (paymentMethod ?? '').toLowerCase();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Deliveries')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _deliveries.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.local_shipping_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                    const SizedBox(height: 16),
                    Text('No deliveries yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                    const SizedBox(height: 4),
                    Text('Assigned deliveries will appear here', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                    const SizedBox(height: 24),
                    ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _deliveries.length,
                  itemBuilder: (_, i) {
                    final d = _deliveries[i];
                    final status = _status(d);
                    final distance = (d['pickupDistance'] as num?)?.toDouble();
                    final earnings = (d['earnings'] as num?)?.toDouble();
                    return Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 1))],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                                child: const Icon(Icons.location_on, color: AppTheme.primaryGreen, size: 18),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(_customerName(d), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                    Text(_orderLabel(d), style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                  ],
                                ),
                              ),
                              _paymentChip(d['paymentMethod'] as String?),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(color: _statusColor(status).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                                child: Text(_cap(status.replaceAll('_', ' ')), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _statusColor(status))),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(_addressLine(d), style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                          if (distance != null || earnings != null) ...[
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                if (distance != null) ...[
                                  Icon(Icons.navigation, size: 14, color: AppTheme.textSecondary),
                                  const SizedBox(width: 4),
                                  Text('${distance.toStringAsFixed(1)} km', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                  const SizedBox(width: 16),
                                ],
                                if (earnings != null) ...[
                                  Icon(Icons.payments_outlined, size: 14, color: AppTheme.success),
                                  const SizedBox(width: 4),
                                  Text('Rs ${earnings.toStringAsFixed(2)}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.success)),
                                ],
                              ],
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
              ),
    );
  }
}