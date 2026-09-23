import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class FarmerB2BScreen extends StatefulWidget {
  const FarmerB2BScreen({super.key});
  @override
  State<FarmerB2BScreen> createState() => _FarmerB2BScreenState();
}

class _FarmerB2BScreenState extends State<FarmerB2BScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _rfqs = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/b2b/rfqs');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _rfqs = (data['rfqs'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _rfqs = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _openRfq(Map<String, dynamic> rfq) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _RfqDetailScreen(rfq: rfq, onChanged: _load),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('B2B Requests')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _rfqs.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.business_center_outlined,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No open RFQs right now',
                          style: TextStyle(color: AppTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _rfqs.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final r = _rfqs[index];
                      final biz = r['businessInfo'] as Map<String, dynamic>? ?? {};
                      final qty = (r['quantityPerWeekKg'] as num?)?.toDouble() ?? 0;
                      final ceiling = (r['priceCeilingPerKg'] as num?)?.toDouble();
                      final offers = (r['offerCount'] as num?)?.toInt() ?? 0;
                      return InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => _openRfq(r),
                        child: Container(
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
                                  Container(
                                    padding: const EdgeInsets.all(10),
                                    decoration: BoxDecoration(
                                      color: AppTheme.primaryGreen.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: const Icon(Icons.business_center,
                                        color: AppTheme.primaryGreen, size: 20),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(r['productName'] as String? ?? 'RFQ',
                                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                                        Text(
                                          biz['businessName'] as String? ?? 'Business',
                                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AppTheme.success.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: const Text('OPEN',
                                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.success)),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 12,
                                runSpacing: 4,
                                children: [
                                  if (qty > 0)
                                    _Meta('${qty.toStringAsFixed(0)} kg/week'),
                                  if (ceiling != null)
                                    _Meta('Ceiling $kPriceSymbol${ceiling.toStringAsFixed(0)}/kg'),
                                  if ((r['deliveryCity'] as String? ?? '').isNotEmpty)
                                    _Meta('Delivery in ${r['deliveryCity']}'),
                                  _Meta('$offers offer${offers == 1 ? '' : 's'}'),
                                ],
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

class _Meta extends StatelessWidget {
  final String text;
  const _Meta(this.text);
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.circle, size: 5, color: AppTheme.textSecondary),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
      ],
    );
  }
}

class _RfqDetailScreen extends StatefulWidget {
  final Map<String, dynamic> rfq;
  final VoidCallback onChanged;
  const _RfqDetailScreen({required this.rfq, required this.onChanged});
  @override
  State<_RfqDetailScreen> createState() => _RfqDetailScreenState();
}

class _RfqDetailScreenState extends State<_RfqDetailScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _offers = [];
  final _formKey = GlobalKey<FormState>();
  final _price = TextEditingController();
  final _minQty = TextEditingController();
  final _note = TextEditingController();
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _loadOffers();
  }

  @override
  void dispose() {
    _price.dispose();
    _minQty.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _loadOffers() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/b2b/rfqs/${widget.rfq['id']}/offers');
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      setState(() {
        _offers = (data['offers'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _offers = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _submitOffer() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSubmitting = true);
    final body = {
      'pricePerKg': double.tryParse(_price.text) ?? 0,
      'minOrderKg': double.tryParse(_minQty.text) ?? 0,
      'deliveryNote': _note.text.trim().isEmpty ? null : _note.text.trim(),
    };
    try {
      await ApiService.post('/b2b/rfqs/${widget.rfq['id']}/offers', body: body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Offer submitted'), backgroundColor: AppTheme.success),
      );
      widget.onChanged();
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSubmitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.rfq;
    final biz = r['businessInfo'] as Map<String, dynamic>? ?? {};
    final qty = (r['quantityPerWeekKg'] as num?)?.toDouble() ?? 0;
    final ceiling = (r['priceCeilingPerKg'] as num?)?.toDouble();
    return Scaffold(
      appBar: AppBar(title: Text(r['productName'] as String? ?? 'RFQ Details')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${biz['businessName'] as String? ?? 'Business'}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(
                  '${biz['businessType'] as String? ?? ''}'
                  '${(biz['city'] as String? ?? '').isNotEmpty ? ' · ${biz['city']}' : ''}',
                  style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 12),
                if (qty > 0)
                  Text('Quantity: ${qty.toStringAsFixed(0)} kg/week',
                      style: const TextStyle(fontSize: 14)),
                if (ceiling != null)
                  Text('Price ceiling: $kPriceSymbol${ceiling.toStringAsFixed(0)}/kg',
                      style: const TextStyle(fontSize: 14)),
                if ((r['deliveryDays'] as String? ?? '').isNotEmpty)
                  Text('Delivery days: ${r['deliveryDays']}',
                      style: const TextStyle(fontSize: 14)),
                if (r['notes'] != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('${r['notes']}', style: const TextStyle(fontSize: 13)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Text('Your Offer', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border),
            ),
            child: Form(
              key: _formKey,
              child: Column(
                children: [
                  TextFormField(
                    controller: _price,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Price per kg'),
                    validator: (v) => (v == null || double.tryParse(v) == null) ? 'Enter a price' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _minQty,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Minimum order (kg, optional)'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _note,
                    maxLines: 2,
                    decoration: const InputDecoration(labelText: 'Delivery note (optional)'),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: _isSubmitting ? null : _submitOffer,
                    child: _isSubmitting
                        ? const SizedBox(
                            height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Submit offer'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text('Existing Offers', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          const SizedBox(height: 8),
          if (_isLoading)
            const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
          else if (_offers.isEmpty)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.border),
              ),
              child: Text('No offers yet', style: TextStyle(color: AppTheme.textSecondary)),
            )
          else
            ..._offers.map((o) {
              final price = (o['pricePerKg'] as num?)?.toDouble() ?? 0;
              final minQty = (o['minOrderKg'] as num?)?.toDouble() ?? 0;
              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('$kPriceSymbol${price.toStringAsFixed(0)}/kg',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                    if (minQty > 0)
                      Text('Min ${minQty.toStringAsFixed(0)} kg',
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    if ((o['status'] as String? ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text('Status: ${o['status']}',
                            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
}