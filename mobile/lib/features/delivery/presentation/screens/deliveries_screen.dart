import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/services/location_service.dart';
import 'package:intl/intl.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

enum _PodSource { camera, anyFile }

class DeliveriesScreen extends StatefulWidget {
  const DeliveriesScreen({super.key});
  @override
  State<DeliveriesScreen> createState() => _DeliveriesScreenState();
}

class _DeliveriesScreenState extends State<DeliveriesScreen> {
  bool _isLoading = true;
  bool _busyAction = false;
  List<Map<String, dynamic>> _deliveries = [];
  List<Map<String, dynamic>> _nearbyOrders = [];
  int _selectedRadius = 5;
  bool _isLoadingNearby = false;
  String? _locationError;

  @override
  void initState() {
    super.initState();
    _loadDeliveries();
    _loadNearbyOrders();
  }

  Future<Position?> _getLivePosition() async {
    final result = await LocationService.currentPosition();
    if (result.ok) return result.position;
    final message = switch (result.failure) {
      LocationFailure.serviceDisabled => 'Turn on location to see nearby orders',
      LocationFailure.permissionDenied => 'Location permission is required for nearby orders',
      _ => 'Unable to get your live location. Please try again.',
    };
    setState(() => _locationError = message);
    return null;
  }

  Future<void> _loadNearbyOrders() async {
    setState(() {
      _isLoadingNearby = true;
      _locationError = null;
    });
    try {
      final position = await _getLivePosition();
      if (position == null) return;
      await ApiService.put('/delivery/me/location', body: {
        'latitude': position.latitude,
        'longitude': position.longitude,
      });
      final res = await ApiService.get('/delivery/nearby-orders', params: {
        'lat': position.latitude.toString(),
        'lng': position.longitude.toString(),
        'radius': _selectedRadius.toString(),
        'limit': '100',
      });
      if (!mounted) return;
      setState(() => _nearbyOrders = (res['data'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>());
    } catch (_) {
      if (mounted) setState(() => _locationError = 'Unable to load nearby orders');
    } finally {
      if (mounted) setState(() => _isLoadingNearby = false);
    }
  }

  Future<void> _openRouteInMaps(Map<String, dynamic> address) async {
    final position = await _getLivePosition();
    if (position == null) return;

    final location = address['location'] is Map ? address['location'] as Map<String, dynamic> : null;
    double? destLat;
    double? destLng;
    if (location != null) {
      final coords = location['coordinates'];
      if (coords is List && coords.length >= 2) {
        destLng = (coords[0] as num).toDouble();
        destLat = (coords[1] as num).toDouble();
      }
    }

    final String destination;
    if (destLat != null && destLng != null) {
      destination = '$destLat,$destLng';
    } else {
      final street = address['street'] as String? ?? '';
      final city = address['city'] as String? ?? '';
      destination = Uri.encodeComponent('$street, $city'.trim());
    }

    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1'
      '&origin=${position.latitude},${position.longitude}'
      '&destination=$destination&travelmode=driving',
    );
    try {
      bool launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && mounted) {
        launched = await launchUrl(uri, mode: LaunchMode.platformDefault);
      }
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Unable to open maps'), backgroundColor: AppTheme.error));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Unable to open maps'), backgroundColor: AppTheme.error));
      }
    }
  }

  Widget _buildNearbyOrders() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      color: const Color(0xFFF7FAF8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Expanded(child: Text('Nearby Assign Orders', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold))),
          if (_isLoadingNearby) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
        ]),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [5, 10, 20, 25, 50].map((radius) => Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              label: Text('$radius km'),
              selected: _selectedRadius == radius,
              onSelected: (_) {
                setState(() => _selectedRadius = radius);
                _loadNearbyOrders();
              },
            ),
          )).toList()),
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _isLoadingNearby ? null : _loadNearbyOrders,
            icon: const Icon(Icons.my_location, size: 18),
            label: const Text('Use Current Location'),
          ),
        ),
        if (_locationError != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_locationError!, style: const TextStyle(color: AppTheme.error, fontSize: 12))),
        if (!_isLoadingNearby && _locationError == null && _nearbyOrders.isEmpty)
          Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text('No ready orders within $_selectedRadius km', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13))),
        if (_nearbyOrders.isNotEmpty)
          SizedBox(
            height: 220,
            child: ListView(children: _nearbyOrders.map(_buildNearbyOrderCard).toList()),
          ),
      ]),
    );
  }

  Widget _buildNearbyOrderCard(Map<String, dynamic> order) {
    final address = order['address'] is Map ? order['address'] as Map<String, dynamic> : <String, dynamic>{};
    final distance = (order['distance'] as num?)?.toDouble();
    final pickupDistance = (order['pickupDistance'] as num?)?.toDouble();
    final deliveryDistance = (order['deliveryDistance'] as num?)?.toDouble();
    final pickup = order['pickup'] is Map ? order['pickup'] as Map<String, dynamic> : <String, dynamic>{};
    final pickupName = pickup['name'] as String? ?? 'Farm';
    final showDistances = pickupDistance != null || deliveryDistance != null;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.location_on, color: AppTheme.primaryGreen),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(order['customerName'] as String? ?? 'Customer', style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text('${address['city'] ?? address['street'] ?? 'Delivery address'}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    ],
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _openRouteInMaps(address),
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: const Text('Open'),
                ),
              ],
            ),
            if (showDistances || pickupName.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.07),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Icon(Icons.storefront_outlined, size: 15, color: AppTheme.accent),
                      const SizedBox(width: 6),
                      Expanded(child: Text('Pickup: $pickupName', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
                    ]),
                    if (distance != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2, left: 21),
                        child: Text('${distance.toStringAsFixed(1)} km away from you', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                      ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(child: _buildDistanceTile(Icons.flag_outlined, 'Pickup distance', pickupDistance)),
                        Container(width: 1, height: 28, color: AppTheme.border),
                        Expanded(child: _buildDistanceTile(Icons.flag_circle_outlined, 'Delivery distance', deliveryDistance)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _loadDeliveries() async {
    setState(() => _isLoading = true);
    try {
      final params = <String, String>{'status': 'assigned,pending,in_transit,accepted,dispatched'};
      try {
        final position = await _getLivePosition();
        if (position != null) {
          params['lat'] = position.latitude.toString();
          params['lng'] = position.longitude.toString();
        }
      } catch (_) {}
      final res = await ApiService.get('/delivery/assignments', params: params);
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() => _deliveries = data.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _acceptDelivery(String id) async {
    if (_busyAction) return;
    setState(() => _busyAction = true);
    try {
      await ApiService.put('/delivery/assignments/$id/accept');
      if (!mounted) return;
      _loadDeliveries();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Delivery accepted'), backgroundColor: AppTheme.success));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to accept'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  Future<void> _completeDelivery(String id) async {
    if (_busyAction) return;
    final filePath = await _pickProofFile();
    if (!mounted) return;
    if (filePath == null || filePath.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Proof of delivery is required to complete'), backgroundColor: AppTheme.error),
      );
      return;
    }
    setState(() => _busyAction = true);
    try {
      await ApiService.uploadFile('/delivery/assignments/$id/pod', filePath, 'photo');
      if (!mounted) return;
      _loadDeliveries();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Delivery completed with proof of delivery!'), backgroundColor: AppTheme.success),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to complete'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  Future<String?> _pickProofFile() async {
    final source = await showModalBottomSheet<_PodSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text('Proof of Delivery', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined, color: AppTheme.primaryGreen),
              title: const Text('Take Photo'),
              subtitle: const Text('Open the camera to capture the delivery'),
              onTap: () => Navigator.pop(ctx, _PodSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.folder_open_outlined, color: Color(0xFF3B82F6)),
              title: const Text('Upload Any File'),
              subtitle: const Text('Choose a photo or any document from your device'),
              onTap: () => Navigator.pop(ctx, _PodSource.anyFile),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (source == null) return null;
    try {
      switch (source) {
        case _PodSource.camera:
          final file = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1280, imageQuality: 70);
          return file?.path;
        case _PodSource.anyFile:
          final result = await FilePicker.platform.pickFiles();
          return result?.files.single.path;
      }
    } catch (_) {
      return null;
    }
  }

  Future<void> _shareTrackingLink(String orderId) async {
    try {
      final res = await ApiService.post('/delivery/orders/$orderId/share');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      final shareUrl = data['shareUrl'] as String? ?? '';
      if (shareUrl.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Unable to create link'), backgroundColor: AppTheme.error));
        return;
      }
      await Clipboard.setData(ClipboardData(text: shareUrl));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tracking link copied to clipboard'), backgroundColor: AppTheme.success));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to create tracking link'), backgroundColor: AppTheme.error));
    }
  }

  Widget _buildDistanceTile(IconData icon, String label, double? distance) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppTheme.primaryGreen),
        const SizedBox(width: 6),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
              Text(
                distance == null ? '-- km' : '${distance.toStringAsFixed(1)} km',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _startNavigation(Map<String, dynamic> delivery) async {
    final address = delivery['address'] is Map ? delivery['address'] as Map<String, dynamic> : <String, dynamic>{};
    final street = address['street'] as String? ?? '';
    final city = address['city'] as String? ?? '';
    if (street.isEmpty && city.isEmpty && address['location'] == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No address available'), backgroundColor: AppTheme.error));
      return;
    }
    await _openRouteInMaps(address);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Active Deliveries')),
      body: Column(
        children: [
          _buildNearbyOrders(),
          Expanded(child: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _deliveries.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.local_shipping_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                    const SizedBox(height: 16),
                    Text('No active deliveries', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                    const SizedBox(height: 8),
                    Text('New assignments will appear here', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                    const SizedBox(height: 24),
                    ElevatedButton.icon(onPressed: _loadDeliveries, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _loadDeliveries,
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _deliveries.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final delivery = _deliveries[i];
                    final id = delivery['_id'] as String? ?? '';
                    final orderId = delivery['order'] is Map ? (delivery['order'] as Map)['_id'] as String? ?? '' : delivery['orderId'] as String? ?? '';
                    final displayId = (orderId.isNotEmpty ? orderId : id);
                    final status = delivery['status'] as String? ?? 'assigned';
    final address = delivery['address'] is Map ? delivery['address'] as Map<String, dynamic> : <String, dynamic>{};
                    final customerName = delivery['customerName'] as String? ?? (delivery['customer'] is Map ? (delivery['customer'] as Map)['name'] as String? : 'Customer');
                    final items = delivery['items'] as List<dynamic>? ?? [];
                    final pickup = delivery['pickup'] is Map ? delivery['pickup'] as Map<String, dynamic> : {};
                    final pickupName = pickup['name'] as String? ?? 'Farm';
                    final pickupAddress = pickup['address'] as String? ?? '';
                    final pickupDistance = (delivery['pickupDistance'] as num?)?.toDouble();
                    final deliveryDistance = (delivery['deliveryDistance'] as num?)?.toDouble();
                    final createdAt = delivery['createdAt'] as String? ?? '';
                    String date = '';
                    try { date = DateFormat('dd MMM, hh:mm a').format(DateTime.parse(createdAt)); } catch (_) { date = createdAt; }

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
                                decoration: BoxDecoration(
                                  color: status == 'assigned' ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.primaryGreen.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(
                                  status == 'assigned' ? Icons.new_releases_outlined : Icons.local_shipping,
                                  color: status == 'assigned' ? AppTheme.accent : AppTheme.primaryGreen,
                                  size: 20,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Order #${displayId.length >= 8 ? displayId.substring(0, 8).toUpperCase() : displayId}', style: const TextStyle(fontWeight: FontWeight.w600)),
                                    Text(date, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                  ],
                                ),
                              ),
                              _paymentChip(delivery['paymentMethod'] as String?),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: status == 'assigned' ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.primaryGreen.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  status == 'assigned' ? 'New' : 'In Transit',
                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: status == 'assigned' ? AppTheme.accent : AppTheme.primaryGreen),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Icon(Icons.person_outline, size: 16, color: AppTheme.textSecondary),
                              const SizedBox(width: 6),
                              Text(customerName ?? 'Customer', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                            ],
                          ),
                          if (address['street'] != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Row(
                                children: [
                                  Icon(Icons.location_on_outlined, size: 16, color: AppTheme.textSecondary),
                                  const SizedBox(width: 6),
                                  Expanded(child: Text('${address['street']}, ${address['city'] as String? ?? ''}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
                                ],
                              ),
                            ),
                          Text('${items.length} item(s)', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                          if (pickupName.isNotEmpty || pickupDistance != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  color: AppTheme.accent.withValues(alpha: 0.07),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(children: [
                                      const Icon(Icons.storefront_outlined, size: 15, color: AppTheme.accent),
                                      const SizedBox(width: 6),
                                      Expanded(child: Text('Pickup: $pickupName', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
                                    ]),
                                    if (pickupAddress.isNotEmpty)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2, left: 21),
                                        child: Text(pickupAddress, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                      ),
                                    const SizedBox(height: 8),
                                    Row(
                                      children: [
                                        Expanded(child: _buildDistanceTile(Icons.flag_outlined, 'Pickup distance', pickupDistance)),
                                        Container(width: 1, height: 28, color: AppTheme.border),
                                        Expanded(child: _buildDistanceTile(Icons.flag_circle_outlined, 'Delivery distance', deliveryDistance)),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          const SizedBox(height: 12),
                          if (status == 'assigned')
                            Row(
                              children: [
                                Expanded(
                                  child: SizedBox(
                                    height: 38,
                                    child: ElevatedButton.icon(
                                      onPressed: _busyAction ? null : () => _acceptDelivery(id),
                                      icon: const Icon(Icons.check, size: 16),
                                      label: const Text('Accept', style: TextStyle(fontSize: 13)),
                                      style: ElevatedButton.styleFrom(minimumSize: Size.zero),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: SizedBox(
                                    height: 38,
                                    child: OutlinedButton.icon(
                                      onPressed: () => _startNavigation(delivery),
                                      icon: const Icon(Icons.navigation, size: 16),
                                      label: const Text('Navigate', style: TextStyle(fontSize: 13)),
                                      style: OutlinedButton.styleFrom(minimumSize: Size.zero),
                                    ),
                                  ),
                                ),
                              ],
                            )
                          else
                            Row(
                              children: [
                                Expanded(
                                  child: SizedBox(
                                    height: 38,
                                    child: ElevatedButton.icon(
                                      onPressed: _busyAction ? null : () => _completeDelivery(id),
                                      icon: const Icon(Icons.check_circle_outline, size: 16),
                                      label: const Text('Mark Complete', style: TextStyle(fontSize: 13)),
                                      style: ElevatedButton.styleFrom(minimumSize: Size.zero, backgroundColor: AppTheme.success),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: SizedBox(
                                    height: 38,
                                    child: OutlinedButton.icon(
                                      onPressed: () => _startNavigation(delivery),
                                      icon: const Icon(Icons.navigation, size: 16),
                                      label: const Text('Navigate', style: TextStyle(fontSize: 13)),
                                      style: OutlinedButton.styleFrom(minimumSize: Size.zero),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: SizedBox(
                                  height: 34,
                                  child: OutlinedButton.icon(
                                    onPressed: () => _shareTrackingLink(orderId),
                                    icon: const Icon(Icons.share, size: 15),
                                    label: const Text('Share Tracking Link', style: TextStyle(fontSize: 12)),
                                    style: OutlinedButton.styleFrom(minimumSize: Size.zero),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
              )),
        ],
      ),
    );
  }

  Widget _paymentChip(String? paymentMethod) {
    final m = (paymentMethod ?? '').toLowerCase();
    final cod = m == 'cash' || m == 'cod' || m == 'cash_on_delivery';
    final label = cod ? 'COD' : (m.isEmpty ? '' : 'Online');
    if (label.isEmpty) return const SizedBox.shrink();
    final color = cod ? AppTheme.accent : const Color(0xFF3B82F6);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color)),
    );
  }
}
