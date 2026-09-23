import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});
  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _payments = [];

  @override
  void initState() {
    super.initState();
    _loadPayments();
  }

  Future<void> _loadPayments() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/customers/me/payments');
      if (!mounted) return;
      setState(() {
        _payments = (res['data'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _payments = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _date(dynamic value) {
    if (value == null) return '';
    try {
      final dt = DateTime.parse(value.toString()).toLocal();
      return '${dt.day} ${const [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ][dt.month - 1]} ${dt.year}';
    } catch (_) {
      return '';
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'succeeded':
      case 'completed':
      case 'refunded':
        return AppTheme.success;
      case 'failed':
        return AppTheme.error;
      case 'pending':
        return AppTheme.accent;
      default:
        return AppTheme.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payments')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _payments.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.payments_outlined,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No payments yet',
                          style: TextStyle(color: AppTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadPayments,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _payments.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final p = _payments[index];
                      final amount = (p['amount'] as num?)?.toDouble() ?? 0;
                      final status = p['status'] as String? ?? 'pending';
                      return InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () {
                          final orderId = p['orderId'] as String? ?? '';
                          if (orderId.isNotEmpty) {
                            context.push('/customer/orders/$orderId');
                          }
                        },
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
                                  color: AppTheme.primaryGreen.withValues(alpha: 0.12),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.account_balance_wallet_outlined,
                                    color: AppTheme.primaryGreen, size: 22),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '$kPriceSymbol${amount.toStringAsFixed(2)}',
                                      style: const TextStyle(
                                          fontSize: 16, fontWeight: FontWeight.bold),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      p['paymentMethod'] as String? ?? 'Payment',
                                      style: TextStyle(
                                          fontSize: 13, color: AppTheme.textSecondary),
                                    ),
                                    if (p['orderNumber'] != null)
                                      Text(
                                        'Order ${p['orderNumber']}',
                                        style: const TextStyle(
                                            fontSize: 12, color: AppTheme.textSecondary),
                                      ),
                                    if (_date(p['paymentDate'] ?? p['createdAt']).isNotEmpty)
                                      Text(_date(p['paymentDate'] ?? p['createdAt']),
                                          style: const TextStyle(
                                              fontSize: 11, color: AppTheme.textSecondary)),
                                  ],
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: _statusColor(status).withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      status.toUpperCase(),
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                        color: _statusColor(status),
                                      ),
                                    ),
                                  ),
                                  if ((p['refundAmount'] as num?)?.toDouble() != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Text(
                                        'Refund ${kPriceSymbol}${((p['refundAmount'] as num?) ?? 0).toStringAsFixed(2)}',
                                        style: const TextStyle(
                                            fontSize: 11, color: AppTheme.success),
                                      ),
                                    ),
                                ],
                              ),
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