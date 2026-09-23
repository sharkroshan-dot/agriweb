import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';

class HarvestsScreen extends StatefulWidget {
  const HarvestsScreen({super.key});
  @override
  State<HarvestsScreen> createState() => _HarvestsScreenState();
}

class _HarvestsScreenState extends State<HarvestsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _plans = [];
  List<Map<String, dynamic>> _myPreorders = [];
  int _radius = 20;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        ApiService.get('/harvests/upcoming', params: {'radius': '$_radius'}),
        ApiService.get('/harvests/my/preorders'),
      ]);
      if (!mounted) return;
      final plansRes = results[0];
      final preRes = results[1];
      final plansData = plansRes['data'] as Map<String, dynamic>? ?? {};
      final preData = preRes['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _plans = ((plansData['plans'] as List<dynamic>?) ?? (plansRes is List ? plansRes : [])).cast<Map<String, dynamic>>();
        _myPreorders = (preData['preorders'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() { _plans = []; _myPreorders = []; });
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _planId(Map<String, dynamic> p) => p['_id'] as String? ?? p['id'] as String? ?? '';

  Future<void> _preorder(Map<String, dynamic> plan, int qty) async {
    final id = _planId(plan);
    setState(() => _busyId = 'pre:$id');
    try {
      await ApiService.post('/harvests/$id/preorder', body: {'quantityKg': qty});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Pre-order placed for $qty kg!'),
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

  Future<void> _notify(Map<String, dynamic> plan) async {
    final id = _planId(plan);
    setState(() => _busyId = 'notify:$id');
    try {
      await ApiService.post('/harvests/$id/notify');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text("We'll notify you when it's harvested!"),
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
      appBar: AppBar(title: const Text('Fresh Harvest')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    const Text('Radius', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: DropdownButton<int>(
                          value: _radius,
                          isExpanded: true,
                          underline: const SizedBox.shrink(),
                          items: const [2, 5, 10, 20, 50, 100].map((r) => DropdownMenuItem(value: r, child: Text('$r km'))).toList(),
                          onChanged: (v) {
                            if (v == null) return;
                            setState(() => _radius = v);
                            _load();
                          },
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (_plans.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(32),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.border)),
                    child: Column(children: [
                      const Icon(Icons.eco_outlined, size: 48, color: AppTheme.textSecondary),
                      const SizedBox(height: 8),
                      Text('No upcoming harvests nearby yet', style: TextStyle(color: AppTheme.textSecondary)),
                    ]),
                  )
                else
                  ..._plans.map((plan) => _harvestCard(plan)),
                const SizedBox(height: 24),
                if (_myPreorders.isNotEmpty) ...[
                  Text('Your Pre-orders', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  ..._myPreorders.map((po) => _preorderCard(po)),
                ],
              ],
            ),
      ),
    );
  }

  Widget _harvestCard(Map<String, dynamic> plan) {
    final id = _planId(plan);
    final status = plan['status'] as String? ?? 'open';
    final farmerInfo = plan['farmerInfo'] is Map ? plan['farmerInfo'] as Map<String, dynamic> : {};
    final price = (plan['preOrderPricePerKg'] as num?)?.toDouble();
    final distance = (plan['distanceKm'] as num?)?.toDouble();
    final qty = (plan['expectedQuantityKg'] as num?)?.toDouble();
    final myPreorder = plan['myPreorder'] is Map ? plan['myPreorder'] as Map<String, dynamic> : null;
    final myNotify = plan['myNotify'] as bool? ?? false;
    final preorderBusy = _busyId == 'pre:$id';
    final notifyBusy = _busyId == 'notify:$id';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                  child: Icon(Icons.eco, color: AppTheme.primaryGreen),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(plan['cropName'] as String? ?? 'Harvest', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      Text(farmerInfo['farmName'] as String? ?? farmerInfo['name'] as String? ?? 'Local Farm',
                          style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                      if (farmerInfo['rating'] != null)
                        Row(children: [
                          const Icon(Icons.star, size: 14, color: AppTheme.accent),
                          const SizedBox(width: 2),
                          Text((farmerInfo['rating'] as num).toStringAsFixed(1), style: const TextStyle(fontSize: 12, color: AppTheme.accent)),
                        ]),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: status == 'harvested' ? AppTheme.success.withValues(alpha: 0.1)
                        : status == 'closed' ? AppTheme.textSecondary.withValues(alpha: 0.1)
                        : AppTheme.primaryGreen.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    status == 'harvested' ? 'Harvested' : status == 'closed' ? 'Closed' : 'Pre-order Open',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600,
                        color: status == 'harvested' ? AppTheme.success : status == 'closed' ? AppTheme.textSecondary : AppTheme.primaryGreen),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Wrap(
              spacing: 16,
              runSpacing: 6,
              children: [
                _info(Icons.calendar_today_outlined, 'Harvest: ${shortDate(plan['expectedHarvestDate'])}'),
                _info(Icons.grain, '${qty?.toStringAsFixed(0) ?? '0'} kg planned'),
                _info(Icons.currency_rupee, price != null ? '$kPriceSymbol${price.toStringAsFixed(0)}/kg' : '--'),
                _info(Icons.location_on_outlined, distance != null ? '${distance.toStringAsFixed(1)} km away' : 'Nearby'),
              ],
            ),
          ),
          if (plan['notes'] != null)
            Padding(
              padding: const EdgeInsets.all(14),
              child: Text(plan['notes'] as String, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            ),
          if (status == 'preorder' || status == 'open') ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(14),
              child: myPreorder == null
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _PreorderRow(
                        plan: plan,
                        busy: preorderBusy,
                        onPreorder: (qty) => _preorder(plan, qty),
                      ),
                      const SizedBox(height: 8),
                      if (!myNotify)
                        OutlinedButton.icon(
                          onPressed: notifyBusy ? null : () => _notify(plan),
                          icon: notifyBusy
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.notifications_outlined, size: 16),
                          label: const Text('Notify me when harvested'),
                        )
                      else
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.notifications_active, size: 16, color: AppTheme.primaryGreen),
                            SizedBox(width: 4),
                            Text("You'll be notified on harvest", style: TextStyle(fontSize: 12, color: AppTheme.primaryGreen)),
                          ],
                        ),
                    ],
                  )
                : Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
                    child: Row(children: [
                      const Icon(Icons.check_circle, color: AppTheme.primaryGreen, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Your pre-order: ${myPreorder['quantityKg']} kg for $kPriceSymbol${(myPreorder['total'] as num?)?.toStringAsFixed(0) ?? '0'}',
                          style: const TextStyle(fontSize: 13, color: AppTheme.primaryDark),
                        ),
                      ),
                    ]),
                  ),
            ),
          ],
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

  Widget _preorderCard(Map<String, dynamic> po) {
    final qty = (po['quantityKg'] as num?)?.toDouble() ?? 0;
    final total = (po['total'] as num?)?.toDouble() ?? (po['totalPrice'] as num?)?.toDouble() ?? 0;
    final status = po['status'] as String? ?? 'active';
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
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
            child: const Icon(Icons.eco, color: AppTheme.primaryGreen),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${po['cropName'] as String? ?? 'Harvest'} (${qty.toStringAsFixed(0)} kg)', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                Text('$kPriceSymbol${total.toStringAsFixed(0)} · ${status.toUpperCase()}',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PreorderRow extends StatefulWidget {
  final Map<String, dynamic> plan;
  final bool busy;
  final void Function(int qty) onPreorder;
  const _PreorderRow({required this.plan, required this.busy, required this.onPreorder});

  @override
  State<_PreorderRow> createState() => _PreorderRowState();
}

class _PreorderRowState extends State<_PreorderRow> {
  int _qty = 1;

  @override
  void initState() {
    super.initState();
    _qty = (widget.plan['myPreorder'] is Map ? (widget.plan['myPreorder'] as Map)['quantityKg'] as num? : 1)?.toInt() ?? 1;
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 84,
          child: TextField(
            keyboardType: TextInputType.number,
            controller: TextEditingController(text: '$_qty'),
            onChanged: (v) {
              final parsed = int.tryParse(v);
              setState(() => _qty = (parsed == null || parsed < 1) ? 1 : parsed);
            },
            decoration: const InputDecoration(
              labelText: 'Qty (kg)',
              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: ElevatedButton(
            onPressed: widget.busy ? null : () => widget.onPreorder(_qty),
            child: widget.busy
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : Text('Pre-order $_qty kg'),
          ),
        ),
      ],
    );
  }
}