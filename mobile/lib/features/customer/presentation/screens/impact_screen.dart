import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class CustomerImpactScreen extends StatefulWidget {
  const CustomerImpactScreen({super.key});
  @override
  State<CustomerImpactScreen> createState() => _CustomerImpactScreenState();
}

class _CustomerImpactScreenState extends State<CustomerImpactScreen> {
  bool _isLoading = true;
  bool _isError = false;
  Map<String, dynamic> _data = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _isError = false;
    });
    try {
      final res = await ApiService.get('/impact/me');
      if (!mounted) return;
      setState(() {
        _data = res['data'] as Map<String, dynamic>? ?? res as Map<String, dynamic>? ?? {};
        _isError = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isError = true);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _val(dynamic v) {
    final n = toDouble(v);
    return n == null ? '0' : '${n.toInt()}';
  }

  String _valPrice(dynamic v) {
    final n = toDouble(v);
    return '$kPriceSymbol${(n ?? 0).toStringAsFixed(2)}';
  }

  double? toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  String _monthLabel(String month) {
    final parts = month.split('-');
    if (parts.length != 2) return month;
    final names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final m = int.tryParse(parts[1]);
    if (m == null || m < 1 || m > 12) return month;
    return '${names[m - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Your Local Impact')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _isError
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.eco, size: 56, color: AppTheme.error),
                      const SizedBox(height: 12),
                      const Text('Failed to load your impact'),
                      const SizedBox(height: 12),
                      ElevatedButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppTheme.primaryGreen.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.2)),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.eco, color: AppTheme.primaryGreen, size: 28),
                            SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'See how buying direct from farmers helps your community',
                                style: TextStyle(fontSize: 14, color: AppTheme.primaryDark),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        mainAxisSpacing: 12,
                        crossAxisSpacing: 12,
                        childAspectRatio: 1.5,
                        children: [
                          _StatCard(icon: Icons.currency_rupee, label: 'Spent with farmers', value: _valPrice(_data['totalSpent']), color: AppTheme.primaryGreen),
                          _StatCard(icon: Icons.people_outline, label: 'Farmers supported', value: _val(_data['farmersSupported']), color: const Color(0xFF3B82F6)),
                          _StatCard(icon: Icons.local_shipping_outlined, label: 'Local deliveries', value: _val(_data['localDeliveries']), color: AppTheme.accent),
                          _StatCard(icon: Icons.store_outlined, label: 'Farm pickups', value: _val(_data['pickupOrders']), color: const Color(0xFF8B5CF6)),
                          _StatCard(icon: Icons.location_on_outlined, label: 'Community deliveries', value: _val(_data['communityDeliveries']), color: AppTheme.success),
                          _StatCard(icon: Icons.grain, label: 'Delivered volume', value: '${_val(_data['deliveredKg'])} kg', color: const Color(0xFFEC4899)),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Text('Your Savings',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                      const SizedBox(height: 10),
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        mainAxisSpacing: 12,
                        crossAxisSpacing: 12,
                        childAspectRatio: 1.5,
                        children: [
                          _StatCard(icon: Icons.percent, label: 'Discounts & offers saved', value: _valPrice(_data['discountSavings']), color: const Color(0xFFF59E0B)),
                          _StatCard(icon: Icons.storefront_outlined, label: 'Delivery fee saved by pickup', value: _valPrice(_data['pickupFeeSavings']), color: const Color(0xFF0D9488)),
                          _StatCard(icon: Icons.eco_outlined, label: 'AgriPoints earned', value: '${_val(_data['agriPointsEarned'])} pts', color: const Color(0xFF16A34A)),
                          _StatCard(icon: Icons.replay_outlined, label: 'Money back via refunds', value: _valPrice(_data['refundMoneyBack']), color: const Color(0xFF6366F1)),
                        ],
                      ),
                      const SizedBox(height: 16),
                      _buildOrdersByMonth(),
                      const SizedBox(height: 16),
                      _buildTopFarmers(),
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.auto_awesome, color: AppTheme.primaryGreen, size: 24),
                            const SizedBox(width: 12),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Estimated delivery distance saved', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                  SizedBox(height: 2),
                                  Text('From local delivery routes instead of longer farm-pickup alternatives', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                ],
                              ),
                            ),
                            Text('${_val(_data['estimatedDistanceSavedKm'])} km', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _data['disclaimer'] as String? ?? 'Metrics are computed from delivered orders only.',
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withValues(alpha: 0.8)),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildOrdersByMonth() {
    final months = (_data['ordersByMonth'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .toList();
    if (months.isEmpty) return const SizedBox.shrink();
    final maxOrders = months.fold<int>(1, (max, m) {
      final n = (m['orders'] as num?)?.toInt() ?? 0;
      return n > max ? n : max;
    });
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
          const Row(
            children: [
              Icon(Icons.bar_chart, color: AppTheme.primaryGreen, size: 22),
              SizedBox(width: 8),
              Text('Orders by month', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 120,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (final m in months)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Text('${m['orders'] ?? 0}',
                              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 4),
                          Container(
                            height: 120 * ((m['orders'] as num?)?.toDouble() ?? 0) / maxOrders,
                            decoration: BoxDecoration(
                              color: AppTheme.primaryGreen,
                              borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(_monthLabel(m['month'] as String? ?? ''),
                              style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTopFarmers() {
    final farmers = (_data['topFarmers'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .toList();
    if (farmers.isEmpty) return const SizedBox.shrink();
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
          const Row(
            children: [
              Icon(Icons.star_outline, color: AppTheme.primaryGreen, size: 22),
              SizedBox(width: 8),
              Text('Your favourite farmers', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
            ],
          ),
          const SizedBox(height: 12),
          for (final f in farmers) _farmerRow(f),
        ],
      ),
    );
  }

  Widget _farmerRow(Map<String, dynamic> f) {
    final name = f['name'] as String? ?? 'Local Farmer';
    final orders = (f['orders'] as num?)?.toInt() ?? 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: const BoxDecoration(color: AppTheme.primaryGreen, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Text(name.characters.first.toUpperCase(),
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
          ),
          Text('$orders order${orders != 1 ? 's' : ''}',
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label, value;
  final Color color;
  const _StatCard({required this.icon, required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: color, size: 20),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              Text(label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }
}