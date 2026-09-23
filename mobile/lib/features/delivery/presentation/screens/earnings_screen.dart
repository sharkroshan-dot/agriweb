import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class DeliveryEarningsScreen extends StatefulWidget {
  const DeliveryEarningsScreen({super.key});
  @override
  State<DeliveryEarningsScreen> createState() => _DeliveryEarningsScreenState();
}

class _DeliveryEarningsScreenState extends State<DeliveryEarningsScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _earningsData;
  List<Map<String, dynamic>> _transactions = [];

  bool _savingPayout = false;
  String _paymentMethod = 'bank_transfer';
  String _upiId = '';
  int _minWithdrawal = 200;
  bool _autoWithdraw = false;
  final TextEditingController _upiController = TextEditingController();
  final TextEditingController _minWithdrawalController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadEarnings();
    _loadPayoutPrefs();
  }

  @override
  void dispose() {
    _upiController.dispose();
    _minWithdrawalController.dispose();
    super.dispose();
  }

  Future<void> _loadEarnings() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery/me/earnings');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? res;
      setState(() {
        _earningsData = data;
        _transactions = (data['recentTransactions'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadPayoutPrefs() async {
    try {
      final res = await ApiService.get('/settings/mine');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      final payout = data['payout'] as Map<String, dynamic>?;
      if (payout == null) return;
      setState(() {
        _paymentMethod = payout['paymentMethod'] as String? ?? 'bank_transfer';
        _upiId = payout['upiId'] as String? ?? '';
        _minWithdrawal = (payout['minWithdrawal'] as num?)?.toInt() ?? 200;
        _autoWithdraw = payout['autoWithdraw'] as bool? ?? false;
        _upiController.text = _upiId;
        _minWithdrawalController.text = _minWithdrawal.toString();
      });
    } catch (_) {}
  }

  Future<void> _savePayout() async {
    final parsedMin = int.tryParse(_minWithdrawalController.text.trim()) ?? 0;
    final upiId = _upiController.text.trim();
    setState(() {
      _upiId = upiId;
      _minWithdrawal = parsedMin;
    });
    setState(() => _savingPayout = true);
    try {
      await ApiService.put('/settings/mine', body: {
        'payout': {
          'paymentMethod': _paymentMethod,
          'upiId': upiId,
          'minWithdrawal': parsedMin,
          'autoWithdraw': _autoWithdraw,
        },
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Payout preferences saved'), backgroundColor: AppTheme.success));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to save preferences'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _savingPayout = false);
    }
  }

  Future<void> _withdraw() async {
    final pendingPayouts = (_earningsData?['pendingPayouts'] as num?)?.toDouble() ?? 0;
    if (pendingPayouts <= 0) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No eligible balance to withdraw yet'), backgroundColor: AppTheme.error));
      return;
    }
    if (pendingPayouts < _minWithdrawal) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Minimum withdrawal is Rs $_minWithdrawal'),
        backgroundColor: AppTheme.error,
      ));
      return;
    }
    if (_paymentMethod == 'upi' && _upiId.trim().isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add your UPI ID first'), backgroundColor: AppTheme.error));
      return;
    }
    try {
      await ApiService.post('/delivery/me/earnings/withdraw', body: {
        'amount': pendingPayouts,
        'bankAccount': {
          'method': _paymentMethod,
          'upiId': _upiId.trim(),
        },
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Withdrawal initiated!'), backgroundColor: AppTheme.success));
      _loadEarnings();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to withdraw'), backgroundColor: AppTheme.error));
    }
  }

  void _openCashSettlement() {
    context.push('/delivery/cash-settlement');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Earnings')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _earningsData == null
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.cloud_off_outlined, size: 56, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                    const SizedBox(height: 12),
                    const Text("Couldn't load your earnings", style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    const Text('Check your connection and try again', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    const SizedBox(height: 20),
                    ElevatedButton.icon(
                      onPressed: _loadEarnings,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              )
            : RefreshIndicator(
            onRefresh: _loadEarnings,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildEarningsHero(),
                  const SizedBox(height: 20),
                  _buildPeriodStats(),
                  const SizedBox(height: 24),
                  _buildPendingWithdraw(),
                  const SizedBox(height: 16),
                  _buildCashSettlementCard(),
                  const SizedBox(height: 24),
                  _buildPayoutPrefs(),
                  const SizedBox(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Recent Transactions', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (_transactions.isEmpty)
                    Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(32),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.border)),
                        child: Column(children: [
                          Icon(Icons.receipt_long_outlined, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                          const SizedBox(height: 8),
                          Text('No transactions yet', style: TextStyle(color: AppTheme.textSecondary)),
                        ]),
                      )
                  else
                    ..._transactions.map((t) => _buildTransactionCard(t)),
                ],
              ),
            ),
          ),
    );
  }

  Widget _buildEarningsHero() {
    final todayEarnings = (_earningsData!['todayEarnings'] as num?)?.toDouble() ?? 0;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Today's Earnings", style: TextStyle(fontSize: 14, color: Colors.white.withValues(alpha: 0.8))),
          const SizedBox(height: 8),
          Text('Rs ${todayEarnings.toStringAsFixed(2)}', style: const TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: Colors.white)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
            child: Row(
              children: [
                Icon(Icons.trending_up, color: Colors.white, size: 20),
                const SizedBox(width: 8),
                Text('${_earningsData!['weeklyChange'] ?? 0}% from yesterday', style: TextStyle(color: Colors.white.withValues(alpha: 0.9))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPeriodStats() {
    final weekEarnings = (_earningsData!['weekEarnings'] as num?)?.toDouble() ?? 0;
    final monthEarnings = (_earningsData!['monthEarnings'] as num?)?.toDouble() ?? 0;

    return Row(
      children: [
        Expanded(child: _PeriodCard(
          title: 'This Week',
          value: 'Rs ${weekEarnings.toStringAsFixed(0)}',
          icon: Icons.calendar_view_week,
          color: const Color(0xFF3B82F6),
        )),
        const SizedBox(width: 12),
        Expanded(child: _PeriodCard(
          title: 'This Month',
          value: 'Rs ${monthEarnings.toStringAsFixed(0)}',
          icon: Icons.calendar_month,
          color: AppTheme.accent,
        )),
      ],
    );
  }

  Widget _buildPendingWithdraw() {
    final pendingPayouts = (_earningsData!['pendingPayouts'] as num?)?.toDouble() ?? 0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
            child: const Icon(Icons.account_balance_wallet_outlined, color: AppTheme.accent, size: 28),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Pending Payments', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                Text('Rs ${pendingPayouts.toStringAsFixed(2)}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              ],
            ),
          ),
          SizedBox(
            height: 44,
            child: ElevatedButton(
              onPressed: pendingPayouts > 0 ? _withdraw : null,
              style: ElevatedButton.styleFrom(minimumSize: const Size(120, 0)),
              child: const Text('Withdraw'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCashSettlementCard() {
    final cashToday = (_earningsData!['cashCollectedToday'] as num?)?.toDouble() ?? 0;
    final cashToSettle = (_earningsData!['cashPendingSubmission'] as num?)?.toDouble() ?? 0;
    final inVerification = (_earningsData!['cashInVerification'] as num?)?.toDouble() ?? 0;
    final deposited = (_earningsData!['cashDeposited'] as num?)?.toDouble() ?? 0;
    final codBlocked = _earningsData!['codBlocked'] as bool? ?? false;

    return InkWell(
      onTap: _openCashSettlement,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)],
          border: codBlocked ? Border.all(color: AppTheme.error) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(codBlocked ? Icons.warning_amber_rounded : Icons.payments_outlined, color: codBlocked ? AppTheme.error : AppTheme.accent, size: 22),
                const SizedBox(width: 8),
                Text('COD Cash Settlement', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                const Spacer(),
                Icon(Icons.chevron_right, color: AppTheme.textSecondary),
              ],
            ),
            const SizedBox(height: 4),
            Text('Cash you collected on COD orders. Transfer it to the platform and submit the UTR.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            if (codBlocked) ...[
              const SizedBox(height: 10),
              Text(_earningsData!['codBlockReason'] as String? ?? 'Settle your outstanding COD cash to continue receiving deliveries.', style: TextStyle(fontSize: 12, color: AppTheme.error)),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: _cashStat('Today', cashToday, AppTheme.textPrimary)),
                Expanded(child: _cashStat('To settle', cashToSettle, cashToSettle > 0 ? AppTheme.error : AppTheme.textPrimary)),
                Expanded(child: _cashStat('Verifying', inVerification, Colors.orange)),
                Expanded(child: _cashStat('Deposited', deposited, AppTheme.success)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _cashStat(String label, double value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Rs ${value.toStringAsFixed(0)}', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: color)),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
      ],
    );
  }

  Widget _buildPayoutPrefs() {
    return Container(
      width: double.infinity,
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
            children: [
              Icon(Icons.account_balance_outlined, color: AppTheme.primaryGreen, size: 22),
              const SizedBox(width: 8),
              Text('Payment method & payout preferences', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            ],
          ),
          const SizedBox(height: 4),
          Text('How and when you receive your earnings.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _paymentMethod,
            decoration: const InputDecoration(labelText: 'Payment method'),
            items: const [
              DropdownMenuItem(value: 'bank_transfer', child: Text('Bank transfer')),
              DropdownMenuItem(value: 'upi', child: Text('UPI')),
            ],
            onChanged: (v) => setState(() => _paymentMethod = v ?? 'bank_transfer'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _upiController,
            decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'raj@upi'),
            keyboardType: TextInputType.emailAddress,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _minWithdrawalController,
            decoration: const InputDecoration(labelText: 'Minimum withdrawal (Rs)'),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Auto-withdraw', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
              Switch(
                value: _autoWithdraw,
                onChanged: (v) => setState(() => _autoWithdraw = v),
                activeColor: AppTheme.primaryGreen,
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _savingPayout ? null : _savePayout,
              child: Text(_savingPayout ? 'Saving...' : 'Save preferences'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionCard(Map<String, dynamic> transaction) {
    final amount = (transaction['amount'] as num?)?.toDouble() ?? 0;
    final type = transaction['type'] as String? ?? 'earnings';
    final description = transaction['description'] as String? ?? 'Delivery earnings';
    final createdAt = transaction['createdAt'] as String? ?? '';
    String date = '';
    try { date = DateFormat('dd MMM, hh:mm a').format(DateTime.parse(createdAt)); } catch (_) { date = createdAt; }

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 4)],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: type == 'withdrawal' ? AppTheme.error.withValues(alpha: 0.1) : AppTheme.success.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              type == 'withdrawal' ? Icons.arrow_upward : Icons.arrow_downward,
              color: type == 'withdrawal' ? AppTheme.error : AppTheme.success,
              size: 18,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(description, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
                Text(date, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Text(
            '${type == 'withdrawal' ? '-' : '+'}Rs ${amount.toStringAsFixed(0)}',
            style: TextStyle(
              fontWeight: FontWeight.bold, fontSize: 14,
              color: type == 'withdrawal' ? AppTheme.error : AppTheme.success,
            ),
          ),
        ],
      ),
    );
  }
}

class _PeriodCard extends StatelessWidget {
  final String title, value;
  final IconData icon;
  final Color color;
  const _PeriodCard({required this.title, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              Text(title, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }
}
