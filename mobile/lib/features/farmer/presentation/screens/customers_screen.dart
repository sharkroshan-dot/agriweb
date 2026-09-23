import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerCustomersScreen extends StatefulWidget {
  const FarmerCustomersScreen({super.key});
  @override
  State<FarmerCustomersScreen> createState() => _FarmerCustomersScreenState();
}

class _FarmerCustomersScreenState extends State<FarmerCustomersScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _customers = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/customers');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _customers = (data['customers'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _customers = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _lastOrder(dynamic value) {
    if (value == null) return '';
    try {
      final dt = DateTime.parse(value.toString()).toLocal();
      return 'Last order ${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Customers')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _customers.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.people_outline,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No customers yet',
                          style: TextStyle(color: AppTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _customers.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final c = _customers[index];
                      final spent = (c['totalSpent'] as num?)?.toDouble() ?? 0;
                      final orders = (c['orderCount'] as num?)?.toInt() ?? 0;
                      final name = c['name'] as String? ?? 'Customer';
                      return Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 22,
                              backgroundColor:
                                  AppTheme.primaryGreen.withValues(alpha: 0.12),
                              child: Text(
                                name.isNotEmpty ? name[0].toUpperCase() : '?',
                                style: const TextStyle(
                                    color: AppTheme.primaryGreen,
                                    fontWeight: FontWeight.bold),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(name,
                                      style: const TextStyle(
                                          fontSize: 15, fontWeight: FontWeight.w600)),
                                  Text(
                                    '$orders order${orders == 1 ? '' : 's'} · spent $kPriceSymbol${spent.toStringAsFixed(0)}',
                                    style: TextStyle(
                                        fontSize: 12, color: AppTheme.textSecondary),
                                  ),
                                  if (_lastOrder(c['lastOrderDate']).isNotEmpty)
                                    Text(_lastOrder(c['lastOrderDate']),
                                        style: const TextStyle(
                                            fontSize: 11, color: AppTheme.textSecondary)),
                                ],
                              ),
                            ),
                            if ((c['phone'] as String? ?? '').isNotEmpty)
                              const Icon(Icons.phone_outlined,
                                  size: 20, color: AppTheme.textSecondary),
                          ],
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}