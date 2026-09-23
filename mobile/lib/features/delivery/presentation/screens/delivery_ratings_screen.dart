import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class DeliveryRatingsScreen extends StatefulWidget {
  const DeliveryRatingsScreen({super.key});
  @override
  State<DeliveryRatingsScreen> createState() => _DeliveryRatingsScreenState();
}

class _DeliveryRatingsScreenState extends State<DeliveryRatingsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _ratings = [];
  Map<String, dynamic> _summary = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/delivery-ratings/partner/me');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _ratings = (data['ratings'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        _summary = data['summary'] as Map<String, dynamic>? ?? {};
      });
    } catch (_) {
      if (mounted) {
        _ratings = [];
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

  double _avg() {
    final avg = _summary['overallAvg'] as num?;
    if (avg != null) return avg.toDouble();
    final total = (_summary['count'] as num?)?.toInt() ?? _ratings.length;
    if (total == 0) return 0;
    final sum = _ratings.fold<int>(
        0, (acc, r) => acc + ((r['overallRating'] as num?)?.toInt() ?? 0));
    return sum / total;
  }

  @override
  Widget build(BuildContext context) {
    final avg = _avg();
    return Scaffold(
      appBar: AppBar(title: const Text('My Ratings')),
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
                              avg.toStringAsFixed(1),
                              style: const TextStyle(
                                  fontSize: 36,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white),
                            ),
                            Row(
                              children: List.generate(
                                5,
                                (i) => Icon(
                                  i < avg.round()
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
                        Text(
                          '${_summary['count'] ?? _ratings.length} ratings',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (_ratings.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.border),
                      ),
                      child: Text('No ratings yet',
                          style: TextStyle(color: AppTheme.textSecondary)),
                    )
                  else
                    ..._ratings.map((r) => Container(
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
                                    child: Text(
                                      r['orderNumber'] as String? ?? 'Delivery',
                                      style: const TextStyle(
                                          fontSize: 14, fontWeight: FontWeight.w600),
                                    ),
                                  ),
                                  Text(_date(r['createdAt']),
                                      style: const TextStyle(
                                          fontSize: 11, color: AppTheme.textSecondary)),
                                ],
                              ),
                              Row(
                                children: List.generate(
                                  5,
                                  (i) => Icon(
                                    i < ((r['overallRating'] as num?)?.toInt() ?? 0)
                                        ? Icons.star
                                        : Icons.star_border,
                                    size: 16,
                                    color: AppTheme.accent,
                                  ),
                                ),
                              ),
                              if ((r['feedback'] as String? ?? '').isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Text(r['feedback'] as String,
                                      style: const TextStyle(fontSize: 13)),
                                ),
                              if (r['onTimeRating'] != null ||
                                  r['professionalismRating'] != null ||
                                  r['handlingRating'] != null ||
                                  r['communicationRating'] != null)
                                Padding(
                                  padding: const EdgeInsets.only(top: 8),
                                  child: Wrap(
                                    spacing: 8,
                                    runSpacing: 4,
                                    children: [
                                      if ((r['onTimeRating'] as num?) != null)
                                        _Chip('On-time',
                                            (r['onTimeRating'] as num).toInt()),
                                      if ((r['professionalismRating'] as num?) != null)
                                        _Chip('Professionalism',
                                            (r['professionalismRating'] as num).toInt()),
                                      if ((r['handlingRating'] as num?) != null)
                                        _Chip('Handling',
                                            (r['handlingRating'] as num).toInt()),
                                      if ((r['communicationRating'] as num?) != null)
                                        _Chip('Communication',
                                            (r['communicationRating'] as num).toInt()),
                                    ],
                                  ),
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

class _Chip extends StatelessWidget {
  final String label;
  final int value;
  const _Chip(this.label, this.value);
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.primaryGreen.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        '$label $value',
        style: const TextStyle(
            fontSize: 11, color: AppTheme.primaryGreen, fontWeight: FontWeight.w600),
      ),
    );
  }
}