import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/providers/delivery_controller.dart';
import '../../../../shared/widgets/app_bar.dart';
import '../../../../shared/widgets/app_card.dart';
import '../../../../shared/widgets/section_header.dart';
import '../../../../shared/widgets/skeleton.dart';
import '../../../../shared/widgets/status_chip.dart';

class DeliveryDashboardScreen extends StatefulWidget {
  const DeliveryDashboardScreen({super.key});
  @override
  State<DeliveryDashboardScreen> createState() => _DeliveryDashboardScreenState();
}

class _DeliveryDashboardScreenState extends State<DeliveryDashboardScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _dashboard;
  bool _isAvailable = true;

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  Future<void> _loadDashboard() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        ApiService.get('/delivery/me/dashboard'),
        ApiService.get('/delivery/me/profile'),
      ]);
      if (!mounted) return;
      final dashboard = results[0]['data'] as Map<String, dynamic>? ?? results[0] as Map<String, dynamic>? ?? {};
      final profile = results[1]['data'] as Map<String, dynamic>? ?? results[1] as Map<String, dynamic>? ?? {};
      // Keep one shared source of truth so profile/settings reflect the same
      // availability and document status as the dashboard.
      DeliveryController.instance?.syncProfile(profile);
      setState(() {
        _dashboard = dashboard;
        _isAvailable = dashboard['isAvailable'] as bool? ?? profile['isAvailable'] as bool? ?? true;
        DeliveryController.instance?.syncAvailability(_isAvailable);
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleAvailability() async {
    final controller = DeliveryController.of(context);
    final target = !controller.isAvailable;
    final ok = await controller.setAvailable(target);
    if (!mounted) return;
    if (ok) {
      setState(() => _isAvailable = controller.isAvailable);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(controller.isAvailable ? 'You are now available for deliveries' : 'You are offline'),
        backgroundColor: controller.isAvailable ? AppTheme.success : AppTheme.textSecondary,
        behavior: SnackBarBehavior.floating,
      ));
    } else {
      setState(() => _isAvailable = controller.isAvailable);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Failed to update availability'),
        backgroundColor: AppTheme.error,
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: _isLoading
          ? Column(
              children: [
                const AppGradientHeader(title: 'Delivery Partner', subtitle: 'Welcome back'),
                const Expanded(child: PageSkeleton(items: 6)),
              ],
            )
          : _dashboard == null
              ? _buildErrorState()
              : RefreshIndicator(
              onRefresh: _loadDashboard,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppGradientHeader(
                      title: 'Delivery Hub',
                      subtitle: _isAvailable ? 'Available for deliveries' : 'Currently offline',
                      leading: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.18),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.local_shipping_outlined, color: Colors.white, size: 22),
                      ),
                      trailing: InkWell(
                        onTap: () => context.push('/delivery/settings'),
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(Icons.settings_outlined, color: Colors.white, size: 20),
                        ),
                      ),
                      onNotificationTap: () => context.push('/delivery/notifications'),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildWelcomeCard(),
                          const SizedBox(height: 14),
                          _buildKycBanner(),
                          _buildAvailabilityToggle(),
                          const SizedBox(height: 16),
                          _buildStatsRow(),
                          const SizedBox(height: 24),
                          const SectionHeader(title: "Today's Deliveries"),
                          const SizedBox(height: 12),
                          _buildTodayDeliveries(),
                          const SizedBox(height: 24),
                          const SectionHeader(title: 'Quick Actions'),
                          const SizedBox(height: 12),
                          _buildQuickActions(),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildErrorState() {
    return Column(
      children: [
        const AppGradientHeader(title: 'Delivery Partner', subtitle: 'Welcome back'),
        Expanded(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.cloud_off_outlined, size: 56, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                const SizedBox(height: 12),
                const Text("Couldn't load your dashboard", style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                const Text('Check your connection and try again', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                const SizedBox(height: 20),
                ElevatedButton.icon(
                  onPressed: _loadDashboard,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildWelcomeCard() {
    final name = _dashboard!['name'] as String? ?? 'Partner';
    final todayEarnings = (_dashboard!['todayEarnings'] as num?)?.toDouble() ?? 0;
    return AppCard(
      padding: const EdgeInsets.all(16),
      gradient: AppTheme.brandGradient,
      showShadow: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Good day, $name!', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Colors.white)),
          const SizedBox(height: 3),
          Text("Here's your delivery summary", style: const TextStyle(fontSize: 13, color: Color(0xFFD9F5E3))),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _glassMetric("Today's Earnings", 'Rs ${todayEarnings.toStringAsFixed(2)}'),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _glassMetric('On-Time Rate', _dashboard!['onTimeRate'] != null ? '${_dashboard!['onTimeRate']}%' : '--'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// KYC banner driven by the shared [DeliveryController] profile so the status
  /// shown here always matches the Profile/Settings screens.
  Widget _buildKycBanner() {
    final profile = DeliveryController.of(context).profile;
    final dl = profile?['drivingLicense'];
    final Map<String, dynamic> licence = dl is Map ? Map<String, dynamic>.from(dl) : <String, dynamic>{};
    final status = (licence['status'] as String?) ?? 'not_submitted';

    final String label;
    final IconData icon;
    final Color color;
    switch (status) {
      case 'verified':
        return const SizedBox.shrink();
      case 'submitted':
        label = 'Driving licence under review';
        icon = Icons.hourglass_top;
        color = AppTheme.accent;
        break;
      case 'rejected':
        label = 'Driving licence rejected — please re-submit';
        icon = Icons.error_outline;
        color = AppTheme.error;
        break;
      default:
        label = 'Add your driving licence to keep delivering';
        icon = Icons.badge_outlined;
        color = AppTheme.warning;
    }

    return AppCard(
      showShadow: false,
      color: color.withValues(alpha: 0.07),
      border: Border.all(color: color.withValues(alpha: 0.3)),
      onTap: () => context.push('/delivery/settings'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
            ),
          ),
          Icon(Icons.chevron_right, color: AppTheme.textSecondary, size: 20),
        ],
      ),
    );
  }

  Widget _glassMetric(String label, String value) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFFD9F5E3))),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: Colors.white)),
        ],
      ),
    );
  }

  Widget _buildAvailabilityToggle() {
    final color = _isAvailable ? AppTheme.success : AppTheme.error;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(_isAvailable ? Icons.wifi : Icons.wifi_off, color: color, size: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_isAvailable ? 'You are Available' : 'You are Offline', style: TextStyle(fontWeight: FontWeight.w700, color: color)),
                Text(
                  _isAvailable ? 'Accepting new deliveries' : 'You won\'t receive new assignments',
                  style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
          Switch(value: _isAvailable, onChanged: (_) => _toggleAvailability()),
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    return Row(
      children: [
        Expanded(
          child: StatCard(
            icon: Icons.local_shipping,
            label: 'Pending',
            value: '${_dashboard!['pendingDeliveries'] ?? 0}',
            color: AppTheme.accent,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: StatCard(
            icon: Icons.check_circle_outline,
            label: 'Completed',
            value: '${_dashboard!['completedDeliveries'] ?? 0}',
            color: AppTheme.success,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: StatCard(
            icon: Icons.star_outline,
            label: 'Rating',
            value: (_dashboard!['rating'] as num?) != null ? (_dashboard!['rating'] as num).toStringAsFixed(1) : '--',
            color: AppTheme.accent,
          ),
        ),
      ],
    );
  }

  Widget _buildTodayDeliveries() {
    final deliveries = _dashboard!['todayDeliveries'] as List<dynamic>? ?? [];
    if (deliveries.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(32),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border.withValues(alpha: 0.6)),
        ),
        child: Column(children: [
          Icon(Icons.check_circle_outline, size: 48, color: AppTheme.success.withValues(alpha: 0.6)),
          const SizedBox(height: 8),
          const Text('All deliveries completed!', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
        ]),
      );
    }
    return Column(
      children: deliveries.take(5).map((d) {
        final order = d is Map ? d as Map<String, dynamic> : <String, dynamic>{};
        final id = order['_id'] as String? ?? '';
        final address = order['address'] is Map ? order['address'] as Map<String, dynamic> : <String, dynamic>{};
        final status = (order['status'] as String? ?? 'pending').toLowerCase();
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(
            padding: const EdgeInsets.all(12),
            showShadow: true,
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryGreen.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.location_on, color: AppTheme.primaryGreen, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(id.length >= 8 ? '#${id.substring(0, 8).toUpperCase()}' : 'Delivery', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                      if (address['street'] != null)
                        Text(address['street'] as String, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                    ],
                  ),
                ),
                StatusChip(status: status),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildQuickActions() {
    const colorPurple = Color(0xFF8B5CF6);
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        _action(Icons.local_shipping, 'Active', AppTheme.primaryGreen, () => context.push('/delivery/deliveries')),
        _action(Icons.map_outlined, 'Order Map', colorPurple, () => context.push('/delivery/order-map')),
        _action(Icons.route_outlined, 'Live Route', colorPurple, () => context.push('/delivery/route')),
        _action(Icons.rocket_launch_outlined, 'Open Jobs', AppTheme.error, () => context.push('/delivery/jobs')),
        _action(Icons.account_balance_wallet_outlined, 'Earnings', AppTheme.accent, () => context.push('/delivery/earnings')),
        _action(Icons.payments_outlined, 'Settlement', const Color(0xFF10B981), () => context.push('/delivery/cash-settlement')),
        _action(Icons.account_balance_outlined, 'Settlements', AppTheme.primaryGreen, () => context.push('/delivery/settlements')),
        _action(Icons.star_outline, 'My Ratings', AppTheme.accent, () => context.push('/delivery/ratings')),
        _action(Icons.history, 'History', AppTheme.info, () => context.push('/delivery/history')),
        _action(Icons.support_agent, 'Support', colorPurple, () => context.push('/delivery/support')),
      ],
    );
  }

  Widget _action(IconData icon, String label, Color color, VoidCallback onTap) {
    return SizedBox(
      width: (MediaQuery.of(context).size.width - 16 * 2 - 10 * 2) / 3,
      child: ActionCard(icon: icon, label: label, onTap: onTap, color: color),
    );
  }
}