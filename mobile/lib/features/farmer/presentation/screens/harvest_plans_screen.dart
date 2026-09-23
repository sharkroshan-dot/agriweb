import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerHarvestPlansScreen extends StatefulWidget {
  const FarmerHarvestPlansScreen({super.key});
  @override
  State<FarmerHarvestPlansScreen> createState() => _FarmerHarvestPlansScreenState();
}

class _FarmerHarvestPlansScreenState extends State<FarmerHarvestPlansScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _plans = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/harvests/farmer/plans');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _plans = (data['plans'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _plans = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showCreate() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _CreateHarvestPlanScreen(onCreated: _load)),
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
      case 'harvested':
        return AppTheme.success;
      case 'cancelled':
        return AppTheme.error;
      case 'open':
      case 'preorder':
        return AppTheme.primaryGreen;
      default:
        return AppTheme.accent;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Harvest Plans')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppTheme.primaryGreen,
        onPressed: _showCreate,
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _plans.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.eco_outlined, size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No harvest plans yet',
                          style: TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 4),
                      Text('Plan a crop and take pre-orders',
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: _showCreate, child: const Text('Create plan')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _plans.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final p = _plans[index];
                      final status = p['status'] as String? ?? 'planned';
                      final qty = (p['expectedQuantityKg'] as num?)?.toDouble() ?? 0;
                      final price = (p['preOrderPricePerKg'] as num?)?.toDouble();
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
                                  child: const Icon(Icons.eco, color: AppTheme.primaryGreen, size: 22),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(p['cropName'] as String? ?? 'Crop',
                                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                                      Text(
                                        'Harvest: ${_date(p['expectedHarvestDate'])}',
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
                            Row(
                              children: [
                                if (qty > 0)
                                  Expanded(
                                    child: Text('$qty kg expected',
                                        style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                                  ),
                                if (price != null)
                                  Expanded(
                                    child: Text('Pre-order $kPriceSymbol${price.toStringAsFixed(0)}/kg',
                                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen)),
                                  ),
                              ],
                            ),
                            if (p['notes'] != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(p['notes'] as String,
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

class _CreateHarvestPlanScreen extends StatefulWidget {
  final VoidCallback onCreated;
  const _CreateHarvestPlanScreen({required this.onCreated});
  @override
  State<_CreateHarvestPlanScreen> createState() => _CreateHarvestPlanScreenState();
}

class _CreateHarvestPlanScreenState extends State<_CreateHarvestPlanScreen> {
  final _formKey = GlobalKey<FormState>();
  final _cropName = TextEditingController();
  final _qty = TextEditingController();
  final _price = TextEditingController();
  final _notes = TextEditingController();
  DateTime _harvestDate = DateTime.now().add(const Duration(days: 30));
  bool _preOrderEnabled = false;
  bool _isSaving = false;

  @override
  void dispose() {
    _cropName.dispose();
    _qty.dispose();
    _price.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _harvestDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _harvestDate = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);
    final priceVal = double.tryParse(_price.text);
    final body = {
      'cropName': _cropName.text.trim(),
      'expectedHarvestDate': _harvestDate.toUtc().toIso8601String(),
      'expectedQuantityKg': double.tryParse(_qty.text) ?? 0,
      'preOrderEnabled': _preOrderEnabled && priceVal != null,
      'preOrderPricePerKg': _preOrderEnabled ? priceVal : null,
      'notes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
    };
    try {
      await ApiService.post('/harvests/plans', body: body);
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
      appBar: AppBar(title: const Text('Create Harvest Plan')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _cropName,
                decoration: const InputDecoration(labelText: 'Crop name'),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _qty,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Expected quantity (kg)'),
                validator: (v) => (v == null || double.tryParse(v) == null) ? 'Enter a number' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _price,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Pre-order price per kg (optional)'),
              ),
              const SizedBox(height: 12),
              InkWell(
                onTap: _pickDate,
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Expected harvest date'),
                  child: Text(
                    '${_harvestDate.day}/${_harvestDate.month}/${_harvestDate.year}',
                    style: const TextStyle(fontSize: 16),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              SwitchListTile(
                value: _preOrderEnabled,
                onChanged: (v) => setState(() => _preOrderEnabled = v),
                title: const Text('Enable pre-orders'),
                subtitle: const Text('Requires a pre-order price per kg'),
                activeColor: AppTheme.primaryGreen,
                contentPadding: EdgeInsets.zero,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _notes,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'Notes (optional)'),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: _isSaving ? null : _save,
                child: _isSaving
                    ? const SizedBox(
                        height: 20, width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Create plan'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}