import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerAnalyticsScreen extends StatefulWidget {
  const FarmerAnalyticsScreen({super.key});
  @override
  State<FarmerAnalyticsScreen> createState() => _FarmerAnalyticsScreenState();
}

class _FarmerAnalyticsScreenState extends State<FarmerAnalyticsScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _analytics;
  String _selectedPeriod = 'month';

  @override
  void initState() {
    super.initState();
    _loadAnalytics();
  }

  Future<void> _loadAnalytics() async {
    setState(() => _isLoading = true);
    try {
      final range = switch (_selectedPeriod) {
        'week' => '7d',
        'month' => '30d',
        'year' => '90d',
        _ => '30d',
      };
      final res = await ApiService.get('/farmers/me/analytics', params: {'range': range});
      if (!mounted) return;
      setState(() => _analytics = res['data'] as Map<String, dynamic>? ?? res);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Farm Report'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.date_range),
            onSelected: (v) { setState(() => _selectedPeriod = v); _loadAnalytics(); },
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
            onRefresh: _loadAnalytics,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildInsights(),
                  const SizedBox(height: 24),
                  _buildMoneyCards(),
                  const SizedBox(height: 24),
                  _buildRevenueChart(),
                  const SizedBox(height: 24),
                  _buildSummaryCards(),
                  const SizedBox(height: 24),
                  _buildRatingCard(),
                  const SizedBox(height: 24),
                  _buildTopProducts(),
                  const SizedBox(height: 24),
                  _buildFarmActivity(),
                  const SizedBox(height: 24),
                  _buildOrderStats(),
                  const SizedBox(height: 24),
                  _buildProductStock(),
                ],
              ),
            ),
          ),
    );
  }

  double _num(dynamic v) => (v as num?)?.toDouble() ?? 0;
  int _int(dynamic v) => (v as num?)?.toInt() ?? 0;

  Widget _sectionCard(String title, String subtitle, IconData icon, List<Widget> children) {
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
              Icon(icon, color: AppTheme.primaryGreen),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                    if (subtitle.isNotEmpty)
                      Text(subtitle, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }

  Widget _buildInsights() {
    final insights = (_analytics!['insights'] as List<dynamic>?) ?? [];
    if (insights.isEmpty) return const SizedBox.shrink();

    return _sectionCard(
      '💡 Your farm at a glance',
      'Simple tips to help you grow',
      Icons.lightbulb_outline,
      insights.take(4).map((raw) {
        final i = raw as Map<String, dynamic>;
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${i['emoji'] ?? '🌾'} ', style: const TextStyle(fontSize: 18)),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${i['title'] ?? ''}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
                    const SizedBox(height: 2),
                    Text('${i['message'] ?? ''}', style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.35)),
                  ],
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildMoneyCards() {
    final revenue = _num(_analytics!['totalRevenue']);
    final wallet = _num(_analytics!['walletBalance']);
    final pending = _num(_analytics!['pendingEarnings']);

    return Row(
      children: [
        Expanded(child: _SummaryCard(
          title: '💰 Earned',
          value: 'Rs ${revenue.toStringAsFixed(0)}',
          icon: Icons.attach_money,
          color: AppTheme.primaryGreen,
        )),
        const SizedBox(width: 12),
        Expanded(child: _SummaryCard(
          title: '👛 In wallet',
          value: 'Rs ${wallet.toStringAsFixed(0)}',
          icon: Icons.account_balance_wallet_outlined,
          color: AppTheme.info,
        )),
        Expanded(child: _SummaryCard(
          title: '⏳ Coming soon',
          value: 'Rs ${pending.toStringAsFixed(0)}',
          icon: Icons.schedule,
          color: AppTheme.accent,
        )),
      ],
    );
  }

  Widget _buildRevenueChart() {
    final revenueData = (_analytics!['revenueTrend'] as List<dynamic>?) ?? [];
    final maxRevenue = revenueData.isEmpty
        ? 100.0
        : revenueData.fold(0.0, (max, d) {
            final amount = ((d['amount'] ?? d['revenue']) as num?)?.toDouble() ?? 0;
            return amount > max ? amount : max;
          });

    return _sectionCard(
      '💰 Your earnings',
      'What you earned over time',
      Icons.trending_up,
      [
        if (revenueData.isEmpty)
          const SizedBox(
            height: 150,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.show_chart, size: 48, color: AppTheme.textTertiary),
                  SizedBox(height: 8),
                  Text('No earnings yet', style: TextStyle(color: AppTheme.textSecondary)),
                ],
              ),
            ),
          )
        else
          SizedBox(
            height: 150,
            child: Column(
              children: [
                Expanded(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: revenueData.asMap().entries.map((entry) {
                      final value = (entry.value['amount'] ?? entry.value['revenue']) as num? ?? 0;
                      final v = value.toDouble();
                      final height = maxRevenue > 0 ? (v / maxRevenue) * 120 : 0.0;
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 2),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              Container(
                                height: height,
                                decoration: BoxDecoration(
                                  color: AppTheme.primaryGreen.withValues(alpha: 0.7),
                                  borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: revenueData.map((d) {
                    final label = (d['label'] ?? d['name']) as String? ?? '';
                    return Text(label.length > 3 ? label.substring(0, 3) : label, style: const TextStyle(fontSize: 9, color: AppTheme.textSecondary));
                  }).toList(),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildSummaryCards() {
    final avgOrder = _num(_analytics!['averageOrderValue']);
    final delivered = _int(_analytics!['deliveredOrders']);

    return Row(
      children: [
        Expanded(child: _SummaryCard(
          title: '🧺 Orders',
          value: '${_int(_analytics!['totalOrders'])}',
          icon: Icons.shopping_bag_outlined,
          color: AppTheme.primaryGreen,
        )),
        const SizedBox(width: 12),
        Expanded(child: _SummaryCard(
          title: '🛒 Avg order size',
          value: 'Rs ${avgOrder.toStringAsFixed(0)}',
          icon: Icons.receipt_long_outlined,
          color: AppTheme.accent,
        )),
        Expanded(child: _SummaryCard(
          title: '✅ Delivered',
          value: '$delivered',
          icon: Icons.check_circle_outline,
          color: AppTheme.success,
        )),
      ],
    );
  }

  Widget _buildRatingCard() {
    final rating = _num(_analytics!['avgRating']);
    final count = _int(_analytics!['reviewCount']);

    return _sectionCard(
      '⭐ How customers rate you',
      'How much your customers love your produce',
      Icons.star,
      [
        Row(
          children: [
            Text(
              rating > 0 ? rating.toStringAsFixed(1) : '—',
              style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: AppTheme.textPrimary),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: List.generate(5, (i) {
                      return Icon(
                        Icons.star,
                        size: 20,
                        color: i < rating.round() ? AppTheme.accent : AppTheme.border,
                      );
                    }),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    count > 0 ? 'Based on $count customer review${count == 1 ? '' : 's'}' : 'No reviews yet',
                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                ],
              ),
            ),
            if (rating > 0)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.primarySoft,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  rating >= 4.5 ? 'Great!' : (rating >= 3.5 ? 'Good' : 'Needs work'),
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.primaryGreen),
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildTopProducts() {
    final topProducts = (_analytics!['topProducts'] as List<dynamic>?) ?? [];

    return _sectionCard(
      '🥇 Your best sellers',
      'Products that earned the most',
      Icons.leaderboard_outlined,
      topProducts.isEmpty
        ? const [Center(child: Padding(padding: EdgeInsets.all(16), child: Text('No product sales yet', style: TextStyle(color: AppTheme.textSecondary))))]
        : topProducts.take(5).toList().asMap().entries.map((entry) {
            final product = entry.value as Map<String, dynamic>;
            final name = product['name'] as String? ?? 'Product';
            final count = (product['orderCount'] ?? product['orders']) as num? ?? 0;
            final revenue = _num(product['revenue']);
            final growth = _num(product['growth']);
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Container(
                    width: 24, height: 24,
                    decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(6)),
                    child: Center(child: Text('${entry.key + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen))),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(name, style: const TextStyle(fontSize: 13))),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('Rs ${revenue.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                      Text('$count orders · $growth%', style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                    ],
                  ),
                ],
              ),
            );
          }).toList(),
    );
  }

  Widget _buildFarmActivity() {
    final activity = (_analytics!['harvestActivity'] as Map<String, dynamic>?) ?? {};
    final plans = (activity['harvestPlans'] ?? _analytics!['harvestPlans']) as num? ?? 0;
    final upcoming = (activity['upcomingHarvests'] ?? _analytics!['upcomingHarvests']) as num? ?? 0;
    final preorders = (activity['preOrders'] ?? _analytics!['preOrders']) as num? ?? 0;
    final notify = (activity['notifyMe'] ?? _analytics!['notifyMe']) as num? ?? 0;

    return _sectionCard(
      '🌱 Your farm activity',
      'Your harvests and customer demand',
      Icons.agriculture_outlined,
      [
        Row(
          children: [
            Expanded(child: _StatTile(emoji: '🌱', label: 'Harvest plans', value: '$plans')),
            const SizedBox(width: 8),
            Expanded(child: _StatTile(emoji: '📅', label: 'Upcoming', value: '$upcoming')),
            const SizedBox(width: 8),
            Expanded(child: _StatTile(emoji: '🛒', label: 'Pre-orders', value: '$preorders')),
            const SizedBox(width: 8),
            Expanded(child: _StatTile(emoji: '🔔', label: 'Interested', value: '$notify')),
          ],
        ),
      ],
    );
  }

  Widget _buildOrderStats() {
    final orderStats = (_analytics!['orderStats'] as Map<String, dynamic>?) ?? {};
    final stats = [
      {'label': 'Pending', 'value': '${orderStats['pending'] ?? 0}', 'color': AppTheme.accent},
      {'label': 'Confirmed', 'value': '${orderStats['confirmed'] ?? 0}', 'color': AppTheme.info},
      {'label': 'Shipped', 'value': '${orderStats['shipped'] ?? 0}', 'color': AppTheme.primaryGreen},
      {'label': 'Delivered', 'value': '${orderStats['delivered'] ?? 0}', 'color': AppTheme.success},
      {'label': 'Cancelled', 'value': '${orderStats['cancelled'] ?? 0}', 'color': AppTheme.error},
    ];

    final total = stats.fold(0, (sum, s) => sum + (int.tryParse(s['value'] as String) ?? 0));

    return _sectionCard(
      '🚚 Where your orders stand',
      'Pending, shipped or delivered',
      Icons.pie_chart_outline,
      stats.map((s) {
        final value = (int.tryParse(s['value'] as String) ?? 0);
        final fraction = total > 0 ? value / total : 0.0;
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(width: 10, height: 10, decoration: BoxDecoration(color: s['color'] as Color, shape: BoxShape.circle)),
                      const SizedBox(width: 8),
                      Text(s['label'] as String, style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                    ],
                  ),
                  Text('${s['value']} (${(fraction * 100).toStringAsFixed(0)}%)', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
                ],
              ),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: fraction,
                  backgroundColor: AppTheme.border,
                  color: s['color'] as Color,
                  minHeight: 6,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildProductStock() {
    final productStock = (_analytics!['productStock'] as List<dynamic>?) ?? [];
    if (productStock.isEmpty) return const SizedBox.shrink();

    return _sectionCard(
      '📦 Stock left to sell',
      'What you still have on hand',
      Icons.inventory_2_outlined,
      productStock.take(6).map((raw) {
        final p = raw as Map<String, dynamic>;
        final unit = p['unit'] ?? 'kg';
        final sold = _num(p['unitsSold']);
        final remaining = _num(p['remaining']);
        final total = _num(p['totalStock']);
        final pct = total > 0 ? (remaining / total).clamp(0.0, 1.0) : 0.0;
        final oos = remaining <= 0;
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(child: Text('${p['name'] ?? 'Product'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
                  Text(
                    '$sold $unit sold · $remaining $unit left',
                    style: TextStyle(fontSize: 12, color: oos ? AppTheme.error : AppTheme.textSecondary),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: total > 0 ? pct : 0,
                  backgroundColor: AppTheme.border,
                  color: oos ? AppTheme.error : (pct <= 0.2 ? AppTheme.accent : AppTheme.primaryGreen),
                  minHeight: 6,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String title, value;
  final IconData icon;
  final Color color;
  const _SummaryCard({required this.title, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(height: 12),
          Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppTheme.textPrimary)),
          Text(title, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  final String emoji, label, value;
  const _StatTile({required this.emoji, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 20)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.textPrimary)),
          Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}