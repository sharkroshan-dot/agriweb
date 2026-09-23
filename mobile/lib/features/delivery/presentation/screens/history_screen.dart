import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import 'package:intl/intl.dart';

class DeliveryHistoryScreen extends StatefulWidget {
  const DeliveryHistoryScreen({super.key});
  @override
  State<DeliveryHistoryScreen> createState() => _DeliveryHistoryScreenState();
}

class _DeliveryHistoryScreenState extends State<DeliveryHistoryScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _deliveries = [];

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery/assignments', params: {'status': 'delivered,completed,cancelled'});
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() => _deliveries = data.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery History')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _deliveries.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.history_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                    const SizedBox(height: 16),
                    Text('No delivery history', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                    const SizedBox(height: 8),
                    Text('Completed deliveries will appear here', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _loadHistory,
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _deliveries.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final delivery = _deliveries[i];
                    final id = delivery['_id'] as String? ?? '';
                    final orderId = delivery['order'] is Map ? (delivery['order'] as Map)['_id'] as String? ?? '' : delivery['orderId'] as String? ?? '';
                    final status = delivery['status'] as String? ?? 'completed';
                    final address = delivery['address'] is Map ? delivery['address'] as Map<String, dynamic> : {};
                    final customerName = delivery['customerName'] as String? ?? 'Customer';
                    final earnings = (delivery['earnings'] as num?)?.toDouble() ?? 0;
                    final completedAt = delivery['completedAt'] as String? ?? delivery['updatedAt'] as String? ?? '';
                    String date = '';
                    try { date = DateFormat('dd MMM yyyy, hh:mm a').format(DateTime.parse(completedAt)); } catch (_) { date = completedAt; }

                    return Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppTheme.border.withValues(alpha: 0.6)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: status == 'completed' ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.error.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Icon(
                              status == 'completed' ? Icons.check_circle : Icons.cancel_outlined,
                              color: status == 'completed' ? AppTheme.success : AppTheme.error,
                              size: 22,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Order #${(() { final s = orderId.isNotEmpty ? orderId : id; return s.length >= 8 ? s.substring(0, 8).toUpperCase() : s; })()}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                                Text(customerName, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                if (address['street'] != null) Text(address['street'] as String, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                Text(date, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: status == 'completed' ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.error.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  status.isEmpty ? status : status[0].toUpperCase() + status.substring(1),
                                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: status == 'completed' ? AppTheme.success : AppTheme.error),
                                ),
                              ),
                              const SizedBox(height: 6),
                              _paymentChip(delivery['paymentMethod'] as String?),
                              if (earnings > 0) ...[
                                const SizedBox(height: 6),
                                Text('+Rs ${earnings.toStringAsFixed(0)}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                              ],
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
    );
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
