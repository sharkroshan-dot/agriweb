import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerDeliveryCalendarScreen extends StatefulWidget {
  const FarmerDeliveryCalendarScreen({super.key});
  @override
  State<FarmerDeliveryCalendarScreen> createState() => _FarmerDeliveryCalendarScreenState();
}

class _FarmerDeliveryCalendarScreenState extends State<FarmerDeliveryCalendarScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _weeklyData;
  Map<String, dynamic>? _todaySummary;
  DateTime _currentWeekStart = DateTime.now().subtract(Duration(days: DateTime.now().weekday - 1));

  final List<String> _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  final List<Map<String, String>> _timeSlots = [
    {'key': 'morning', 'label': 'Morning 6-8AM'},
    {'key': 'midday', 'label': 'Mid-day 8-10AM'},
    {'key': 'afternoon', 'label': 'Afternoon 4-6PM'},
  ];

  @override
  void initState() {
    super.initState();
    _loadCalendar();
  }

  Future<void> _loadCalendar() async {
    setState(() => _isLoading = true);
    try {
      final weekStartStr = DateFormat('yyyy-MM-dd').format(_currentWeekStart);
      final res = await ApiService.get('/farmers/me/delivery-calendar', params: {'weekStart': weekStartStr});
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? res;
      setState(() {
        _weeklyData = data['weeklySlots'] as Map<String, dynamic>? ?? {};
        _todaySummary = data['todaySummary'] as Map<String, dynamic>?;
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showSlotDetails(String day, String slotKey) {
    final key = '${day}_$slotKey';
    final slot = _weeklyData?[key] as Map<String, dynamic>?;
    if (slot == null) return;
    final deliveries = slot['deliveries'] as List<dynamic>? ?? [];
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _buildSlotDetailsSheet(day, slotKey, deliveries.cast<Map<String, dynamic>>()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery Calendar')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _loadCalendar,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildWeekNavigation(),
                  const SizedBox(height: 16),
                  _buildCalendarGrid(),
                  const SizedBox(height: 24),
                  if (_todaySummary != null) _buildTodaySummary(),
                ],
              ),
            ),
          ),
    );
  }

  Widget _buildWeekNavigation() {
    final weekEnd = _currentWeekStart.add(const Duration(days: 6));
    final weekLabel = '${DateFormat('MMM d').format(_currentWeekStart)} - ${DateFormat('MMM d, yyyy').format(weekEnd)}';
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        IconButton(
          icon: const Icon(Icons.chevron_left),
          onPressed: () { setState(() => _currentWeekStart = _currentWeekStart.subtract(const Duration(days: 7))); _loadCalendar(); },
        ),
        Text(weekLabel, style: TextStyle(fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
        IconButton(
          icon: const Icon(Icons.chevron_right),
          onPressed: () { setState(() => _currentWeekStart = _currentWeekStart.add(const Duration(days: 7))); _loadCalendar(); },
        ),
      ],
    );
  }

  Widget _buildCalendarGrid() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)],
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.primaryGreen.withValues(alpha: 0.05),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            ),
            child: Row(
              children: [
                const SizedBox(width: 80),
                ..._days.map((d) => Expanded(
                  child: Center(
                    child: Text(d, style: TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w600,
                      color: _isToday(d) ? AppTheme.primaryGreen : AppTheme.textSecondary,
                    )),
                  ),
                )),
              ],
            ),
          ),
          ..._timeSlots.map((slot) => _buildSlotRow(slot)),
        ],
      ),
    );
  }

  Widget _buildSlotRow(Map<String, String> slot) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: AppTheme.border.withValues(alpha: 0.5)))),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(slot['label']!, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
          ),
          ..._days.map((d) => Expanded(child: _buildSlotCell(d, slot['key']!))),
        ],
      ),
    );
  }

  Widget _buildSlotCell(String day, String slotKey) {
    final key = '${day}_$slotKey';
    final slot = _weeklyData?[key] as Map<String, dynamic>?;
    final count = (slot?['count'] as num?)?.toInt() ?? 0;

    if (count == 0) {
      return Center(child: Container(
        width: 24, height: 24,
        decoration: BoxDecoration(color: AppTheme.border.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(6)),
      ));
    }

    return GestureDetector(
      onTap: () => _showSlotDetails(day, slotKey),
      child: Center(child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        decoration: BoxDecoration(
          color: count > 2 ? AppTheme.primaryGreen.withValues(alpha: 0.15) : AppTheme.accent.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text('$count', style: TextStyle(
          fontSize: 12, fontWeight: FontWeight.bold,
          color: count > 2 ? AppTheme.primaryGreen : AppTheme.accent,
        )),
      )),
    );
  }

  bool _isToday(String day) {
    final today = DateTime.now();
    final dayIndex = _days.indexOf(day) + 1;
    return today.weekday == dayIndex && _isCurrentWeek(today);
  }

  bool _isCurrentWeek(DateTime date) {
    final diff = date.difference(_currentWeekStart).inDays;
    return diff >= 0 && diff < 7;
  }

  Widget _buildSlotDetailsSheet(String day, String slotKey, List<Map<String, dynamic>> deliveries) {
    final slotLabel = _timeSlots.firstWhere((s) => s['key'] == slotKey, orElse: () => {'label': slotKey})['label']!;
    return DraggableScrollableSheet(
      initialChildSize: 0.5,
      minChildSize: 0.3,
      maxChildSize: 0.8,
      expand: false,
      builder: (_, scrollController) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40, height: 4,
                decoration: BoxDecoration(color: AppTheme.border, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 16),
            Text('$day $slotLabel', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            const SizedBox(height: 4),
            Text('${deliveries.length} delivery(s)', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            const SizedBox(height: 16),
            Expanded(
              child: ListView.separated(
                controller: scrollController,
                itemCount: deliveries.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (_, i) {
                  final d = deliveries[i];
                  final customerName = d['customerName'] as String? ?? 'Customer';
                  final address = d['address'] as String? ?? '';
                  final status = d['status'] as String? ?? 'pending';
                  return Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.border),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
                          child: const Icon(Icons.person, color: AppTheme.primaryGreen, size: 18),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(customerName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                              if (address.isNotEmpty) Text(address, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: status == 'completed' ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.accent.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(status[0].toUpperCase() + status.substring(1), style: TextStyle(
                            fontSize: 10, fontWeight: FontWeight.w600,
                            color: status == 'completed' ? AppTheme.success : AppTheme.accent,
                          )),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTodaySummary() {
    final summary = _todaySummary!;
    final deliveries = (summary['deliveries'] as num?)?.toInt() ?? 0;
    final totalDistance = (summary['totalDistance'] as num?)?.toDouble() ?? 0;
    final fuelCost = (summary['fuelCost'] as num?)?.toDouble() ?? 0;
    final income = (summary['income'] as num?)?.toDouble() ?? 0;
    final totalTime = (summary['totalTime'] as num?)?.toDouble() ?? 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text("Today's Summary", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [AppTheme.primaryGreen, AppTheme.primaryDark]),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  _SummaryItem(label: 'Deliveries', value: '$deliveries', icon: Icons.local_shipping),
                  const SizedBox(width: 12),
                  _SummaryItem(label: 'Distance', value: '${totalDistance.toStringAsFixed(1)} km', icon: Icons.route),
                  const SizedBox(width: 12),
                  _SummaryItem(label: 'Time', value: '${totalTime.toStringAsFixed(0)}h', icon: Icons.access_time),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  _SummaryItem(label: 'Fuel Cost', value: 'Rs ${fuelCost.toStringAsFixed(0)}', icon: Icons.local_gas_station),
                  const SizedBox(width: 12),
                  _SummaryItem(label: 'Income', value: 'Rs ${income.toStringAsFixed(0)}', icon: Icons.account_balance_wallet),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SummaryItem extends StatelessWidget {
  final String label, value;
  final IconData icon;
  const _SummaryItem({required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: Colors.white.withValues(alpha: 0.8)),
              const SizedBox(width: 4),
              Text(label, style: TextStyle(fontSize: 10, color: Colors.white.withValues(alpha: 0.8))),
            ],
          ),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white)),
        ],
      ),
    );
  }
}
