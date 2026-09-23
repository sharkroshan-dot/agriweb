import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerAdvisorScreen extends StatefulWidget {
  const FarmerAdvisorScreen({super.key});
  @override
  State<FarmerAdvisorScreen> createState() => _FarmerAdvisorScreenState();
}

class _FarmerAdvisorScreenState extends State<FarmerAdvisorScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _report;
  String _selectedPeriod = 'month';

  @override
  void initState() {
    super.initState();
    _loadAdvisor();
  }

  Future<void> _loadAdvisor() async {
    setState(() => _isLoading = true);
    try {
      final range = switch (_selectedPeriod) {
        'week' => '7d',
        'month' => '30d',
        'year' => '90d',
        _ => '30d',
      };
      final res = await ApiService.get('/farmers/me/advisor', params: {'period': range});
      if (!mounted) return;
      setState(() => _report = res['data'] as Map<String, dynamic>? ?? res);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  double _num(dynamic v) => (v as num?)?.toDouble() ?? 0;
  int _int(dynamic v) => (v as num?)?.toInt() ?? 0;
  String _money(num v) =>
      v >= 100000 ? '₹${(v / 100000).toStringAsFixed(1)}L' : '₹${v.toStringAsFixed(0)}';
  String _kg(num v) => v >= 1000 ? '${(v / 1000).toStringAsFixed(1)} t' : '${v.toStringAsFixed(0)} kg';

  String _trend(dynamic v) {
    final x = _num(v);
    if (x > 0) return '▲ ${x.round()}%';
    if (x < 0) return '▼ ${x.abs().round()}%';
    return '—';
  }

  Color _trendColor(dynamic v) => _num(v) > 0 ? Colors.green : (_num(v) < 0 ? Colors.red : Colors.grey);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Farm Advisor'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.date_range),
            onSelected: (v) { setState(() => _selectedPeriod = v); _loadAdvisor(); },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'week', child: Text('Last 7 days')),
              const PopupMenuItem(value: 'month', child: Text('Last 30 days')),
              const PopupMenuItem(value: 'year', child: Text('Last 90 days')),
            ],
          ),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _loadAdvisor,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: _report?['hasData'] == true ? _buildReport() : _buildEmpty(),
            ),
          ),
    );
  }

  Widget _buildEmpty() {
    return Column(
      children: [
        const SizedBox(height: 48),
        Icon(Icons.psychology_alt, size: 64, color: AppTheme.primaryGreen.withValues(alpha: 0.4)),
        const SizedBox(height: 16),
        const Text('Not enough data yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text(
          'No sales in this period. List your produce and check back once orders start coming in.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppTheme.textSecondary),
        ),
      ],
    );
  }

  Widget _sectionCard(String title, IconData icon, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 16),
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
              Icon(icon, color: AppTheme.primaryGreen),
              const SizedBox(width: 8),
              Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            ],
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }

  Widget _buildReport() {
    final what = _report?['whatHappened'] as Map<String, dynamic>? ?? {};
    final why = (_report?['why'] as List? ?? []);
    final forecast = (_report?['forecast'] as List? ?? []);
    final recs = (_report?['recommendations'] as List? ?? []);
    final price = (_report?['priceInsight'] as List? ?? []);
    final wallet = _report?['wallet'] as Map<String, dynamic>? ?? {};
    final delivery = _report?['delivery'] as Map<String, dynamic>? ?? {};
    final topProduct = what['topProduct'] as Map<String, dynamic>?;
    final topArea = what['topArea'] as Map<String, dynamic>?;

    Widget moneyCard(String label, num value, dynamic change, {Color? valueColor}) {
      return Expanded(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.grey.shade50,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.grey.shade200),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              const SizedBox(height: 4),
              Text(
                label.contains('Orders') ? '${_int(value)}' : _money(value),
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: valueColor ?? AppTheme.textPrimary),
              ),
              Text(_trend(change), style: TextStyle(fontSize: 12, color: _trendColor(change))),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('What happened · ${_report?['periodLabel'] ?? ''}',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
        const SizedBox(height: 12),
        Row(
          children: [
            moneyCard('Sales', _num(what['revenue']), what['revenueChangePct']),
            const SizedBox(width: 8),
            moneyCard('Orders', _num(what['orders']), what['ordersChangePct']),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            moneyCard('Customers', _num(what['customers']), what['customersChangePct']),
            const SizedBox(width: 8),
            moneyCard('Est. profit', _num(what['estimatedProfit']), what['estimatedProfitChangePct'], valueColor: AppTheme.primaryGreen),
          ],
        ),
        if (topProduct != null) ...[
          const SizedBox(height: 12),
          Text('Top seller: ${topProduct['name']} · Top area: ${topArea?['name']} (${_kg(_num(topArea?['quantityKg']))})',
              style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          const SizedBox(height: 4),
          const Text('*Profit is an estimate using a transparent margin, not true accounts.',
              style: TextStyle(fontSize: 11, color: Colors.grey)),
        ],
        const SizedBox(height: 24),

        if (why.isNotEmpty) ...[
          _sectionCard('Why', Icons.info_outline, [
            for (final w in why)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${w['emoji'] ?? '•'} ', style: const TextStyle(fontSize: 18)),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${w['title']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                          Text('${w['message']}', style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ]),
        ],

        if (forecast.isNotEmpty) ...[
          _sectionCard('What happens next', Icons.insights, [
            for (final f in forecast)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: const Border(left: BorderSide(color: AppTheme.primaryGreen, width: 4)),
                  color: Colors.grey.shade50,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('${f['product']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: f['status'] == 'shortage' ? Colors.amber.shade100 : Colors.green.shade100,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            f['status'] == 'shortage' ? 'Shortage' : f['status'] == 'overstock' ? 'Overstock' : 'Balanced',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: f['status'] == 'shortage' ? Colors.amber.shade900 : Colors.green.shade900),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text('${_kg(_num(f['predictedKg']))}  ${f['trend'] == 'up' ? '▲' : f['trend'] == 'down' ? '▼' : '→'} ${_int(f['growthPct'])}%',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    Text('Range ${_int(f['predictedLowKg'])}–${_int(f['predictedHighKg'])} kg · sold ${_int(f['currentKg'])} kg',
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    Text('Your stock: ${_kg(_num(f['supplyKg']))}${_num(f['gapKg']) > 0 ? ' · Gap ~${_int(f['gapKg'])} kg' : ''}',
                        style: TextStyle(fontSize: 12, color: _num(f['gapKg']) > 0 ? Colors.amber.shade800 : AppTheme.textSecondary)),
                  ],
                ),
              ),
          ]),
        ],

        if (recs.isNotEmpty) ...[
          _sectionCard('What should I do?', Icons.psychology, [
            for (final r in recs)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  color: r['priority'] == 'high' ? Colors.green.shade50 : Colors.grey.shade50,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${r['emoji'] ?? '💡'} ', style: const TextStyle(fontSize: 20)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${r['title']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                          Text('${r['reason']}', style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ]),
        ],

        if (price.isNotEmpty) ...[
          _sectionCard('Price check', Icons.price_check, [
            for (final p in price)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('${p['product']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text('Market avg ₹${p['marketAvg'] ?? '—'}/kg · Your ₹${p['yourPrice'] ?? 'not listed'}/kg',
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
          ]),
        ],

        Row(
          children: [
            Expanded(
              child: _sectionCard('Wallet', Icons.account_balance_wallet, [
                Text('Balance: ${_money(_num(wallet['balance']))}', style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text('Pending: ${_money(_num(wallet['pending']))}',
                    style: const TextStyle(fontSize: 13, color: AppTheme.primaryGreen)),
              ]),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _sectionCard('Deliveries', Icons.local_shipping, [
                Text('${_int(delivery['total'])} total', style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text('${_int(delivery['onTime'])} on time',
                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
              ]),
            ),
          ],
        ),
      ],
    );
  }
}