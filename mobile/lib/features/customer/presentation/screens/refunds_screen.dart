import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/widgets/status_chip.dart';
import 'refund_details_screen.dart' show refundStatusMeta;

class RefundsScreen extends StatefulWidget {
  const RefundsScreen({super.key});
  @override
  State<RefundsScreen> createState() => _RefundsScreenState();
}

class _RefundsScreenState extends State<RefundsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _refunds = [];

  @override
  void initState() {
    super.initState();
    _loadRefunds();
  }

  Future<void> _loadRefunds() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/customers/me/refunds');
      if (!mounted) return;
      setState(() {
        _refunds = (res['data'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _refunds = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _date(dynamic value) {
    if (value == null) return '';
    try {
      final dt = DateTime.parse(value.toString()).toLocal();
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  double _amount(Map<String, dynamic> p) {
    return (p['approvedAmount'] as num?)?.toDouble() ??
        (p['refundAmount'] as num?)?.toDouble() ??
        (p['amount'] as num?)?.toDouble() ??
        0;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Refunds & Returns')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _refunds.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.currency_rupee_outlined,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No refunds yet',
                          style: TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 4),
                      Text('Cancellation and problem refunds appear here.',
                          style: TextStyle(
                              fontSize: 12, color: AppTheme.textTertiary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadRefunds,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _refunds.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final p = _refunds[index];
                      final amount = _amount(p);
                      final status = (p['status'] as String? ?? 'requested').toLowerCase();
                      final meta = refundStatusMeta(status);
                      final refundId = p['refundId'] as String? ?? p['id'] as String? ?? 'Refund';
                      final orderNumber = p['orderNumber'] as String?;
                      return InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => context.push('/customer/refunds/${p['id'] ?? p['_id']}'),
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppTheme.border),
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
                                    Text(
                                      '$refundId',
                                      style: const TextStyle(
                                          fontSize: 14, fontWeight: FontWeight.bold),
                                    ),
                                    const SizedBox(height: 2),
                                    if (orderNumber != null)
                                      Text(
                                        'Order ${orderNumber}',
                                        style: TextStyle(
                                            fontSize: 12, color: AppTheme.textSecondary),
                                      ),
                                    Text(
                                      '${kPriceSymbol}${amount.toStringAsFixed(2)}',
                                      style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                          color: AppTheme.success),
                                    ),
                                    if (_date(p['requestedAt'] ?? p['createdAt']).isNotEmpty)
                                      Text(
                                        _date(p['requestedAt'] ?? p['createdAt']),
                                        style: const TextStyle(
                                            fontSize: 11, color: AppTheme.textSecondary),
                                      ),
                                  ],
                                ),
                              ),
                              StatusChip(status: meta.label, color: meta.color),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}