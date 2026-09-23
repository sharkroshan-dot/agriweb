import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerProfileScreen extends StatefulWidget {
  const FarmerProfileScreen({super.key});
  @override
  State<FarmerProfileScreen> createState() => _FarmerProfileScreenState();
}

class _FarmerProfileScreenState extends State<FarmerProfileScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _profile;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/profile');
      if (!mounted) return;
      setState(() => _profile = res['data'] as Map<String, dynamic>? ?? res);
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
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error), child: const Text('Logout')),
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
      appBar: AppBar(title: const Text('Farmer Profile')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 44,
                        backgroundColor: Colors.white.withValues(alpha: 0.2),
                        child: Icon(Icons.store, size: 44, color: Colors.white),
                      ),
                      const SizedBox(height: 12),
                      Text(_profile!['farmName'] as String? ?? _profile!['name'] as String? ?? 'Farm Name', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                      const SizedBox(height: 4),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.location_on, size: 14, color: Colors.white.withValues(alpha: 0.8)),
                          const SizedBox(width: 4),
                          Text(_profile!['location'] as String? ?? 'Location not set', style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.8))),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        decoration: BoxDecoration(
                          color: (_profile!['isVerified'] as bool? ?? false) ? AppTheme.success.withValues(alpha: 0.2) : AppTheme.accent.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              (_profile!['isVerified'] as bool? ?? false) ? Icons.verified : Icons.pending_outlined,
                              size: 16, color: (_profile!['isVerified'] as bool? ?? false) ? AppTheme.success : AppTheme.accent,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              (_profile!['isVerified'] as bool? ?? false) ? 'Verified Farmer' : 'Pending Verification',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: (_profile!['isVerified'] as bool? ?? false) ? AppTheme.success : AppTheme.accent),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
                  child: Column(
                    children: [
                      _detailRow(Icons.person_outline, 'Contact Name', _profile!['name'] as String? ?? ''),
                      const Divider(),
                      _detailRow(Icons.email_outlined, 'Email', _profile!['email'] as String? ?? ''),
                      const Divider(),
                      _detailRow(Icons.phone_outlined, 'Phone', _profile!['phone'] as String? ?? ''),
                      const Divider(),
                      _detailRow(Icons.location_on_outlined, 'Address', _profile!['address'] as String? ?? ''),
                      const Divider(),
                      _detailRow(Icons.category_outlined, 'Crops Grown', (_profile!['crops'] as List<dynamic>?)?.join(', ') ?? 'Not specified'),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                Container(
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
                  child: Column(
                    children: [
                      _menuTile(Icons.dashboard_outlined, 'Dashboard', () => context.push('/farmer/dashboard')),
                      _menuTile(Icons.inventory_2_outlined, 'My Products', () => context.push('/farmer/products')),
                      _menuTile(Icons.receipt_outlined, 'Orders', () => context.push('/farmer/orders')),
                      _menuTile(Icons.bar_chart_outlined, 'Analytics', () => context.push('/farmer/analytics')),
                      _menuTile(Icons.account_balance_wallet_outlined, 'Earnings & Withdraw', () => context.push('/farmer/earnings')),
                      _menuTile(Icons.chat_bubble_outline, 'Messages', () => context.push('/farmer/chat')),
                      _menuTile(Icons.route_outlined, 'Route Planning', () => context.push('/farmer/route')),
                      _menuTile(Icons.eco_outlined, 'Impact', () => context.push('/farmer/impact')),
                      _menuTile(Icons.map_outlined, 'Order Map', () => context.push('/farmer/order-map')),
                      _menuTile(Icons.calendar_month_outlined, 'Delivery Schedule', () => context.push('/farmer/delivery-schedule/new')),
                      _menuTile(Icons.security_outlined, 'Security', () => context.push('/farmer/security')),
                      _menuTile(Icons.settings_outlined, 'Settings', () => context.push('/farmer/settings')),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _logout,
                    icon: const Icon(Icons.logout, color: AppTheme.error),
                    label: const Text('Logout', style: TextStyle(color: AppTheme.error)),
                    style: OutlinedButton.styleFrom(side: const BorderSide(color: AppTheme.error)),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
    );
  }

  Widget _detailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppTheme.textSecondary),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                Text(value.isNotEmpty ? value : 'Not set', style: const TextStyle(fontWeight: FontWeight.w500)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _menuTile(IconData icon, String title, VoidCallback onTap) {
    return ListTile(
      leading: Icon(icon, color: AppTheme.textSecondary),
      title: Text(title, style: const TextStyle(fontSize: 14)),
      trailing: const Icon(Icons.chevron_right, color: AppTheme.textSecondary),
      onTap: onTap,
    );
  }
}
