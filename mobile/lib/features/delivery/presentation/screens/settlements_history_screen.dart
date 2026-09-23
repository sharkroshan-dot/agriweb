import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class SettlementsHistoryScreen extends StatefulWidget {
  const SettlementsHistoryScreen({super.key});
  @override
  State<SettlementsHistoryScreen> createState() => _SettlementsHistoryScreenState();
}

class _SettlementsHistoryScreenState extends State<SettlementsHistoryScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _settlements = [];
  Map<String, dynamic> _totals = {};
  String? _statusFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get(
        '/delivery/me/cash-settlements',
        params: _statusFilter == null ? null : {'status': _statusFilter!},
      );
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _settlements = (data['settlements'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
        _totals = data['totals'] as Map<String, dynamic>? ?? {};
      });
    } catch (_) {
      if (mounted) setState(() => _settlements = []);
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

  Color _statusColor(String status) {
    switch (status) {
      case 'verified':
      case 'settled':
        return AppTheme.success;
      case 'submitted':
      case 'pending_submission':
        return AppTheme.accent;
      case 'rejected':
        return AppTheme.error;
      case 'pending_remit':
        return AppTheme.primaryGreen;
      default:
        return AppTheme.textSecondary;
    }
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'pending_remit':
        return 'PENDING REMIT';
      case 'pending_submission':
        return 'PENDING SUBMISSION';
      case 'submitted':
        return 'SUBMITTED';
      case 'verified':
        return 'VERIFIED';
      case 'settled':
        return 'SETTLED';
      case 'rejected':
        return 'REJECTED';
      default:
        return status.toUpperCase();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settlements History')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Container(
                  margin: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                        colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      _TotalCol(label: 'To remit', value: _totals['pendingRemit']),
                      _TotalCol(label: 'Collected', value: _totals['cashCollected']),
                      _TotalCol(label: 'Settled', value: _totals['alreadyDeposited']),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _filterChip(null, 'All'),
                        _filterChip('pending_remit', 'Pending'),
                        _filterChip('submitted', 'Submitted'),
                        _filterChip('verified', 'Verified'),
                        _filterChip('rejected', 'Rejected'),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: _settlements.isEmpty
                      ? Center(
                          child: Text('No settlements found',
                              style: TextStyle(color: AppTheme.textSecondary)),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.separated(
                            padding: const EdgeInsets.all(16),
                            itemCount: _settlements.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (context, index) {
                              final s = _settlements[index];
                              final amount = (s['amountToRemit'] as num?)?.toDouble() ?? 0;
                              final collected = (s['cashCollected'] as num?)?.toDouble();
                              final status = s['status'] as String? ?? 'pending_remit';
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
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: _statusColor(status).withValues(alpha: 0.12),
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(Icons.account_balance_outlined,
                                          color: _statusColor(status), size: 22),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            'Order ${s['orderNumber'] ?? ''}',
                                            style: const TextStyle(
                                                fontSize: 14, fontWeight: FontWeight.w600),
                                          ),
                                          Text(
                                            'Remit $kPriceSymbol${amount.toStringAsFixed(2)}'
                                            '${collected != null ? ' · Collected $kPriceSymbol${collected.toStringAsFixed(2)}' : ''}',
                                            style: TextStyle(
                                                fontSize: 12, color: AppTheme.textSecondary),
                                          ),
                                          if (_date(s['createdAt'] ?? s['submittedAt']).isNotEmpty)
                                            Text(
                                              _date(s['createdAt'] ?? s['submittedAt']),
                                              style: const TextStyle(
                                                  fontSize: 11, color: AppTheme.textSecondary),
                                            ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: _statusColor(status).withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Text(
                                        _statusLabel(status),
                                        style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                          color: _statusColor(status),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _filterChip(String? value, String label) {
    final selected = _statusFilter == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) {
          setState(() => _statusFilter = value);
          _load();
        },
        selectedColor: AppTheme.primaryGreen,
        labelStyle: TextStyle(
          color: selected ? Colors.white : AppTheme.textSecondary,
          fontSize: 12,
        ),
      ),
    );
  }
}

class _TotalCol extends StatelessWidget {
  final String label;
  final dynamic value;
  const _TotalCol({required this.label, required this.value});
  @override
  Widget build(BuildContext context) {
    final v = (value as num?)?.toDouble() ?? 0;
    return Column(
      children: [
        Text('$kPriceSymbol${v.toStringAsFixed(0)}',
            style: const TextStyle(
                color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        Text(label,
            style: const TextStyle(color: Colors.white70, fontSize: 11)),
      ],
    );
  }
}