import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerSmartRouteScreen extends StatefulWidget {
  const FarmerSmartRouteScreen({super.key});
  @override
  State<FarmerSmartRouteScreen> createState() => _FarmerSmartRouteScreenState();
}

class _FarmerSmartRouteScreenState extends State<FarmerSmartRouteScreen> {
  bool _isLoading = true;
  bool _isOptimizing = false;
  Map<String, dynamic>? _routeData;
  List<Map<String, dynamic>> _stops = [];

  @override
  void initState() {
    super.initState();
    _loadRoute();
  }

  Future<void> _loadRoute() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery/route/stops', params: {'includeSummary': 'true'});
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _routeData = data['summary'] as Map<String, dynamic>?;
        _stops = (data['stops'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _optimizeRoute() async {
    setState(() => _isOptimizing = true);
    try {
      final res = await ApiService.post('/delivery/route/optimize', body: {
        'stops': _stops.map((s) => s['_id']).toList(),
      });
      if (!mounted) return;
      final optimized = res['data'] as List<dynamic>? ?? [];
      setState(() => _stops = optimized.cast<Map<String, dynamic>>());
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Route optimized!'), backgroundColor: AppTheme.success));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to optimize route'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _isOptimizing = false);
    }
  }

  void _startRoute() {
    if (_stops.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No stops to start'), backgroundColor: AppTheme.error));
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Route started! Navigate to first stop.'), backgroundColor: AppTheme.success));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Smart Route')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _loadRoute,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildSummaryCards(),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      Expanded(
                        child: SizedBox(
                          height: 44,
                          child: ElevatedButton.icon(
                            onPressed: _isOptimizing ? null : _optimizeRoute,
                            icon: _isOptimizing
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.auto_fix_high, size: 18),
                            label: Text(_isOptimizing ? 'Optimizing...' : 'Optimize Route'),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: SizedBox(
                          height: 44,
                          child: ElevatedButton.icon(
                            onPressed: _stops.isEmpty ? null : _startRoute,
                            icon: const Icon(Icons.play_arrow, size: 18),
                            label: const Text('Start Route'),
                            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.success),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text('Route Timeline', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const SizedBox(height: 16),
                  if (_stops.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(32),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.border)),
                      child: Column(children: [
                        Icon(Icons.route_outlined, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                        const SizedBox(height: 8),
                        Text('No stops in route', style: TextStyle(color: AppTheme.textSecondary)),
                      ]),
                    )
                  else
                    _buildRouteTimeline(),
                ],
              ),
            ),
          ),
    );
  }

  Widget _buildSummaryCards() {
    final totalDistance = (_routeData?['totalDistance'] as num?)?.toDouble() ?? 0;
    final totalOrders = (_routeData?['totalOrders'] as num?)?.toInt() ?? _stops.length;
    final fuelCost = (_routeData?['fuelCost'] as num?)?.toDouble() ?? 0;
    final totalIncome = (_routeData?['totalIncome'] as num?)?.toDouble() ?? 0;
    final totalTime = (_routeData?['totalTime'] as num?)?.toDouble() ?? 0;
    final totalCustomers = (_routeData?['totalCustomers'] as num?)?.toInt() ?? _stops.length;

    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.2,
      children: [
        _MiniStatCard(icon: Icons.route, label: 'Distance', value: '${totalDistance.toStringAsFixed(1)} km', color: AppTheme.primaryGreen),
        _MiniStatCard(icon: Icons.shopping_bag_outlined, label: 'Orders', value: '$totalOrders', color: const Color(0xFF3B82F6)),
        _MiniStatCard(icon: Icons.local_gas_station, label: 'Fuel Cost', value: 'Rs ${fuelCost.toStringAsFixed(0)}', color: AppTheme.accent),
        _MiniStatCard(icon: Icons.account_balance_wallet, label: 'Income', value: 'Rs ${totalIncome.toStringAsFixed(0)}', color: AppTheme.success),
        _MiniStatCard(icon: Icons.access_time, label: 'Time', value: '${totalTime.toStringAsFixed(0)}h', color: const Color(0xFF8B5CF6)),
        _MiniStatCard(icon: Icons.people, label: 'Customers', value: '$totalCustomers', color: const Color(0xFFEC4899)),
      ],
    );
  }

  Widget _buildRouteTimeline() {
    return Column(
      children: [
        _buildTimelineStop(
          number: 0,
          isFarm: true,
          title: 'Your Farm',
          subtitle: 'Starting point',
          isFirst: true,
        ),
        ..._stops.asMap().entries.map((entry) => _buildTimelineStop(
          number: entry.key + 1,
          isFarm: false,
          title: entry.value['customerName'] as String? ?? 'Customer',
          subtitle: _buildStopSubtitle(entry.value),
          distance: (entry.value['distance'] as num?)?.toDouble(),
          deliveryWindow: entry.value['deliveryWindow'] as String?,
          products: entry.value['products'] as List<dynamic>?,
        )),
        _buildTimelineStop(
          number: _stops.length + 1,
          isFarm: true,
          title: 'Return to Farm',
          subtitle: 'End of route',
          isLast: true,
        ),
      ],
    );
  }

  String _buildStopSubtitle(Map<String, dynamic> stop) {
    final address = stop['address'] is Map ? stop['address'] as Map<String, dynamic> : {};
    final parts = <String>[];
    if (address['street'] != null) parts.add(address['street'] as String);
    if (address['city'] != null) parts.add(address['city'] as String);
    return parts.join(', ');
  }

  Widget _buildTimelineStop({
    required int number,
    required bool isFarm,
    required String title,
    required String subtitle,
    double? distance,
    String? deliveryWindow,
    List<dynamic>? products,
    bool isFirst = false,
    bool isLast = false,
  }) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 40,
            child: Column(
              children: [
                if (!isFirst)
                  Container(width: 2, height: 12, color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
                Container(
                  width: isFarm ? 28 : 32,
                  height: isFarm ? 28 : 32,
                  decoration: BoxDecoration(
                    color: isFarm ? AppTheme.primaryGreen : AppTheme.primaryGreen.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                    border: isFarm ? null : Border.all(color: AppTheme.primaryGreen, width: 2),
                  ),
                  child: Center(
                    child: isFarm
                      ? Icon(Icons.store, size: 14, color: Colors.white)
                      : Text('$number', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                  ),
                ),
                if (!isLast)
                  Flexible(flex: 1, child: Container(width: 2, color: AppTheme.primaryGreen.withValues(alpha: 0.3))),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppTheme.textPrimary)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  if (distance != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Row(
                        children: [
                          Icon(Icons.navigation, size: 14, color: AppTheme.primaryGreen),
                          const SizedBox(width: 4),
                          Text('${distance.toStringAsFixed(1)} km', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: AppTheme.primaryGreen)),
                        ],
                      ),
                    ),
                  if (deliveryWindow != null && deliveryWindow.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Row(
                        children: [
                          Icon(Icons.access_time, size: 14, color: AppTheme.accent),
                          const SizedBox(width: 4),
                          Text(deliveryWindow, style: TextStyle(fontSize: 11, color: AppTheme.accent)),
                        ],
                      ),
                    ),
                  if (products != null && products.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        products.map((p) => p is Map ? p['name'] : '$p').join(', '),
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                        maxLines: 2, overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniStatCard extends StatelessWidget {
  final IconData icon;
  final String label, value;
  final Color color;
  const _MiniStatCard({required this.icon, required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 6),
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          Text(label, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}
