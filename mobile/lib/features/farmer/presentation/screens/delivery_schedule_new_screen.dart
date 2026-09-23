import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class DeliveryScheduleNewScreen extends StatefulWidget {
  const DeliveryScheduleNewScreen({super.key});
  @override
  State<DeliveryScheduleNewScreen> createState() => _DeliveryScheduleNewScreenState();
}

class _DeliveryScheduleNewScreenState extends State<DeliveryScheduleNewScreen> {
  static const _days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  static const _timeSlots = ['Morning', 'Mid-day', 'Afternoon'];
  static const _activeStatuses = {'pending', 'confirmed', 'processing', 'ready_for_delivery', 'ready_for_pickup'};

  bool _isLoading = true;
  List<Map<String, dynamic>> _orders = [];
  final Map<String, Map<String, String>> _selections = {};
  String? _savingId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/orders', params: {'limit': '100'});
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      final all = ((data['orders'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      final active = all.where((o) => _activeStatuses.contains('${o['orderStatus'] ?? o['status'] ?? ''}'.toLowerCase())).toList();
      setState(() {
        _orders = active;
        for (final o in active) {
          final id = _orderId(o);
          if (!_selections.containsKey(id)) {
            _selections[id] = {
              'day': o['deliveryDay'] as String? ?? 'Monday',
              'timeSlot': o['deliveryTimeSlot'] as String? ?? 'Morning',
            };
          }
        }
      });
    } catch (_) {
      if (mounted) setState(() => _orders = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _orderId(Map<String, dynamic> o) => o['_id'] as String? ?? o['id'] as String? ?? '';

  Future<void> _save(Map<String, dynamic> order) async {
    final id = _orderId(order);
    final slot = _selections[id];
    if (slot == null) return;
    setState(() => _savingId = id);
    try {
      await ApiService.put('/farmers/me/orders/$id/delivery-slot', body: {
        'day': slot['day'],
        'timeSlot': slot['timeSlot'],
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Delivery slot saved'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _savingId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Schedule Delivery')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _orders.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.calendar_today_outlined, size: 72, color: AppTheme.textSecondary),
                  const SizedBox(height: 16),
                  Text('No active orders to schedule', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                  const SizedBox(height: 8),
                  Text('Orders appear here once buyers purchase your products', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _orders.length + 1,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (_, i) {
                  if (i == _orders.length) {
                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.primaryGreen.withValues(alpha: 0.06),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.2)),
                      ),
                      child: const Row(children: [
                        Icon(Icons.check_circle, color: AppTheme.primaryGreen, size: 18),
                        SizedBox(width: 8),
                        Expanded(child: Text('Saved slots appear on the Delivery Calendar for planning.', style: TextStyle(fontSize: 12, color: AppTheme.primaryDark))),
                      ]),
                    );
                  }
                  return _orderCard(_orders[i]);
                },
              ),
            ),
    );
  }

  Widget _orderCard(Map<String, dynamic> order) {
    final id = _orderId(order);
    final slot = _selections[id] ?? {'day': 'Monday', 'timeSlot': 'Morning'};
    final status = '${order['orderStatus'] ?? order['status'] ?? 'pending'}'.replaceAll('_', ' ');
    final total = (order['totalAmount'] as num?)?.toDouble() ?? 0;
    final itemCount = (order['items'] as List<dynamic>?)?.length ?? 0;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(order['customerName'] as String? ?? 'Customer', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    Text('#${order['orderNumber'] ?? ''} · $status', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                child: Text('$itemCount item(s) · Rs ${total.toStringAsFixed(0)}',
                    style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: slot['day'],
                  decoration: const InputDecoration(labelText: 'Day', contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
                  items: _days.map((d) => DropdownMenuItem(value: d, child: Text(d, style: const TextStyle(fontSize: 13)))).toList(),
                  onChanged: (v) => setState(() => _selections[id] = {...slot, 'day': v ?? 'Monday'}),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: slot['timeSlot'],
                  decoration: const InputDecoration(labelText: 'Time slot', contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
                  items: _timeSlots.map((t) => DropdownMenuItem(value: t, child: Text(t, style: const TextStyle(fontSize: 13)))).toList(),
                  onChanged: (v) => setState(() => _selections[id] = {...slot, 'timeSlot': v ?? 'Morning'}),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 76,
                child: ElevatedButton(
                  onPressed: _savingId == id ? null : () => _save(order),
                  style: ElevatedButton.styleFrom(minimumSize: const Size(0, 44)),
                  child: _savingId == id
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Save'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}