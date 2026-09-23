import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';
import '../../../../shared/widgets/empty_state.dart';
import '../../../../shared/widgets/filter_chips.dart';
import '../../../../shared/widgets/skeleton.dart';

class CustomerProductsScreen extends StatefulWidget {
  final String? initialQuery;
  const CustomerProductsScreen({super.key, this.initialQuery});

  @override
  State<CustomerProductsScreen> createState() => _CustomerProductsScreenState();
}

class _CustomerProductsScreenState extends State<CustomerProductsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _products = [];
  List<String> _categories = [];
  String? _selectedCategory;
  String? _selectedFarmer;
  List<String> _farmers = [];
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';
  bool _isOrganic = false;
  double? _minPrice;
  double? _maxPrice;
  int _page = 1;
  int _totalPages = 1;
  late final TextEditingController _searchController;
  bool _isLoadingMore = false;

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController(text: widget.initialQuery ?? '');
    _loadProducts();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Map<String, String> get _params {
    final params = <String, String>{
      'sortBy': _sortBy,
      'sortOrder': _sortOrder,
      'page': '$_page',
      'limit': '20',
    };
    final query = _searchController.text.trim();
    if (query.isNotEmpty) params['query'] = query;
    if (_selectedCategory != null) params['category'] = _selectedCategory!;
    if (_selectedFarmer != null) params['farmerId'] = _selectedFarmer!;
    if (_isOrganic) params['isOrganic'] = 'true';
    if (_minPrice != null) params['minPrice'] = _minPrice!.toString();
    if (_maxPrice != null) params['maxPrice'] = _maxPrice!.toString();
    return params;
  }

  Future<void> _loadProducts({bool reset = true}) async {
    if (reset) {
      setState(() => _isLoading = true);
      _page = 1;
    } else {
      setState(() => _isLoadingMore = true);
      _page += 1;
    }
    try {
      final res = await ApiService.get('/products/search', params: _params);
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      final list = (data['products'] as List<dynamic>? ?? ApiService.asList(res)).cast<Map<String, dynamic>>();
      final pagination = data['pagination'] as Map<String, dynamic>? ?? {};
      final cats = <String>{};
      final farmers = <String>{};
      for (final p in list) {
        final c = p['category'];
        if (c is String && c.trim().isNotEmpty) cats.add(c);
        final fid = p['farmerId'] as String?;
        if (fid != null && fid.isNotEmpty) farmers.add(fid);
      }
      setState(() {
        _products = reset ? list : [..._products, ...list];
        if (reset) {
          _categories = cats.toList()..sort();
          _farmers = farmers.toList();
        } else {
          for (final c in cats) {
            if (!_categories.contains(c)) _categories.add(c);
          }
          _categories.sort();
          for (final f in farmers) {
            if (!_farmers.contains(f)) _farmers.add(f);
          }
        }
        _totalPages = (pagination['totalPages'] as num?)?.toInt() ?? 1;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _products = reset ? [] : _products);
      }
    } finally {
      if (mounted) setState(() {
        _isLoading = false;
        _isLoadingMore = false;
      });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    return _products.where((p) {
      if (_selectedCategory != null && p['category'] != _selectedCategory) return false;
      if (_isOrganic && p['isOrganic'] != true) return false;
      final price = (p['price'] as num?)?.toDouble();
      if (price != null) {
        if (_minPrice != null && price < _minPrice!) return false;
        if (_maxPrice != null && price > _maxPrice!) return false;
      }
      return true;
    }).toList();
  }

  void _openFilterSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusXl)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          return Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 20,
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text('Filters', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    const Spacer(),
                    TextButton(
                      onPressed: () => setSheetState(() {
                        _isOrganic = false;
                        _minPrice = null;
                        _maxPrice = null;
                      }),
                      child: const Text('Clear'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Organic only', style: TextStyle(fontSize: 14)),
                  value: _isOrganic,
                  onChanged: (v) => setSheetState(() => _isOrganic = v),
                ),
                const SizedBox(height: 8),
                const Text('Price Range (Rs)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(hintText: 'Min', contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
                        onChanged: (v) => _minPrice = double.tryParse(v),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(hintText: 'Max', contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
                        onChanged: (v) => _maxPrice = double.tryParse(v),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      _loadProducts();
                    },
                    child: const Text('Apply Filters'),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Products'),
        actions: [
          IconButton(
            icon: const Icon(Icons.filter_list),
            tooltip: 'Filters',
            onPressed: _openFilterSheet,
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort),
            onSelected: (v) {
              setState(() {
                _sortBy = v;
                _sortOrder = v.startsWith('-') ? 'desc' : 'asc';
                _sortBy = v.replaceFirst('-', '');
              });
              _loadProducts();
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'createdAt', child: Text('Newest First')),
              const PopupMenuItem(value: 'rating', child: Text('Top Rated')),
              const PopupMenuItem(value: 'price', child: Text('Price: Low to High')),
              const PopupMenuItem(value: '-price', child: Text('Price: High to Low')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search products, farmers, categories...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          setState(() {});
                          _loadProducts();
                        },
                      ),
              ),
              onChanged: (v) => setState(() {}),
              onSubmitted: (v) => _loadProducts(),
              textInputAction: TextInputAction.search,
            ),
          ),
          if (_isOrganic || _minPrice != null || _maxPrice != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    if (_isOrganic)
                      _activeFilterChip('Organic', () => setState(() => _isOrganic = false)),
                    if (_minPrice != null)
                      _activeFilterChip('Min Rs ${_minPrice!.toStringAsFixed(0)}', () => setState(() => _minPrice = null)),
                    if (_maxPrice != null)
                      _activeFilterChip('Max Rs ${_maxPrice!.toStringAsFixed(0)}', () => setState(() => _maxPrice = null)),
                  ],
                ),
              ),
            ),
          if (_categories.isNotEmpty)
            FilterChipBar(
              options: ['All', ..._categories],
              selected: _selectedCategory ?? 'All',
              onSelected: (cat) {
                setState(() => _selectedCategory = cat == 'All' ? null : cat);
                _loadProducts();
              },
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text('${filtered.length} products', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                if (_searchController.text.trim().isNotEmpty)
                  Text('  for "${_searchController.text.trim()}"', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Expanded(
            child: _isLoading
                ? const PageSkeleton(items: 5)
                : filtered.isEmpty
                    ? EmptyState(
                        icon: Icons.inventory_2_outlined,
                        title: 'No products found',
                        message: 'Try a different search or clear the filters to see more farm-fresh items.',
                        actionLabel: 'Clear & Refresh',
                        onAction: () {
                          _searchController.clear();
                          _selectedCategory = null;
                          _isOrganic = false;
                          _minPrice = null;
                          _maxPrice = null;
                          setState(() {});
                          _loadProducts();
                        },
                      )
                    : RefreshIndicator(
                        onRefresh: () => _loadProducts(),
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: filtered.length + (hasMore ? 1 : 0),
                          separatorBuilder: (_, __) => const SizedBox(height: 12),
                          itemBuilder: (_, i) {
                            if (i >= filtered.length) {
                              return Center(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                  child: _isLoadingMore
                                      ? const SizedBox(height: 24, width: 24, child: CircularProgressIndicator(strokeWidth: 2))
                                      : TextButton(
                                          onPressed: () => _loadProducts(reset: false),
                                          child: const Text('Load more'),
                                        ),
                                ),
                              );
                            }
                            return _buildProductRow(filtered[i]);
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  bool get hasMore => _page < _totalPages;

  Widget _activeFilterChip(String label, VoidCallback onRemove) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 6, 6, 6),
      decoration: BoxDecoration(
        color: AppTheme.primarySoft,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.primaryDark)),
          const SizedBox(width: 4),
          InkWell(
            onTap: () {
              onRemove();
              _loadProducts();
            },
            borderRadius: BorderRadius.circular(10),
            child: const Icon(Icons.close, size: 16, color: AppTheme.primaryDark),
          ),
        ],
      ),
    );
  }

  Widget _buildProductRow(Map<String, dynamic> product) {
    final id = product['_id'] as String? ?? '';
    final name = product['name'] as String? ?? 'Product';
    final price = (product['price'] as num?)?.toDouble();
    final mrp = (product['mrp'] as num?)?.toDouble();
    final rating = productRating(product);
    final image = productImage(product);
    final farmer = productFarmerName(product);
    final unit = product['unit'] as String? ?? 'kg';
    final isOrganic = product['isOrganic'] == true;
    final isFresh = product['isFresh'] == true;

    int? discountPct;
    String? strikePrice;
    if (mrp != null && price != null && mrp > price) {
      discountPct = ((mrp - price) / mrp * 100).round();
      strikePrice = mrp.toStringAsFixed(0);
    }

    return GestureDetector(
      onTap: () => context.push('/customer/product/$id'),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border.withValues(alpha: 0.7)),
          boxShadow: AppTheme.cardShadow,
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Stack(
                children: [
                  Container(
                    width: 90,
                    height: 90,
                    color: AppTheme.background,
                    child: image != null && image.isNotEmpty
                        ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.image, color: AppTheme.textSecondary))
                        : const Icon(Icons.image, color: AppTheme.textSecondary),
                  ),
                  if (discountPct != null)
                    Positioned(
                      bottom: 6,
                      left: 6,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.error.withValues(alpha: 0.92),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          '$discountPct% OFF',
                          style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: Colors.white),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (product['category'] is String && (product['category'] as String).isNotEmpty)
                        Expanded(
                          child: Text(
                            product['category'] as String,
                            style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      if (isOrganic)
                        const _TagChip(label: 'Organic', color: AppTheme.success, icon: Icons.eco),
                      if (isFresh)
                        const _TagChip(label: 'Fresh', color: AppTheme.info, icon: Icons.local_florist),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(farmer, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(height: 8),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        price != null ? 'Rs ${price == price.roundToDouble() ? price.toInt().toString() : price.toStringAsFixed(2)}' : '—',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppTheme.primaryGreen),
                      ),
                      if (unit.isNotEmpty) Text('/$unit', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      if (strikePrice != null)
                        Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: Text(
                            'Rs $strikePrice',
                            style: const TextStyle(fontSize: 11, color: AppTheme.textTertiary, decoration: TextDecoration.lineThrough),
                          ),
                        ),
                      const Spacer(),
                      if (rating > 0)
                        Row(
                          children: [
                            const Icon(Icons.star, size: 14, color: AppTheme.accent),
                            Text(rating.toStringAsFixed(1), style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
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

class _TagChip extends StatelessWidget {
  final String label;
  final Color color;
  final IconData icon;
  const _TagChip({required this.label, required this.color, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(left: 4),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: color),
          const SizedBox(width: 2),
          Text(label, style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: color)),
        ],
      ),
    );
  }
}