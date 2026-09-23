import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_card.dart';

class FarmBasketsScreen extends StatefulWidget {
  const FarmBasketsScreen({super.key});
  @override
  State<FarmBasketsScreen> createState() => _FarmBasketsScreenState();
}

class _FarmBasketsScreenState extends State<FarmBasketsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _plans = [];
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _loadPlans();
  }

  Future<void> _loadPlans() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/subscriptions/plans/my');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      final list = data['plans'] as List<dynamic>? ?? [];
      setState(() => _plans = list.cast<Map<String, dynamic>>());
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to load baskets'), backgroundColor: AppTheme.error),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _deletePlan(Map<String, dynamic> plan) async {
    final name = plan['name'] as String? ?? 'basket';
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Basket'),
        content: Text('Delete "$name"? This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() => _deleting = true);
    try {
      await ApiService.delete('/subscriptions/plans/${plan['id']}');
      if (!mounted) return;
      setState(() => _plans.removeWhere((p) => p['id'] == plan['id']));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Basket deleted'), backgroundColor: AppTheme.success),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to delete basket'), backgroundColor: AppTheme.error),
      );
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  void _openForm([Map<String, dynamic>? plan]) {
    context.push('/farmer/farm-baskets/form', extra: plan);
  }

  String _price(num? value) {
    final v = value?.toDouble() ?? 0;
    return v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Farm Baskets'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadPlans),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _plans.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.shopping_basket_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                      const SizedBox(height: 16),
                      Text('No farm baskets yet', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppTheme.textSecondary)),
                      const SizedBox(height: 8),
                      Text('Create recurring baskets to get predictable demand', style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                      const SizedBox(height: 24),
                      ElevatedButton.icon(
                        onPressed: () => _openForm(),
                        icon: const Icon(Icons.add),
                        label: const Text('Create Basket'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadPlans,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _plans.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _buildPlanCard(_plans[i]),
                  ),
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: _openForm,
        backgroundColor: AppTheme.primaryGreen,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  Widget _buildPlanCard(Map<String, dynamic> plan) {
    final id = plan['id'] as String? ?? '';
    final name = plan['name'] as String? ?? 'Basket';
    final cadence = plan['cadence'] as String? ?? 'weekly';
    final day = plan['day'] as String? ?? 'Saturday';
    final price = (plan['price'] as num?)?.toDouble() ?? 0;
    final items = plan['items'] as List<dynamic>? ?? [];
    final status = plan['status'] as String? ?? 'active';
    final subscribers = (plan['subscriberCount'] as num?)?.toInt() ?? 0;
    final maxSubs = (plan['maxSubscribers'] as num?)?.toInt() ?? 0;

    return AppCard(
      padding: const EdgeInsets.all(14),
      showShadow: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.primaryGreen.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.shopping_basket, color: AppTheme.primaryGreen, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15), maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(
                      '${cadence[0].toUpperCase()}${cadence.substring(1)} · $day · Rs ${_price(price)}',
                      style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: status == 'active' ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.textSecondary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  status == 'active' ? 'Active' : 'Disabled',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: status == 'active' ? AppTheme.success : AppTheme.textSecondary),
                ),
              ),
            ],
          ),
          if (items.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: items.map((it) {
                final itMap = it as Map<String, dynamic>;
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceVariant,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '${itMap['name']} · ${itMap['quantity']} ${itMap['unit'] ?? 'kg'}',
                    style: const TextStyle(fontSize: 11, color: AppTheme.textPrimary),
                  ),
                );
              }).toList(),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.people_outline, size: 16, color: AppTheme.textSecondary),
              const SizedBox(width: 4),
              Text('$subscribers / $maxSubs subscribers', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              const Spacer(),
              TextButton(
                onPressed: () => _openForm(plan),
                child: const Text('Edit'),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 20, color: AppTheme.error),
                onPressed: _deleting ? null : () => _deletePlan(plan),
                constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                padding: EdgeInsets.zero,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
