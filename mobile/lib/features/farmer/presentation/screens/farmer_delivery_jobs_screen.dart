import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

/// Farmer-side delivery job management.
///
/// Mirrors the order-map pipeline for each job:
/// open (post to partners) -> process (order to processing) -> ready
/// (order to ready_for_delivery) -> partner accepts -> delivered.
/// Self-delivery switches close the job automatically.
class FarmerDeliveryJobsScreen extends StatefulWidget {
  const FarmerDeliveryJobsScreen({super.key});
  @override
  State<FarmerDeliveryJobsScreen> createState() => _FarmerDeliveryJobsScreenState();
}

class _FarmerDeliveryJobsScreenState extends State<FarmerDeliveryJobsScreen> {
  bool _isLoading = true;
  bool _isOpeningRemaining = false;
  List<Map<String, dynamic>> _jobs = [];
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _loadJobs();
  }

  Future<void> _loadJobs() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/delivery-map/jobs');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() => _jobs = (data['jobs'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _openRemaining() async {
    setState(() => _isOpeningRemaining = true);
    try {
      final res = await ApiService.post('/farmers/me/delivery-map/jobs/open-remaining', body: {'minutes': 120});
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      final opened = data['opened'] ?? 0;
      _loadJobs();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Delivery jobs opened for $opened orders'),
        backgroundColor: AppTheme.success,
      ));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message), backgroundColor: AppTheme.error));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to open jobs'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _isOpeningRemaining = false);
    }
  }

  Future<void> _jobAction(String orderId, String endpoint, String successMessage) async {
    try {
      await ApiService.post('/farmers/me/delivery-map/jobs/$orderId/$endpoint', body: {'minutes': 120});
      if (!mounted) return;
      _loadJobs();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(successMessage),
        backgroundColor: AppTheme.success,
      ));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message), backgroundColor: AppTheme.error));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Action failed'), backgroundColor: AppTheme.error));
    }
  }

  Future<void> _confirmClose(String orderId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Close delivery job?'),
        content: const Text('Partners will no longer see this job. You can open it again later.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Close Job'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _jobAction(orderId, 'close', 'Delivery job closed');
    }
  }

  List<Map<String, dynamic>> get _filteredJobs {
    if (_filter == 'all') return _jobs;
    return _jobs.where((j) => (j['status'] as String? ?? '') == _filter).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Delivery Jobs'),
        actions: [
          IconButton(
            tooltip: 'Open jobs for remaining orders',
            onPressed: _isOpeningRemaining ? null : _openRemaining,
            icon: _isOpeningRemaining
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.rocket_launch_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          _buildFilterBar(),
          Expanded(
            child: _isLoading
              ? const Center(child: CircularProgressIndicator())
              : _filteredJobs.isEmpty
                  ? _emptyState()
                  : RefreshIndicator(
                      onRefresh: _loadJobs,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _filteredJobs.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (_, i) => _buildJobCard(_filteredJobs[i]),
                      ),
                    ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterBar() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      color: AppTheme.background,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: ['all', 'open', 'accepted', 'no_partner_found', 'delivered', 'cancelled'].map((s) {
            final isActive = _filter == s;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                label: Text(_filterLabel(s), style: TextStyle(fontSize: 12, color: isActive ? Colors.white : AppTheme.textPrimary)),
                selected: isActive,
                selectedColor: AppTheme.primaryGreen,
                onSelected: (_) => setState(() => _filter = s),
                checkmarkColor: Colors.white,
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  String _filterLabel(String s) {
    switch (s) {
      case 'all': return 'All';
      case 'open': return 'Open';
      case 'accepted': return 'Accepted';
      case 'no_partner_found': return 'No Partner';
      case 'delivered': return 'Delivered';
      case 'cancelled': return 'Closed';
      default: return s[0].toUpperCase() + s.substring(1);
    }
  }

  Widget _emptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.rocket_launch_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
          const SizedBox(height: 16),
          Text('No delivery jobs here', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
          const SizedBox(height: 8),
          Text('Open jobs for unassigned orders using the launch icon above',
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary), textAlign: TextAlign.center),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _isOpeningRemaining ? null : _openRemaining,
            icon: const Icon(Icons.rocket_launch_outlined),
            label: Text(_isOpeningRemaining ? 'Opening...' : 'Open Jobs for Remaining Orders'),
          ),
        ],
      ),
    );
  }

  Widget _buildJobCard(Map<String, dynamic> job) {
    final orderId = job['orderId'] as String? ?? '';
    final orderNumber = job['orderNumber'] as String? ?? '';
    final status = job['status'] as String? ?? '';
    final orderStatus = job['orderStatus'] as String? ?? '';
    final weight = (job['weightKg'] as num?)?.toDouble() ?? 0;
    final earnings = (job['earnings'] as num?)?.toDouble() ?? 0;
    final distance = (job['distanceKm'] as num?)?.toDouble();
    final eligibleCount = job['eligibleCount'] as int? ?? 0;
    final selfDelivery = job['selfDelivery'] == true;

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
                decoration: BoxDecoration(color: _statusColor(status).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                child: Icon(_statusIcon(status), color: _statusColor(status), size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Order $orderNumber', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    Text('#${orderId.isEmpty ? '---' : orderId.substring(0, 8).toUpperCase()}', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: _statusColor(status).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                child: Text(_statusLabel(status), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _statusColor(status))),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _pipelineStep('Process', orderStatus == 'processing' || orderStatus == 'ready_for_delivery' || orderStatus == 'in_transit' || orderStatus == 'delivered')),
              _pipelineConnector(),
              Expanded(child: _pipelineStep('Ready', orderStatus == 'ready_for_delivery' || orderStatus == 'in_transit' || orderStatus == 'delivered')),
              _pipelineConnector(),
              Expanded(child: _pipelineStep('Pickup', status == 'accepted' || status == 'delivered')),
              _pipelineConnector(),
              Expanded(child: _pipelineStep('Delivered', status == 'delivered')),
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
              const Spacer(),
              _infoChip(Icons.people_outline, '$eligibleCount partners'),
            ],
          ),
          const SizedBox(height: 12),
          _buildActions(job, orderId, status, orderStatus, selfDelivery),
        ],
      ),
    );
  }

  Widget _buildActions(Map<String, dynamic> job, String orderId, String status, String orderStatus, bool selfDelivery) {
    final List<Widget> actions = [];

    void addFilled(String label, String endpoint, String msg, {Color? color}) {
      actions.add(SizedBox(
        width: double.infinity,
        height: 36,
        child: ElevatedButton(
          onPressed: () => _jobAction(orderId, endpoint, msg),
          style: ElevatedButton.styleFrom(
            backgroundColor: color ?? AppTheme.primaryGreen,
            foregroundColor: Colors.white,
            minimumSize: Size.zero,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        ),
      ));
    }

    void addOutlined(String label, VoidCallback onTap) {
      actions.add(SizedBox(
        width: double.infinity,
        height: 36,
        child: OutlinedButton(
          onPressed: onTap,
          style: OutlinedButton.styleFrom(minimumSize: Size.zero, padding: EdgeInsets.zero),
          child: Text(label, style: const TextStyle(fontSize: 12)),
        ),
      ));
    }

    if (selfDelivery) {
      actions.add(Container(
        width: double.infinity,
        height: 36,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
        child: const Text('Self Delivery', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.accent)),
      ));
    }

    if (orderStatus == 'pending' || orderStatus == 'confirmed') {
      addFilled('Process', 'process', 'Order is now being processed', color: const Color(0xFF3B82F6));
    } else if (orderStatus == 'processing') {
      addFilled('Ready for Delivery', 'ready', 'Order is ready for delivery');
    }

    if (status == 'open') {
      addOutlined('Close', () => _confirmClose(orderId));
      if (orderStatus != 'ready_for_delivery') {
        addOutlined('Ready', () => _jobAction(orderId, 'ready', 'Order is ready for delivery'));
      }
    } else if (status == 'no_partner_found' || status == 'expired' || status == 'cancelled') {
      addFilled('Re-open / Extend', 'extend', 'Job re-opened', color: AppTheme.accent);
    }

    if (actions.isEmpty) {
      return Container(
        width: double.infinity,
        height: 30,
        alignment: Alignment.centerLeft,
        child: Text('No pending actions for this job', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, action) in actions.indexed) ...[
          if (i > 0) const SizedBox(height: 8),
          action,
        ],
      ],
    );
  }

  Widget _pipelineStep(String label, bool active) {
    return Column(
      children: [
        Icon(
          active ? Icons.check_circle : Icons.radio_button_unchecked,
          size: 16,
          color: active ? AppTheme.success : AppTheme.border,
        ),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(fontSize: 10, color: active ? AppTheme.success : AppTheme.textSecondary)),
      ],
    );
  }

  Widget _pipelineConnector() {
    return Container(width: 14, height: 1, color: AppTheme.border, margin: const EdgeInsets.only(bottom: 16));
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

  String _statusLabel(String status) {
    switch (status) {
      case 'open': return 'Open';
      case 'accepted': return 'Accepted';
      case 'no_partner_found': return 'No Partner';
      case 'expired': return 'Expired';
      case 'cancelled': return 'Closed';
      case 'delivered': return 'Delivered';
      default: return status.isEmpty ? 'Unknown' : status[0].toUpperCase() + status.substring(1);
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'open': return Icons.rocket_launch_outlined;
      case 'accepted': return Icons.local_shipping_outlined;
      case 'no_partner_found': return Icons.people_outline;
      case 'expired': return Icons.timer_off_outlined;
      case 'cancelled': return Icons.close;
      case 'delivered': return Icons.check_circle_outline;
      default: return Icons.work_outline;
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'open': return AppTheme.accent;
      case 'accepted': return const Color(0xFF3B82F6);
      case 'no_partner_found': return AppTheme.error;
      case 'expired': return AppTheme.textSecondary;
      case 'cancelled': return AppTheme.textSecondary;
      case 'delivered': return AppTheme.success;
      default: return AppTheme.textSecondary;
    }
  }
}
