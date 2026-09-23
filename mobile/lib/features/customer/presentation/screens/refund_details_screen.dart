import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/skeleton.dart';
import '../../../../shared/widgets/status_chip.dart';

/// Maps a refund status to a color and label.
({Color color, String label}) refundStatusMeta(String status) {
  switch (status.toLowerCase()) {
    case 'requested':
      return (color: AppTheme.textSecondary, label: 'Requested');
    case 'under_review':
      return (color: AppTheme.warning, label: 'Under Review');
    case 'approved':
      return (color: AppTheme.info, label: 'Approved');
    case 'refund_processing':
      return (color: const Color(0xFF8B5CF6), label: 'Refund Processing');
    case 'refunded':
      return (color: AppTheme.success, label: 'Refund Completed');
    case 'rejected':
      return (color: AppTheme.error, label: 'Rejected');
    default:
      return (color: AppTheme.textSecondary, label: status);
  }
}

String _reasonLabel(dynamic reason) {
  const map = {
    'ordered_by_mistake': 'Ordered by mistake',
    'no_longer_needed': 'No longer needed',
    'delivery_too_slow': 'Delivery taking too long',
    'found_other': 'Found another product',
    'wrong_product': 'Wrong product',
    'missing_quantity': 'Missing quantity',
    'damaged_product': 'Damaged product',
    'poor_quality': 'Poor quality',
    'spoiled_expired': 'Spoiled/expired',
    'other': 'Other',
  };
  final value = reason as String?;
  return map[value] ?? value ?? 'Refund request';
}

class RefundDetailsScreen extends StatefulWidget {
  final String refundId;
  const RefundDetailsScreen({super.key, required this.refundId});
  @override
  State<RefundDetailsScreen> createState() => _RefundDetailsScreenState();
}

class _RefundDetailsScreenState extends State<RefundDetailsScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _refund;
  double? _walletBalance;

  @override
  void initState() {
    super.initState();
    _load();
  }

  bool get _isWalletPayout {
    final method = (_refund?['paymentMethod'] as String? ?? '').toLowerCase();
    return method == 'wallet' || method == 'cash' || method == 'cod' || method == 'cash_on_delivery';
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/refunds/${widget.refundId}');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? (res is Map<String, dynamic> ? res : null);
      setState(() => _refund = data);
      await _loadWalletBalance();
    } catch (_) {
      if (mounted) setState(() => _refund = null);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadWalletBalance() async {
    final method = (_refund?['paymentMethod'] as String? ?? '').toLowerCase();
    if (_status() != 'refunded' || !(method == 'wallet' || method == 'cash' || method == 'cod' || method == 'cash_on_delivery')) {
      return;
    }
    try {
      final res = await ApiService.get('/payments/wallet/info');
      if (!mounted) return;
      final data = (res['data'] as Map<String, dynamic>?) ?? res;
      final balance = (data['balance'] as num?)?.toDouble();
      if (balance != null) setState(() => _walletBalance = balance);
    } catch (_) {}
  }

  String _status() => (_refund?['status'] as String? ?? 'requested').toLowerCase();
  String _fmt(dynamic v) {
    try {
      final value = (v as num).toDouble();
      return '$kPriceSymbol${value.toStringAsFixed(2)}';
    } catch (_) {
      return '${kPriceSymbol}0.00';
    }
  }

  String _date(dynamic value) {
    if (value == null) return '';
    try {
      final dt = DateTime.parse(value.toString()).toLocal();
      return DateFormat('dd MMM yyyy, hh:mm a').format(dt);
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Refund Details')),
      body: _isLoading
          ? const PageSkeleton(items: 6)
          : _refund == null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.replay_circle_filled_outlined, size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      const Text('Refund not found', style: TextStyle(color: AppTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildSummaryCard(),
                      const SizedBox(height: 16),
                      if (_status() == 'rejected') ..._buildRejectedCard(),
                      if (_isWalletPayout && _status() == 'refunded') ..._buildWalletCard(),
                      if ((_refund?['affectedItems'] as List?)?.isNotEmpty ?? false) ...[
                        _buildAffectedItems(),
                        const SizedBox(height: 16),
                      ],
                      _buildTimeline(),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              );
  }

  Widget _buildSummaryCard() {
    final meta = refundStatusMeta(_status());
    final orderNumber = _refund?['orderNumber'] as String? ?? '';
    final shortOrder = orderNumber.length > 8 ? orderNumber.substring(orderNumber.length - 8) : orderNumber;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _refund?['refundId'] as String? ?? 'Refund',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ),
              StatusChip(status: meta.label, color: meta.color),
            ],
          ),
          const SizedBox(height: 12),
          _summaryRow('Order', '#$shortOrder'),
          _summaryRow('Reason', _reasonLabel(_refund?['reason'])),
          _summaryRow('Payment', ((_refund?['paymentMethod'] as String? ?? 'cash').toUpperCase())),
          _summaryRow('Requested', _date(_refund?['requestedAt'] ?? _refund?['createdAt'])),
          const Divider(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Approved refund', style: TextStyle(fontSize: 14, color: AppTheme.textSecondary)),
              Text(_fmt(_refund?['approvedAmount'] ?? 0), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.success)),
            ],
          ),
          if ((_refund?['refundTransactionId'] as String?)?.isNotEmpty ?? false) ...[
            const SizedBox(height: 6),
            _summaryRow('Refund txn', _refund?['refundTransactionId'] as String? ?? ''),
          ],
          if ((_refund?['description'] as String?)?.isNotEmpty ?? false) ...[
            const SizedBox(height: 8),
            Text(_refund!['description'] as String, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ],
        ],
      ),
    );
  }

  Widget _summaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 2, child: Text(label, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
          Expanded(flex: 3, child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }

  List<Widget> _buildRejectedCard() {
    return [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.error.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppTheme.error.withValues(alpha: 0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.cancel_outlined, color: AppTheme.error, size: 22),
                SizedBox(width: 8),
                Text('Refund Rejected', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.error)),
              ],
            ),
            if ((_refund?['rejectionReason'] as String?) != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Reason: ${_refund!['rejectionReason']}', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              ),
          ],
        ),
      ),
      const SizedBox(height: 16),
    ];
  }

  List<Widget> _buildWalletCard() {
    return [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.primaryGreen.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.account_balance_wallet_outlined, color: AppTheme.primaryGreen, size: 22),
                SizedBox(width: 8),
                Text('Refunded to your Wallet', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${_fmt(_refund?['approvedAmount'] ?? _refund?['requestedAmount'])} has been credited to your wallet.',
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
            if (_walletBalance != null) ...[
              const SizedBox(height: 6),
              Text(
                'Wallet balance: ${_fmt(_walletBalance)}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen),
              ),
            ],
          ],
        ),
      ),
      const SizedBox(height: 16),
    ];
  }

  Widget _buildAffectedItems() {
    final items = (_refund!['affectedItems'] as List?) ?? const [];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.shopping_bag_outlined, size: 18, color: AppTheme.primaryGreen),
              SizedBox(width: 8),
              Text('Affected items', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 10),
          ...items.map((item) {
            final m = item as Map<String, dynamic>;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m['productName'] as String? ?? 'Product', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                        Text('Qty ${m['quantity']} × ${_fmt(m['unitPrice'])}', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),
                  Text(_fmt(m['approvedAmount'] ?? m['requestedAmount']), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.success)),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildTimeline() {
    final timeline = (_refund?['timeline'] as List?) ?? [];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.schedule, size: 18, color: AppTheme.primaryGreen),
              SizedBox(width: 8),
              Text('Refund timeline', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 14),
          if (timeline.isEmpty)
            const Text('No timeline entries yet.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))
          else
            ...timeline.reversed.map((entry) {
              final e = entry as Map<String, dynamic>;
              final status = (e['status'] as String? ?? '').toLowerCase();
              final note = e['note'] as String?;
              final actor = e['actorRole'] as String?;
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  status == 'rejected'
                      ? const Icon(Icons.cancel, size: 20, color: AppTheme.error)
                      : const Icon(Icons.check_circle, size: 20, color: AppTheme.success),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            note ?? status.replaceAll('_', ' '),
                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                          ),
                          Text(
                            _date(e['timestamp']),
                            style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                          if (actor != null && actor != 'system' && note != null)
                            Text('by $actor', style: const TextStyle(fontSize: 11, color: AppTheme.textTertiary)),
                        ],
                      ),
                    ),
                  ),
                ],
              );
            }),
        ],
      ),
    );
  }
}