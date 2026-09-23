import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class PreordersScreen extends StatefulWidget {
  const PreordersScreen({super.key});
  @override
  State<PreordersScreen> createState() => _PreordersScreenState();
}

class _PreordersScreenState extends State<PreordersScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _preorders = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/harvests/my/preorders');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _preorders = (data['preorders'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _preorders = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Harvest Pre-orders')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _preorders.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.eco_outlined,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No pre-orders yet',
                          style: TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 4),
                      Text('Pre-order fresh harvests from farmers',
                          style: TextStyle(
                              fontSize: 12, color: AppTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _preorders.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final po = _preorders[index];
                      final plan = po['plan'] as Map<String, dynamic>? ?? {};
                      final qty = (po['quantityKg'] as num?)?.toDouble() ??
                          (po['quantity'] as num?)?.toDouble() ??
                          0;
                      final price = (po['preOrderPricePerKg'] as num?)?.toDouble() ??
                          (plan['preOrderPricePerKg'] as num?)?.toDouble() ??
                          0;
                      final status = po['status'] as String? ?? 'active';
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
                              width: 56,
                              height: 56,
                              decoration: BoxDecoration(
                                color: AppTheme.primaryGreen.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Icon(Icons.eco,
                                  color: AppTheme.primaryGreen, size: 28),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    plan['cropName'] as String? ?? 'Harvest',
                                    style: const TextStyle(
                                        fontSize: 15, fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(height: 2),
                                  if (qty > 0)
                                    Text(
                                      '$qty kg at $kPriceSymbol${price.toStringAsFixed(0)}/kg',
                                      style: TextStyle(
                                          fontSize: 13,
                                          color: AppTheme.textSecondary),
                                    ),
                                  if (_date(plan['expectedHarvestDate']).isNotEmpty)
                                    Text(
                                      'Harvest: ${_date(plan['expectedHarvestDate'])}',
                                      style: const TextStyle(
                                          fontSize: 12, color: AppTheme.textSecondary),
                                    ),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                if (po['totalPrice'] != null)
                                  Text(
                                    '$kPriceSymbol${((po['totalPrice'] as num?) ?? 0).toStringAsFixed(0)}',
                                    style: const TextStyle(
                                        fontSize: 15, fontWeight: FontWeight.bold),
                                  ),
                                Container(
                                  margin: const EdgeInsets.only(top: 4),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: (status == 'cancelled'
                                            ? AppTheme.error
                                            : AppTheme.primaryGreen)
                                        .withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    status.toUpperCase(),
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                      color: status == 'cancelled'
                                          ? AppTheme.error
                                          : AppTheme.primaryGreen,
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
                ),
    );
  }
}