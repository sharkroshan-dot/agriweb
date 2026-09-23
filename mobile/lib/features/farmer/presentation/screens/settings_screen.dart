import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerSettingsScreen extends StatefulWidget {
  const FarmerSettingsScreen({super.key});
  @override
  State<FarmerSettingsScreen> createState() => _FarmerSettingsScreenState();
}

class _FarmerSettingsScreenState extends State<FarmerSettingsScreen> {
  bool _isLoading = true;
  bool _savingProfile = false;
  bool _savingPrefs = false;

  final Map<String, TextEditingController> _profile = {
    'farmName': TextEditingController(),
    'ownerName': TextEditingController(),
    'phone': TextEditingController(),
    'email': TextEditingController(),
    'city': TextEditingController(),
    'weeklyPickupWindow': TextEditingController(),
    'farmAddress': TextEditingController(),
    'pickupInstructions': TextEditingController(),
  };

  final _productLowStock = TextEditingController(text: '10');
  final _productCriticalStock = TextEditingController(text: '5');
  final _orderTimeout = TextEditingController(text: '30');
  final _maxOrdersPerDay = TextEditingController(text: '50');
  final _minOrderValue = TextEditingController(text: '100');
  final _deliveryRadius = TextEditingController(text: '10');
  final _bankAccount = TextEditingController();
  final _accountHolder = TextEditingController();
  final _accountNumber = TextEditingController();
  final _ifsc = TextEditingController();
  final _minPayout = TextEditingController(text: '500');

  Map<String, dynamic> _ai = {
    'pricePrediction': true,
    'demandForecast': true,
    'weatherIntegration': true,
    'smartRecommendations': true,
    'dailyReport': true,
    'weeklyReport': false,
    'monthlyReport': false,
  };
  Map<String, dynamic> _alerts = {
    'lowStockAlerts': true,
    'autoAcceptSmallOrders': false,
    'newOrderAlert': true,
    'orderCancelled': true,
    'paymentReceived': true,
  };

  String _notificationMethod = 'email';
  String _payoutFrequency = 'weekly';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _profile.values) {
      c.dispose();
    }
    _productLowStock.dispose();
    _productCriticalStock.dispose();
    _orderTimeout.dispose();
    _maxOrdersPerDay.dispose();
    _minOrderValue.dispose();
    _deliveryRadius.dispose();
    _bankAccount.dispose();
    _accountHolder.dispose();
    _accountNumber.dispose();
    _ifsc.dispose();
    _minPayout.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        ApiService.get('/farmers/me/profile'),
        ApiService.get('/settings/mine'),
      ]);
      if (!mounted) return;
      final profileData = results[0]['data'] as Map<String, dynamic>? ?? results[0] as Map<String, dynamic>? ?? {};
      final settingsData = results[1]['data'] as Map<String, dynamic>? ?? results[1] as Map<String, dynamic>? ?? {};
      setState(() {
        _profile['farmName']!.text = profileData['farmName'] as String? ?? '';
        _profile['ownerName']!.text = profileData['ownerName'] as String? ?? '';
        _profile['phone']!.text = profileData['phone'] as String? ?? '';
        _profile['email']!.text = profileData['email'] as String? ?? '';
        _profile['city']!.text = profileData['city'] as String? ?? '';
        _profile['weeklyPickupWindow']!.text = profileData['weeklyPickupWindow'] as String? ?? '';
        _profile['farmAddress']!.text = profileData['farmAddress'] as String? ?? '';
        _profile['pickupInstructions']!.text = profileData['pickupInstructions'] as String? ?? '';

        final product = settingsData['product'] is Map ? settingsData['product'] as Map<String, dynamic> : {};
        final orders = settingsData['orders'] is Map ? settingsData['orders'] as Map<String, dynamic> : {};
        final payouts = settingsData['payouts'] is Map ? settingsData['payouts'] as Map<String, dynamic> : {};
        final ai = settingsData['ai'] is Map ? settingsData['ai'] as Map<String, dynamic> : {};
        final alerts = settingsData['alerts'] is Map ? settingsData['alerts'] as Map<String, dynamic> : {};

        _productLowStock.text = '${product['lowStockAlert'] ?? 10}';
        _productCriticalStock.text = '${product['criticalStock'] ?? 5}';
        _notificationMethod = product['notificationMethod'] as String? ?? 'email';
        _orderTimeout.text = '${orders['orderTimeout'] ?? 30}';
        _maxOrdersPerDay.text = '${orders['maxOrdersPerDay'] ?? 50}';
        _minOrderValue.text = '${orders['minOrderValue'] ?? 100}';
        _deliveryRadius.text = '${orders['deliveryRadius'] ?? 10}';
        _bankAccount.text = payouts['bankAccount'] as String? ?? '';
        _accountHolder.text = payouts['accountHolder'] as String? ?? '';
        _accountNumber.text = payouts['accountNumber'] as String? ?? '';
        _ifsc.text = payouts['ifsc'] as String? ?? '';
        _payoutFrequency = payouts['payoutFrequency'] as String? ?? 'weekly';
        _minPayout.text = '${payouts['minPayout'] ?? 500}';
        _ai = {..._ai, ...ai};
        _alerts = {..._alerts, ...alerts};
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _saveProfile() async {
    setState(() => _savingProfile = true);
    try {
      await ApiService.put('/farmers/me/profile', body: {
        'farmName': _profile['farmName']!.text.trim(),
        'ownerName': _profile['ownerName']!.text.trim(),
        'phone': _profile['phone']!.text.trim(),
        'email': _profile['email']!.text.trim(),
        'city': _profile['city']!.text.trim(),
        'weeklyPickupWindow': _profile['weeklyPickupWindow']!.text.trim(),
        'farmAddress': _profile['farmAddress']!.text.trim(),
        'pickupInstructions': _profile['pickupInstructions']!.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Farm profile saved'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _savingProfile = false);
    }
  }

  Future<void> _savePrefs() async {
    setState(() => _savingPrefs = true);
    try {
      await ApiService.put('/settings/mine', body: {
        'product': {
          'lowStockAlert': int.tryParse(_productLowStock.text) ?? 10,
          'criticalStock': int.tryParse(_productCriticalStock.text) ?? 5,
          'notificationMethod': _notificationMethod,
        },
        'orders': {
          'orderTimeout': int.tryParse(_orderTimeout.text) ?? 30,
          'maxOrdersPerDay': int.tryParse(_maxOrdersPerDay.text) ?? 50,
          'minOrderValue': int.tryParse(_minOrderValue.text) ?? 100,
          'deliveryRadius': int.tryParse(_deliveryRadius.text) ?? 10,
        },
        'payouts': {
          'bankAccount': _bankAccount.text.trim(),
          'accountHolder': _accountHolder.text.trim(),
          'accountNumber': _accountNumber.text.trim(),
          'ifsc': _ifsc.text.trim(),
          'payoutFrequency': _payoutFrequency,
          'minPayout': int.tryParse(_minPayout.text) ?? 500,
        },
        'ai': _ai,
        'alerts': _alerts,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Settings saved'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _savingPrefs = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          TextButton.icon(
            onPressed: _savingPrefs ? null : _savePrefs,
            icon: _savingPrefs
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.save_outlined, size: 18),
            label: const Text('Save'),
          ),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _sectionCard(
                  title: 'Farm Profile',
                  subtitle: 'Visible to buyers and used across your dashboard.',
                  child: Column(
                    children: [
                      _field(_profile['farmName']!, 'Farm name'),
                      _field(_profile['ownerName']!, 'Owner name'),
                      _field(_profile['phone']!, 'Phone'),
                      _field(_profile['email']!, 'Email'),
                      _field(_profile['city']!, 'City'),
                      _field(_profile['weeklyPickupWindow']!, 'Pickup window'),
                      _field(_profile['farmAddress']!, 'Farm address'),
                      _field(_profile['pickupInstructions']!, 'Pickup instructions'),
                      const SizedBox(height: 8),
                      ElevatedButton.icon(
                        onPressed: _savingProfile ? null : _saveProfile,
                        icon: _savingProfile
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.save_outlined, size: 16),
                        label: const Text('Save Profile'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _sectionCard(
                  title: 'Product & Inventory',
                  subtitle: 'Stock alert thresholds for your listings.',
                  child: Column(
                    children: [
                      Row(children: [
                        Expanded(child: _field(_productLowStock, 'Low stock alert (units)')),
                        const SizedBox(width: 12),
                        Expanded(child: _field(_productCriticalStock, 'Critical stock (units)')),
                      ]),
                      DropdownButtonFormField<String>(
                        value: _notificationMethod,
                        decoration: const InputDecoration(labelText: 'Notification method'),
                        items: const [
                          DropdownMenuItem(value: 'email', child: Text('Email')),
                          DropdownMenuItem(value: 'sms', child: Text('SMS')),
                          DropdownMenuItem(value: 'push', child: Text('Push')),
                        ],
                        onChanged: (v) => setState(() => _notificationMethod = v ?? 'email'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _sectionCard(
                  title: 'Order Management',
                  subtitle: 'Defaults applied to incoming orders.',
                  child: Column(
                    children: [
                      Row(children: [
                        Expanded(child: _field(_orderTimeout, 'Order timeout (min)')),
                        const SizedBox(width: 12),
                        Expanded(child: _field(_maxOrdersPerDay, 'Max orders / day')),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: _field(_minOrderValue, 'Min order value (Rs)')),
                        const SizedBox(width: 12),
                        Expanded(child: _field(_deliveryRadius, 'Delivery radius (km)')),
                      ]),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _sectionCard(
                  title: 'Payments & Payouts',
                  subtitle: 'Bank details for your earnings.',
                  child: Column(
                    children: [
                      _field(_bankAccount, 'Bank / UPI account'),
                      _field(_accountHolder, 'Account holder'),
                      _field(_accountNumber, 'Account number'),
                      _field(_ifsc, 'IFSC code'),
                      DropdownButtonFormField<String>(
                        value: _payoutFrequency,
                        decoration: const InputDecoration(labelText: 'Payout frequency'),
                        items: const [
                          DropdownMenuItem(value: 'daily', child: Text('Daily')),
                          DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                          DropdownMenuItem(value: 'biweekly', child: Text('Bi-weekly')),
                          DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                        ],
                        onChanged: (v) => setState(() => _payoutFrequency = v ?? 'weekly'),
                      ),
                      const SizedBox(height: 10),
                      _field(_minPayout, 'Minimum payout (Rs)'),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _sectionCard(
                  title: 'AI & Analytics',
                  subtitle: 'Smart tools to grow your farm business.',
                  child: Column(
                    children: [
                      ..._ai.keys.map((key) => _toggleTile(_aiLabel(key), key, _ai)),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _sectionCard(
                  title: 'Alerts & Security',
                  subtitle: 'How you hear about orders and account safety.',
                  child: Column(
                    children: [
                      ..._alerts.keys.map((key) => _toggleTile(_alertLabel(key), key, _alerts)),
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppTheme.textSecondary.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Row(children: [
                          Icon(Icons.shield_outlined, size: 18, color: AppTheme.textSecondary),
                          SizedBox(width: 8),
                          Expanded(child: Text('Two-factor auth off · Account recovery & device controls on roadmap', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
                        ]),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _savingPrefs ? null : _savePrefs,
                  icon: _savingPrefs
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.save_outlined, size: 16),
                  label: const Text('Save all settings'),
                ),
              ],
            ),
          ),
    );
  }

  String _aiLabel(String key) {
    switch (key) {
      case 'pricePrediction': return 'Price prediction';
      case 'demandForecast': return 'Demand forecast';
      case 'weatherIntegration': return 'Weather integration';
      case 'smartRecommendations': return 'Smart recommendations';
      case 'dailyReport': return 'Daily report';
      case 'weeklyReport': return 'Weekly report';
      case 'monthlyReport': return 'Monthly report';
      default: return key;
    }
  }

  String _alertLabel(String key) {
    switch (key) {
      case 'newOrderAlert': return 'New order alert';
      case 'orderCancelled': return 'Order cancelled alert';
      case 'paymentReceived': return 'Payment received alert';
      case 'lowStockAlerts': return 'Low stock alerts';
      case 'autoAcceptSmallOrders': return 'Auto-accept small orders';
      default: return key;
    }
  }

  Widget _toggleTile(String label, String key, Map<String, dynamic> map) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
          Switch(
            value: map[key] as bool? ?? false,
            onChanged: (v) => setState(() => map[key] = v),
            activeColor: AppTheme.primaryGreen,
          ),
        ],
      ),
    );
  }

  Widget _sectionCard({required String title, String? subtitle, required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(subtitle, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ],
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  Widget _field(TextEditingController controller, String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextField(
        controller: controller,
        keyboardType: label.contains('(Rs)') || label.contains('(min)') || label.contains('(km)') || label.contains('(units)')
            ? TextInputType.number
            : TextInputType.text,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }
}