import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/empty_state.dart';

class CartItem {
  final String id;
  final String name;
  final double price;
  final String image;
  int quantity;
  CartItem({required this.id, required this.name, required this.price, required this.image, this.quantity = 1});

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'price': price,
        'image': image,
        'quantity': quantity,
      };

  factory CartItem.fromJson(Map<String, dynamic> json) => CartItem(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? 'Product',
        price: (json['price'] as num?)?.toDouble() ?? 0,
        image: json['image'] as String? ?? '',
        quantity: (json['quantity'] as num?)?.toInt() ?? 1,
      );
}

/// In-memory cart persisted to [SharedPreferences] so items survive app
/// restarts. Screens rebuild via [ChangeNotifier] listening.
class CartService extends ChangeNotifier {
  CartService._() {
    _load();
  }

  static final CartService _instance = CartService._();
  static CartService get instance => _instance;

  static const String _storageKey = 'cart_items';
  final List<CartItem> _items = [];

  List<CartItem> get items => List.unmodifiable(_items);
  int get itemCount => _items.fold(0, (sum, item) => sum + item.quantity);
  double get total => _items.fold(0.0, (sum, item) => sum + item.price * item.quantity);

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_storageKey);
      if (raw == null || raw.isEmpty) return;
      final list = jsonDecode(raw) as List<dynamic>;
      _items
        ..clear()
        ..addAll(list.map((e) => CartItem.fromJson(e as Map<String, dynamic>)));
      notifyListeners();
    } catch (_) {
      // Corrupt or missing cache is not fatal; start with an empty cart.
    }
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, jsonEncode(_items.map((e) => e.toJson()).toList()));
  }

  Future<void> addItem(CartItem item) async {
    final existing = _items.where((i) => i.id == item.id).firstOrNull;
    if (existing != null) {
      existing.quantity = (existing.quantity + item.quantity).clamp(1, 99);
    } else {
      _items.add(item);
    }
    notifyListeners();
    await _persist();
  }

  Future<void> removeItem(String id) async {
    _items.removeWhere((i) => i.id == id);
    notifyListeners();
    await _persist();
  }

  Future<void> updateQuantity(String id, int delta) async {
    final item = _items.where((i) => i.id == id).firstOrNull;
    if (item != null) {
      item.quantity = (item.quantity + delta).clamp(1, 99);
      notifyListeners();
      await _persist();
    }
  }

  Future<void> clear() async {
    _items.clear();
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_storageKey);
  }
}

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});
  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final _cart = CartService.instance;

  @override
  void initState() {
    super.initState();
    _cart.addListener(_onCartChanged);
  }

  @override
  void dispose() {
    _cart.removeListener(_onCartChanged);
    super.dispose();
  }

  void _onCartChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _onQuantityChanged(String id, int delta) async {
    await _cart.updateQuantity(id, delta);
  }

  Future<void> _onRemove(String id) async {
    await _cart.removeItem(id);
  }

  @override
  Widget build(BuildContext context) {
    final items = _cart.items;
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Cart'),
        actions: [
          if (items.isNotEmpty)
            TextButton(
              onPressed: () => _cart.clear(),
              child: const Text('Clear', style: TextStyle(color: AppTheme.error)),
            ),
        ],
      ),
      body: items.isEmpty
          ? EmptyState(
              icon: Icons.shopping_cart_outlined,
              title: 'Your cart is empty',
              message: 'Browse products and add fresh farm items to your cart.',
              actionLabel: 'Start Shopping',
              onAction: () => context.go('/customer/home'),
            )
          : Column(
              children: [
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.fromLTRB(16, 14, 16, 10),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFFE8FFF5), Color(0xFFF8FFFB)],
                    ),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.2)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: AppTheme.primaryGreen.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.eco_outlined, color: AppTheme.primaryGreen, size: 18),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '${items.length} fresh item${items.length == 1 ? '' : 's'} ready for checkout',
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _CartItemCard(
                      item: items[i],
                      onQuantityChanged: (delta) => _onQuantityChanged(items[i].id, delta),
                      onRemove: () => _onRemove(items[i].id),
                    ),
                  ),
                ),
                _CheckoutBar(
                  count: _cart.itemCount,
                  total: _cart.total,
                  onCheckout: () => context.push('/customer/checkout'),
                ),
              ],
            ),
    );
  }
}

class _CartItemCard extends StatelessWidget {
  final CartItem item;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onRemove;

  const _CartItemCard({
    required this.item,
    required this.onQuantityChanged,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
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
            child: Container(
              width: 82,
              height: 82,
              color: AppTheme.background,
              child: item.image.isNotEmpty
                  ? Image.network(item.image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.image, color: AppTheme.textSecondary))
                  : const Icon(Icons.image, color: AppTheme.textSecondary),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppTheme.textPrimary), maxLines: 2, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 4),
                Text(
                  'Rs ${item.price.toStringAsFixed(2)} each',
                  style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.primaryGreen),
                ),
                const SizedBox(height: 6),
                Text(
                  'Subtotal: Rs ${(item.price * item.quantity).toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _QuantityControl(
                      quantity: item.quantity,
                      onIncrement: () => onQuantityChanged(1),
                      onDecrement: () {
                        if (item.quantity <= 1) {
                          onRemove();
                        } else {
                          onQuantityChanged(-1);
                        }
                      },
                    ),
                    const Spacer(),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.delete_outline, color: AppTheme.error, size: 20),
                      onPressed: onRemove,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutBar extends StatelessWidget {
  final int count;
  final double total;
  final VoidCallback onCheckout;

  const _CheckoutBar({required this.count, required this.total, required this.onCheckout});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFFFF), Color(0xFFF3FBF6)],
        ),
        boxShadow: AppTheme.cardShadow,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
      ),
      child: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$count item${count == 1 ? '' : 's'}', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  Text('Rs ${total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppTheme.primaryGreen)),
                ],
              ),
            ),
            Expanded(
              flex: 2,
              child: ElevatedButton(
                onPressed: onCheckout,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryGreen,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Proceed to Checkout'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuantityControl extends StatelessWidget {
  final int quantity;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;
  const _QuantityControl({required this.quantity, required this.onIncrement, required this.onDecrement});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: AppTheme.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: onDecrement,
            borderRadius: BorderRadius.circular(8),
            child: const Padding(padding: EdgeInsets.all(7), child: Icon(Icons.remove, size: 18, color: AppTheme.primaryGreen)),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: const BoxDecoration(
              color: AppTheme.primarySoft,
              borderRadius: BorderRadius.horizontal(left: Radius.zero, right: Radius.zero),
            ),
            child: Text('$quantity', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          ),
          InkWell(
            onTap: onIncrement,
            borderRadius: BorderRadius.circular(8),
            child: const Padding(padding: EdgeInsets.all(7), child: Icon(Icons.add, size: 18, color: AppTheme.primaryGreen)),
          ),
        ],
      ),
    );
  }
}