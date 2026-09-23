import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';

class CustomerDeliverySlotsScreen extends StatefulWidget {
  const CustomerDeliverySlotsScreen({super.key});
  @override
  State<CustomerDeliverySlotsScreen> createState() => _CustomerDeliverySlotsScreenState();
}

class _CustomerDeliverySlotsScreenState extends State<CustomerDeliverySlotsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _slots = [];
  List<Map<String, dynamic>> _mySlots = [];
  int _radius = 50;
  String _area = '';
  final _areaController = TextEditingController();
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _areaController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final params = <String, String>{'radius': '$_radius'};
      if (_area.trim().isNotEmpty) params['area'] = _area.trim();
      final results = await Future.wait([
        ApiService.get('/delivery-slots/available', params: params),
        ApiService.get('/delivery-slots/my'),
      ]);
      if (!mounted) return;
      final slotsRes = results[0];
      final myRes = results[1];
      final slotsData = slotsRes['data'] as Map<String, dynamic>? ?? {};
      final myData = myRes['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _slots = ((slotsData['slots'] as List<dynamic>?) ?? (slotsRes is List ? slotsRes : [])).cast<Map<String, dynamic>>();
        _mySlots = ((myData['bookings'] as List<dynamic>?) ?? (myRes is List ? myRes : [])).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() { _slots = []; _mySlots = []; });
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _slotId(Map<String, dynamic> s) => s['_id'] as String? ?? s['id'] as String? ?? '';

  Future<void> _join(Map<String, dynamic> slot) async {
    final id = _slotId(slot);
    setState(() => _busyId = 'join:$id');
    try {
      await ApiService.post('/delivery-slots/slots/$id/join');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Joined the delivery slot! The farmer will batch your order.'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString()),
        backgroundColor: AppTheme.error,
      ));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _leave(Map<String, dynamic> slot) async {
    final slotId = slot['slotId'] as String? ?? _slotId(slot);
    setState(() => _busyId = 'leave:$slotId');
    try {
      await ApiService.delete('/delivery-slots/slots/$slotId/join');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Left the delivery slot'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString()),
        backgroundColor: AppTheme.error,
      ));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Farmer Delivery Slots')),
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
                      child: TextField(
                        controller: _areaController,
                        decoration: const InputDecoration(
                          hintText: 'Area e.g. Coimbatore North',
                          prefixIcon: Icon(Icons.location_city_outlined),
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                        ),
                        textInputAction: TextInputAction.search,
                        onSubmitted: (_) => _load(),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.border),
                      ),
                      child: DropdownButton<int>(
                        value: _radius,
                        underline: const SizedBox.shrink(),
                        items: const [10, 20, 50, 100, 200].map((r) => DropdownMenuItem(value: r, child: Text('$r km'))).toList(),
                        onChanged: (v) {
                          if (v == null) return;
                          setState(() => _radius = v);
                          _load();
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (_slots.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(32),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.border)),
                    child: Column(children: [
                      const Icon(Icons.local_shipping_outlined, size: 48, color: AppTheme.textSecondary),
                      const SizedBox(height: 8),
                      Text('No delivery slots available yet', style: TextStyle(color: AppTheme.textSecondary)),
                    ]),
                  )
                else
                  ..._slots.map((slot) => _slotCard(slot)),
                if (_mySlots.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('Slots You\'ve Joined', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  ..._mySlots.map((b) => _mySlotCard(b)),
                ],
              ],
            ),
          ),
    );
  }

  Widget _slotCard(Map<String, dynamic> slot) {
    final id = _slotId(slot);
    final status = slot['status'] as String? ?? 'open';
    final farmerInfo = slot['farmerInfo'] is Map ? slot['farmerInfo'] as Map<String, dynamic> : {};
    final bookings = (slot['bookings'] as num?)?.toInt() ?? 0;
    final maxOrders = (slot['maxOrders'] as num?)?.toInt() ?? 0;
    final distance = (slot['distanceKm'] as num?)?.toDouble();
    final radius = (slot['radiusKm'] as num?)?.toDouble();
    final busy = _busyId == 'join:$id';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.local_shipping, color: AppTheme.primaryGreen),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(slot['area'] as String? ?? 'Area', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                    Text(farmerInfo['farmName'] as String? ?? farmerInfo['name'] as String? ?? 'Farmer',
                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: status == 'full' ? AppTheme.error.withValues(alpha: 0.1)
                      : status == 'closed' ? AppTheme.textSecondary.withValues(alpha: 0.1)
                      : AppTheme.primaryGreen.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  status == 'full' ? 'Full' : status == 'closed' ? 'Closed' : '$bookings/$maxOrders',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
                      color: status == 'full' ? AppTheme.error : status == 'closed' ? AppTheme.textSecondary : AppTheme.primaryGreen),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 16,
            runSpacing: 6,
            children: [
              _info(Icons.calendar_today_outlined, shortDate(slot['date'])),
              _info(Icons.schedule, '${slot['startTime']} – ${slot['endTime']}'),
              _info(Icons.location_on_outlined, distance != null ? '${distance.toStringAsFixed(1)} km away' : '${radius?.toStringAsFixed(0) ?? '0'} km radius'),
              _info(Icons.people_outline, '$bookings joined'),
            ],
          ),
          if (slot['notes'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(slot['notes'] as String, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: (status != 'open' || busy) ? null : () => _join(slot),
            child: busy
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Join This Slot'),
          ),
        ],
      ),
    );
  }

  Widget _info(IconData icon, String text) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppTheme.primaryGreen),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
      ],
    );
  }

  Widget _mySlotCard(Map<String, dynamic> booking) {
    final slot = booking['slot'] is Map ? Map<String, dynamic>.from(booking['slot'] as Map) : <String, dynamic>{};
    final slotId = booking['slotId'] as String? ?? _slotId(slot);
    final area = slot['area'] as String? ?? booking['area'] as String? ?? 'Delivery slot';
    final busy = _busyId == 'leave:$slotId';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(area, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                Text(
                  '${shortDate(slot['date'])} • ${slot['startTime']} – ${slot['endTime']}',
                  style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
          OutlinedButton.icon(
            onPressed: busy ? null : () => _leave(booking),
            icon: busy
              ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.close, size: 16),
            label: const Text('Leave'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 40),
              side: const BorderSide(color: AppTheme.error),
              foregroundColor: AppTheme.error,
            ),
          ),
        ],
      ),
    );
  }
}