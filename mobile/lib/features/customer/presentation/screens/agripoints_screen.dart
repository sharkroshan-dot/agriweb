import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class AgriPointsScreen extends StatefulWidget {
  const AgriPointsScreen({super.key});
  @override
  State<AgriPointsScreen> createState() => _AgriPointsScreenState();
}

class _AgriPointsScreenState extends State<AgriPointsScreen> {
  bool _isLoading = true;
  int _balance = 0;
  int _lifetime = 0;
  double _rewardValueRs = 0;
  List<Map<String, dynamic>> _transactions = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/loyalty/me');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _balance = (data['balance'] as num?)?.toInt() ?? 0;
        _lifetime = (data['lifetimeEarned'] as num?)?.toInt() ?? 0;
        _rewardValueRs = (data['rewardValueRs'] as num?)?.toDouble() ?? 0;
        _transactions = (data['transactions'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _redeem() async {
    if (_balance < 100) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('You need at least 100 points to redeem'),
            backgroundColor: AppTheme.error),
      );
      return;
    }
    final controller = TextEditingController(text: '$_balance');
    final points = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Redeem AgriPoints'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('100 points = ₹1 wallet credit. Redeem a multiple of 100.'),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Points to redeem'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, null),
              child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, int.tryParse(controller.text)),
            child: const Text('Redeem'),
          ),
        ],
      ),
    );
    if (points == null || points <= 0) return;
    try {
      final res = await ApiService.post('/loyalty/redeem', body: {'points': points});
      if (!mounted) return;
      final msg = (res['message'] as String?) ?? 'Points redeemed';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg), backgroundColor: AppTheme.success),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error),
      );
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AgriPoints')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                          colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      children: [
                        const Text('AgriPoints Balance',
                            style: TextStyle(color: Colors.white70, fontSize: 14)),
                        const SizedBox(height: 8),
                        Text(
                          '$_balance',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 44,
                              fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Worth $kPriceSymbol${_rewardValueRs.toStringAsFixed(0)} · $_lifetime lifetime earned',
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 13),
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: _redeem,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: AppTheme.primaryGreen,
                            ),
                            child: const Text('Redeem points'),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text('Earn AgriPoints',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textSecondary)),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.border),
                    ),
                    child: Column(
                      children: const [
                        _RuleRow('Base points per order', '5 points'),
                        _RuleRow('Bonus for pickup orders', '+10 points'),
                        _RuleRow('Bonus for community delivery', '+20 points'),
                        _RuleRow('Bonus for nearby farmers', '+5 points'),
                        _RuleRow('Cashback', '1 point per ₹100'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text('Recent activity',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textSecondary)),
                  const SizedBox(height: 8),
                  if (_transactions.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.border),
                      ),
                      child: Text('No activity yet',
                          style:
                              TextStyle(color: AppTheme.textSecondary)),
                    )
                  else
                    ..._transactions.map((t) {
                      final pts = (t['points'] as num?)?.toInt() ?? 0;
                      final earned = pts >= 0;
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              earned
                                  ? Icons.add_circle_outline
                                  : Icons.remove_circle_outline,
                              color: earned ? AppTheme.success : AppTheme.accent,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    t['description'] as String? ?? '',
                                    style: const TextStyle(fontSize: 13),
                                  ),
                                  Text(
                                    _date(t['createdAt']),
                                    style: const TextStyle(
                                        fontSize: 11,
                                        color: AppTheme.textSecondary),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              '${earned ? '+' : ''}$pts pts',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: earned ? AppTheme.success : AppTheme.accent,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                ],
              ),
            ),
    );
  }
}

class _RuleRow extends StatelessWidget {
  final String label;
  final String value;
  const _RuleRow(this.label, this.value);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: const TextStyle(fontSize: 13)),
          ),
          Text(value,
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.primaryGreen)),
        ],
      ),
    );
  }
}