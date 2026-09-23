import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/services/location_service.dart';
import '../../../../shared/widgets/map_view.dart';

class DeliveryOrderMapScreen extends StatefulWidget {
  const DeliveryOrderMapScreen({super.key});
  @override
  State<DeliveryOrderMapScreen> createState() => _DeliveryOrderMapScreenState();
}

class _DeliveryOrderMapScreenState extends State<DeliveryOrderMapScreen> {
  static const _radiusOptions = <int>[5, 10, 20, 25, 50];
  static const _hiddenStatuses = {'delivered', 'cancelled', 'refunded', 'failed'};
  static const _readyStatuses = {'ready_for_delivery', 'assigned'};
  static const _acceptedStatuses = {'accepted', 'picked_up', 'in_transit', 'dispatched'};

  bool _isLoading = true;
  bool _locating = false;
  bool _acceptingRoute = false;
  String? _acceptingId;
  String _radiusFilter = '10';
  String? _selectedId;
  String? _locationStatus;
  Position? _position;

  List<Map<String, dynamic>> _orders = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  String _orderId(Map<String, dynamic> d) {
    final raw = d['orderId'] ?? d['order'] is Map ? (d['order'] as Map)['id'] : null;
    if (raw != null) return raw.toString();
    final id = d['id'] ?? d['_id'];
    if (id != null) return id.toString();
    return '';
  }

  String _assignmentId(Map<String, dynamic> d) {
    final raw = d['assignmentId'];
    if (raw != null) return raw.toString();
    final id = d['id'];
    if (id != null && d['orderId'] != null && id.toString() != d['orderId'].toString()) return id.toString();
    return '';
  }

  String _status(Map<String, dynamic> d) => '${d['status'] ?? d['orderStatus'] ?? ''}'.toLowerCase();

  String _customerName(Map<String, dynamic> d) {
    final name = d['customerName'];
    if (name is String && name.isNotEmpty) return name;
    final customer = d['customer'];
    if (customer is Map) {
      final n = customer['name'];
      if (n is String && n.isNotEmpty) return n;
    }
    return 'Delivery order';
  }

  String _customerPhone(Map<String, dynamic> d) {
    final phone = d['customerPhone'];
    if (phone is String && phone.isNotEmpty) return phone;
    final customer = d['customer'];
    if (customer is Map) {
      final p = customer['phone'];
      if (p is String && p.isNotEmpty) return p;
    }
    return '';
  }

  String _formatAddress(dynamic addr) {
    if (addr == null || addr is String) return (addr as String?) ?? 'Address unavailable';
    if (addr is Map) {
      final parts = [
        addr['addressLine1'] ?? addr['address_line1'],
        addr['addressLine2'] ?? addr['address_line2'],
        addr['city'],
        addr['state'],
        addr['zipCode'] ?? addr['zip_code'],
      ].where((p) => p != null && '$p'.isNotEmpty).toList();
      return parts.isEmpty ? 'Address unavailable' : parts.join(', ');
    }
    return 'Address unavailable';
  }

  String _deliveryAddress(Map<String, dynamic> d) {
    final addr = d['deliveryAddress'] ?? (d['order'] is Map ? (d['order'] as Map)['deliveryAddress'] : null) ?? d['address'] ?? (d['customer'] is Map ? (d['customer'] as Map)['address'] : null);
    return _formatAddress(addr);
  }

  (double?, double?) _coords(Map<String, dynamic> d) {
    final latRaw = d['latitude'] ?? d['lat'];
    final lngRaw = d['longitude'] ?? d['lng'];
    if (latRaw is num && lngRaw is num) return (latRaw.toDouble(), lngRaw.toDouble());
    dynamic loc = d['location'];
    if (loc is Map && loc['coordinates'] is List && (loc['coordinates'] as List).length == 2) {
      // GeoJSON [lng, lat]
      final c = loc['coordinates'] as List;
      if (c[0] is num && c[1] is num) return (c[1].toDouble(), c[0].toDouble());
    }
    final addr = d['deliveryAddress'];
    if (addr is Map) {
      loc = addr['location'] ?? addr['coordinates'] ?? addr['geo'];
      if (loc is Map && loc['coordinates'] is List && (loc['coordinates'] as List).length == 2) {
        final c = loc['coordinates'] as List;
        if (c[0] is num && c[1] is num) return (c[1].toDouble(), c[0].toDouble());
      }
      if (loc is List && loc.length == 2 && loc[0] is num && loc[1] is num) {
        return (loc[1].toDouble(), loc[0].toDouble());
      }
    }
    final order = d['order'];
    if (order is Map) return _coords(Map<String, dynamic>.from(order));
    return (null, null);
  }

  List<Map<String, dynamic>> _extractOrders(dynamic res) {
    final data = res['data'];
    final list = <Map<String, dynamic>>[];
    void addAll(dynamic v) {
      if (v is List) {
        for (final item in v) {
          if (item is Map) list.add(Map<String, dynamic>.from(item));
        }
      }
    }

    if (data is List) {
      addAll(data);
    } else if (data is Map) {
      addAll(data['deliveries']);
      addAll(data['todayDeliveries']);
      addAll(data['assignments']);
      addAll(data['orders']);
      addAll(data['items']);
      addAll(data['list']);
    } else {
      addAll(res['deliveries']);
      addAll(res['orders']);
      addAll(res['assignments']);
      addAll(res['data']);
    }
    return list;
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        ApiService.get('/delivery/me/today'),
        ApiService.get('/delivery/me/dashboard'),
        ApiService.get('/delivery/assignments', params: {'status': 'all', 'limit': '100'}),
      ]);
      if (!mounted) return;
      final merged = <String, Map<String, dynamic>>{};
      for (final res in results) {
        for (final order in _extractOrders(res)) {
          final id = _orderId(order);
          if (id.isNotEmpty && !merged.containsKey(id)) merged[id] = order;
        }
      }
      setState(() => _orders = merged.values.toList());
    } catch (_) {
      if (mounted) setState(() => _orders = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _locate() async {
    setState(() {
      _locating = true;
      _locationStatus = null;
    });
    try {
      final position = await _getPosition();
      if (position == null) {
        if (mounted) setState(() => _locationStatus = 'Location unavailable');
        return;
      }
      setState(() => _position = position);
      await ApiService.put('/delivery/me/location', body: {
        'latitude': position.latitude,
        'longitude': position.longitude,
      });
      if (mounted) setState(() => _locationStatus = 'Live GPS active');
      await _loadNearby(position);
    } catch (_) {
      if (mounted) setState(() => _locationStatus = 'Location error');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<Position?> _getPosition() async {
    final result = await LocationService.currentPosition();
    return result.ok ? result.position : null;
  }

  Future<void> _loadNearby(Position position) async {
    final origin = _position ?? position;
    final res = await ApiService.get('/delivery/nearby-orders', params: {
      'lat': origin.latitude.toString(),
      'lng': origin.longitude.toString(),
      'radius': _radiusFilter == 'all' ? '0' : _radiusFilter,
      'limit': '100',
    });
    if (!mounted) return;
    setState(() {
      for (final order in _extractOrders(res)) {
        final id = _orderId(order);
        if (id.isNotEmpty && !_orders.any((o) => _orderId(o) == id)) _orders.add(order);
      }
    });
  }

  Future<void> _accept(Map<String, dynamic> order) async {
    final id = _orderId(order);
    if (id.isEmpty) return;
    setState(() => _acceptingId = id);
    try {
      final assignmentId = _assignmentId(order);
      final res = assignmentId.isNotEmpty
          ? await ApiService.put('/delivery/assignments/$assignmentId/accept')
          : await ApiService.put('/delivery/orders/$id/accept');
      if (res is Map && res['success'] == false) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('${res['detail'] ?? 'Failed to accept order'}'),
          backgroundColor: AppTheme.error,
        ));
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Order accepted'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _acceptingId = null);
    }
  }

  Future<void> _acceptAll() async {
    setState(() => _acceptingRoute = true);
    for (final order in visibleOrders.where(canAccept).toList()) {
      await _accept(order);
    }
    if (mounted) setState(() => _acceptingRoute = false);
  }

  bool canAccept(Map<String, dynamic> order) =>
      _readyStatuses.contains(_status(order)) && !_acceptedStatuses.contains(_status(order));

  List<Map<String, dynamic>> get visibleOrders {
    final filtered = _orders.where((o) => !_hiddenStatuses.contains(_status(o))).toList();
    if (_radiusFilter != 'all') {
      return filtered.where((o) => canAccept(o) || _acceptedStatuses.contains(_status(o))).toList();
    }
    return filtered;
  }

  String _radiusLabel() => _radiusFilter == 'all' ? 'All' : '$_radiusFilter km';

  Future<void> _call(String phone) async {
    if (phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Customer phone number is not available'),
        backgroundColor: AppTheme.textSecondary,
      ));
      return;
    }
    final cleaned = phone.replaceAll(RegExp(r'[^\d+]'), '');
    final uri = Uri(scheme: 'tel', path: cleaned);
    final launched = await launchUrl(uri);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Unable to place the call'),
        backgroundColor: AppTheme.error,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = visibleOrders.where((o) => _orderId(o) == _selectedId).toList();
    final selectedOrder = selected.isNotEmpty ? selected.first : (visibleOrders.isNotEmpty ? visibleOrders.first : null);
    final acceptCount = visibleOrders.where(canAccept).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Order Map'),
        actions: [
          IconButton(
            onPressed: _locating ? null : _locate,
            icon: _locating
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.my_location),
            tooltip: 'Locate me',
          ),
          IconButton(
            onPressed: _isLoading ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _statBox('${visibleOrders.length}', 'Available', Icons.pin_drop, AppTheme.primaryGreen),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _statBox(_radiusLabel(), 'Radius', Icons.route, AppTheme.accent),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _statBox(
                        _locationStatus ?? (_position != null ? 'Live GPS' : 'Waiting for GPS'),
                        'Location',
                        Icons.gps_fixed,
                        _locationStatus == 'Location unavailable' || _locationStatus == 'Location error' ? AppTheme.error : AppTheme.primaryDark,
                        small: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                SizedBox(
                  height: 38,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      ..._radiusOptions.map((km) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text('$km km', style: const TextStyle(fontSize: 12)),
                          selected: _radiusFilter == '$km',
                          selectedColor: AppTheme.primaryGreen.withValues(alpha: 0.15),
                          onSelected: (_) {
                            setState(() => _radiusFilter = '$km');
                            if (_position != null) _loadNearby(_position!);
                          },
                        ),
                      )),
                      ChoiceChip(
                        label: const Text('All', style: TextStyle(fontSize: 12)),
                        selected: _radiusFilter == 'all',
                        selectedColor: AppTheme.primaryGreen.withValues(alpha: 0.15),
                        onSelected: (_) => setState(() => _radiusFilter = 'all'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _buildOrderMap(visibleOrders),
                const SizedBox(height: 16),
                if (selectedOrder != null) _selectedCard(selectedOrder),
                const SizedBox(height: 16),
                Row(
                  children: [
                    const Expanded(
                      child: Text('Visible Orders', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                    ),
                    TextButton.icon(
                      onPressed: acceptCount == 0 || _acceptingRoute ? null : _acceptAll,
                      icon: _acceptingRoute
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.done_all, size: 16),
                      label: const Text('Accept All'),
                    ),
                  ],
                ),
                if (visibleOrders.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 48),
                    child: Column(
                      children: [
                        const Icon(Icons.map_outlined, size: 64, color: AppTheme.textSecondary),
                        const SizedBox(height: 12),
                        Text('No available orders on the map', style: TextStyle(fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                        const SizedBox(height: 4),
                        Text(
                          _radiusFilter != 'all' ? 'Try a wider radius, All, or refresh orders.' : 'Allow location access to find nearby orders.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        ),
                      ],
                    ),
                  )
                else
                  ...visibleOrders.asMap().entries.map((e) {
                    final index = e.key;
                    final order = e.value;
                    final id = _orderId(order);
                    final selectedFlag = id == _selectedId || (selectedOrder != null && _orderId(selectedOrder) == id);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: InkWell(
                        onTap: () => setState(() => _selectedId = id),
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: selectedFlag ? AppTheme.primaryGreen.withValues(alpha: 0.06) : Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: selectedFlag ? AppTheme.primaryGreen.withValues(alpha: 0.5) : AppTheme.border),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text('${index + 1}. ${_customerName(order)}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: (canAccept(order) ? AppTheme.success : AppTheme.textSecondary).withValues(alpha: 0.1),
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: Text(
                                      _status(order).replaceAll('_', ' '),
                                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: canAccept(order) ? AppTheme.success : AppTheme.textSecondary),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(_deliveryAddress(order), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                              const SizedBox(height: 6),
                              Row(
                                children: [
                                  if (order['distanceFromPartnerKm'] is num)
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(color: AppTheme.border.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(8)),
                                      child: Text('${(order['distanceFromPartnerKm'] as num).toStringAsFixed(1)} km', style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                                    ),
                                  if (order['totalAmount'] is num) ...[
                                    const SizedBox(width: 8),
                                    Text('Order value: Rs ${(order['totalAmount'] as num).toStringAsFixed(0)}', style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                  ],
                                  const Spacer(),
                                  if (canAccept(order))
                                    SizedBox(
                                      width: 96,
                                      height: 32,
                                      child: ElevatedButton(
                                        onPressed: _acceptingId == id ? null : () => _accept(order),
                                        style: ElevatedButton.styleFrom(minimumSize: const Size(0, 0), padding: const EdgeInsets.symmetric(horizontal: 8)),
                                        child: _acceptingId == id
                                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                          : const Text('Accept', style: TextStyle(fontSize: 12)),
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
              ],
            ),
          ),
    );
  }

  Widget _buildOrderMap(List<Map<String, dynamic>> orders) {
    final points = <MapPoint>[];
    for (final order in orders) {
      final (lat, lng) = _coords(order);
      if (lat != null && lng != null) {
        points.add(MapPoint(
          lat: lat,
          lng: lng,
          label: _customerName(order),
          color: canAccept(order) ? AppTheme.success : AppTheme.accent,
        ));
      }
    }
    final pos = _position;
    return MapView(
      points: points,
      current: pos != null
          ? MapPoint(lat: pos.latitude, lng: pos.longitude, color: AppTheme.primaryDark)
          : null,
      height: 300,
      onPointTap: (p) {
        final match = orders.where((o) {
          final (lat, lng) = _coords(o);
          return lat == p.lat && lng == p.lng;
        }).firstOrNull;
        if (match != null) {
          setState(() => _selectedId = _orderId(match));
        }
      },
    );
  }

  Widget _selectedCard(Map<String, dynamic> order) {
    final canAcceptThis = canAccept(order);
    final phone = _customerPhone(order);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.primaryGreen.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Selected Order', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.primaryDark)),
          const SizedBox(height: 8),
          Text(_customerName(order), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: 4),
          Text(_deliveryAddress(order), style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          if (order['distanceFromPartnerKm'] is num)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('${(order['distanceFromPartnerKm'] as num).toStringAsFixed(1)} km from you', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen)),
            ),
          if (order['totalAmount'] is num)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text('Order value: Rs ${(order['totalAmount'] as num).toStringAsFixed(0)}', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            ),
          const SizedBox(height: 10),
          Row(
            children: [
              if (canAcceptThis)
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _acceptingId == _orderId(order) ? null : () => _accept(order),
                    icon: _acceptingId == _orderId(order)
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check_circle, size: 16),
                    label: const Text('Accept'),
                  ),
                ),
              if (canAcceptThis) const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _call(phone),
                  icon: const Icon(Icons.call, size: 16),
                  label: const Text('Call'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statBox(String value, String label, IconData icon, Color color, {bool small = false}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(height: 6),
          Text(value, style: TextStyle(fontSize: small ? 11 : 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          Text(label, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}