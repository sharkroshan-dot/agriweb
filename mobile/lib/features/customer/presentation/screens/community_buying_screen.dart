import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class CommunityBuyingScreen extends StatefulWidget {
  const CommunityBuyingScreen({super.key});
  @override
  State<CommunityBuyingScreen> createState() => _CommunityBuyingScreenState();
}

class _CommunityBuyingScreenState extends State<CommunityBuyingScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  List<Map<String, dynamic>> _groupBuys = [];
  List<Map<String, dynamic>> _mySubscriptions = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadGroupBuys();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadGroupBuys() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/community-buys', params: {'limit': '20'});
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() => _groupBuys = data.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadMySubscriptions() async {
    try {
      final res = await ApiService.get('/community-buys/my-subscriptions');
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() => _mySubscriptions = data.cast<Map<String, dynamic>>());
    } catch (_) {}
  }

  Future<void> _joinGroupBuy(String id) async {
    try {
      await ApiService.post('/community-buys/$id/join');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Joined group buy!'), backgroundColor: AppTheme.success));
      _loadGroupBuys();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to join'), backgroundColor: AppTheme.error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Community Buying'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.primaryGreen,
          labelColor: AppTheme.primaryGreen,
          unselectedLabelColor: AppTheme.textSecondary,
          tabs: const [
            Tab(text: 'Available'),
            Tab(text: 'My Subscriptions'),
            Tab(text: 'How It Works'),
          ],
          onTap: (i) {
            if (i == 1) _loadMySubscriptions();
          },
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildAvailableTab(),
          _buildMySubscriptionsTab(),
          _buildHowItWorksTab(),
        ],
      ),
    );
  }

  Widget _buildAvailableTab() {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_groupBuys.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.people_outline, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
            const SizedBox(height: 16),
            Text('No group buys available', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
            const SizedBox(height: 8),
            Text('Check back later for new offers', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            const SizedBox(height: 24),
            ElevatedButton.icon(onPressed: _loadGroupBuys, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadGroupBuys,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _groupBuys.length,
        itemBuilder: (_, i) => _buildGroupBuyCard(_groupBuys[i]),
      ),
    );
  }

  Widget _buildGroupBuyCard(Map<String, dynamic> groupBuy) {
    final id = groupBuy['_id'] as String? ?? '';
    final farmerName = groupBuy['farmerName'] as String? ?? (groupBuy['farmer'] is Map ? (groupBuy['farmer'] as Map)['name'] as String? ?? 'Local Farmer' : 'Local Farmer');
    final deliveryArea = groupBuy['deliveryArea'] as String? ?? 'Local Area';
    final day = groupBuy['deliveryDay'] as String? ?? '';
    final time = groupBuy['deliveryTime'] as String? ?? '';
    final cutoff = groupBuy['cutoffTime'] as String? ?? '';
    final subscriberCount = (groupBuy['subscriberCount'] as num?)?.toInt() ?? 0;
    final minSubscribers = (groupBuy['minSubscribers'] as num?)?.toInt() ?? 5;
    final products = groupBuy['products'] as List<dynamic>? ?? [];
    final saver = (groupBuy['saverPercent'] as num?)?.toDouble() ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 1))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                child: const Icon(Icons.people, color: AppTheme.primaryGreen, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(farmerName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                    Text(deliveryArea, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              if (saver > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: AppTheme.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                  child: Text('Save ${saver.toStringAsFixed(0)}%', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.success)),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Icon(Icons.calendar_today, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 6),
              Text('$day $time', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              const SizedBox(width: 16),
              Icon(Icons.access_time, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 6),
              Text('Cutoff: $cutoff', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            ],
          ),
          const SizedBox(height: 8),
          Text('${products.map((p) => p is Map ? p['name'] : p).join(', ')}',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary), maxLines: 2, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text('$subscriberCount/$minSubscribers', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                        const SizedBox(width: 4),
                        Text('subscribed', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: minSubscribers > 0 ? subscriberCount / minSubscribers : 0,
                        backgroundColor: AppTheme.border,
                        color: AppTheme.primaryGreen,
                        minHeight: 6,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                height: 38,
                child: ElevatedButton(
                  onPressed: () => _joinGroupBuy(id),
                  style: ElevatedButton.styleFrom(minimumSize: const Size(100, 0)),
                  child: const Text('Join', style: TextStyle(fontSize: 13)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMySubscriptionsTab() {
    return _mySubscriptions.isEmpty
      ? Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.subscriptions_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
              const SizedBox(height: 16),
              Text('No subscriptions yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
              const SizedBox(height: 8),
              Text('Join a group buy to see it here', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            ],
          ),
        )
      : RefreshIndicator(
          onRefresh: _loadMySubscriptions,
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _mySubscriptions.length,
            itemBuilder: (_, i) => _buildSubscriptionCard(_mySubscriptions[i]),
          ),
        );
  }

  Widget _buildSubscriptionCard(Map<String, dynamic> sub) {
    final farmerName = sub['farmerName'] as String? ?? 'Farmer';
    final deliveryArea = sub['deliveryArea'] as String? ?? '';
    final status = sub['status'] as String? ?? 'active';
    final deliveryDay = sub['deliveryDay'] as String? ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: status == 'active' ? AppTheme.primaryGreen.withValues(alpha: 0.1) : AppTheme.textSecondary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.subscriptions, color: status == 'active' ? AppTheme.primaryGreen : AppTheme.textSecondary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(farmerName, style: const TextStyle(fontWeight: FontWeight.w600)),
                if (deliveryArea.isNotEmpty) Text(deliveryArea, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                if (deliveryDay.isNotEmpty) Text(deliveryDay, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: status == 'active' ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.textSecondary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(status[0].toUpperCase() + status.substring(1), style: TextStyle(
              fontSize: 11, fontWeight: FontWeight.w600,
              color: status == 'active' ? AppTheme.success : AppTheme.textSecondary,
            )),
          ),
        ],
      ),
    );
  }

  Widget _buildHowItWorksTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildStep(1, 'Browse Available Group Buys', 'Find farmers in your area offering group purchases on fresh produce.'),
          const SizedBox(height: 24),
          _buildStep(2, 'Join a Group', 'Subscribe to a group buy before the cutoff time. Minimum subscribers required for the deal to go through.'),
          const SizedBox(height: 24),
          _buildStep(3, 'Wait for Confirmation', 'Once the minimum subscriber count is met, the group buy is confirmed and production begins.'),
          const SizedBox(height: 24),
          _buildStep(4, 'Pick Up or Delivery', 'Collect your share at the designated delivery point on the scheduled day, or opt for home delivery.'),
          const SizedBox(height: 32),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppTheme.primaryGreen.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.2)),
            ),
            child: Column(
              children: [
                Icon(Icons.lightbulb_outline, color: AppTheme.primaryGreen, size: 32),
                const SizedBox(height: 12),
                Text('Why Community Buying?', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                const SizedBox(height: 8),
                Text('Lower prices through bulk buying, reduced delivery costs, fresher produce harvested to order, and direct support for local farmers.',
                  style: TextStyle(fontSize: 13, color: AppTheme.textSecondary), textAlign: TextAlign.center),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStep(int number, String title, String description) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36, height: 36,
          decoration: BoxDecoration(color: AppTheme.primaryGreen, shape: BoxShape.circle),
          child: Center(child: Text('$number', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16))),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
              const SizedBox(height: 4),
              Text(description, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.4)),
            ],
          ),
        ),
      ],
    );
  }
}
