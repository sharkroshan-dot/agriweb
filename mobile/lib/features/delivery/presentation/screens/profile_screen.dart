import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/providers/delivery_controller.dart';

class DeliveryProfileScreen extends StatefulWidget {
  const DeliveryProfileScreen({super.key});
  @override
  State<DeliveryProfileScreen> createState() => _DeliveryProfileScreenState();
}

class _DeliveryProfileScreenState extends State<DeliveryProfileScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _profile;
  bool _isAvailable = true;
  bool _uploadingLicense = false;

  String _avatarInitial() {
    final name = (_profile?['name'] as String? ?? '').trim();
    if (name.isEmpty) return 'D';
    return name[0].toUpperCase();
  }

  String get _photoBase {
    final base = ApiService.baseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
    return base;
  }

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery/me/profile');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? res;
      DeliveryController.instance?.syncProfile(data);
      setState(() {
        _profile = data;
        _isAvailable = data['isAvailable'] as bool? ?? true;
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
      setState(() {
        _isAvailable = controller.isAvailable;
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(controller.isAvailable ? 'You are now available' : 'You are offline'),
        backgroundColor: controller.isAvailable ? AppTheme.success : AppTheme.textSecondary,
      ));
    } else {
      setState(() => _isAvailable = controller.isAvailable);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Failed to update'),
        backgroundColor: AppTheme.error,
      ));
    }
  }

  Future<void> _pickAndUploadLicense() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 85);
    if (picked == null) return;
    setState(() => _uploadingLicense = true);
    try {
      await ApiService.uploadFile('/delivery/me/documents/driving-license', picked.path, 'photo');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Driving licence submitted for verification'),
        backgroundColor: AppTheme.success,
      ));
      await _loadProfile();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Upload failed, please try again'),
        backgroundColor: AppTheme.error,
      ));
    } finally {
      if (mounted) setState(() => _uploadingLicense = false);
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
      appBar: AppBar(title: const Text('My Profile')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _profile == null
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.cloud_off_outlined, size: 56, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                    const SizedBox(height: 12),
                    const Text("Couldn't load your profile", style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    const Text('Check your connection and try again', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    const SizedBox(height: 20),
                    ElevatedButton.icon(
                      onPressed: _loadProfile,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              )
            : SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 40,
                        backgroundColor: Colors.white.withValues(alpha: 0.2),
                        child: Text(
                          _avatarInitial(),
                          style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.white),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(_profile!['name'] as String? ?? 'Delivery Partner', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                      Text(_profile!['email'] as String? ?? '', style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.8))),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('Status: ', style: TextStyle(fontSize: 14, color: Colors.white.withValues(alpha: 0.8))),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            decoration: BoxDecoration(
                              color: _isAvailable ? AppTheme.success : AppTheme.error,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              _isAvailable ? 'Available' : 'Offline',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                _buildVehicleInfo(),
                const SizedBox(height: 16),
                _buildDrivingLicenseCard(),
                const SizedBox(height: 16),
                _buildStats(),
                const SizedBox(height: 16),
                _buildAvailabilityToggle(),
                const SizedBox(height: 20),
                Container(
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
                  child: Column(
                    children: [
                      _menuTile(Icons.dashboard_outlined, 'Dashboard', () => context.push('/delivery/dashboard')),
                      _menuTile(Icons.local_shipping_outlined, 'Active Deliveries', () => context.push('/delivery/deliveries')),
                      _menuTile(Icons.route_outlined, 'Live Route', () => context.push('/delivery/route')),
                      _menuTile(Icons.map_outlined, 'Order Map', () => context.push('/delivery/order-map')),
                      _menuTile(Icons.history_outlined, 'History', () => context.push('/delivery/history')),
                      _menuTile(Icons.account_balance_wallet_outlined, 'Earnings', () => context.push('/delivery/earnings')),
                      _menuTile(Icons.support_agent, 'Help & Support', () => context.push('/delivery/support')),
                      _menuTile(Icons.settings_outlined, 'Settings', () => context.push('/delivery/settings')),
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

  Widget _buildVehicleInfo() {
    final vehicle = _profile!['vehicle'] is Map ? _profile!['vehicle'] as Map<String, dynamic> : null;
    if (vehicle == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
        child: Row(
          children: [
            Icon(Icons.two_wheeler_outlined, color: AppTheme.textSecondary, size: 32),
            const SizedBox(width: 12),
            Text('No vehicle info', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.two_wheeler_outlined, color: AppTheme.primaryGreen, size: 24),
              const SizedBox(width: 8),
              Text('Vehicle Info', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            ],
          ),
          const SizedBox(height: 12),
          _infoRow('Type', vehicle['type'] as String? ?? 'Two Wheeler'),
          _infoRow('Registration', vehicle['registrationNo'] as String? ?? 'N/A'),
          _infoRow('Model', vehicle['model'] as String? ?? 'N/A'),
        ],
      ),
    );
  }

  Widget _buildDrivingLicenseCard() {
    final dl = _profile!['drivingLicense'] is Map ? _profile!['drivingLicense'] as Map<String, dynamic> : null;
    final status = dl?['status'] as String? ?? 'not_submitted';
    final photoUrl = dl?['photoUrl'] as String?;

    final String statusText;
    final Color statusColor;
    switch (status) {
      case 'verified':
        statusText = 'Verified';
        statusColor = AppTheme.success;
        break;
      case 'submitted':
        statusText = 'Under review';
        statusColor = AppTheme.accent;
        break;
      case 'rejected':
        statusText = 'Rejected';
        statusColor = AppTheme.error;
        break;
      default:
        statusText = 'Not submitted';
        statusColor = AppTheme.textSecondary;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.verified_user_outlined, color: AppTheme.primaryGreen, size: 24),
              const SizedBox(width: 8),
              Text('Documents', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Text('Driving licence: ', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                child: Text(statusText, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor)),
              ),
            ],
          ),
          if (photoUrl != null) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.network(
                '$_photoBase$photoUrl',
                height: 110,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  height: 110,
                  width: double.infinity,
                  color: AppTheme.background,
                  child: const Icon(Icons.broken_image_outlined, color: AppTheme.textSecondary),
                ),
              ),
            ),
          ],
          if (dl?['remark'] != null && status == 'rejected') ...[
            const SizedBox(height: 8),
            Text('Admin note: ${dl!['remark']}', style: const TextStyle(fontSize: 12, color: AppTheme.error)),
          ],
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: status == 'verified' || _uploadingLicense ? null : _pickAndUploadLicense,
              icon: _uploadingLicense
                ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.upload_file, size: 18),
              label: Text(_uploadingLicense
                ? 'Uploading...'
                : status == 'verified'
                  ? 'Verified'
                  : status == 'submitted'
                    ? 'Resubmit licence'
                    : 'Upload driving licence'),
              style: OutlinedButton.styleFrom(side: const BorderSide(color: AppTheme.primaryGreen), foregroundColor: AppTheme.primaryGreen),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStats() {
    return Row(
      children: [
        Expanded(child: _StatCard(
          title: 'Total Deliveries',
          value: '${_profile!['totalDeliveries'] ?? '0'}',
          icon: Icons.check_circle_outline,
          color: AppTheme.primaryGreen,
        )),
        const SizedBox(width: 12),
        Expanded(child: _StatCard(
          title: 'Total Earnings',
          value: 'Rs ${(_profile!['totalEarnings'] as num?)?.toStringAsFixed(0) ?? '0'}',
          icon: Icons.account_balance_wallet_outlined,
          color: AppTheme.accent,
        )),
        Expanded(child: _StatCard(
          title: 'Rating',
          value: '${(_profile!['rating'] as num?)?.toStringAsFixed(1) ?? '0.0'}',
          icon: Icons.star,
          color: AppTheme.accent,
        )),
      ],
    );
  }

  Widget _buildAvailabilityToggle() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _isAvailable ? AppTheme.success.withValues(alpha: 0.05) : AppTheme.error.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _isAvailable ? AppTheme.success.withValues(alpha: 0.3) : AppTheme.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(
            _isAvailable ? Icons.wifi : Icons.wifi_off,
            color: _isAvailable ? AppTheme.success : AppTheme.error,
            size: 28,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_isAvailable ? 'You are Available' : 'You are Offline', style: TextStyle(fontWeight: FontWeight.w600, color: _isAvailable ? AppTheme.success : AppTheme.error)),
                Text(_isAvailable ? 'New deliveries will be assigned to you' : 'You won\'t receive new assignments', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Switch(
            value: _isAvailable,
            onChanged: (_) => _toggleAvailability(),
            activeColor: AppTheme.primaryGreen,
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Text('$label: ', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
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

class _StatCard extends StatelessWidget {
  final String title, value;
  final IconData icon;
  final Color color;
  const _StatCard({required this.title, required this.value, required this.icon, required this.color});

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
          Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          Text(title, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}
