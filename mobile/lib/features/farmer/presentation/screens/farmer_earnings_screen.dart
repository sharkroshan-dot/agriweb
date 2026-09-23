import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/services/payment_service.dart';

class FarmerEarningsScreen extends StatefulWidget {
  const FarmerEarningsScreen({super.key});
  @override
  State<FarmerEarningsScreen> createState() => _FarmerEarningsScreenState();
}

class _FarmerEarningsScreenState extends State<FarmerEarningsScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _earningsData;
  List<Map<String, dynamic>> _transactions = [];
  List<Map<String, dynamic>> _withdrawals = [];
  String _selectedPeriod = 'month';

  bool _withdrawing = false;
  String _paymentMethod = 'bank';
  String? _withdrawError;
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _accountHolderController = TextEditingController();
  final TextEditingController _accountNumberController = TextEditingController();
  final TextEditingController _ifscController = TextEditingController();
  final TextEditingController _bankNameController = TextEditingController();
  final TextEditingController _upiController = TextEditingController();

  double get _availableBalance => (_earningsData?['availableBalance'] as num?)?.toDouble() ?? 0;

  @override
  void initState() {
    super.initState();
    _loadEarnings();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _accountHolderController.dispose();
    _accountNumberController.dispose();
    _ifscController.dispose();
    _bankNameController.dispose();
    _upiController.dispose();
    super.dispose();
  }

  Future<void> _loadEarnings() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/earnings', params: {'period': _selectedPeriod});
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? res;
      setState(() {
        _earningsData = data;
        _transactions = (data['recentTransactions'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        _withdrawals = (data['withdrawals'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _openWithdraw() {
    setState(() => _paymentMethod = 'bank');
    showDialog(context: context, builder: (_) => buildWithdrawDialog(context));
  }

  Future<void> _submitWithdraw() async {
    final amount = double.tryParse(_amountController.text.trim()) ?? 0;
    final bankAccount = WithdrawalBankAccount(
      accountHolder: _accountHolderController.text.trim(),
      accountNumber: _accountNumberController.text.trim(),
      ifsc: _ifscController.text.trim(),
      bankName: _bankNameController.text.trim(),
      upiId: _paymentMethod == 'upi' ? _upiController.text.trim() : null,
    );

    if (amount < PaymentService.minWithdrawalAmount) {
      setState(() => _withdrawError = 'Minimum withdrawal is Rs ${PaymentService.minWithdrawalAmount}');
      return;
    }
    if (amount > _availableBalance) {
      setState(() => _withdrawError = 'Amount exceeds your available balance');
      return;
    }
    if (!bankAccount.isValid) {
      setState(() => _withdrawError = _paymentMethod == 'upi'
          ? 'Enter a valid UPI ID (e.g. name@bank)'
          : 'Fill in account holder, account number and IFSC code');
      return;
    }

    setState(() { _withdrawError = null; _withdrawing = true; });
    try {
      final res = await PaymentService.withdraw(amount: amount, bankAccount: bankAccount);
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? res;
      final message = data['message'] as String? ?? (data['status'] == 'completed'
          ? 'Withdrawal successful. Funds transferred to your account.'
          : 'Withdrawal initiated. Funds will reach your account shortly.');
      Navigator.of(context).pop();
      _showMessage(message, AppTheme.success);
      _loadEarnings();
    } catch (e) {
      if (!mounted) return;
      _showMessage(e.toString().replaceFirst('Exception: ', ''), AppTheme.error);
    } finally {
      if (mounted) setState(() => _withdrawing = false);
    }
  }

  void _showMessage(String message, Color color) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: color));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Earnings'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.date_range),
            onSelected: (v) { setState(() => _selectedPeriod = v); _loadEarnings(); },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'week', child: Text('This Week')),
              const PopupMenuItem(value: 'month', child: Text('This Month')),
              const PopupMenuItem(value: 'year', child: Text('This Year')),
            ],
          ),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _loadEarnings,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildRevenueHero(),
                  const SizedBox(height: 20),
                  _buildStatsGrid(),
                  const SizedBox(height: 24),
                  _buildWithdrawCard(),
                  const SizedBox(height: 24),
                  _buildWithdrawalHistory(),
                  const SizedBox(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Recent Transactions', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (_transactions.isEmpty)
                    _buildEmptyState('No transactions yet. Your sale earnings will appear here after orders are paid.')
                  else
                    ..._transactions.map((t) => _buildTransactionCard(t)),
                ],
              ),
            ),
          ),
    );
  }

  Widget _buildRevenueHero() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Available Balance', style: TextStyle(fontSize: 14, color: Colors.white.withValues(alpha: 0.8))),
          const SizedBox(height: 8),
          Text('Rs ${_availableBalance.toStringAsFixed(2)}', style: const TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: Colors.white)),
          const SizedBox(height: 12),
          Row(
            children: [
              Icon(Icons.account_balance_wallet, color: Colors.white, size: 18),
              const SizedBox(width: 6),
              Text('Withdrawable to your bank / UPI', style: TextStyle(color: Colors.white.withValues(alpha: 0.9))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatsGrid() {
    final monthEarnings = (_earningsData!['monthEarnings'] as num?)?.toDouble() ?? 0;
    final pendingPayouts = (_earningsData!['pendingPayouts'] as num?)?.toDouble() ?? 0;
    final totalWithdrawn = (_earningsData!['totalWithdrawn'] as num?)?.toDouble() ?? 0;

    return Row(
      children: [
        Expanded(child: _EarningStatCard(
          title: 'This Month',
          value: 'Rs ${monthEarnings.toStringAsFixed(0)}',
          icon: Icons.calendar_month,
          color: const Color(0xFF3B82F6),
        )),
        const SizedBox(width: 12),
        Expanded(child: _EarningStatCard(
          title: 'Pending Payouts',
          value: 'Rs ${pendingPayouts.toStringAsFixed(0)}',
          icon: Icons.account_balance_wallet_outlined,
          color: AppTheme.accent,
        )),
        Expanded(child: _EarningStatCard(
          title: 'Total Withdrawn',
          value: 'Rs ${totalWithdrawn.toStringAsFixed(0)}',
          icon: Icons.landscape,
          color: AppTheme.success,
        )),
      ],
    );
  }

  Widget _buildWithdrawCard() {
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
            children: [
              Icon(Icons.arrow_downward, color: AppTheme.primaryGreen, size: 20),
              const SizedBox(width: 8),
              Text('Withdraw to Bank', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            ],
          ),
          const SizedBox(height: 6),
          Text('Transfer your earnings to your bank account or UPI. Minimum Rs ${PaymentService.minWithdrawalAmount.toStringAsFixed(0)}.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: _availableBalance >= PaymentService.minWithdrawalAmount ? _openWithdraw : null,
              child: const Text('Withdraw Now'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWithdrawalHistory() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Withdrawal History', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
        const SizedBox(height: 12),
        if (_withdrawals.isEmpty)
          _buildEmptyState('No withdrawals yet.')
        else
          ..._withdrawals.map((w) => _buildWithdrawalCard(w)),
      ],
    );
  }

  Widget _buildWithdrawalCard(Map<String, dynamic> withdrawal) {
    final amount = (withdrawal['amount'] as num?)?.toDouble() ?? 0;
    final status = withdrawal['status'] as String? ?? 'processing';
    final createdAt = withdrawal['createdAt'] as String? ?? '';
    final bankAccount = withdrawal['bankAccount'] as Map<String, dynamic>? ?? {};
    final method = (bankAccount['upiId'] as String?)?.isNotEmpty == true ? 'UPI' : 'Bank';

    String date = '';
    try { date = DateFormat('dd MMM, hh:mm a').format(DateTime.parse(createdAt).toLocal()); } catch (_) { date = createdAt; }

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
            decoration: BoxDecoration(color: _statusColor(status).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
            child: Icon(Icons.arrow_upward, color: _statusColor(status), size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Rs ${amount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                Text('$method withdrawal • $date', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: _statusColor(status).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
            child: Text(status.toUpperCase(), style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: _statusColor(status))),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionCard(Map<String, dynamic> transaction) {
    final amount = (transaction['amount'] as num?)?.toDouble() ?? 0;
    final type = transaction['type'] as String? ?? 'credit';
    final description = transaction['description'] as String? ?? (type == 'credit' ? 'Sale earnings' : 'Withdrawal');
    final createdAt = transaction['createdAt'] as String? ?? '';
    final isCredit = type == 'credit';

    String date = '';
    try { date = DateFormat('dd MMM, hh:mm a').format(DateTime.parse(createdAt).toLocal()); } catch (_) { date = createdAt; }

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
              color: (isCredit ? AppTheme.success : AppTheme.error).withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              isCredit ? Icons.arrow_downward : Icons.arrow_upward,
              color: isCredit ? AppTheme.success : AppTheme.error,
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
            '${isCredit ? '+' : '-'}Rs ${amount.toStringAsFixed(2)}',
            style: TextStyle(
              fontWeight: FontWeight.bold, fontSize: 14,
              color: isCredit ? AppTheme.success : AppTheme.error,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.border)),
      child: Column(children: [
        Icon(Icons.receipt_long_outlined, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
        const SizedBox(height: 8),
        Text(message, style: TextStyle(color: AppTheme.textSecondary), textAlign: TextAlign.center),
      ]),
    );
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'processed':
        return AppTheme.success;
      case 'processing':
      case 'pending':
        return AppTheme.accent;
      case 'failed':
      case 'cancelled':
      case 'reversed':
        return AppTheme.error;
      default:
        return AppTheme.textSecondary;
    }
  }

  Widget buildWithdrawDialog(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('Withdraw to Bank', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const Spacer(),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
                ],
              ),
              Text('Available: Rs ${_availableBalance.toStringAsFixed(2)} (min Rs ${PaymentService.minWithdrawalAmount.toStringAsFixed(0)})', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              const SizedBox(height: 16),
              TextField(
                controller: _amountController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount (Rs)', prefixIcon: Icon(Icons.currency_rupee)),
              ),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'bank', label: Text('Bank'), icon: Icon(Icons.account_balance)),
                  ButtonSegment(value: 'upi', label: Text('UPI'), icon: Icon(Icons.qr_code)),
                ],
                selected: {_paymentMethod},
                onSelectionChanged: (s) => setState(() => _paymentMethod = s.first),
              ),
              const SizedBox(height: 16),
              if (_paymentMethod == 'bank') ...[
                TextField(
                  controller: _accountHolderController,
                  decoration: const InputDecoration(labelText: 'Account Holder Name', prefixIcon: Icon(Icons.person_outline)),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _accountNumberController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Account Number', prefixIcon: Icon(Icons.numbers)),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _ifscController,
                        textCapitalization: TextCapitalization.characters,
                        decoration: const InputDecoration(labelText: 'IFSC Code', prefixIcon: Icon(Icons.pin_outlined)),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _bankNameController,
                        decoration: const InputDecoration(labelText: 'Bank Name (optional)', prefixIcon: Icon(Icons.account_balance_outlined)),
                      ),
                    ),
                  ],
                ),
              ] else ...[
                TextField(
                  controller: _upiController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'name@upi', prefixIcon: Icon(Icons.qr_code)),
                ),
              ],
              if (_withdrawError != null) ...[
                const SizedBox(height: 12),
                Text(_withdrawError!, style: const TextStyle(color: AppTheme.error, fontSize: 13)),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _withdrawing ? null : _submitWithdraw,
                  child: _withdrawing
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Confirm Withdrawal'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EarningStatCard extends StatelessWidget {
  final String title, value;
  final IconData icon;
  final Color color;
  const _EarningStatCard({required this.title, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(height: 10),
          Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          Text(title, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}
