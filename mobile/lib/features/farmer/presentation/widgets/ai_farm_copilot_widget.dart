import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/widgets/skeleton.dart';

class AIFarmCopilotWidget extends StatefulWidget {
  final String? farmerId;
  final VoidCallback? onAskAI;
  final VoidCallback? onViewInsights;

  const AIFarmCopilotWidget({
    super.key,
    this.farmerId,
    this.onAskAI,
    this.onViewInsights,
  });

  @override
  State<AIFarmCopilotWidget> createState() => _AIFarmCopilotWidgetState();
}

class _AIFarmCopilotWidgetState extends State<AIFarmCopilotWidget> {
  bool _isLoading = true;
  Map<String, dynamic>? _insights;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadInsights();
  }

  Future<void> _loadInsights() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await ApiService.get('/ai/farmer/insights');

      if (!mounted) return;

      final data = response['data'] ?? response;
      setState(() {
        _insights = data;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load AI insights';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return _buildErrorState();
    }

    if (_isLoading) {
      return _buildSkeleton();
    }

    if (_insights == null) {
      return const SizedBox.shrink();
    }

    final demand = (_insights!['demand'] as List<dynamic>?) ?? [];
    final pricing = (_insights!['pricing'] as List<dynamic>?) ?? [];
    final delivery = (_insights!['delivery'] as Map<String, dynamic>?) ?? {};
    final community = (_insights!['community'] as Map<String, dynamic>?) ?? {};

    final hasHighDemand = demand.any((d) => (d['level'] as String?) == 'HIGH');
    final hasPricingAlert = pricing.isNotEmpty;
    final highRiskDeliveries = (delivery['highRisk'] as int?) ?? 0;
    final communityOpportunity = (community['customerCount'] as int?) ?? 0;

    return Card(
      elevation: 0,
      color: AppTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        side: BorderSide(color: AppTheme.border.withValues(alpha: 0.6)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppTheme.warning.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.psychology_outlined,
                    size: 22,
                    color: AppTheme.warning,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'AI Farm Copilot',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      Text(
                        _getSummaryText(demand, pricing, delivery, community),
                        style: TextStyle(
                          fontSize: 12,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),

            // Insights Grid
            _InsightRow(
              icon: Icons.trending_up,
              color: hasHighDemand ? AppTheme.success : AppTheme.info,
              title: 'Demand',
              subtitle: _getDemandSummary(demand),
              onTap: () => context.push('/farmer/advisor'),
            ),

            const SizedBox(height: 10),

            _InsightRow(
              icon: Icons.attach_money,
              color: hasPricingAlert ? AppTheme.warning : AppTheme.info,
              title: 'Pricing',
              subtitle: _getPricingSummary(pricing),
              onTap: () => context.push('/farmer/advisor'),
            ),

            const SizedBox(height: 10),

            _InsightRow(
              icon: Icons.local_shipping_outlined,
              color: highRiskDeliveries > 0 ? AppTheme.error : AppTheme.info,
              title: 'Delivery',
              subtitle: _getDeliverySummary(delivery),
              onTap: () => context.push('/farmer/smart-route'),
            ),

            const SizedBox(height: 10),

            _InsightRow(
              icon: Icons.group_outlined,
              color: communityOpportunity > 0 ? AppTheme.success : AppTheme.info,
              title: 'Community Delivery',
              subtitle: _getCommunitySummary(community),
              onTap: () => context.push('/farmer/smart-route'),
            ),

            const SizedBox(height: 16),

            // Action Buttons
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: widget.onAskAI ?? () => context.push('/ai/copilot'),
                    icon: const Icon(Icons.chat_bubble_outline, size: 18),
                    label: const Text('Ask AI'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.primaryGreen,
                      side: const BorderSide(color: AppTheme.primaryGreen),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: widget.onViewInsights ?? () => context.push('/farmer/advisor'),
                    icon: const Icon(Icons.analytics_outlined, size: 18),
                    label: const Text('Full Insights'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primaryGreen,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _getSummaryText(
    List<dynamic> demand,
    List<dynamic> pricing,
    Map<String, dynamic> delivery,
    Map<String, dynamic> community,
  ) {
    final parts = <String>[];
    if (demand.any((d) => d['level'] == 'HIGH')) parts.add('High demand detected');
    if (pricing.isNotEmpty) parts.add('Price review suggested');
    if (((delivery['highRisk'] as int?) ?? 0) > 0) parts.add('Delivery risks found');
    if (((community['customerCount'] as int?) ?? 0) > 0) parts.add('Group delivery opportunity');

    if (parts.isEmpty) return 'All systems running smoothly';
    return parts.join(' · ');
  }

  String _getDemandSummary(List<dynamic> demand) {
    if (demand.isEmpty) return 'No demand data available';
    final high = demand.where((d) => d['level'] == 'HIGH').length;
    final med = demand.where((d) => d['level'] == 'MEDIUM').length;
    if (high > 0) return '$high products with HIGH demand';
    if (med > 0) return '$med products with MEDIUM demand';
    return '${demand.length} products analyzed';
  }

  String _getPricingSummary(List<dynamic> pricing) {
    if (pricing.isEmpty) return 'Prices are competitive';
    return '${pricing.length} products need price review';
  }

  String _getDeliverySummary(Map<String, dynamic> delivery) {
    final highRisk = (delivery['highRisk'] as int?) ?? 0;
    final total = (delivery['totalOrders'] as int?) ?? 0;
    if (highRisk > 0) return '$highRisk of $total orders at high risk';
    return 'All $total deliveries on track';
  }

  String _getCommunitySummary(Map<String, dynamic> community) {
    final count = (community['customerCount'] as int?) ?? 0;
    if (count > 0) return '$count orders can be grouped';
    return 'No grouping opportunities';
  }

  Widget _buildErrorState() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.info_outline, color: AppTheme.error, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _error!,
                style: TextStyle(fontSize: 13, color: AppTheme.error),
              ),
            ),
            TextButton(
              onPressed: _loadInsights,
              child: Text('Retry', style: TextStyle(color: AppTheme.error)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSkeleton() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceVariant,
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SkeletonBox(width: 120, height: 16),
                      const SizedBox(height: 4),
                      const SkeletonBox(width: 160, height: 12),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ...List.generate(4, (i) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  const SkeletonBox(width: 40, height: 40, radius: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SkeletonBox(width: 100, height: 14),
                        const SizedBox(height: 4),
                        const SkeletonBox(width: 150, height: 12),
                      ],
                    ),
                  ),
                ],
              ),
            )),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: SkeletonBox(height: 48, radius: 12)),
                const SizedBox(width: 12),
                Expanded(child: SkeletonBox(height: 48, radius: 12)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _InsightRow extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _InsightRow({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 20, color: color),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.textSecondary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: AppTheme.textSecondary, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}