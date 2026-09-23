import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';
import '../../../../shared/widgets/map_view.dart';

class FarmerOrderMapScreen extends StatefulWidget {
  const FarmerOrderMapScreen({super.key});
  @override
  State<FarmerOrderMapScreen> createState() => _FarmerOrderMapScreenState();
}

class _FarmerOrderMapScreenState extends State<FarmerOrderMapScreen> {
  bool _isLoading = true;
  Map<String, dynamic> _data = {};
  int _radius = 10;
  final String _deliveredWindow = 'today';
  String? _selectedStopId;
  bool _accepting = false;
  bool _assigning = false;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/delivery-map',
          params: {'radius': '$_radius', 'delivered': _deliveredWindow});
      if (!mounted) return;
      setState(() => _data = res['data'] as Map<String, dynamic>? ?? res as Map<String, dynamic>? ?? {});
    } catch (_) {
      if (mounted) setState(() => _data = {});
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<Map<String, dynamic>> _list(String key) {
    final v = _data[key];
    if (v is List) return v.cast<Map<String, dynamic>>();
    return [];
  }

  String _stopId(Map<String, dynamic> s) =>
      '${s['orderId'] ?? s['id'] ?? s['_id'] ?? ''}';

  bool _isDone(Map<String, dynamic> s) {
    final status = '${s['status'] ?? ''}'.toLowerCase();
    return status == 'delivered' || status == 'picked_up';
  }

  String _stateOf(Map<String, dynamic> s) {
    final state = '${s['deliveryState'] ?? ''}'.toLowerCase();
    if (state.isNotEmpty) return state;
    if (_isDone(s)) return 'delivered';
    final assignment = '${s['assignment'] ?? ''}'.toLowerCase();
    if (assignment == 'self') return 'self_delivery';
    if (assignment == 'partner') return 'partner_assigned';
    return 'pending_assignment';
  }

  String _stateLabel(Map<String, dynamic> s) {
    switch (_stateOf(s)) {
      case 'self_delivery': return 'Self Delivery';
      case 'partner_assigned': return 'Delivery Partner';
      case 'partner_assignment_pending':
      case 'pending_assignment': return 'Pending Assignment';
      case 'problem': return 'Delivery Problem';
      case 'delivered': return 'Completed';
      default: return 'Unknown';
    }
  }

  Color _stateColor(Map<String, dynamic> s) {
    switch (_stateOf(s)) {
      case 'self_delivery': return AppTheme.success;
      case 'partner_assigned': return const Color(0xFF3B82F6);
      case 'pending_assignment':
      case 'partner_assignment_pending': return AppTheme.accent;
      case 'problem': return AppTheme.error;
      case 'delivered': return AppTheme.textSecondary;
      default: return AppTheme.accent;
    }
  }

  String _formatAddress(Map<String, dynamic> s) {
    final parts = [s['location'], s['city']].whereType<String>().where((v) => v.isNotEmpty).toList();
    return parts.isNotEmpty ? parts.join(', ') : 'Address unavailable';
  }

  (double?, double?) _coords(Map<String, dynamic> s) {
    final latRaw = s['lat'] ?? s['latitude'];
    final lngRaw = s['lng'] ?? s['longitude'];
    if (latRaw is num && lngRaw is num) return (latRaw.toDouble(), lngRaw.toDouble());
    final loc = s['location'];
    if (loc is Map && loc['coordinates'] is List && (loc['coordinates'] as List).length == 2) {
      final c = loc['coordinates'] as List;
      if (c[0] is num && c[1] is num) return (c[1].toDouble(), c[0].toDouble());
    }
    if (loc is List && loc.length == 2 && loc[0] is num && loc[1] is num) {
      return (loc[1].toDouble(), loc[0].toDouble());
    }
    return (null, null);
  }

  Future<void> _acceptWithin() async {
    setState(() => _accepting = true);
    try {
      await ApiService.put('/farmers/me/delivery-map/accept-within', body: {'radius': _radius});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Orders accepted for self-delivery within $_radius km'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _accepting = false);
    }
  }

  Future<void> _assignOutside() async {
    setState(() => _assigning = true);
    try {
      final res = await ApiService.post('/farmers/me/delivery-map/assign-outside', body: {
        'radius': _radius,
        'mode': 'marketplace',
      });
      if (!mounted) return;
      final msg = (res['data'] is Map ? (res['data'] as Map)['mode'] : null) == 'marketplace'
          ? 'Orders posted for all delivery partners to accept'
          : (res['message'] as String?) ?? 'Orders assigned to delivery partners';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: AppTheme.success));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _assigning = false);
    }
  }

  Future<void> _switchAssignment(Map<String, dynamic> s, String mode) async {
    setState(() => _acting = true);
    try {
      await ApiService.put('/farmers/me/delivery-map/orders/${_stopId(s)}/assignment', body: {'mode': mode});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(mode == 'self' ? 'Order switched to self delivery' : 'Order assigned to delivery partner'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _complete(Map<String, dynamic> s) async {
    final isPickup = '${s['deliveryType'] ?? ''}'.toLowerCase() == 'pickup';
    setState(() => _acting = true);
    try {
      await ApiService.put('/farmers/me/route/${_stopId(s)}/status', body: {
        'status': isPickup ? 'picked_up' : 'delivered',
        'note': 'Farmer completed stop from order map',
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('${s['buyerName'] ?? 'Order'} completed!'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  void _openNavigation(Map<String, dynamic> s) {
    Clipboard.setData(ClipboardData(text: _formatAddress(s)));
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('Address copied: ${_formatAddress(s)}'),
      backgroundColor: AppTheme.primaryGreen,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final within = _list('withinRadius');
    final outside = _list('outsideRadius');
    final unlocated = _list('unlocated');
    final delivered = _list('delivered');
    final partners = _list('partners');
    final Map<String, dynamic> summary = _data['summary'] is Map
        ? Map<String, dynamic>.from(_data['summary'] as Map)
        : <String, dynamic>{};
    final all = [...within, ...outside, ...unlocated, ...delivered];
    if (_selectedStopId == null && all.isNotEmpty) {
      _selectedStopId = _stopId(all.first);
    }
    final selectedStop = all.where((s) => _stopId(s) == _selectedStopId).firstOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Order Map'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _isLoading ? null : _load),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _radiusSelector(),
                const SizedBox(height: 12),
                _summaryGrid(summary),
                const SizedBox(height: 16),
                _buildFarmMap(all),
                const SizedBox(height: 16),
                if (partners.isNotEmpty) ...[
                  Text('Available Partners', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  ...partners.where((p) => p['isAvailable'] == true && p['isVerified'] != false).map(_partnerCard),
                  const SizedBox(height: 16),
                ],
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: within.isEmpty || _accepting ? null : _acceptWithin,
                        icon: _accepting
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.check_circle_outline, size: 18),
                        label: Text('Accept All Within $_radius km'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: outside.isEmpty || _assigning ? null : _assignOutside,
                        icon: _assigning
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.local_shipping_outlined, size: 18),
                        label: Text('Assign All Outside $_radius km'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (selectedStop != null) _selectedCard(selectedStop),
                const SizedBox(height: 16),
                _sectionHeader('Within $_radius km', within.length, AppTheme.success),
                const SizedBox(height: 8),
                if (within.isEmpty) _emptyNote('No orders within $_radius km.')
                else ...within.map((s) => _stopCard(s, selected: _stopId(s) == _selectedStopId)),
                const SizedBox(height: 16),
                _sectionHeader('Outside $_radius km', outside.length, AppTheme.accent),
                const SizedBox(height: 8),
                if (outside.isEmpty) _emptyNote('All orders are within $_radius km.')
                else ...outside.map((s) => _stopCard(s, selected: _stopId(s) == _selectedStopId)),
                const SizedBox(height: 16),
                if (unlocated.isNotEmpty) ...[
                  _sectionHeader('Unlocated', unlocated.length, const Color(0xFF3B82F6)),
                  const SizedBox(height: 8),
                  ...unlocated.map((s) => _stopCard(s, selected: _stopId(s) == _selectedStopId)),
                  const SizedBox(height: 16),
                ],
                _sectionHeader('Delivered', delivered.length, AppTheme.textSecondary),
                const SizedBox(height: 8),
                if (delivered.isEmpty) _emptyNote('No delivered orders in this window yet.')
                else ...delivered.map((s) => _stopCard(s, selected: _stopId(s) == _selectedStopId, readOnly: true)),
              ],
            ),
          ),
    );
  }

  Widget _buildFarmMap(List<Map<String, dynamic>> stops) {
    final points = <MapPoint>[];
    for (final s in stops) {
      final (lat, lng) = _coords(s);
      if (lat != null && lng != null) {
        points.add(MapPoint(
          lat: lat,
          lng: lng,
          label: s['buyerName'] as String? ?? 'Stop',
          color: _isDone(s) ? AppTheme.textSecondary : _stateColor(s),
        ));
      }
    }
    return MapView(
      points: points,
      height: 280,
      onPointTap: (p) {
        final match = stops.where((s) {
          final (lat, lng) = _coords(s);
          return lat == p.lat && lng == p.lng;
        }).firstOrNull;
        if (match != null) setState(() => _selectedStopId = _stopId(match));
      },
    );
  }

  Widget _radiusSelector() {
    return Row(
      children: [
        const Text('Radius', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
        const SizedBox(width: 12),
        Expanded(
          child: SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [2, 5, 10, 20, 50].map((r) {
                final selected = _radius == r;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: GestureDetector(
                    onTap: () {
                      setState(() => _radius = r);
                      _load();
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: selected ? AppTheme.primaryGreen : Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: selected ? AppTheme.primaryGreen : AppTheme.border),
                      ),
                      child: Text('$r km', style: TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w600,
                        color: selected ? Colors.white : AppTheme.textSecondary,
                      )),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }

  Widget _summaryGrid(Map<String, dynamic> summary) {
    final items = [
      ('Total Orders', '${summary['totalOrders'] ?? 0}', AppTheme.textPrimary),
      ('Within $_radius KM', '${summary['withinRadius'] ?? 0}', AppTheme.success),
      ('Outside', '${summary['outsideRadius'] ?? 0}', AppTheme.accent),
      ('Self Delivery', '${summary['selfDelivery'] ?? 0}', AppTheme.success),
      ('Partner Assigned', '${summary['partnerAssigned'] ?? 0}', const Color(0xFF3B82F6)),
      ('Unassigned', '${summary['unassigned'] ?? 0}', AppTheme.accent),
      ('Delivered', '${summary['delivered'] ?? 0}', AppTheme.textSecondary),
      ('Order Value', '$kPriceSymbol${_int(summary['totalValue'])}', AppTheme.success),
    ];
    return GridView.count(
      crossAxisCount: 4,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1.1,
      children: items.map((item) => Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppTheme.border),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(item.$2, style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: item.$3), maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            Text(item.$1, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
          ],
        ),
      )).toList(),
    );
  }

  String _int(dynamic v) {
    final n = toDoubleValue(v);
    return n == null ? '0' : '${n.toInt()}';
  }

  Widget _sectionHeader(String title, int count, Color color) {
    return Row(
      children: [
        Container(width: 4, height: 18, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 8),
        Text('$title ($count)', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _emptyNote(String text) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Text(text, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
    );
  }

  Widget _partnerCard(Map<String, dynamic> p) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.person_outline, color: AppTheme.primaryGreen),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p['name'] as String? ?? 'Partner', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                Text('${p['vehicleType'] ?? ''} · ${p['vehicleNumber'] ?? ''}',
                    style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(color: AppTheme.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
            child: const Text('Available', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.success)),
          ),
        ],
      ),
    );
  }

  Widget _selectedCard(Map<String, dynamic> s) {
    final done = _isDone(s);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(s['buyerName'] as String? ?? s['orderNumber'] as String? ?? 'Delivery order',
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              ),
              _stateChip(s),
            ],
          ),
          const SizedBox(height: 4),
          Text(_formatAddress(s), style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          if (s['distance'] != null)
            Text('${s['distance']} km from farm', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: AppTheme.success)),
          const SizedBox(height: 4),
          Text('${s['quantity'] ?? '0'} · ${s['product'] ?? 'Items'} · $kPriceSymbol${_int(s['total'])}',
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          if (!done) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _actionChip('Self', s, 'self'),
                _actionChip('Partner', s, 'partner'),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              if (!done)
                Expanded(
                  child: ElevatedButton(
                    onPressed: _acting ? null : () => _complete(s),
                    style: ElevatedButton.styleFrom(minimumSize: const Size(0, 40)),
                    child: Text('${'${s['deliveryType'] ?? ''}'.toLowerCase() == 'pickup' ? 'Mark Picked Up' : 'Mark Delivered'}'),
                  ),
                ),
              if (!done) const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _openNavigation(s),
                  icon: const Icon(Icons.navigation_outlined, size: 16),
                  label: const Text('Navigate'),
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _actionChip(String label, Map<String, dynamic> s, String mode) {
    final current = '${s['assignment'] ?? ''}'.toLowerCase();
    final selected = (mode == 'self' && current == 'self') || (mode == 'partner' && current == 'partner');
    return GestureDetector(
      onTap: _acting || selected ? null : () => _switchAssignment(s, mode),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppTheme.primaryGreen : AppTheme.primaryGreen.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: selected ? Colors.white : AppTheme.primaryGreen)),
      ),
    );
  }

  Widget _stateChip(Map<String, dynamic> s) {
    final color = _stateColor(s);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
      child: Text(_stateLabel(s), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color)),
    );
  }

  Widget _stopCard(Map<String, dynamic> s, {bool selected = false, bool readOnly = false}) {
    final id = _stopId(s);
    return GestureDetector(
      onTap: () => setState(() => _selectedStopId = id),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? AppTheme.primaryGreen : AppTheme.border, width: selected ? 2 : 1),
        ),
        child: Row(
          children: [
            Container(
              width: 32, height: 32,
              decoration: BoxDecoration(
                color: _stateColor(s).withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.location_on, size: 18, color: _stateColor(s)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s['buyerName'] as String? ?? s['orderNumber'] as String? ?? 'Delivery order',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                  Text(_formatAddress(s), style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                ],
              ),
            ),
            _stateChip(s),
          ],
        ),
      ),
    );
  }
}