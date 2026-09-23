import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/services/location_service.dart';
import '../../../../shared/widgets/map_view.dart';

class _Stop {
  final String orderId;
  final String customerName;
  final String address;
  final String phone;
  final String eta;
  final double? lat;
  final double? lng;
  final int index;

  const _Stop({
    required this.orderId,
    required this.customerName,
    required this.address,
    required this.phone,
    required this.eta,
    required this.lat,
    required this.lng,
    required this.index,
  });

  factory _Stop.fromJson(Map<String, dynamic> json, int index) {
    final order = json['order'] is Map ? json['order'] as Map<String, dynamic> : <String, dynamic>{};
    final addressRaw = json['address'] is Map
        ? json['address'] as Map<String, dynamic>
        : order['deliveryAddress'] is Map
            ? order['deliveryAddress'] as Map<String, dynamic>
            : <String, dynamic>{};
    final location = addressRaw['location'] is Map
        ? addressRaw['location'] as Map<String, dynamic>
        : <String, dynamic>{};
    final coords = location['coordinates'];
    double? lat;
    double? lng;
    if (coords is List && coords.length >= 2) {
      lng = (coords[0] as num).toDouble();
      lat = (coords[1] as num).toDouble();
    }

    return _Stop(
      orderId: json['orderId'] as String? ?? order['id'] as String? ?? order['_id'] as String? ?? '',
      customerName: json['customerName'] as String? ?? order['customerName'] as String? ?? 'Stop ${index + 1}',
      address: _formatAddress(addressRaw),
      phone: json['customerPhone'] as String? ?? order['customerPhone'] as String? ?? '',
      eta: json['eta'] as String? ?? 'Pending',
      lat: lat,
      lng: lng,
      index: index,
    );
  }

  static String _formatAddress(Map<String, dynamic> addr) {
    final parts = [
      addr['addressLine1'],
      addr['addressLine2'],
      addr['area'],
      addr['city'],
      addr['district'],
      addr['state'],
      addr['pincode'],
    ];
    final filtered = parts.whereType<String>().where((p) => p.trim().isNotEmpty).join(', ');
    if (filtered.isNotEmpty) return filtered;
    final fallback = addr['address'];
    return fallback is String ? fallback : '';
  }
}

class DeliveryRouteScreen extends StatefulWidget {
  const DeliveryRouteScreen({super.key});

  @override
  State<DeliveryRouteScreen> createState() => _DeliveryRouteScreenState();
}

class _DeliveryRouteScreenState extends State<DeliveryRouteScreen> {
  bool _isLoading = true;
  List<_Stop> _stops = [];
  String? _error;
  int _currentStop = 0;
  bool _isNavigating = false;
  int _selectedRadius = 10;
  Position? _livePosition;
  StreamSubscription<Position>? _positionStream;

  static const List<int> _radiusOptions = [5, 10, 20, 25, 50];
  static const List<String> _activeStatuses = [
    'in_transit', 'ready_for_delivery', 'picked_up', 'accepted', 'assigned', 'dispatched',
  ];

  @override
  void initState() {
    super.initState();
    _load();
    _watchPosition();
  }

  @override
  void dispose() {
    _positionStream?.cancel();
    super.dispose();
  }

  Future<void> _watchPosition() async {
    try {
      if (!await LocationService.hasPermission()) return;
      _positionStream = LocationService.positionStream(distanceFilterMeters: 10).listen((pos) {
        _livePosition = pos;
        _syncLocation(pos);
        if (mounted) setState(() {});
      });
    } catch (_) {}
  }

  Future<void> _syncLocation(Position pos) async {
    try {
      await ApiService.put('/delivery/me/location', body: {
        'latitude': pos.latitude,
        'longitude': pos.longitude,
      });
    } catch (_) {}
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiService.get('/delivery/me/route'),
        ApiService.get('/delivery/assignments', params: {'status': 'all', 'limit': '100'}),
        ApiService.get('/delivery/me/today'),
      ]);
      if (!mounted) return;

      final routeRes = results[0];
      final routeData = routeRes['data'];
      final waypoints = routeData is Map ? (routeData['waypoints'] as List<dynamic>? ?? []) : <dynamic>[];
      final routeStops = waypoints
          .whereType<Map<String, dynamic>>()
          .map((w) => _Stop.fromJson(w, 0))
          .toList();

      final assignmentsRes = results[1];
      final assignments = (assignmentsRes['data'] as List<dynamic>? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();

      final todayRes = results[2];
      final todayData = todayRes['data'] is Map
          ? todayRes['data'] as Map<String, dynamic>
          : <String, dynamic>{};
      final todayDeliveries = (todayData['deliveries'] as List<dynamic>? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();

      final combined = [...todayDeliveries, ...assignments];
      final active = combined
          .where((d) => _activeStatuses.contains(d['status'] as String? ?? d['orderStatus'] as String?))
          .toList();

      // Prefer the optimized route order, append active orders not in the route.
      final routeIds = routeStops.map((s) => s.orderId).toSet();
      final extra = active
          .where((d) => !routeIds.contains(d['orderId'] as String? ?? d['id'] as String?))
          .map((d) => _Stop.fromJson(d, 0))
          .toList();

      var stops = [...routeStops, ...extra];
      // Apply live-location radius filter.
      if (_livePosition != null && stops.isNotEmpty) {
        final origin = _livePosition!;
        stops = stops.where((s) {
          if (s.lat == null || s.lng == null) return true;
          return _distanceKm(origin.latitude, origin.longitude, s.lat!, s.lng!) <= _selectedRadius;
        }).toList();
      }
      for (var i = 0; i < stops.length; i++) {
        stops[i] = _copyWithIndex(stops[i], i);
      }
      setState(() => _stops = stops);
    } catch (_) {
      if (mounted) setState(() => _error = 'Unable to load your route');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  _Stop _copyWithIndex(_Stop s, int i) {
    return _Stop(
      orderId: s.orderId,
      customerName: s.customerName,
      address: s.address,
      phone: s.phone,
      eta: s.eta,
      lat: s.lat,
      lng: s.lng,
      index: i,
    );
  }

  double _distanceKm(double lat1, double lng1, double lat2, double lng2) {
    const r = 6371.0;
    final dLat = (lat2 - lat1) * pi / 180;
    final dLng = (lng2 - lng1) * pi / 180;
    final a = sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1 * pi / 180) *
            cos(lat2 * pi / 180) *
            sin(dLng / 2) * sin(dLng / 2);
    return r * 2 * atan2(sqrt(a), sqrt(1 - a));
  }

  Future<void> _openNavigation(_Stop stop) async {
    final destination = stop.lat != null && stop.lng != null
        ? '${stop.lat},${stop.lng}'
        : Uri.encodeComponent(stop.address);
    if (destination.isEmpty) {
      _showSnack('No navigable address for this stop', AppTheme.error);
      return;
    }
    final origin = _livePosition != null
        ? '${_livePosition!.latitude},${_livePosition!.longitude}'
        : '';
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1'
      '${origin.isNotEmpty ? '&origin=$origin' : ''}'
      '&destination=$destination&travelmode=driving',
    );
    try {
      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) _showSnack('Unable to open maps', AppTheme.error);
    } catch (_) {
      if (mounted) _showSnack('Unable to open maps', AppTheme.error);
    }
  }

  Future<void> _openFullRoute() async {
    final navigable = _stops.where((s) => s.lat != null && s.lng != null || s.address.isNotEmpty).toList();
    if (navigable.isEmpty) {
      _showSnack('No delivery addresses available for navigation', AppTheme.error);
      return;
    }
    final origin = _livePosition;
    if (origin == null) {
      _showSnack('Allow location access to start from your current location', AppTheme.error);
      return;
    }
    final destination = navigable.last;
    final destValue = destination.lat != null && destination.lng != null
        ? '${destination.lat},${destination.lng}'
        : Uri.encodeComponent(destination.address);
    final waypoints = navigable.sublist(0, navigable.length - 1).map((s) {
      return s.lat != null && s.lng != null
          ? '${s.lat},${s.lng}'
          : Uri.encodeComponent(s.address);
    }).join('|');
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1'
      '&origin=${origin.latitude},${origin.longitude}'
      '&destination=$destValue'
      '${waypoints.isNotEmpty ? '&waypoints=${Uri.encodeComponent(waypoints)}' : ''}'
      '&travelmode=driving',
    );
    try {
      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) _showSnack('Unable to open maps', AppTheme.error);
    } catch (_) {
      if (mounted) _showSnack('Unable to open maps', AppTheme.error);
    }
  }

  void _call(String? phone) {
    final number = (phone ?? '').replaceAll(RegExp(r'[^\d+]'), '');
    if (number.isEmpty) {
      _showSnack('Customer phone number not available', AppTheme.error);
      return;
    }
    launchUrl(Uri.parse('tel:$number'), mode: LaunchMode.externalApplication).catchError((_) => false);
  }

  void _sms(String? phone) {
    final number = (phone ?? '').replaceAll(RegExp(r'[^\d+]'), '');
    if (number.isEmpty) {
      _showSnack('Customer phone number not available', AppTheme.error);
      return;
    }
    launchUrl(Uri.parse('sms:$number'), mode: LaunchMode.externalApplication).catchError((_) => false);
  }

  Future<void> _completeStop(_Stop stop) async {
    if (stop.orderId.isEmpty) {
      _showSnack('Unable to determine the delivery order', AppTheme.error);
      return;
    }
    try {
      await ApiService.put('/orders/${stop.orderId}/status', body: {'status': 'delivered'});
      if (!mounted) return;
      _showSnack('Delivery completed', AppTheme.success);
    } catch (_) {
      if (!mounted) return;
      _showSnack('Could not mark this order as delivered yet', AppTheme.error);
      return;
    }
    if (mounted) {
      if (_currentStop < _stops.length - 1) {
        setState(() => _currentStop += 1);
      } else {
        setState(() => _isNavigating = false);
        _showSnack('All deliveries completed', AppTheme.success);
      }
      _load();
    }
  }

  void _showSnack(String msg, Color color) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: color));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Live Route')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.route_outlined, size: 64, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildSummaryCard(),
                      if (_stops.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _buildRouteMap(),
                        const SizedBox(height: 16),
                      ],
                      if (_stops.isEmpty) ...[
                        const SizedBox(height: 40),
                        Center(
                          child: Column(
                            children: [
                              Icon(Icons.route_outlined, size: 72, color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
                              const SizedBox(height: 16),
                              const Text('No route assigned', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                              const SizedBox(height: 6),
                              Text('Deliveries scheduled today will appear here', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                            ],
                          ),
                        ),
                      ] else ...[
                        _buildRadiusCard(),
                        const SizedBox(height: 16),
                        _buildStartButton(),
                        const SizedBox(height: 16),
                        ..._stops.map((stop) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _buildStopCard(stop),
                        )),
                        _buildEndCard(),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _buildSummaryCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _stops.isEmpty ? 'No route' : '$_currentStop/${_stops.length} stops',
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 4),
                Text(
                  _isNavigating ? 'Navigation active' : _stops.isEmpty ? 'No route assigned' : 'Route planned',
                  style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.85)),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.15), shape: BoxShape.circle),
            child: const Icon(Icons.alt_route, color: Colors.white, size: 28),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteMap() {
    final points = <MapPoint>[
      for (final s in _stops)
        if (s.lat != null && s.lng != null)
          MapPoint(
            lat: s.lat!,
            lng: s.lng!,
            label: s.customerName,
            color: s.index < _currentStop ? AppTheme.success : AppTheme.primaryGreen,
          ),
    ];
    final live = _livePosition;
    return MapView(
      points: points,
      current: live != null
          ? MapPoint(lat: live.latitude, lng: live.longitude, color: AppTheme.info)
          : null,
      height: 260,
      onPointTap: (p) {
        final stop = _stops.where((s) => s.lat == p.lat && s.lng == p.lng).firstOrNull;
        if (stop != null) _openNavigation(stop);
      },
    );
  }

  Widget _buildRadiusCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Stops within radius', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(
            _livePosition != null
                ? 'Using your live location as the start point'
                : 'Waiting for live GPS location',
            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 10),
          Row(
            children: _radiusOptions.map((r) {
              final selected = _selectedRadius == r;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text('$r km'),
                  selected: selected,
                  onSelected: (_) {
                    setState(() => _selectedRadius = r);
                    _load();
                  },
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildStartButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _isNavigating
            ? () => setState(() => _isNavigating = false)
            : () {
                setState(() => _isNavigating = true);
                _openFullRoute();
              },
        icon: Icon(_isNavigating ? Icons.pause : Icons.navigation, size: 18),
        label: Text(_isNavigating ? 'Stop Navigation' : 'Start Route'),
        style: _isNavigating
            ? ElevatedButton.styleFrom(backgroundColor: AppTheme.error)
            : null,
      ),
    );
  }

  Widget _buildStopCard(_Stop stop) {
    final done = stop.index < _currentStop;
    final current = stop.index == _currentStop && _isNavigating;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: current ? AppTheme.primarySoft : AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(
          color: done ? AppTheme.success.withValues(alpha: 0.5) : current ? AppTheme.primaryGreen : AppTheme.border,
          width: current ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: done ? AppTheme.success : AppTheme.primarySoft,
                  shape: BoxShape.circle,
                ),
                child: done
                    ? const Icon(Icons.check, size: 18, color: Colors.white)
                    : Text(
                        '${stop.index + 1}',
                        style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.primaryDark),
                      ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            stop.customerName,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: done ? AppTheme.success.withValues(alpha: 0.1) : current ? AppTheme.accent.withValues(alpha: 0.12) : AppTheme.surfaceVariant,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            done ? 'Done' : current ? 'Current' : 'Pending',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: done ? AppTheme.success : current ? AppTheme.accent : AppTheme.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      stop.address.isNotEmpty ? stop.address : 'Delivery address',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.3),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.schedule, size: 13, color: AppTheme.textTertiary),
                        const SizedBox(width: 4),
                        Text('ETA: ${stop.eta}', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                        if (_livePosition != null && stop.lat != null && stop.lng != null) ...[
                          const SizedBox(width: 12),
                          const Icon(Icons.near_me, size: 13, color: AppTheme.textTertiary),
                          const SizedBox(width: 4),
                          Text(
                            '${_distanceKm(_livePosition!.latitude, _livePosition!.longitude, stop.lat!, stop.lng!).toStringAsFixed(1)} km',
                            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              IconButton(
                onPressed: () => _call(stop.phone),
                icon: const Icon(Icons.phone_outlined, size: 20),
                color: AppTheme.primaryGreen,
                tooltip: 'Call',
              ),
              IconButton(
                onPressed: () => _sms(stop.phone),
                icon: const Icon(Icons.sms_outlined, size: 20),
                color: AppTheme.info,
                tooltip: 'Message',
              ),
              const Spacer(),
              if (current || !done) ...[
                OutlinedButton.icon(
                  onPressed: () => _openNavigation(stop),
                  icon: const Icon(Icons.navigation, size: 16),
                  label: const Text('Navigate'),
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  onPressed: () => _completeStop(stop),
                  icon: const Icon(Icons.check_circle_outline, size: 16),
                  label: const Text('Deliver'),
                  style: ElevatedButton.styleFrom(minimumSize: const Size(0, 38), backgroundColor: AppTheme.success),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildEndCard() {
    final complete = _stops.isNotEmpty && _currentStop >= _stops.length;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: complete ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: complete ? AppTheme.success : AppTheme.border),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: complete ? AppTheme.success : AppTheme.textTertiary.withValues(alpha: 0.3),
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.flag, size: 18, color: complete ? Colors.white : AppTheme.textSecondary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('End Location', style: TextStyle(fontWeight: FontWeight.w700)),
                Text('Complete all deliveries', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          if (complete)
            const Text('Completed', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.success)),
        ],
      ),
    );
  }
}