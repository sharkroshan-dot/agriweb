import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerRatingsScreen extends StatefulWidget {
  const FarmerRatingsScreen({super.key});
  @override
  State<FarmerRatingsScreen> createState() => _FarmerRatingsScreenState();
}

class _FarmerRatingsScreenState extends State<FarmerRatingsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _products = [];
  List<Map<String, dynamic>> _reviews = [];
  Map<String, dynamic>? _summary;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/farmers/me/reviews');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _products = (data['products'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        _reviews = (data['reviews'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        _summary = data['summary'] as Map<String, dynamic>? ?? {};
      });
    } catch (_) {
      if (mounted) {
        _products = [];
        _reviews = [];
        _summary = {};
      }
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
      appBar: AppBar(title: const Text('Ratings & Reviews')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                          colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${((_summary?['averageRating'] as num?) ?? 0).toStringAsFixed(1)}',
                              style: const TextStyle(
                                  fontSize: 36, fontWeight: FontWeight.bold, color: Colors.white),
                            ),
                            Row(
                              children: List.generate(
                                5,
                                (i) => Icon(
                                  i < ((_summary?['averageRating'] as num?) ?? 0).round()
                                      ? Icons.star
                                      : Icons.star_border,
                                  size: 16,
                                  color: AppTheme.accent,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const Spacer(),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              '${(_summary?['totalReviews'] as num?)?.toInt() ?? 0} reviews',
                              style: const TextStyle(
                                  color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
                            ),
                            Text('Across ${_products.length} products',
                                style: const TextStyle(color: Colors.white70, fontSize: 12)),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (_products.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    Text('Product ratings',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                    const SizedBox(height: 8),
                    ..._products.map((p) => Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppTheme.border),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(p['productName'] as String? ?? 'Product',
                                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                              ),
                              Row(
                                children: List.generate(
                                  5,
                                  (i) => Icon(
                                    i < ((p['average'] as num?) ?? 0).round()
                                        ? Icons.star
                                        : Icons.star_border,
                                    size: 14,
                                    color: AppTheme.accent,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text('(${(p['count'] as num?)?.toInt() ?? 0})',
                                  style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                            ],
                          ),
                        )),
                  ],
                  const SizedBox(height: 20),
                  Text('Customer reviews',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const SizedBox(height: 8),
                  if (_reviews.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.border),
                      ),
                      child: Text('No reviews yet', style: TextStyle(color: AppTheme.textSecondary)),
                    )
                  else
                    ..._reviews.map((r) => Container(
                          margin: const EdgeInsets.only(bottom: 8),
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
                                  Expanded(
                                    child: Text(r['customerName'] as String? ?? 'Customer',
                                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                                  ),
                                  Text(_date(r['createdAt']),
                                      style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                                ],
                              ),
                              Row(
                                children: List.generate(
                                  5,
                                  (i) => Icon(
                                    i < ((r['rating'] as num?) ?? 0).toInt()
                                        ? Icons.star
                                        : Icons.star_border,
                                    size: 14,
                                    color: AppTheme.accent,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(r['productName'] as String? ?? '',
                                  style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                              if ((r['comment'] as String? ?? '').isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text(r['comment'] as String,
                                      style: const TextStyle(fontSize: 13)),
                                ),
                            ],
                          ),
                        )),
                ],
              ),
            ),
    );
  }
}