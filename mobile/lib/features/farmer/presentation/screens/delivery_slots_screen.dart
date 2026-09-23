import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerDeliverySlotsScreen extends StatefulWidget {
  const FarmerDeliverySlotsScreen({super.key});
  @override
  State<FarmerDeliverySlotsScreen> createState() => _FarmerDeliverySlotsScreenState();
}

class _FarmerDeliverySlotsScreenState extends State<FarmerDeliverySlotsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _slots = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery-slots/farmer/slots');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _slots = (data['slots'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _slots = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showCreate() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _CreateSlotScreen(onCreated: _load)),
    );
  }

  String _date(dynamic value) {
    if (value == null) return '';
    try {
      final dt = DateTime.parse(value.toString()).toLocal();
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'open':
        return AppTheme.success;
      case 'full':
        return AppTheme.accent;
      case 'cancelled':
      case 'closed':
        return AppTheme.error;
      case 'completed':
        return AppTheme.primaryGreen;
      default:
        return AppTheme.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery Slots')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppTheme.primaryGreen,
        onPressed: _showCreate,
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _slots.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.schedule_outlined,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No delivery slots yet',
                          style: TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 16),
                      ElevatedButton(
                          onPressed: _showCreate,
                          child: const Text('Create slot')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _slots.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final s = _slots[index];
                      final status = s['status'] as String? ?? 'open';
                      final bookings = (s['bookings'] as num?)?.toInt() ?? 0;
                      final maxOrders = (s['maxOrders'] as num?)?.toInt() ?? 0;
                      final fee = (s['deliveryFee'] as num?)?.toDouble() ?? 0;
                      return Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: AppTheme.primaryGreen.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: const Icon(Icons.local_shipping_outlined,
                                      color: AppTheme.primaryGreen, size: 22),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(s['area'] as String? ?? 'Area',
                                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                                      Text(
                                        '${_date(s['date'])} · ${s['startTime']} - ${s['endTime']}',
                                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                      ),
                                    ],
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: _statusColor(status).withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(status.toUpperCase(),
                                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: _statusColor(status))),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 16,
                              runSpacing: 4,
                              children: [
                                Text('$bookings/$maxOrders bookings',
                                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                                Text('Radius ${s['radiusKm']} km',
                                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                                if (fee > 0)
                                  Text('Fee $kPriceSymbol${fee.toStringAsFixed(0)}',
                                      style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                              ],
                            ),
                            if (s['notes'] != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(s['notes'] as String,
                                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                              ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}

class _CreateSlotScreen extends StatefulWidget {
  final VoidCallback onCreated;
  const _CreateSlotScreen({required this.onCreated});
  @override
  State<_CreateSlotScreen> createState() => _CreateSlotScreenState();
}

class _CreateSlotScreenState extends State<_CreateSlotScreen> {
  final _formKey = GlobalKey<FormState>();
  final _area = TextEditingController();
  final _start = TextEditingController();
  final _end = TextEditingController();
  final _radius = TextEditingController(text: '10');
  final _maxOrders = TextEditingController(text: '25');
  final _fee = TextEditingController(text: '0');
  DateTime _date = DateTime.now().add(const Duration(days: 1));
  bool _isSaving = false;

  @override
  void dispose() {
    _area.dispose();
    _start.dispose();
    _end.dispose();
    _radius.dispose();
    _maxOrders.dispose();
    _fee.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);
    final body = {
      'area': _area.text.trim(),
      'date': _date.toUtc().toIso8601String(),
      'startTime': _start.text.trim(),
      'endTime': _end.text.trim(),
      'radiusKm': int.tryParse(_radius.text) ?? 10,
      'maxOrders': int.tryParse(_maxOrders.text) ?? 25,
      'deliveryFee': double.tryParse(_fee.text) ?? 0,
    };
    try {
      await ApiService.post('/delivery-slots/slots', body: body);
      if (!mounted) return;
      widget.onCreated();
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create Delivery Slot')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _area,
                decoration: const InputDecoration(labelText: 'Delivery area'),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              InkWell(
                onTap: _pickDate,
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Delivery date'),
                  child: Text('${_date.day}/${_date.month}/${_date.year}',
                      style: const TextStyle(fontSize: 16)),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _start,
                      decoration: const InputDecoration(labelText: 'Start time', hintText: '08:00'),
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextFormField(
                      controller: _end,
                      decoration: const InputDecoration(labelText: 'End time', hintText: '12:00'),
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _radius,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Radius (km)'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _maxOrders,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Max orders'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _fee,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Delivery fee'),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: _isSaving ? null : _save,
                child: _isSaving
                    ? const SizedBox(
                        height: 20, width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Create slot'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}