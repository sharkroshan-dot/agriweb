import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/services/navigation_state_service.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/utils/helpers.dart';

class StateMarketplaceScreen extends StatefulWidget {
  const StateMarketplaceScreen({super.key});
  @override
  State<StateMarketplaceScreen> createState() => _StateMarketplaceScreenState();
}

class _StateMarketplaceScreenState extends State<StateMarketplaceScreen> {
  static const String _stateKey = AppRoutes.marketplaceState;

  bool _isLoading = true;
  List<Map<String, dynamic>> _products = [];
  List<String> _categories = [];
  String? _selectedCategory;
  String _selectedState = 'Kerala';
  String? _selectedDistrict;
  String _sortBy = 'rating';

  final ScrollController _scrollController = ScrollController();

  final List<String> _states = ['Kerala', 'Tamil Nadu', 'Karnataka', 'Maharashtra', 'Punjab', 'Himachal Pradesh', 'Uttarakhand', 'Assam'];
  final Map<String, List<String>> _districts = {
    'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Palakkad', 'Alappuzha'],
    'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Salem'],
    'Karnataka': ['Bangalore', 'Mysore', 'Hubli', 'Mangalore'],
    'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Nashik'],
    'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar'],
    'Himachal Pradesh': ['Shimla', 'Kullu', 'Manali', 'Dharamshala'],
    'Uttarakhand': ['Dehradun', 'Haridwar', 'Nainital'],
    'Assam': ['Guwahati', 'Jorhat', 'Dibrugarh'],
  };

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _restoreState();
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    NavigationStateService.instance.flushScrollOffsets();
    super.dispose();
  }

  void _onScroll() {
    NavigationStateService.instance
        .setScrollOffset(_stateKey, _scrollController.offset);
  }

  /// Restores the saved filters + scroll position for this marketplace route
  /// (mirrors the web app restoring URL query params + scroll on mount).
  Future<void> _restoreState() async {
    final filters = await NavigationStateService.instance.loadFilters(_stateKey);
    if (mounted) {
      final savedState = filters['state'];
      if (savedState != null && _states.contains(savedState)) {
        _selectedState = savedState;
      }
      final savedDistrict = filters['district'];
      if (savedDistrict != null && (_districts[_selectedState]?.contains(savedDistrict) ?? false)) {
        _selectedDistrict = savedDistrict;
      }
      final savedCategory = filters['category'];
      if (savedCategory != null && savedCategory.isNotEmpty) {
        _selectedCategory = savedCategory;
      }
      final savedSort = filters['sortBy'];
      if (savedSort != null && savedSort.isNotEmpty) {
        _sortBy = savedSort;
      }
    }
    await _loadProducts();
    await _loadCategories();

    final offset =
        await NavigationStateService.instance.restoreScrollOffset(_stateKey);
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.jumpTo(
        offset.clamp(0.0, _scrollController.position.maxScrollExtent),
      );
    });
  }

  Map<String, String> _currentFilters() => {
        'sortBy': _sortBy,
        'state': _selectedState,
        if (_selectedDistrict != null) 'district': _selectedDistrict!,
        if (_selectedCategory != null) 'category': _selectedCategory!,
      };

  Future<void> _persistFilters() async {
    await NavigationStateService.instance.saveFilters(_stateKey, _currentFilters());
  }

  Future<void> _loadProducts() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/products/search', params: {
        if (_selectedCategory != null) 'category': _selectedCategory!,
        'sortBy': _sortBy,
        'state': _selectedState,
        if (_selectedDistrict != null) 'district': _selectedDistrict!,
        'limit': '50',
      });
      if (!mounted) return;
      final data = ApiService.asList(res);
      setState(() => _products = data.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadCategories() async {
    try {
      final res = await ApiService.get('/products/categories');
      if (!mounted) return;
      setState(() => _categories = ApiService.asList(res).map((e) => e is String ? e : e['name'] as String? ?? '').where((e) => e.isNotEmpty).toList());
    } catch (_) {}
  }

  Future<void> _changeState(String? state) async {
    if (state == null) return;
    setState(() {
      _selectedState = state;
      _selectedDistrict = null;
    });
    await _persistFilters();
    await _loadProducts();
  }

  Future<void> _changeDistrict(String? district) async {
    setState(() => _selectedDistrict = district);
    await _persistFilters();
    await _loadProducts();
  }

  Future<void> _toggleCategory(String category) async {
    setState(() {
      _selectedCategory = _selectedCategory == category ? null : category;
    });
    await _persistFilters();
    await _loadProducts();
  }

  Future<void> _changeSort(String sortBy) async {
    setState(() => _sortBy = sortBy);
    await _persistFilters();
    await _loadProducts();
  }

  Future<void> _openProduct(String id) async {
    await NavigationStateService.instance
        .setListingReferrer(_stateKey, _currentFilters());
    await NavigationStateService.instance.flushScrollOffsets();
    if (!mounted) return;
    context.push('/customer/product/$id');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('State Marketplace')),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            decoration: BoxDecoration(color: Colors.white, border: Border(bottom: BorderSide(color: AppTheme.border))),
            child: Column(
              children: [
                DropdownButtonFormField<String>(
                  value: _selectedState,
                  decoration: InputDecoration(
                    labelText: 'Select State',
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    filled: true,
                    fillColor: AppTheme.background,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
                  ),
                  items: _states.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                  onChanged: _changeState,
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: _selectedDistrict,
                  decoration: InputDecoration(
                    hintText: 'Select district (optional)',
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    filled: true,
                    fillColor: AppTheme.background,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
                  ),
                  items: (_districts[_selectedState] ?? []).map((d) => DropdownMenuItem(value: d, child: Text(d))).toList(),
                  onChanged: _changeDistrict,
                ),
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
                    onTap: () => _toggleCategory(cat),
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
                Text('${_products.length} products found', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
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
                  onSelected: _changeSort,
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
              : _products.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.inventory_2_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                          const SizedBox(height: 16),
                          Text('No products found', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                          const SizedBox(height: 24),
                          ElevatedButton.icon(onPressed: _loadProducts, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadProducts,
                      child: GridView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        itemCount: _products.length,
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          childAspectRatio: 0.72,
                        ),
                        itemBuilder: (_, i) => _buildProductCard(_products[i]),
                      ),
                    ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductCard(Map<String, dynamic> product) {
    final id = product['_id'] as String? ?? '';
    final name = product['name'] as String? ?? 'Product';
    final price = (product['price'] as num?)?.toDouble() ?? 0;
    final rating = productRating(product);
    final image = productImage(product);
    final farmer = productFarmerName(product);
    final district = product['district'] as String? ?? '';

    return GestureDetector(
      onTap: () => _openProduct(id),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
              child: Container(
                height: 110,
                width: double.infinity,
                color: AppTheme.background,
                child: image != null && image.isNotEmpty
                  ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Icon(Icons.image, size: 36, color: AppTheme.textSecondary.withValues(alpha: 0.4)))
                  : Icon(Icons.image, size: 36, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(farmer, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary), maxLines: 1, overflow: TextOverflow.ellipsis),
                    if (district.isNotEmpty)
                      Text(district, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                    const Spacer(),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Rs $price', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppTheme.primaryGreen)),
                        if (rating > 0) Row(
                          children: [
                            Icon(Icons.star, size: 12, color: AppTheme.accent),
                            Text(rating.toStringAsFixed(1), style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    SizedBox(
                      height: 32,
                      child: ElevatedButton(
                        onPressed: () {},
                        style: ElevatedButton.styleFrom(
                          minimumSize: Size.zero,
                          padding: EdgeInsets.zero,
                        ),
                        child: const Text('Add', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
