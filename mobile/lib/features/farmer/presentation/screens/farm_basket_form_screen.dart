import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';

const _weekdays = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', '1st of month'];
const _cadences = ['weekly', 'biweekly', 'monthly'];
const _units = ['kg', 'g', 'piece', 'bunch', 'liter', 'ml', 'dozen'];
const _categories = ['vegetables', 'fruits', 'dairy', 'grains', 'spices', 'herbs', 'poultry', 'meat', 'seafood', 'nuts-seeds', 'beverages', 'organic'];

class FarmBasketFormScreen extends StatefulWidget {
  const FarmBasketFormScreen({super.key});
  @override
  State<FarmBasketFormScreen> createState() => _FarmBasketFormScreenState();
}

class _FarmBasketFormScreenState extends State<FarmBasketFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _priceController = TextEditingController();
  final _maxSubsController = TextEditingController();

  final _newProductNameController = TextEditingController();
  final _newProductPriceController = TextEditingController();

  bool _isEditing = false;
  String? _planId;
  String _cadence = 'weekly';
  String _day = 'Saturday';
  String _deliveryMode = 'delivery';
  String _newProductCategory = 'vegetables';
  String _newProductUnit = 'kg';

  bool _isLoading = true;
  bool _creatingProduct = false;
  bool _saving = false;
  bool _showNewProduct = false;

  List<Map<String, dynamic>> _products = [];
  final Map<String, String> _selectedQtys = {};
  final Map<String, TextEditingController> _qtyControllers = {};
  final Map<String, Map<String, dynamic>> _legacyItems = {};

  @override
  void initState() {
    super.initState();
    final extra = GoRouterState.of(context).extra as Map<String, dynamic>?;
    if (extra != null && extra['id'] != null) {
      _isEditing = true;
      _planId = extra['id'] as String?;
      _nameController.text = extra['name'] as String? ?? '';
      _descriptionController.text = extra['description'] as String? ?? '';
      _priceController.text = '${extra['price'] as num? ?? ''}';
      _maxSubsController.text = '${extra['maxSubscribers'] as num? ?? 50}';
      _cadence = extra['cadence'] as String? ?? 'weekly';
      _day = extra['day'] as String? ?? 'Saturday';
      _deliveryMode = extra['deliveryMode'] as String? ?? 'delivery';
      final items = extra['items'] as List<dynamic>? ?? [];
      for (final it in items) {
        final item = it as Map<String, dynamic>;
        final pid = '${item['productId']}';
        _selectedQtys[pid] = '${item['quantity'] ?? ''}';
        _legacyItems[pid] = item;
      }
    }
    _loadProducts();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _priceController.dispose();
    _maxSubsController.dispose();
    _newProductNameController.dispose();
    _newProductPriceController.dispose();
    for (final c in _qtyControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _syncQtyControllers() {
    for (final p in _products) {
      final id = _productId(p);
      if (_qtyControllers.containsKey(id)) continue;
      final controller = TextEditingController(text: _selectedQtys[id] ?? '');
      _qtyControllers[id] = controller;
    }
  }

  void _disposeQtyController(String id) {
    final c = _qtyControllers.remove(id);
    c?.dispose();
  }

  Future<void> _loadProducts() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get(
        '/farmers/me/products',
        params: {'limit': '100', 'includeBasketOnly': 'true'},
      );
      if (!mounted) return;
      final data = res['data'] as Map<String, dynamic>? ?? {};
      final list = data['products'] as List<dynamic>? ?? [];
      setState(() {
        _products = list.cast<Map<String, dynamic>>();
        _syncQtyControllers();
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to load products'), backgroundColor: AppTheme.error),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _productId(Map<String, dynamic> product) =>
      '${product['id'] ?? product['_id'] ?? ''}';

  String _productName(Map<String, dynamic> product) =>
      product['name'] as String? ?? 'Product';

  String _productUnit(Map<String, dynamic> product) =>
      product['unit'] as String? ?? 'kg';

  double _productPrice(Map<String, dynamic> product) =>
      (product['price'] as num?)?.toDouble() ?? 0;

  /// Non-destructive: removes the product from the current basket selection.
  void _removeFromBasket(String id) {
    _disposeQtyController(id);
    setState(() {
      _selectedQtys.remove(id);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Removed from basket'), backgroundColor: AppTheme.success),
    );
  }

  Future<void> _deleteProduct(Map<String, dynamic> product) async {
    final id = _productId(product);
    final name = _productName(product);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Product'),
        content: Text('Delete "$name"? This deletes the product permanently and removes it from all baskets.'),
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
    try {
      await ApiService.delete('/products/$id');
      if (!mounted) return;
      _disposeQtyController(id);
      setState(() {
        _products.removeWhere((p) => _productId(p) == id);
        _selectedQtys.remove(id);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Product deleted'), backgroundColor: AppTheme.success),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to delete product'), backgroundColor: AppTheme.error),
      );
    }
  }

  /// Creates a NEW product flagged basket-only so it is hidden from the
  /// public product page and only used inside farm baskets.
  Future<void> _createProduct() async {
    final name = _newProductNameController.text.trim();
    final price = double.tryParse(_newProductPriceController.text.trim());
    if (name.isEmpty || price == null || price <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a product name and valid price'), backgroundColor: AppTheme.error),
      );
      return;
    }
    setState(() => _creatingProduct = true);
    try {
      final slug = name
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
          .replaceAll(RegExp(r'^-+|-+$'), '');
      final res = await ApiService.post('/products', body: {
        'name': name,
        'slug': slug.isEmpty ? 'product' : slug,
        'categoryId': _newProductCategory,
        'price': price,
        'unit': _newProductUnit,
        'quantity': 1,
        'description': 'Basket-only product',
        'isActive': true,
        'isBasketOnly': true,
      });
      if (!mounted) return;
      final created = res is Map ? Map<String, dynamic>.from(res) : <String, dynamic>{};
      final id = '${created['id'] ?? created['_id'] ?? ''}';
      if (id.isEmpty) {
        throw ApiException('Product id missing', 0);
      }
      setState(() {
        _products.insert(0, created);
        _selectedQtys[id] = '1';
        _qtyControllers[id] = TextEditingController(text: '1');
        _newProductNameController.clear();
        _newProductPriceController.clear();
        _showNewProduct = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Product created and added to basket'), backgroundColor: AppTheme.success),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: AppTheme.error),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to create product'), backgroundColor: AppTheme.error),
      );
    } finally {
      if (mounted) setState(() => _creatingProduct = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final items = <Map<String, dynamic>>[];
    _selectedQtys.forEach((productId, qtyRaw) {
      final qty = double.tryParse(qtyRaw.trim());
      if (qty == null || qty <= 0) return;
      final product = _products.where((p) => _productId(p) == productId).firstOrNull;
      final legacy = _legacyItems[productId];
      items.add({
        'productId': productId,
        'name': product != null ? _productName(product) : (legacy?['name'] ?? 'Item'),
        'quantity': qty,
        'unit': product != null ? _productUnit(product) : (legacy?['unit'] ?? 'kg'),
        'unitPrice': product != null ? _productPrice(product) : ((legacy?['unitPrice'] as num?)?.toDouble() ?? 0),
      });
    });
    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add at least one product with a quantity'), backgroundColor: AppTheme.error),
      );
      return;
    }
    final price = double.tryParse(_priceController.text.trim());
    if (price == null || price <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid basket price'), backgroundColor: AppTheme.error),
      );
      return;
    }
    final body = <String, dynamic>{
      'name': _nameController.text.trim(),
      'description': _descriptionController.text.trim().isEmpty ? null : _descriptionController.text.trim(),
      'cadence': _cadence,
      'day': _day,
      'price': price,
      'maxSubscribers': int.tryParse(_maxSubsController.text.trim()) ?? 50,
      'deliveryMode': _deliveryMode,
      'items': items,
    };
    setState(() => _saving = true);
    try {
      if (_isEditing) {
        await ApiService.put('/subscriptions/plans/$_planId', body: body);
      } else {
        await ApiService.post('/subscriptions/plans', body: body);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_isEditing ? 'Basket updated' : 'Basket created'), backgroundColor: AppTheme.success),
      );
      context.pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: AppTheme.error),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to save basket'), backgroundColor: AppTheme.error),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEditing ? 'Edit Basket' : 'Create Farm Basket')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _buildDetailsCard(),
                  const SizedBox(height: 20),
                  _buildProductsCard(),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(_isEditing ? 'Update Basket' : 'Create Basket'),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
    );
  }

  Widget _buildDetailsCard() {
    return _FormCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Basket Details', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
          const SizedBox(height: 16),
          TextFormField(
            controller: _nameController,
            decoration: const InputDecoration(labelText: 'Basket Name', prefixIcon: Icon(Icons.shopping_basket_outlined)),
            validator: (v) => v == null || v.trim().isEmpty ? 'Enter basket name' : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _descriptionController,
            decoration: const InputDecoration(labelText: 'Description', alignLabelWithHint: true, prefixIcon: Icon(Icons.notes)),
            maxLines: 2,
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _cadence,
                  decoration: const InputDecoration(labelText: 'Frequency'),
                  items: _cadences.map((c) => DropdownMenuItem(value: c, child: Text(c[0].toUpperCase() + c.substring(1)))).toList(),
                  onChanged: (v) => setState(() => _cadence = v!),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _day,
                  decoration: const InputDecoration(labelText: 'Delivery Day'),
                  items: _weekdays.map((d) => DropdownMenuItem(value: d, child: Text(d))).toList(),
                  onChanged: (v) => setState(() => _day = v!),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextFormField(
                  controller: _priceController,
                  decoration: const InputDecoration(labelText: 'Price (Rs)', prefixIcon: Icon(Icons.currency_rupee)),
                  keyboardType: TextInputType.number,
                  validator: (v) => v == null || v.trim().isEmpty ? 'Enter price' : null,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextFormField(
                  controller: _maxSubsController,
                  decoration: const InputDecoration(labelText: 'Max Subscribers'),
                  keyboardType: TextInputType.number,
                  initialValue: null,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _deliveryMode,
            decoration: const InputDecoration(labelText: 'Delivery Mode', prefixIcon: Icon(Icons.local_shipping_outlined)),
            items: const [
              DropdownMenuItem(value: 'delivery', child: Text('Farm Delivery')),
              DropdownMenuItem(value: 'pickup', child: Text('Farm Pickup')),
            ],
            onChanged: (v) => setState(() => _deliveryMode = v!),
          ),
        ],
      ),
    );
  }

  Widget _buildProductsCard() {
    return _FormCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Basket Products', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
              ),
              TextButton.icon(
                onPressed: () => setState(() => _showNewProduct = !_showNewProduct),
                icon: const Icon(Icons.add, size: 18),
                label: Text(_showNewProduct ? 'Close' : 'Add Product'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Products you create here are basket-only and will not appear on the public product page.',
            style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 12),
          if (_showNewProduct) _buildNewProductForm(),
          if (_products.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text('No products yet. Add a product to include in this basket.', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
              ),
            )
          else
            ..._products.map((p) => _buildProductRow(p)),
        ],
      ),
    );
  }

  Widget _buildNewProductForm() {
    return Container(
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppTheme.primarySoft,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Create a basket-only product (hidden from the product page)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.primaryDark)),
          const SizedBox(height: 12),
          TextFormField(
            controller: _newProductNameController,
            decoration: const InputDecoration(labelText: 'Product Name *', isDense: true),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextFormField(
                  controller: _newProductPriceController,
                  decoration: const InputDecoration(labelText: 'Price per unit (Rs) *', isDense: true, prefixIcon: Icon(Icons.currency_rupee, size: 18)),
                  keyboardType: TextInputType.number,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _newProductUnit,
                  decoration: const InputDecoration(labelText: 'Unit', isDense: true),
                  items: _units.map((u) => DropdownMenuItem(value: u, child: Text(u))).toList(),
                  onChanged: (v) => setState(() => _newProductUnit = v!),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _newProductCategory,
            decoration: const InputDecoration(labelText: 'Category *', isDense: true),
            items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c[0].toUpperCase() + c.substring(1)))).toList(),
            onChanged: (v) => setState(() => _newProductCategory = v!),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _creatingProduct ? null : _createProduct,
              child: _creatingProduct
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Create & Add to Basket'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductRow(Map<String, dynamic> product) {
    final id = _productId(product);
    final name = _productName(product);
    final unit = _productUnit(product);
    final price = _productPrice(product);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text('Rs $price / $unit', style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          SizedBox(
            width: 72,
            child: TextField(
              controller: _qtyControllers[id],
              decoration: const InputDecoration(isDense: true, labelText: 'Qty', contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textAlign: TextAlign.center,
              onChanged: (v) => setState(() => _selectedQtys[id] = v),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 18, color: AppTheme.textSecondary),
            tooltip: 'Remove from basket',
            onPressed: () => _removeFromBasket(id),
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            padding: EdgeInsets.zero,
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, size: 18, color: AppTheme.error),
            tooltip: 'Delete product permanently',
            onPressed: () => _deleteProduct(product),
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            padding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }
}

class _FormCard extends StatelessWidget {
  final Widget child;
  const _FormCard({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.border.withValues(alpha: 0.7)),
      ),
      child: child,
    );
  }
}
