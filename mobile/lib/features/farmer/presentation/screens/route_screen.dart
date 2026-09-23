import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/widgets/map_view.dart';

class FarmerRouteScreen extends StatefulWidget {
  const FarmerRouteScreen({super.key});
  @override
  State<FarmerRouteScreen> createState() => _FarmerRouteScreenState();
}

class _FarmerRouteScreenState extends State<FarmerRouteScreen> {
  bool _isLoading = true;
  bool _isOptimizing = false;
  List<Map<String, dynamic>> _stops = [];

  @override
  void initState() {
    super.initState();
    _loadStops();
  }

  Future<void> _loadStops() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery/route/stops');
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() => _stops = data.cast<Map<String, dynamic>>());
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

  (double?, double?) _coords(Map<String, dynamic> s) {
    final latRaw = s['lat'] ?? s['latitude'];
    final lngRaw = s['lng'] ?? s['longitude'];
    if (latRaw is num && lngRaw is num) return (latRaw.toDouble(), lngRaw.toDouble());
    final address = s['address'];
    if (address is Map) {
      final loc = address['location'] ?? address['coordinates'];
      if (loc is Map && loc['coordinates'] is List && (loc['coordinates'] as List).length == 2) {
        final c = loc['coordinates'] as List;
        if (c[0] is num && c[1] is num) return (c[1].toDouble(), c[0].toDouble());
      }
      if (loc is List && loc.length == 2 && loc[0] is num && loc[1] is num) {
        return (loc[1].toDouble(), loc[0].toDouble());
      }
    }
    return (null, null);
  }

  Widget _buildRouteMap() {
    final points = <MapPoint>[];
    for (var i = 0; i < _stops.length; i++) {
      final (lat, lng) = _coords(_stops[i]);
      if (lat != null && lng != null) {
        points.add(MapPoint(
          lat: lat,
          lng: lng,
          label: _stops[i]['customerName'] as String? ?? 'Stop',
          color: '${_stops[i]['status'] ?? ''}'.toLowerCase() == 'completed'
              ? AppTheme.textSecondary
              : AppTheme.primaryGreen,
        ));
      }
    }
    return MapView(points: points, height: 220);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery Route Planning')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              if (_stops.isNotEmpty)
                Container(
                  padding: const EdgeInsets.all(16),
                  color: AppTheme.primaryGreen.withValues(alpha: 0.05),
                  child: Row(
                    children: [
                      Icon(Icons.route, color: AppTheme.primaryGreen),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${_stops.length} delivery stops', style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text('Total distance calculated', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                          ],
                        ),
                      ),
                      ElevatedButton.icon(
                        onPressed: _isOptimizing ? null : _optimizeRoute,
                        icon: _isOptimizing
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.auto_fix_high, size: 16),
                        label: Text(_isOptimizing ? '...' : 'Optimize'),
                        style: ElevatedButton.styleFrom(minimumSize: const Size(0, 36), padding: const EdgeInsets.symmetric(horizontal: 12)),
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: _stops.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.route_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                          const SizedBox(height: 16),
                          Text('No delivery stops', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                          const SizedBox(height: 8),
                          Text('Orders assigned for delivery will appear here', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                        ],
                      ),
                    )
                  : Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                          child: _buildRouteMap(),
                        ),
                        Expanded(
                          child: RefreshIndicator(
                            onRefresh: _loadStops,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _stops.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) {
                          final stop = _stops[i];
                          final address = stop['address'] is Map ? stop['address'] as Map<String, dynamic> : {};
                          final customerName = stop['customerName'] as String? ?? 'Customer';
                          final status = stop['status'] as String? ?? 'pending';
                          final estimatedTime = stop['estimatedTime'] as String? ?? '';

                          return Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppTheme.border),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 32, height: 32,
                                  decoration: BoxDecoration(
                                    color: i == 0 ? AppTheme.primaryGreen : AppTheme.textSecondary.withValues(alpha: 0.2),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Center(
                                    child: Text('${i + 1}', style: TextStyle(
                                      color: i == 0 ? Colors.white : AppTheme.textSecondary,
                                      fontWeight: FontWeight.bold, fontSize: 13,
                                    )),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(customerName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                      if (address['street'] != null) Text(address['street'] as String, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                      if (address['city'] != null) Text('${address['city']}', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                    ],
                                  ),
                                ),
                                if (estimatedTime.isNotEmpty)
                                  Text(estimatedTime, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: status == 'completed' ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.accent.withValues(alpha: 0.1),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    status[0].toUpperCase() + status.substring(1),
                                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: status == 'completed' ? AppTheme.success : AppTheme.accent),
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
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
}
