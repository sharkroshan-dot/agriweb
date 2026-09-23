import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';

class NationalMarketplaceScreen extends StatefulWidget {
  const NationalMarketplaceScreen({super.key});
  @override
  State<NationalMarketplaceScreen> createState() => _NationalMarketplaceScreenState();
}

class _NationalMarketplaceScreenState extends State<NationalMarketplaceScreen> {
  bool _isLoading = true;
  Map<String, List<Map<String, dynamic>>> _groupedProducts = {};
  List<String> _categories = [];
  String? _selectedCategory;
  String _sortBy = 'rating';

  String? _selectedCountry;
  String? _selectedState;
  String? _selectedDistrict;

  List<String> _countries = [];
  List<String> _states = [];
  List<String> _districts = [];

  @override
  void initState() {
    super.initState();
    _loadCountries();
    _loadProducts();
  }

  Future<void> _loadCountries() async {
    try {
      final res = await ApiService.get('/marketplace/country-list');
      if (!mounted) return;
      final list = ApiService.asList(res, key: 'countries')
          .map((c) => c is Map ? (c['name'] ?? c['country'] ?? '') as String : c as String)
          .where((c) => c.isNotEmpty)
          .toList();
      setState(() => _countries = list);
    } catch (_) {}
  }

  Future<void> _loadStates() async {
    try {
      final res = await ApiService.get('/marketplace/state-list', params: {
        if (_selectedCountry != null) 'country': _selectedCountry!,
      });
      if (!mounted) return;
      final list = ApiService.asList(res, key: 'states')
          .map((s) => s is Map ? (s['name'] ?? s['state'] ?? '') as String : s as String)
          .where((s) => s.isNotEmpty)
          .toList();
      setState(() => _states = list);
    } catch (_) {
      if (mounted) setState(() => _states = []);
    }
  }

  Future<void> _loadDistricts() async {
    if (_selectedState == null) {
      if (mounted) setState(() => _districts = []);
      return;
    }
    try {
      final res = await ApiService.get('/marketplace/district-list', params: {
        if (_selectedCountry != null) 'country': _selectedCountry!,
        'state': _selectedState!,
      });
      if (!mounted) return;
      final list = ApiService.asList(res, key: 'districts')
          .map((d) => d is Map ? (d['name'] ?? d['district'] ?? '') as String : d as String)
          .where((d) => d.isNotEmpty)
          .toList();
      setState(() => _districts = list);
    } catch (_) {
      if (mounted) setState(() => _districts = []);
    }
  }

  Future<void> _loadProducts() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/products/search', params: {
        if (_selectedCountry != null) 'country': _selectedCountry!,
        if (_selectedState != null) 'state': _selectedState!,
        if (_selectedDistrict != null) 'district': _selectedDistrict!,
        if (_selectedCategory != null) 'category': _selectedCategory!,
        'sortBy': _sortBy,
        'limit': '100',
      });
      if (!mounted) return;
      final data = ApiService.asList(res).cast<Map<String, dynamic>>();
      final grouped = <String, List<Map<String, dynamic>>>{};
      for (final p in data) {
        final state = p['state'] as String? ?? 'Other';
        grouped.putIfAbsent(state, () => []).add(p);
      }
      setState(() => _groupedProducts = grouped);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _onCountryChanged(String? country) {
    setState(() {
      _selectedCountry = country == 'All' ? null : country;
      _selectedState = null;
      _selectedDistrict = null;
      _districts = [];
      _states = [];
    });
    _loadStates();
    _loadProducts();
  }

  void _onStateChanged(String? state) {
    setState(() {
      _selectedState = state == 'All' ? null : state;
      _selectedDistrict = null;
      _districts = [];
    });
    _loadDistricts();
    _loadProducts();
  }

  void _onDistrictChanged(String? district) {
    setState(() => _selectedDistrict = district == 'All' ? null : district);
    _loadProducts();
  }

  Widget _buildFilterDropdown({
    required String? value,
    required String hint,
    required List<String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      value: items.contains(value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(
        hintText: hint,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        filled: true,
        fillColor: AppTheme.background,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
      ),
      items: [
        const DropdownMenuItem<String>(value: 'All', child: Text('All')),
        ...items.map((s) => DropdownMenuItem(value: s, child: Text(s))),
      ],
      onChanged: onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    final stateKeys = _groupedProducts.keys.toList()..sort();

    return Scaffold(
      appBar: AppBar(title: const Text('National Marketplace')),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            decoration: BoxDecoration(color: Colors.white, border: Border(bottom: BorderSide(color: AppTheme.border))),
            child: Column(
              children: [
                _buildFilterDropdown(
                  value: _selectedCountry,
                  hint: 'Select Country',
                  items: _countries,
                  onChanged: _onCountryChanged,
                ),
                if (_selectedCountry != null) ...[
                  const SizedBox(height: 8),
                  _buildFilterDropdown(
                    value: _selectedState,
                    hint: 'Select State',
                    items: _states,
                    onChanged: _onStateChanged,
                  ),
                ],
                if (_selectedState != null) ...[
                  const SizedBox(height: 8),
                  _buildFilterDropdown(
                    value: _selectedDistrict,
                    hint: 'Select District',
                    items: _districts,
                    onChanged: _onDistrictChanged,
                  ),
                ],
              ],
            ),
          ),
          if (_categories.isNotEmpty)
            Container(
              height: 44,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _categories.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  final cat = _categories[i];
                  final selected = _selectedCategory == cat;
                  return GestureDetector(
                    onTap: () { setState(() => _selectedCategory = selected ? null : cat); _loadProducts(); },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: selected ? AppTheme.primaryGreen : AppTheme.background,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: selected ? AppTheme.primaryGreen : AppTheme.border),
                      ),
                      child: Text(cat, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: selected ? Colors.white : AppTheme.textSecondary)),
                    ),
                  );
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text('${_groupedProducts.values.fold(0, (s, l) => s + l.length)} products', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                const Spacer(),
                PopupMenuButton<String>(
                  icon: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.sort, size: 16, color: AppTheme.primaryGreen),
                      const SizedBox(width: 4),
                      Text('Sort', style: TextStyle(fontSize: 13, color: AppTheme.primaryGreen)),
                    ],
                  ),
                  onSelected: (v) { setState(() => _sortBy = v); _loadProducts(); },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'rating', child: Text('Top Rated')),
                    const PopupMenuItem(value: 'price', child: Text('Price: Low to High')),
                    const PopupMenuItem(value: '-price', child: Text('Price: High to Low')),
                    const PopupMenuItem(value: 'createdAt', child: Text('Newest First')),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: _isLoading
              ? const Center(child: CircularProgressIndicator())
              : _groupedProducts.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.public_off_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                          const SizedBox(height: 16),
                          Text('No products found', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                          const SizedBox(height: 24),
                          ElevatedButton.icon(onPressed: _loadProducts, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadProducts,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: stateKeys.map((state) => _buildStateSection(state, _groupedProducts[state]!)).toList(),
                      ),
                    ),
          ),
        ],
      ),
    );
  }

  Widget _buildStateSection(String state, List<Map<String, dynamic>> products) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            children: [
              Icon(Icons.location_on, size: 16, color: AppTheme.primaryGreen),
              const SizedBox(width: 6),
              Text(state, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: Text('${products.length}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen)),
              ),
            ],
          ),
        ),
        ...products.map((p) => _buildProductRow(p)),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _buildProductRow(Map<String, dynamic> product) {
    final id = product['_id'] as String? ?? '';
    final name = product['name'] as String? ?? 'Product';
    final price = (product['price'] as num?)?.toDouble() ?? 0;
    final rating = productRating(product);
    final image = productImage(product);
    final farmer = productFarmerName(product);

    return GestureDetector(
      onTap: () => context.push('/customer/product/$id'),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 4, offset: const Offset(0, 1))],
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Container(width: 64, height: 64, color: AppTheme.background,
                child: image != null && image.isNotEmpty
                  ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Icon(Icons.image, size: 28, color: AppTheme.textSecondary.withValues(alpha: 0.4)))
                  : Icon(Icons.image, size: 28, color: AppTheme.textSecondary.withValues(alpha: 0.4))),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(farmer, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Text('Rs $price', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.primaryGreen)),
                      const Spacer(),
                      if (rating > 0) Row(
                        children: [
                          Icon(Icons.star, size: 14, color: AppTheme.accent),
                          Text(rating.toStringAsFixed(1), style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}