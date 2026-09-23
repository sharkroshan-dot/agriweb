import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerImpactScreen extends StatefulWidget {
  const FarmerImpactScreen({super.key});
  @override
  State<FarmerImpactScreen> createState() => _FarmerImpactScreenState();
}

class _FarmerImpactScreenState extends State<FarmerImpactScreen> {
  bool _isLoading = true;
  Map<String, dynamic> _data = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/impact/me');
      if (!mounted) return;
      setState(() => _data = res['data'] as Map<String, dynamic>? ?? res as Map<String, dynamic>? ?? {});
    } catch (_) {
      if (mounted) setState(() => _data = {});
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _val(dynamic v) {
    final n = toDouble(v);
    return n == null ? '0' : '${n.toInt()}';
  }

  double? toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Your Farm Impact')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
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
                          'How your farm serves the local community - from verified delivered orders',
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
                    _StatCard(icon: Icons.currency_rupee, label: 'Direct sales', value: '$kPriceSymbol${_val(_data['totalSpent'])}', color: AppTheme.primaryGreen),
                    _StatCard(icon: Icons.people_outline, label: 'Customers served', value: _val(_data['orders']), color: const Color(0xFF3B82F6)),
                    _StatCard(icon: Icons.local_shipping_outlined, label: 'Local deliveries', value: _val(_data['localDeliveries']), color: AppTheme.accent),
                    _StatCard(icon: Icons.store_outlined, label: 'Farm pickups', value: _val(_data['pickupOrders']), color: const Color(0xFF8B5CF6)),
                    _StatCard(icon: Icons.location_on_outlined, label: 'Community deliveries', value: _val(_data['communityDeliveries']), color: AppTheme.success),
                    _StatCard(icon: Icons.grain, label: 'Delivered volume', value: '${_val(_data['deliveredKg'])} kg', color: const Color(0xFFEC4899)),
                  ],
                ),
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
              Text(label, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }
}