import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_card.dart';
import '../../../../shared/widgets/section_header.dart';
import '../../../../shared/widgets/skeleton.dart';

class CustomerProfileScreen extends StatefulWidget {
  const CustomerProfileScreen({super.key});
  @override
  State<CustomerProfileScreen> createState() => _CustomerProfileScreenState();
}

class _CustomerProfileScreenState extends State<CustomerProfileScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _user;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/users/me');
      if (!mounted) return;
      final user = res['data'] as Map<String, dynamic>? ?? res;
      setState(() => _user = user);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Logout'),
        content: const Text('Are you sure you want to logout?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    await ApiService.clearToken();
    if (!mounted) return;
    context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Profile')),
      body: _isLoading
          ? const PageSkeleton(items: 5)
          : RefreshIndicator(
              onRefresh: _loadProfile,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildProfileCard(),
                    const SizedBox(height: 24),
                    const SectionHeader(title: 'Your Orders'),
                    const SizedBox(height: 10),
                    _buildOrderQuickActions(),
                    const SizedBox(height: 24),
                    const SectionHeader(title: 'Account'),
                    const SizedBox(height: 10),
                    _menuGroup([
                      _MenuItem(Icons.receipt_outlined, 'My Orders', () => context.push('/customer/orders')),
                      _MenuItem(Icons.favorite_outline, 'Wishlist', () => context.push('/customer/wishlist')),
                      _MenuItem(Icons.location_on_outlined, 'Saved Addresses', () => context.push('/customer/addresses')),
                      _MenuItem(Icons.settings_outlined, 'Settings', () => context.push('/customer/settings')),
                    ]),
                    const SizedBox(height: 16),
                    const SectionHeader(title: 'Shopping'),
                    const SizedBox(height: 10),
                    _menuGroup([
                      _MenuItem(Icons.stars_outlined, 'AgriPoints', () => context.push('/customer/agripoints')),
                      _MenuItem(Icons.local_offer_outlined, 'Coupons', () => context.push('/customer/coupons')),
                      _MenuItem(Icons.account_balance_wallet_outlined, 'My Wallet', () => context.push('/customer/wallet')),
                      _MenuItem(Icons.payments_outlined, 'Payments', () => context.push('/customer/payments')),
                      _MenuItem(Icons.currency_rupee_outlined, 'Refunds', () => context.push('/customer/refunds')),
                      _MenuItem(Icons.rate_review_outlined, 'My Reviews', () => context.push('/customer/reviews')),
                    ]),
                    const SizedBox(height: 16),
                    const SectionHeader(title: 'More'),
                    const SizedBox(height: 10),
                    _menuGroup([
                      _MenuItem(Icons.eco_outlined, 'Harvest Pre-orders', () => context.push('/customer/preorders')),
                      _MenuItem(Icons.event_available_outlined, 'Pickups', () => context.push('/customer/pickups')),
                      _MenuItem(Icons.local_shipping_outlined, 'My Deliveries', () => context.push('/customer/my-deliveries')),
                      _MenuItem(Icons.schedule_outlined, 'Delivery Slots', () => context.push('/customer/delivery-slots')),
                      _MenuItem(Icons.spa_outlined, 'Harvests', () => context.push('/customer/harvests')),
                      _MenuItem(Icons.eco_outlined, 'My Impact', () => context.push('/customer/impact')),
                      _MenuItem(Icons.notifications_active_outlined, 'Price & Stock Alerts', () => context.push('/customer/alerts')),
                      _MenuItem(Icons.chat_bubble_outline, 'Messages', () => context.push('/customer/chat')),
                      _MenuItem(Icons.notifications_outlined, 'Notifications', () => context.push('/customer/notifications')),
                    ]),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: _logout,
                        icon: const Icon(Icons.logout, color: AppTheme.error),
                        label: const Text('Logout', style: TextStyle(color: AppTheme.error)),
                        style: OutlinedButton.styleFrom(side: const BorderSide(color: AppTheme.error)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildProfileCard() {
    final user = _user;
    final name = user?['name'] as String? ?? 'User';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: AppTheme.brandGradient,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 34,
            backgroundColor: Colors.white.withValues(alpha: 0.2),
            child: Text(
              name.isNotEmpty ? name[0].toUpperCase() : 'U',
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
                const SizedBox(height: 4),
                Text(
                  user?['email'] as String? ?? '',
                  style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.85)),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (user?['phone'] != null)
                  Text(
                    user!['phone'] as String,
                    style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.85)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderQuickActions() {
    return Row(
      children: [
        _quickAction(Icons.paid_outlined, 'Orders', () => context.push('/customer/orders')),
        const SizedBox(width: 10),
        _quickAction(Icons.shopping_bag_outlined, 'Pickups', () => context.push('/customer/pickups')),
        const SizedBox(width: 10),
        _quickAction(Icons.local_shipping_outlined, 'Deliveries', () => context.push('/customer/my-deliveries')),
        const SizedBox(width: 10),
        _quickAction(Icons.favorite_outline, 'Wishlist', () => context.push('/customer/wishlist')),
      ],
    );
  }

  Widget _quickAction(IconData icon, String label, VoidCallback onTap) {
    return Expanded(
      child: ActionCard(icon: icon, label: label, onTap: onTap, color: AppTheme.primaryGreen),
    );
  }

  Widget _menuGroup(List<_MenuItem> items) {
    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: 4),
      showShadow: true,
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0)
              const Divider(height: 1, indent: 56, color: AppTheme.border),
            _menuTile(items[i]),
          ],
        ],
      ),
    );
  }

  Widget _menuTile(_MenuItem item) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppTheme.primarySoft,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(item.icon, color: AppTheme.primaryGreen, size: 20),
      ),
      title: Text(item.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
      trailing: const Icon(Icons.chevron_right, color: AppTheme.textTertiary),
      onTap: item.onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
    );
  }
}

class _MenuItem {
  final IconData icon;
  final String title;
  final VoidCallback onTap;
  const _MenuItem(this.icon, this.title, this.onTap);
}