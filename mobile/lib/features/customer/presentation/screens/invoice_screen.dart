import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';

class InvoiceScreen extends StatefulWidget {
  final String orderId;
  const InvoiceScreen({super.key, required this.orderId});
  @override
  State<InvoiceScreen> createState() => _InvoiceScreenState();
}

class _InvoiceScreenState extends State<InvoiceScreen> {
  bool _isLoading = true;
  bool _isError = false;
  Map<String, dynamic> _inv = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _isError = false; });
    try {
      final res = await ApiService.get('/impact/orders/${widget.orderId}/invoice');
      if (!mounted) return;
      setState(() => _inv = res['data'] as Map<String, dynamic>? ?? {});
    } catch (_) {
      if (mounted) setState(() => _isError = true);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _fmt(dynamic v) {
    final n = (v is num) ? v.toDouble() : (v is String) ? double.tryParse(v) : null;
    return '$kPriceSymbol${(n ?? 0).toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Invoice'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.push('/customer/orders/${widget.orderId}'),
        ),
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _isError || _inv.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.receipt_long_outlined, size: 80, color: AppTheme.textSecondary),
                  const SizedBox(height: 16),
                  Text('Invoice not available', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                  const SizedBox(height: 8),
                  const Text('You may not have access to this order', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                  const SizedBox(height: 24),
                  OutlinedButton(onPressed: () => context.push('/customer/orders/${widget.orderId}'), child: const Text('Back to Order')),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _header(),
                  const SizedBox(height: 16),
                  _parties(),
                  const SizedBox(height: 16),
                  _items(),
                  const SizedBox(height: 16),
                  _totals(),
                  if (_inv['payments'] is List && (_inv['payments'] as List).isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _payments(),
                  ],
                  if (_inv['pickupDate'] != null) ...[
                    const SizedBox(height: 16),
                    _pickupInfo(),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _header() {
    return Container(
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
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(_inv['invoiceId'] as String? ?? 'Invoice', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                child: Text(
                  ((_inv['orderStatus'] as String? ?? 'pending')).replaceAll('_', ' '),
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text('Order #${_inv['orderNumber'] as String? ?? ''} · ${shortDate(_inv['orderDate'])}',
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          const SizedBox(height: 4),
          Text('Payment: ${_inv['paymentStatus'] as String? ?? ''}',
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _parties() {
    final farmer = _inv['farmer'] is Map ? _inv['farmer'] as Map<String, dynamic> : {};
    final customer = _inv['customer'] is Map ? _inv['customer'] as Map<String, dynamic> : {};
    final address = _inv['deliveryAddress'] is Map ? _inv['deliveryAddress'] as Map<String, dynamic> : {};
    final addrParts = [
      address['address'] as String? ?? address['addressLine1'] as String?,
      address['city'] as String?,
    ].whereType<String>().where((s) => s.isNotEmpty).join(', ');
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: _partyCard(
            icon: Icons.store_outlined,
            title: 'Farmer',
            name: farmer['name'] as String? ?? '',
            sub: farmer['farmName'] as String? ?? '',
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _partyCard(
            icon: Icons.local_shipping_outlined,
            title: 'Customer',
            name: customer['name'] as String? ?? '',
            sub: addrParts.isNotEmpty ? addrParts : 'Pickup at farm',
          ),
        ),
      ],
    );
  }

  Widget _partyCard({required IconData icon, required String title, required String name, required String sub}) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 16, color: AppTheme.textSecondary),
            const SizedBox(width: 6),
            Text(title.toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.textSecondary)),
          ]),
          const SizedBox(height: 6),
          Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          if (sub.isNotEmpty)
            Text(sub, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _items() {
    final items = (_inv['items'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              const Expanded(flex: 3, child: Text('Item', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textSecondary))),
              const Expanded(child: Text('Qty', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textSecondary))),
              const Expanded(child: Text('Unit', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textSecondary))),
              Expanded(child: Text('Total', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textSecondary))),
            ]),
          ),
          const Divider(height: 1),
          ...items.map((item) => Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              Expanded(flex: 3, child: Text(item['productName'] as String? ?? 'Item', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
              Expanded(child: Text('${item['quantity']}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 13))),
              Expanded(child: Text(_fmt(item['unitPrice']), textAlign: TextAlign.right, style: const TextStyle(fontSize: 13))),
              Expanded(child: Text(_fmt(item['totalPrice']), textAlign: TextAlign.right, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
            ]),
          )),
        ],
      ),
    );
  }

  Widget _totals() {
    final discount = (double.tryParse('${_inv['discount'] ?? 0}') ?? 0);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        children: [
          _totalRow('Subtotal', _fmt(_inv['subtotal'])),
          _totalRow('Delivery charge', _fmt(_inv['deliveryCharge'])),
          _totalRow('Platform fee', _fmt(_inv['platformFee'])),
          if (discount > 0)
            _totalRow('Discount', '-${_fmt(discount)}', color: AppTheme.success),
          const Divider(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Total', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              Text(_fmt(_inv['totalAmount']), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _totalRow(String label, String value, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: color ?? AppTheme.textPrimary)),
        ],
      ),
    );
  }

  Widget _payments() {
    final payments = (_inv['payments'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.credit_card, size: 16, color: AppTheme.textSecondary),
            const SizedBox(width: 6),
            Text('PAYMENTS', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.textSecondary)),
          ]),
          const SizedBox(height: 8),
          ...payments.map((p) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    '${p['type'] == 'refund' ? 'Refund' : 'Payment'} • ${p['method'] ?? p['status']}${p['transactionId'] != null ? ' (${p['transactionId']})' : ''}',
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
                Text(
                  '${p['type'] == 'refund' ? '-' : ''}${_fmt(p['amount'])}',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: p['type'] == 'refund' ? AppTheme.success : AppTheme.textPrimary),
                ),
              ],
            ),
          )),
        ],
      ),
    );
  }

  Widget _pickupInfo() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.primaryGreen.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.location_on_outlined, color: AppTheme.primaryGreen, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Farm pickup on ${shortDate(_inv['pickupDate'])}${_inv['pickupTimeSlot'] != null ? ' • ${_inv['pickupTimeSlot']}' : ''}',
              style: const TextStyle(fontSize: 13),
            ),
          ),
          if (_inv['pickupCode'] != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
              child: Text('Code: ${_inv['pickupCode']}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen)),
            ),
        ],
      ),
    );
  }
}