import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:geolocator/geolocator.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/services/location_service.dart';

/// Delivery job marketplace for partners.
///
/// Shows the open marketplace jobs near the driver (privacy-safe: address and
/// phone are hidden until acceptance) and the jobs the partner already accepted.
/// Following the order-map pipeline, a job can only be accepted once the
/// farmer has processed the order and marked it ready for delivery.
class DeliveryJobsScreen extends StatefulWidget {
  const DeliveryJobsScreen({super.key});
  @override
  State<DeliveryJobsScreen> createState() => _DeliveryJobsScreenState();
}

class _DeliveryJobsScreenState extends State<DeliveryJobsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  String? _locationError;
  int _selectedRadius = 60;
  List<Map<String, dynamic>> _openJobs = [];
  List<Map<String, dynamic>> _acceptedJobs = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadJobs();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<Position?> _getLivePosition() async {
    final result = await LocationService.currentPosition();
    if (result.ok) return result.position;
    final message = switch (result.failure) {
      LocationFailure.serviceDisabled => 'Turn on location to see nearby delivery jobs',
      LocationFailure.permissionDenied => 'Location permission is required for nearby jobs',
      _ => 'Unable to get your live location. Please try again.',
    };
    setState(() => _locationError = message);
    return null;
  }

  Future<void> _loadJobs() async {
    setState(() {
      _isLoading = true;
      _locationError = null;
    });
    try {
      final position = await _getLivePosition();
      if (position == null) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }
      await ApiService.put('/delivery/me/location', body: {
        'latitude': position.latitude,
        'longitude': position.longitude,
      });
      final res = await ApiService.get('/delivery/me/jobs', params: {
        'lat': position.latitude.toString(),
        'lng': position.longitude.toString(),
        'radius': _selectedRadius.toString(),
      });
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _openJobs = (data['openJobs'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        _acceptedJobs = (data['acceptedJobs'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _locationError = 'Unable to load delivery jobs');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _acceptJob(String jobId) async {
    try {
      await ApiService.post('/delivery/jobs/$jobId/accept');
      if (!mounted) return;
      _loadJobs();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Delivery job accepted'), backgroundColor: AppTheme.success),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.message),
        backgroundColor: AppTheme.error,
      ));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to accept job'), backgroundColor: AppTheme.error));
    }
  }

  String _formatExpiry(String? raw) {
    if (raw == null || raw.isEmpty) return '';
    try {
      final dt = DateTime.parse(raw).toLocal();
      return 'Ends ${DateFormat('hh:mm a').format(dt)}';
    } catch (_) {
      return raw;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Delivery Jobs'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.primaryGreen,
          labelColor: AppTheme.primaryGreen,
          unselectedLabelColor: AppTheme.textSecondary,
          tabs: const [
            Tab(text: 'Available'),
            Tab(text: 'Accepted'),
          ],
        ),
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : TabBarView(
            controller: _tabController,
            children: [
              _buildAvailableTab(),
              _buildAcceptedTab(),
            ],
          ),
    );
  }

  Widget _buildAvailableTab() {
    return RefreshIndicator(
      onRefresh: _loadJobs,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              const Expanded(child: Text('Nearby jobs you can accept', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600))),
            ],
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [20, 40, 60, 80, 120].map((radius) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text('$radius km'),
                  selected: _selectedRadius == radius,
                  onSelected: (_) {
                    setState(() => _selectedRadius = radius);
                    _loadJobs();
                  },
                ),
              )).toList(),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _isLoading ? null : _loadJobs,
              icon: const Icon(Icons.my_location, size: 18),
              label: const Text('Refresh Near Me'),
            ),
          ),
          if (_locationError != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_locationError!, style: const TextStyle(color: AppTheme.error, fontSize: 12)),
            ),
          const SizedBox(height: 12),
          if (_openJobs.isEmpty && _locationError == null)
            _emptyState(
              icon: Icons.work_off_outlined,
              title: 'No delivery jobs available',
              subtitle: 'Jobs appear here when farmers open them for partners',
            )
          else if (_openJobs.isEmpty)
            const SizedBox.shrink()
          else
            ..._openJobs.map((job) => _buildOpenJobCard(job)),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildAcceptedTab() {
    return RefreshIndicator(
      onRefresh: _loadJobs,
      child: _acceptedJobs.isEmpty
        ? _emptyState(
            icon: Icons.inventory_2_outlined,
            title: 'No accepted jobs',
            subtitle: 'Accepted jobs with full customer details appear here',
          )
        : ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: _acceptedJobs.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) => _buildAcceptedJobCard(_acceptedJobs[i]),
          ),
    );
  }

  Widget _emptyState({required IconData icon, required String title, required String subtitle}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
            const SizedBox(height: 16),
            Text(title, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
            const SizedBox(height: 8),
            Text(subtitle, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary), textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }

  Widget _buildOpenJobCard(Map<String, dynamic> job) {
    final distance = (job['distanceFromPartner'] as num?)?.toDouble();
    final weight = (job['weightKg'] as num?)?.toDouble() ?? 0;
    final earnings = (job['earnings'] as num?)?.toDouble() ?? 0;
    final status = job['status'] as String? ?? '';
    final notReady = (job['orderStatus'] as String? ?? '') != 'ready_for_delivery';
    final disabled = status != 'open' || notReady;
    final expiry = _formatExpiry(job['expiresAt'] as String?);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 1))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                child: const Icon(Icons.work_outline, color: AppTheme.accent, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Order ${job['orderNumber'] ?? '#'}',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    Text('${job['productSummary'] ?? 'Farm produce'} · ${job['deliveryArea'] ?? job['deliveryCity'] ?? 'Delivery'}',
                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              if (notReady)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: AppTheme.textSecondary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                  child: Text('Pending', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.textSecondary)),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _infoChip(Icons.attach_money, kPriceSymbol + earnings.toStringAsFixed(0)),
              const SizedBox(width: 8),
              _infoChip(Icons.monitor_weight_outlined, '${weight.toStringAsFixed(1)} kg'),
              if (distance != null) ...[
                const SizedBox(width: 8),
                _infoChip(Icons.near_me_outlined, '${distance.toStringAsFixed(1)} km'),
              ],
            ],
          ),
          if (job['timeSlot'] != null || job['deliveryDay'] != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.access_time, size: 14, color: AppTheme.textSecondary),
                const SizedBox(width: 4),
                Text('${job['deliveryDay'] ?? 'Today'} · ${job['timeSlot'] ?? ''}',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              ],
            ),
          ],
          if (expiry.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(expiry, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          ],
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 38,
            child: ElevatedButton.icon(
              onPressed: disabled ? null : () => _acceptJob(job['id'] as String? ?? ''),
              icon: const Icon(Icons.check_circle_outline, size: 16),
              label: Text(disabled ? (notReady ? 'Not ready for pickup yet' : 'No longer available') : 'Accept Job', style: const TextStyle(fontSize: 13)),
              style: ElevatedButton.styleFrom(minimumSize: Size.zero),
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppTheme.primaryGreen),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
        ],
      ),
    );
  }

  Widget _buildAcceptedJobCard(Map<String, dynamic> job) {
    final weight = (job['weightKg'] as num?)?.toDouble() ?? 0;
    final earnings = (job['earnings'] as num?)?.toDouble() ?? 0;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 1))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                child: const Icon(Icons.local_shipping, color: AppTheme.primaryGreen, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Order ${job['orderNumber'] ?? '#'}',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    Text(job['customerName'] ?? 'Customer', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: AppTheme.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                child: const Text('Accepted', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.success)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (job['pickupName'] != null || job['pickupAddress'] != null) ...[
            _detailRow(Icons.storefront_outlined, 'Pickup', '${job['pickupName'] ?? 'Farm'}${job['pickupAddress'] != null && (job['pickupAddress'] as String).isNotEmpty ? ' · ${job['pickupAddress']}' : ''}'),
            const SizedBox(height: 6),
          ],
          _detailRow(Icons.location_on_outlined, 'Deliver', '${job['deliveryAddress'] ?? job['deliveryArea'] ?? ''}'),
          const SizedBox(height: 6),
          _detailRow(Icons.phone_outlined, 'Phone', job['customerPhone'] ?? ''),
          const SizedBox(height: 10),
          Row(
            children: [
              _infoChip(Icons.attach_money, kPriceSymbol + earnings.toStringAsFixed(0)),
              const SizedBox(width: 8),
              _infoChip(Icons.monitor_weight_outlined, '${weight.toStringAsFixed(1)} kg'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _detailRow(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 15, color: AppTheme.textSecondary),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            '$label: ${value.isEmpty ? '—' : value}',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
        ),
      ],
    );
  }
}
