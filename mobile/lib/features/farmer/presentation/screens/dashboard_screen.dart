import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_bar.dart';
import '../../../../shared/widgets/app_card.dart';
import '../../../../shared/widgets/section_header.dart';
import '../../../../shared/widgets/skeleton.dart';
import '../../../../shared/widgets/status_chip.dart';
import '../widgets/ai_copilot_card.dart';

class FarmerDashboardScreen extends StatefulWidget {
  const FarmerDashboardScreen({super.key});
  @override
  State<FarmerDashboardScreen> createState() => _FarmerDashboardScreenState();
}

class _FarmerDashboardScreenState extends State<FarmerDashboardScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _dashboard;
  List<Map<String, dynamic>> _recentOrders = [];

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  Future<void> _loadDashboard() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/dashboard');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? res;
      setState(() {
        _dashboard = data;
        _recentOrders = (data['recentOrders'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: _isLoading
          ? Column(
              children: [
                const AppGradientHeader(title: 'Farmer', subtitle: 'Hello, welcome back'),
                const Expanded(child: PageSkeleton(items: 6)),
              ],
            )
          : RefreshIndicator(
              onRefresh: _loadDashboard,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppGradientHeader(
                      title: 'Farmer Hub',
                      subtitle: 'Manage your farm & orders',
                      leading: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.18),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.agriculture, color: Colors.white, size: 22),
                      ),
                      trailing: InkWell(
                        onTap: () => context.push('/farmer/security'),
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(Icons.shield_outlined, color: Colors.white, size: 20),
                        ),
                      ),
                      onNotificationTap: () => context.push('/farmer/notifications'),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildStatsGrid(),
                          const SizedBox(height: 24),
                          const SectionHeader(title: 'Quick Actions'),
                          const SizedBox(height: 12),
                          _buildQuickActions(),
                          const SizedBox(height: 24),
                          const AICopilotCard(),
                          const SizedBox(height: 24),
                          SectionHeader(
                            title: 'Recent Orders',
                            actionLabel: 'See All',
                            onAction: () => context.push('/farmer/orders'),
                          ),
                          const SizedBox(height: 12),
                          if (_recentOrders.isEmpty)
                            const _EmptyRecentOrders()
                          else
                            ..._recentOrders.map((order) => _buildOrderCard(order)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildStatsGrid() {
    final dash = _dashboard!;
    return Row(
      children: [
        Expanded(
          child: StatCard(
            icon: Icons.inventory_2_outlined,
            label: 'Products',
            value: '${dash['totalProducts'] ?? '0'}',
            color: AppTheme.primaryGreen,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: StatCard(
            icon: Icons.shopping_bag_outlined,
            label: 'Active Orders',
            value: '${dash['activeOrders'] ?? '0'}',
            color: AppTheme.info,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: StatCard(
            icon: Icons.trending_up,
            label: "Today's Revenue",
            value: 'Rs ${_num(dash['todayRevenue'])}',
            color: AppTheme.accent,
          ),
        ),
      ],
    );
  }

  Widget _buildQuickActions() {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        _action(Icons.add_circle_outline, 'Add Product', AppTheme.primaryGreen, () => context.push('/farmer/products/add')),
        _action(Icons.view_list_outlined, 'Products', AppTheme.info, () => context.push('/farmer/products')),
        _action(Icons.receipt_outlined, 'Orders', AppTheme.accent, () => context.push('/farmer/orders')),
        _action(Icons.account_balance_wallet_outlined, 'Earnings', AppTheme.success, () => context.push('/farmer/earnings')),
        _action(Icons.analytics_outlined, 'Analytics', const Color(0xFF8B5CF6), () => context.push('/farmer/analytics')),
        _action(Icons.psychology_outlined, 'AI Advisor', AppTheme.primaryGreen, () => context.push('/farmer/advisor')),
        _action(Icons.rocket_launch_outlined, 'Delivery Jobs', AppTheme.accent, () => context.push('/farmer/delivery-jobs')),
        _action(Icons.eco_outlined, 'Harvest Plans', AppTheme.primaryGreen, () => context.push('/farmer/harvests')),
        _action(Icons.business_center_outlined, 'B2B Requests', const Color(0xFF8B5CF6), () => context.push('/farmer/b2b')),
        _action(Icons.shopping_bag_outlined, 'Bulk & B2B Orders', AppTheme.primaryGreen, () => context.push('/farmer/bulk-b2b')),
        _action(Icons.people_outline, 'Customers', AppTheme.info, () => context.push('/farmer/customers')),
        _action(Icons.star_outline, 'Ratings', AppTheme.accent, () => context.push('/farmer/ratings')),
        _action(Icons.schedule_outlined, 'Delivery Slots', AppTheme.primaryGreen, () => context.push('/farmer/delivery-slots')),
        _action(Icons.shopping_basket_outlined, 'Farm Baskets', AppTheme.primaryGreen, () => context.push('/farmer/farm-baskets')),
        _action(Icons.map_outlined, 'Order Map', const Color(0xFF8B5CF6), () => context.push('/farmer/order-map')),
      ],
    );
  }

  Widget _action(IconData icon, String label, Color color, VoidCallback onTap) {
    return SizedBox(
      width: (MediaQuery.of(context).size.width - 16 * 2 - 10 * 2) / 3,
      child: ActionCard(icon: icon, label: label, onTap: onTap, color: color),
    );
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final id = order['_id'] as String? ?? '';
    final status = (order['status'] as String? ?? 'pending').toLowerCase();
    final total = (order['totalAmount'] as num?)?.toDouble() ?? 0;
    final items = order['items'] as List<dynamic>? ?? [];
    final createdAt = order['createdAt'] as String? ?? '';
    String date = '';
    try {
      date = DateFormat('dd MMM').format(DateTime.parse(createdAt));
    } catch (_) {
      date = createdAt;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GestureDetector(
        onTap: () => context.push('/farmer/orders'),
        child: AppCard(
          padding: const EdgeInsets.all(12),
          showShadow: true,
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.primaryGreen.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.receipt, color: AppTheme.primaryGreen, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      id.length >= 8 ? 'Order #${id.substring(0, 8).toUpperCase()}' : 'Order',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text('$items items - Rs ${total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              Text(date, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              const SizedBox(width: 8),
              StatusChip(status: status),
            ],
          ),
        ),
      ),
    );
  }

  String _num(dynamic value) {
    final v = (value as num?)?.toDouble() ?? 0;
    return v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(0);
  }
}

class _EmptyRecentOrders extends StatelessWidget {
  const _EmptyRecentOrders();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.border.withValues(alpha: 0.6)),
      ),
      child: Column(children: [
        Icon(Icons.receipt_long_outlined, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
        const SizedBox(height: 8),
        const Text('No orders yet', style: TextStyle(color: AppTheme.textSecondary)),
      ]),
    );
  }
}