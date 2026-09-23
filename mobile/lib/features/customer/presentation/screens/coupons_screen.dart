import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class CouponsScreen extends StatefulWidget {
  const CouponsScreen({super.key});
  @override
  State<CouponsScreen> createState() => _CouponsScreenState();
}

class _CouponsScreenState extends State<CouponsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _coupons = [];

  @override
  void initState() {
    super.initState();
    _loadCoupons();
  }

  Future<void> _loadCoupons() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/coupons/available');
      if (!mounted) return;
      setState(() {
        _coupons = ApiService.asList(res, key: 'coupons').cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _coupons = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _discountLabel(Map<String, dynamic> c) {
    final type = c['discountType'] as String? ?? 'percent';
    final value = (c['discountValue'] as num?)?.toDouble() ?? 0;
    if (type == 'percent') return '${value.toStringAsFixed(0)}% OFF';
    return '$kPriceSymbol${value.toStringAsFixed(0)} OFF';
  }

  String _meta(Map<String, dynamic> c) {
    final min = (c['minOrderValue'] as num?)?.toDouble();
    final max = (c['maxDiscount'] as num?)?.toDouble();
    final parts = <String>[];
    if (min != null && min > 0) parts.add('Min order $kPriceSymbol${min.toStringAsFixed(0)}');
    if (max != null && max > 0) parts.add('Max discount $kPriceSymbol${max.toStringAsFixed(0)}');
    return parts.join(' | ');
  }

  String _validity(Map<String, dynamic> c) {
    final exp = c['expiresAt'];
    if (exp == null) return 'No expiry';
    try {
      final dt = DateTime.parse(exp.toString()).toLocal();
      return 'Valid till ${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Coupons')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _coupons.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.local_offer_outlined,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No coupons available',
                          style: TextStyle(color: AppTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadCoupons,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _coupons.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final c = _coupons[index];
                      return Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: AppTheme.border),
                          boxShadow: [
                            BoxShadow(
                                color: Colors.black.withValues(alpha: 0.04),
                                blurRadius: 6),
                          ],
                        ),
                        child: IntrinsicHeight(
                          child: Row(
                            children: [
                              Container(
                                width: 90,
                                padding: const EdgeInsets.all(12),
                                decoration: const BoxDecoration(
                                  color: AppTheme.primaryGreen,
                                  borderRadius: BorderRadius.only(
                                    topLeft: Radius.circular(14),
                                    bottomLeft: Radius.circular(14),
                                  ),
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(Icons.local_offer,
                                        color: Colors.white, size: 22),
                                    const SizedBox(height: 6),
                                    Text(
                                      _discountLabel(c),
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 13,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        c['code'] as String? ?? '',
                                        style: const TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.bold,
                                          color: AppTheme.primaryGreen,
                                          letterSpacing: 1,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        c['description'] as String? ?? '',
                                        style: const TextStyle(
                                            fontSize: 13, color: AppTheme.textSecondary),
                                      ),
                                      if (_meta(c).isNotEmpty) ...[
                                        const SizedBox(height: 4),
                                        Text(_meta(c),
                                            style: const TextStyle(
                                                fontSize: 12,
                                                color: AppTheme.textSecondary)),
                                      ],
                                      const SizedBox(height: 4),
                                      Text(_validity(c),
                                          style: const TextStyle(
                                              fontSize: 11,
                                              color: AppTheme.textSecondary)),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}