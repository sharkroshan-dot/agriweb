import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class DeliveryCashSettlementScreen extends StatefulWidget {
  const DeliveryCashSettlementScreen({super.key});
  @override
  State<DeliveryCashSettlementScreen> createState() => _DeliveryCashSettlementScreenState();
}

class _DeliveryCashSettlementScreenState extends State<DeliveryCashSettlementScreen> {
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>> _pending = [];
  List<Map<String, dynamic>> _history = [];

  bool _submitting = false;
  String _method = 'upi';
  final TextEditingController _referenceController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _referenceController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiService.get('/delivery/me/cash-settlements/summary'),
        ApiService.get('/delivery/me/cash-settlements?status=pending_remit&limit=100'),
        ApiService.get('/delivery/me/cash-settlements?limit=50'),
      ]);
      if (!mounted) return;
      setState(() {
        _summary = (results[0]['data'] as Map<String, dynamic>? ?? {});
        final pendingData = results[1]['data'] as Map<String, dynamic>? ?? {};
        _pending = (pendingData['settlements'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        final historyData = results[2]['data'] as Map<String, dynamic>? ?? {};
        _history = (historyData['settlements'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'Unable to load your settlements');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  double _num(dynamic v) => (v as num?)?.toDouble() ?? 0;

  Widget _buildErrorState(String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.error_outline, size: 56, color: AppTheme.error.withValues(alpha: 0.5)),
          const SizedBox(height: 12),
          Text(message, style: TextStyle(color: AppTheme.textSecondary), textAlign: TextAlign.center),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () => _load(),
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Future<void> _submitSettlement() async {
    if (_pending.isEmpty) return;
    final amount = _pending.fold<double>(0, (s, x) => s + _num(x['amountToRemit']));
    final methodLabel = _method == 'upi' ? 'UPI' : _method == 'bank_transfer' ? 'Bank Transfer' : 'Collection Center';
    final reference = _referenceController.text.trim();

    if (_method != 'collection_center' && reference.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter the transaction reference / UTR number'), backgroundColor: AppTheme.error));
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Submit settlement'),
        content: Text(
          'You will transfer Rs ${amount.toStringAsFixed(2)} to the agriConnect platform via $methodLabel and it will be pending verification by finance.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Submit')),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _submitting = true);
    try {
      await ApiService.post('/delivery/me/cash-settlements/submit', body: {
        'settlementIds': _pending.map((s) => s['id']).toList(),
        'method': _method,
        'reference': reference,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Settlement submitted for verification'), backgroundColor: AppTheme.success));
      _referenceController.clear();
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to submit settlement'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settlement')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
            ? _buildErrorState(_error!)
            : RefreshIndicator(
            onRefresh: _load,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildSummary(),
                  const SizedBox(height: 16),
                  if ((_summary?['codBlocked'] as bool? ?? false)) ...[
                    _buildBlockBanner(),
                    const SizedBox(height: 16),
                  ],
                  _buildAccountCard(),
                  const SizedBox(height: 16),
                  _buildTodayBreakdown(),
                  const SizedBox(height: 24),
                  Text("Today's COD Orders", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const SizedBox(height: 4),
                  Text('Detailed split of every cash-on-delivery order delivered today. Settle the total into the agriConnect account above.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(height: 12),
                  _buildTodaySettlements(),
                  const SizedBox(height: 24),
                  _buildPendingCard(),
                  const SizedBox(height: 24),
                  Text('Settlement History', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const SizedBox(height: 12),
                  if (_history.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.border)),
                      child: Text('No settlements yet', textAlign: TextAlign.center, style: TextStyle(color: AppTheme.textSecondary)),
                    )
                  else
                    ..._history.map((s) => _buildHistoryItem(s)),
                ],
              ),
            ),
          ),
    );
  }

  Widget _buildSummary() {
    final today = _summary?['today'] as Map<String, dynamic>? ?? {};
    final todayCash = _num(_summary?['todayCash']);
    final toSettle = _num(_summary?['pendingSubmission']);
    final inVerification = _num(_summary?['inVerification']);
    final deposited = _num(_summary?['alreadyDeposited']);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Today's COD Collected", style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.8))),
          const SizedBox(height: 4),
          Text('Rs ${todayCash.toStringAsFixed(2)}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.white)),
          const SizedBox(height: 4),
          Text('from ${_num(today['codOrders']).toStringAsFixed(0)} COD order(s) today', style: TextStyle(fontSize: 12, color: Colors.white.withValues(alpha: 0.8))),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _summaryStat('To Settle', toSettle, AppTheme.accent)),
              Expanded(child: _summaryStat('In Verification', inVerification, AppTheme.info)),
              Expanded(child: _summaryStat('Deposited', deposited, AppTheme.success)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _summaryStat(String label, dynamic value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Rs ${_num(value).toStringAsFixed(0)}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: color)),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.8))),
      ],
    );
  }

  Widget _buildBlockBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: AppTheme.error.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.error)),
      child: Row(
        children: [
          const Icon(Icons.warning_amber_rounded, color: AppTheme.error),
          const SizedBox(width: 12),
          Expanded(child: Text(_summary?['blockReason'] ?? 'COD deliveries are blocked until you settle your outstanding cash.', style: const TextStyle(color: AppTheme.error, fontSize: 13))),
        ],
      ),
    );
  }

  Widget _buildAccountCard() {
    final account = (_summary?['collectionAccount'] as Map<String, dynamic>? ?? {});
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.account_balance_outlined, color: AppTheme.primaryGreen, size: 22),
            const SizedBox(width: 8),
            Text('agriConnect collection account', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          ]),
          const SizedBox(height: 4),
          Text('Transfer your collected COD cash here, then submit the UTR below.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          const SizedBox(height: 14),
          _accountRow('UPI ID', account['upiId'] ?? '-'),
          _accountRow('Account', '${account['accountNumber'] ?? '-'} · ${account['accountName'] ?? ''}'),
          _accountRow('IFSC', account['ifsc'] ?? '-'),
        ],
      ),
    );
  }

  Widget _accountRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
        ],
      ),
    );
  }

  Widget _buildTodayBreakdown() {
    final today = _summary?['today'] as Map<String, dynamic>? ?? {};
    final codOrders = _num(today['codOrders']).toInt();
    final codAmount = _num(today['codAmount']);
    final onlineOrders = _num(today['onlineOrders']).toInt();
    final onlineAmount = _num(today['onlineAmount']);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.pie_chart_outline, color: AppTheme.accent, size: 22),
            const SizedBox(width: 8),
            Text("Today's Payment Breakdown", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          ]),
          const SizedBox(height: 4),
          Text('How today\'s delivered orders were paid.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _buildBreakdownTile(
                icon: Icons.payments_outlined,
                color: AppTheme.accent,
                label: 'Cash on Delivery',
                count: codOrders,
                amount: codAmount,
              )),
              const SizedBox(width: 12),
              Expanded(child: _buildBreakdownTile(
                icon: Icons.credit_card_outlined,
                color: AppTheme.info,
                label: 'Online Payment',
                count: onlineOrders,
                amount: onlineAmount,
              )),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBreakdownTile({
    required IconData icon,
    required Color color,
    required String label,
    required int count,
    required double amount,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, color: color, size: 18),
            const SizedBox(width: 6),
            Expanded(child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textPrimary))),
          ]),
          const SizedBox(height: 10),
          Text('$count order${count == 1 ? '' : 's'}', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          Text('Rs ${amount.toStringAsFixed(2)}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }

  Widget _buildTodaySettlements() {
    final settlements = (_summary?['todaySettlements'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    if (settlements.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.border)),
        child: Text('No COD orders delivered today yet.', textAlign: TextAlign.center, style: TextStyle(color: AppTheme.textSecondary)),
      );
    }
    return Column(
      children: settlements.map((s) => _buildTodaySettlementCard(s)).toList(),
    );
  }

  Widget _buildTodaySettlementCard(Map<String, dynamic> s) {
    final status = s['status'] as String? ?? '';
    final (Color color, String label) = _statusMeta(status);
    final cashCollected = _num(s['amount']);
    final deliveryFee = _num(s['deliveryFee']);
    final farmerShare = _num(s['farmerShare']);
    final platformShare = _num(s['platformShare']);
    final amountToRemit = _num(s['amountToRemit']);
    final collectedAt = s['cashCollectedAt'] as String? ?? '';
    String time = '';
    try { time = DateFormat('hh:mm a').format(DateTime.parse(collectedAt).toLocal()); } catch (_) { time = collectedAt; }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Order ${s['orderNumber'] ?? ''}', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
                    Text('Cash collected $time', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                child: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _detailRow('Cash collected', cashCollected),
          _detailRow('Delivery fee (yours)', deliveryFee, color: AppTheme.success),
          _detailRow('Farmer share', farmerShare),
          _detailRow('Platform share', platformShare),
          const Divider(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Amount to remit', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
              Text('Rs ${amountToRemit.toStringAsFixed(2)}', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.accent)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _detailRow(String label, double value, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          Text('Rs ${value.toStringAsFixed(2)}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color ?? AppTheme.textPrimary)),
        ],
      ),
    );
  }

  Widget _buildPendingCard() {
    final total = _pending.fold<double>(0, (s, x) => s + _num(x['amountToRemit']));
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.payments_outlined, color: AppTheme.accent, size: 22),
            const SizedBox(width: 8),
            Text('Settle collected cash', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          ]),
          const SizedBox(height: 12),
          if (_pending.isEmpty)
            Text('Nothing to settle right now. New COD collections will appear here.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary))
          else ...[
            Text('Total to settle: Rs ${total.toStringAsFixed(2)} (${_pending.length} order${_pending.length > 1 ? 's' : ''})', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
            const SizedBox(height: 4),
            Text('Amount shown is your collected cash minus your delivery fee. The farmer is paid from this.', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _method,
              decoration: const InputDecoration(labelText: 'Settlement method'),
              items: const [
                DropdownMenuItem(value: 'upi', child: Text('UPI transfer')),
                DropdownMenuItem(value: 'bank_transfer', child: Text('Bank transfer')),
                DropdownMenuItem(value: 'collection_center', child: Text('Collection center')),
              ],
              onChanged: (v) => setState(() => _method = v ?? 'upi'),
            ),
            if (_method != 'collection_center') ...[
              const SizedBox(height: 12),
              TextField(
                controller: _referenceController,
                decoration: const InputDecoration(labelText: 'Transaction reference / UTR', hintText: 'e.g. 404812345678'),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _submitting ? null : _submitSettlement,
                icon: const Icon(Icons.send_outlined),
                label: Text(_submitting ? 'Submitting...' : 'Submit settlement for verification'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  (Color, String) _statusMeta(String status) {
    return switch (status) {
      'verified' => (AppTheme.success, 'Verified'),
      'remitted' => (AppTheme.success, 'Settled'),
      'submitted' => (AppTheme.warning, 'In verification'),
      'rejected' => (AppTheme.error, 'Rejected'),
      _ => (AppTheme.accent, 'Pending'),
    };
  }

  Widget _buildHistoryItem(Map<String, dynamic> s) {
    final status = s['status'] as String? ?? '';
    final (Color color, String label) = _statusMeta(status);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Order ${s['orderNumber'] ?? ''}', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
                Text('Cash: Rs ${_num(s['amount']).toStringAsFixed(2)} · Remit: Rs ${_num(s['amountToRemit']).toStringAsFixed(2)}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                if (s['reference'] != null)
                  Text('Ref: ${s['reference']}', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
            child: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
          ),
        ],
      ),
    );
  }
}
