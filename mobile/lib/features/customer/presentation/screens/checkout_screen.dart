import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import 'cart_screen.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});
  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _addressController = TextEditingController();
  final _cityController = TextEditingController();
  final _pincodeController = TextEditingController();
  final _couponController = TextEditingController();
  late final Razorpay _razorpay;
  String _selectedPayment = 'razorpay';
  bool _isLoading = false;
  bool _isPlacing = false;
  List<Map<String, dynamic>> _savedAddresses = [];
  String? _selectedAddressId;
  bool _showNewAddress = false;
  Map<String, dynamic>? _pendingIntent;
  String? _pendingOrderId;
  String _appliedCouponCode = '';
  double _couponDiscount = 0;
  String _couponError = '';
  bool _applyingCoupon = false;
  double _deliveryCharge = 0;
  bool _calculatingDelivery = false;
  String? _deliveryError;
  String _deliveryType = 'delivery';

  final _paymentMethods = [
    {'id': 'razorpay', 'label': 'Pay Online (UPI, Cards, Net Banking)', 'icon': Icons.payments_outlined},
    {'id': 'cash', 'label': 'Cash on Delivery', 'icon': Icons.money_outlined},
  ];

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handlePaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handlePaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _handleExternalWallet);
    _loadAddresses();
    _calculateDeliveryCharge();
  }

  @override
  void dispose() {
    _razorpay.clear();
    _addressController.dispose();
    _cityController.dispose();
    _pincodeController.dispose();
    _couponController.dispose();
    super.dispose();
  }

  Future<void> _calculateDeliveryCharge() async {
    final cart = CartService.instance;
    if (cart.items.isEmpty) return;
    
    setState(() => _calculatingDelivery = true);
    try {
      final res = await ApiService.post('/delivery/calculate-charge', body: {
        'items': cart.items.map((item) => {
          'productId': item.id,
          'quantity': item.quantity,
        }).toList(),
        'pincode': _pincodeController.text.trim().isNotEmpty ? _pincodeController.text.trim() : _savedAddresses.firstWhere(
          (a) => a['id'] == _selectedAddressId,
          orElse: () => {},
        )['zip_code'] ?? '',
      });
      
      if (!mounted) return;
      final data = res['data'] ?? res;
      setState(() {
        _deliveryCharge = double.tryParse('${data['deliveryCharge']}') ?? 0;
        _deliveryError = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _deliveryCharge = 0;
        _deliveryError = 'Could not calculate delivery charge';
      });
    } finally {
      if (mounted) setState(() => _calculatingDelivery = false);
    }
  }

  Future<void> _loadAddresses() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/users/me/addresses');
      if (!mounted) return;
      final data = res['data'] as List<dynamic>? ?? [];
      setState(() {
        _savedAddresses = data.cast<Map<String, dynamic>>();
        if (_savedAddresses.isNotEmpty) {
          _selectedAddressId = _savedAddresses.first['id'] as String?;
          _pincodeController.text = _savedAddresses.first['zip_code'] ?? '';
        }
      });
      _calculateDeliveryCharge();
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<String?> _resolveAddressId() async {
    if (!_showNewAddress) return _selectedAddressId;

    final street = _addressController.text.trim();
    final city = _cityController.text.trim();
    final pincode = _pincodeController.text.trim();
    if (street.isEmpty || city.isEmpty || pincode.isEmpty) {
      throw Exception('Please fill in the new address');
    }
    final res = await ApiService.post('/users/me/addresses', body: {
      'address_line1': street,
      'address_line2': '',
      'city': city,
      'state': '',
      'zip_code': pincode,
      'country': 'India',
      'address_type': 'home',
      'is_default': _savedAddresses.isEmpty,
    });
    final data = res['data'] ?? res;
    return data is Map ? '${data['id'] ?? data['_id'] ?? ''}' : null;
  }

  Future<void> _placeOrder() async {
    final cart = CartService.instance;
    if (cart.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Your cart is empty'), backgroundColor: AppTheme.error));
      return;
    }

    setState(() => _isPlacing = true);
    try {
      final deliveryAddressId = await _resolveAddressId();
      if (deliveryAddressId == null || deliveryAddressId.isEmpty) {
        throw Exception('Please select or add a delivery address');
      }
      final orderRes = await ApiService.post('/orders', body: {
        'items': cart.items.map((item) => {
          'productId': item.id,
          'quantity': item.quantity,
          'unitPrice': item.price,
        }).toList(),
        'paymentMethod': _selectedPayment,
        'deliveryAddressId': deliveryAddressId,
        'deliveryType': 'delivery',
        if (_appliedCouponCode.isNotEmpty) 'couponCode': _appliedCouponCode,
      });
      if (!mounted) return;
      final orderId = orderRes['id'] ?? orderRes['data']?['_id'] ?? orderRes['_id'] as String?;
      if (orderId == null) throw Exception('Order could not be created');

      if (_selectedPayment == 'cash') {
        cart.clear();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Order placed successfully!'), backgroundColor: AppTheme.success));
        context.go('/customer/orders');
        return;
      }

      // Online payment — create a Razorpay order and open the Checkout.
      final intent = await ApiService.post('/payments/create-intent', body: {
        'order_id': orderId,
        'payment_method': 'razorpay',
      });
      final intentData = intent['data'] ?? intent;
      if (!mounted) return;
      if (intentData['order_id'] == null) {
        throw Exception(intentData['error'] ?? 'Payment initiation failed');
      }

      _pendingIntent = intentData;
      _pendingOrderId = orderId;
      _openRazorpay(intentData);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message), backgroundColor: AppTheme.error));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to place order'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _isPlacing = false);
    }
  }

  void _openRazorpay(Map<String, dynamic> intent) {
    final options = {
      'key': intent['key_id'],
      'amount': intent['amount'],
      'currency': intent['currency'] ?? 'INR',
      'name': intent['name'] ?? 'AgriConnect',
      'description': intent['description'] ?? '',
      'order_id': intent['order_id'],
      'prefill': intent['prefill'] ?? {},
      'theme': {'color': '#059669'},
    };
    try {
      _razorpay.open(options);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open payment gateway'), backgroundColor: AppTheme.error));
    }
  }

  Future<void> _handlePaymentSuccess(PaymentSuccessResponse response) async {
    final intent = _pendingIntent;
    final orderId = _pendingOrderId;
    if (intent == null || orderId == null) return;

    try {
      setState(() => _isPlacing = true);
      await ApiService.post('/payments/verify', body: {
        'payment_id': intent['payment_id'],
        'razorpay_order_id': response.orderId,
        'razorpay_payment_id': response.paymentId,
        'razorpay_signature': response.signature,
      });
      if (!mounted) return;
      CartService.instance.clear();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Payment successful! Order placed.'), backgroundColor: AppTheme.success));
      context.go('/customer/orders');
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Payment received, but confirmation failed. Contact support.'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _isPlacing = false);
    }
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(response.message ?? 'Payment failed, please try again'),
      backgroundColor: AppTheme.error,
    ));
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Wallet selected'), backgroundColor: AppTheme.accent));
  }

  Future<void> _applyCoupon() async {
    final code = _couponController.text.trim();
    if (code.isEmpty) {
      setState(() => _couponError = 'Enter a coupon code');
      return;
    }
    setState(() {
      _applyingCoupon = true;
      _couponError = '';
    });
    try {
      final res = await ApiService.post('/coupons/validate', body: {
        'code': code,
        'orderValue': CartService.instance.total,
      });
      final body = res['data'] ?? res;
      if (body is Map && body['valid'] == true) {
        final discount = double.tryParse('${body['discountAmount']}') ?? 0;
        setState(() {
          _couponDiscount = discount;
          _appliedCouponCode = code.toUpperCase();
        });
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Coupon ${code.toUpperCase()} applied!'),
          backgroundColor: AppTheme.success,
        ));
      } else {
        final msg = body is Map ? (body['message'] as String? ?? 'Invalid coupon code') : 'Invalid coupon code';
        setState(() {
          _couponDiscount = 0;
          _appliedCouponCode = '';
          _couponError = msg;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _couponDiscount = 0;
        _appliedCouponCode = '';
        _couponError = 'Failed to validate coupon';
      });
    } finally {
      if (mounted) setState(() => _applyingCoupon = false);
    }
  }

  void _removeCoupon() {
    _couponController.clear();
    setState(() {
      _couponDiscount = 0;
      _appliedCouponCode = '';
      _couponError = '';
    });
  }

  double get _estimatedTotal => (CartService.instance.total - _couponDiscount + _deliveryCharge).clamp(0, double.infinity);

  @override
  Widget build(BuildContext context) {
    final cart = CartService.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
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
                        child: const Icon(Icons.local_shipping_outlined, color: AppTheme.primaryGreen, size: 18),
                      ),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Fresh delivery promise: tracked and on time for your order.',
                          style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                _SectionHeader(title: 'Delivery Address', icon: Icons.location_on_outlined),
                const SizedBox(height: 12),
                if (_savedAddresses.isNotEmpty)
                  ..._savedAddresses.map((addr) => _AddressCard(
                    address: addr,
                    isSelected: !_showNewAddress && _selectedAddressId == addr['id'],
                    onTap: () => setState(() {
                      _showNewAddress = false;
                      _selectedAddressId = addr['id'] as String?;
                      _pincodeController.text = addr['zip_code'] ?? '';
                      _calculateDeliveryCharge();
                    }),
                  )),
                const SizedBox(height: 8),
                _AddAddressToggle(
                  expanded: _showNewAddress,
                  onTap: () => setState(() {
                    _showNewAddress = !_showNewAddress;
                    if (_showNewAddress) _selectedAddressId = null;
                  }),
                ),
                if (_showNewAddress) ...[
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _addressController,
                    decoration: const InputDecoration(labelText: 'Street Address', prefixIcon: Icon(Icons.home_outlined)),
                    maxLines: 2,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(child: TextFormField(controller: _cityController, decoration: const InputDecoration(labelText: 'City', prefixIcon: Icon(Icons.location_city)))),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _pincodeController,
                          decoration: const InputDecoration(labelText: 'Pincode', prefixIcon: Icon(Icons.pin)),
                          keyboardType: TextInputType.number,
                          onChanged: (_) => _calculateDeliveryCharge(),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 24),
                _SectionHeader(title: 'Order Summary', icon: Icons.receipt_outlined),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
                  child: Column(
                    children: [
                      Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppTheme.primarySoft,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.receipt_long_outlined, size: 16, color: AppTheme.primaryGreen),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Order summary is refreshed in real time with delivery and coupon updates.',
                                style: TextStyle(fontSize: 11.5, color: AppTheme.textSecondary),
                              ),
                            ),
                          ],
                        ),
                      ),
                      _appliedCouponCode.isNotEmpty
                        ? Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: AppTheme.primaryGreen.withValues(alpha: 0.06),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(_appliedCouponCode, style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.primaryGreen)),
                                ),
                                Text('- Rs ${_couponDiscount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.primaryGreen)),
                                const SizedBox(width: 8),
                                InkWell(
                                  onTap: _removeCoupon,
                                  child: const Icon(Icons.close, size: 18, color: AppTheme.textSecondary),
                                ),
                              ],
                            ),
                          )
                        : Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _couponController,
                                  decoration: const InputDecoration(
                                    hintText: 'Coupon code (e.g. SUMMER20)',
                                    isDense: true,
                                    border: OutlineInputBorder(),
                                  ),
                                  textCapitalization: TextCapitalization.characters,
                                ),
                              ),
                              const SizedBox(width: 8),
                              ElevatedButton(
                                onPressed: _applyingCoupon ? null : _applyCoupon,
                                style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primaryGreen, foregroundColor: Colors.white),
                                child: _applyingCoupon
                                  ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                  : const Text('Apply'),
                              ),
                            ],
                          ),
                      if (_couponError.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(_couponError, style: const TextStyle(fontSize: 12, color: AppTheme.error)),
                        ),
                      const SizedBox(height: 12),
                      ...cart.items.map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            Expanded(child: Text('${item.name} x${item.quantity}', style: const TextStyle(fontSize: 13))),
                            Text('Rs ${(item.price * item.quantity).toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          ],
                        ),
                      )),
                      const Divider(),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Subtotal', style: TextStyle(fontSize: 14)),
                          Text('Rs ${cart.total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                        ],
                      ),
                      if (_couponDiscount > 0)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Coupon discount', style: TextStyle(fontSize: 14, color: AppTheme.primaryGreen)),
                              Text('- Rs ${_couponDiscount.toStringAsFixed(2)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen)),
                            ],
                          ),
                        ),
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                const Text('Delivery Charge', style: TextStyle(fontSize: 14)),
                                if (_calculatingDelivery) ...[
                                  const SizedBox(width: 8),
                                  SizedBox(height: 12, width: 12, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primaryGreen)),
                                ],
                              ],
                            ),
                            _calculatingDelivery
                                ? const Text('Calculating...', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textSecondary))
                                : _deliveryCharge > 0
                                    ? Text('Rs ${_deliveryCharge.toStringAsFixed(2)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600))
                                    : Text(
                                        _deliveryError ?? 'Free',
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600,
                                          color: _deliveryError != null ? AppTheme.error : AppTheme.success,
                                        ),
                                      ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        decoration: BoxDecoration(
                          color: AppTheme.primarySoft.withValues(alpha: 0.3),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.2)),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Total', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            Text(
                              'Rs ${_estimatedTotal.toStringAsFixed(2)}',
                              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppTheme.primaryGreen),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                _SectionHeader(title: 'Payment Method', icon: Icons.payment_outlined),
                const SizedBox(height: 12),
                ..._paymentMethods.map((m) => _PaymentMethodCard(
                  method: m,
                  isSelected: _selectedPayment == m['id'],
                  onTap: () => setState(() => _selectedPayment = m['id'] as String),
                )),
                if (_selectedPayment == 'razorpay') ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.primaryGreen.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.3)),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.lock_outline, size: 16, color: AppTheme.primaryGreen),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Secure payments by Razorpay. UPI (GPay, PhonePe, Paytm), cards & net banking.',
                            style: TextStyle(fontSize: 12, color: AppTheme.primaryGreen),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _isPlacing ? null : _placeOrder,
                    child: _isPlacing
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(_selectedPayment == 'cash'
                          ? 'Place Order - Rs ${_estimatedTotal.toStringAsFixed(2)}'
                          : 'Pay Online - Rs ${_estimatedTotal.toStringAsFixed(2)}'),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final IconData icon;
  const _SectionHeader({required this.title, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 20, color: AppTheme.primaryGreen),
        const SizedBox(width: 8),
        Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
      ],
    );
  }
}

class _AddressCard extends StatelessWidget {
  final Map<String, dynamic> address;
  final bool isSelected;
  final VoidCallback onTap;
  const _AddressCard({required this.address, required this.isSelected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primaryGreen.withValues(alpha: 0.05) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? AppTheme.primaryGreen : AppTheme.border, width: isSelected ? 2 : 1),
        ),
        child: Row(
          children: [
            Icon(isSelected ? Icons.radio_button_checked : Icons.radio_button_off, color: isSelected ? AppTheme.primaryGreen : AppTheme.textSecondary, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(address['address_line1'] as String? ?? address['street'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w500)),
                  Text(
                    '${address['city'] as String? ?? ''}${(address['zip_code'] as String?)?.isNotEmpty == true ? ' - ${address['zip_code']}' : ''}',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
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

class _AddAddressToggle extends StatelessWidget {
  final bool expanded;
  final VoidCallback onTap;
  const _AddAddressToggle({required this.expanded, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: expanded ? AppTheme.primaryGreen.withValues(alpha: 0.06) : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: expanded ? AppTheme.primaryGreen : AppTheme.border, width: expanded ? 2 : 1),
          ),
          child: Row(
            children: [
              Icon(expanded ? Icons.expand_less : Icons.add_location_alt_outlined, color: AppTheme.primaryGreen, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  expanded ? 'Use a new address' : 'Add a new address',
                  style: TextStyle(fontWeight: FontWeight.w600, color: expanded ? AppTheme.primaryGreen : AppTheme.textPrimary),
                ),
              ),
              Icon(expanded ? Icons.expand_less : Icons.expand_more, color: AppTheme.textSecondary, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaymentMethodCard extends StatelessWidget {
  final Map<String, dynamic> method;
  final bool isSelected;
  final VoidCallback onTap;
  const _PaymentMethodCard({required this.method, required this.isSelected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primaryGreen.withValues(alpha: 0.05) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? AppTheme.primaryGreen : AppTheme.border, width: isSelected ? 2 : 1),
        ),
        child: Row(
          children: [
            Icon(method['icon'] as IconData, color: isSelected ? AppTheme.primaryGreen : AppTheme.textSecondary),
            const SizedBox(width: 12),
            Expanded(child: Text(method['label'] as String, style: TextStyle(fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal))),
            Icon(isSelected ? Icons.radio_button_checked : Icons.radio_button_off, color: isSelected ? AppTheme.primaryGreen : AppTheme.textSecondary, size: 20),
          ],
        ),
      ),
    );
  }
}
