import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/services/api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/skeleton.dart';
import '../../../../shared/widgets/status_chip.dart';
import 'refund_details_screen.dart' show refundStatusMeta;

class OrderDetailsScreen extends StatefulWidget {
  final String orderId;
  const OrderDetailsScreen({super.key, required this.orderId});
  @override
  State<OrderDetailsScreen> createState() => _OrderDetailsScreenState();
}

class _OrderDetailsScreenState extends State<OrderDetailsScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _order;

  List<Map<String, dynamic>> _refunds = [];
  bool _cancelEligible = false;
  bool _cancelRequiresReview = false;
  double _cancelEstimate = 0;

  String _problemReason = 'damaged_product';
  String _problemResolution = 'partial_refund';
  String _problemDescription = '';
  Map<String, int> _problemQuantities = {};
  List<String> _problemEvidence = [];
  bool _uploadingEvidence = false;
  bool _reporting = false;
  bool _cancelling = false;

  int _overallRating = 0;
  int _onTimeRating = 0;
  int _professionalismRating = 0;
  int _handlingRating = 0;
  int _communicationRating = 0;
  String _feedback = '';
  bool _partnerSubmitting = false;
  Map<String, dynamic>? _partnerRatingData;

  @override
  void initState() {
    super.initState();
    _loadOrder();
  }

  String _orderStatus() {
    return (_order?['orderStatus'] as String? ?? _order?['status'] as String? ?? 'pending').toLowerCase();
  }

  Future<void> _loadOrder() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/orders/${widget.orderId}');
      if (!mounted) return;
      final order = res['data'] as Map<String, dynamic>? ?? res;
      setState(() {
        _order = order;
        _partnerRatingData = null;
      });
      final status = (order['orderStatus'] as String? ?? order['status'] as String? ?? '').toLowerCase();
      final deliveryRating = order['deliveryRating'] is Map ? order['deliveryRating'] as Map<String, dynamic> : null;
      if (status == 'delivered' && deliveryRating != null && deliveryRating['partnerId'] != null) {
        await _loadPartnerRatingStatus();
      }
      await _loadRefundInfo();
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadRefundInfo() async {
    try {
      final elig = await ApiService.get('/refunds/orders/${widget.orderId}/eligibility', params: {'type': 'cancellation'});
      final data = (elig['data'] as Map<String, dynamic>?) ?? (elig is Map<String, dynamic> ? elig : null);
      if (!mounted) return;
      setState(() {
        _cancelEligible = data?['eligible'] == true;
        _cancelRequiresReview = data?['requiresReview'] == true;
        _cancelEstimate = (data?['estimatedRefund'] as num?)?.toDouble() ?? 0;
      });
    } catch (_) {}

    try {
      final res = await ApiService.get('/refunds/orders/${widget.orderId}/refunds');
      final list = (res['data'] as List<dynamic>?) ?? [];
      if (!mounted) return;
      setState(() {
        _refunds = list.whereType<Map<String, dynamic>>().toList();
      });
    } catch (_) {}
  }

  Future<void> _loadPartnerRatingStatus() async {
    try {
      final res = await ApiService.get('/delivery-ratings/order/${widget.orderId}');
      if (!mounted) return;
      final data = (res['data'] as Map<String, dynamic>?) ?? res;
      setState(() {
        _partnerRatingData = data;
        if (data['rated'] == true) {
          _overallRating = (data['overallRating'] as num?)?.toInt() ?? 0;
          _onTimeRating = (data['onTimeRating'] as num?)?.toInt() ?? 0;
          _professionalismRating = (data['professionalismRating'] as num?)?.toInt() ?? 0;
          _handlingRating = (data['handlingRating'] as num?)?.toInt() ?? 0;
          _communicationRating = (data['communicationRating'] as num?)?.toInt() ?? 0;
        }
      });
    } catch (_) {}
  }

  Future<void> _submitPartnerRating() async {
    if (_overallRating < 1 || _onTimeRating < 1 || _professionalismRating < 1 || _handlingRating < 1 || _communicationRating < 1) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please select a rating for every category'), backgroundColor: AppTheme.error));
      return;
    }
    setState(() => _partnerSubmitting = true);
    try {
      await ApiService.post('/delivery-ratings', body: {
        'orderId': widget.orderId,
        'overallRating': _overallRating,
        'onTimeRating': _onTimeRating,
        'professionalismRating': _professionalismRating,
        'handlingRating': _handlingRating,
        'communicationRating': _communicationRating,
        'feedback': _feedback.trim().isEmpty ? null : _feedback.trim(),
      });
      if (!mounted) return;
      setState(() {
        _partnerRatingData = {'rated': true, 'overallRating': _overallRating, 'onTimeRating': _onTimeRating, 'professionalismRating': _professionalismRating, 'handlingRating': _handlingRating, 'communicationRating': _communicationRating, 'feedback': _feedback.trim()};
      });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Thanks! Your delivery partner rating has been submitted.'), backgroundColor: AppTheme.success));
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(msg.toLowerCase().contains('already') ? 'You already rated this delivery partner.' : 'Failed to submit rating'),
        backgroundColor: AppTheme.error,
      ));
      _loadPartnerRatingStatus();
    } finally {
      if (mounted) setState(() => _partnerSubmitting = false);
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'pending': return AppTheme.accent;
      case 'confirmed': return AppTheme.primaryGreen;
      case 'shipped': return const Color(0xFF3B82F6);
      case 'out for delivery': return const Color(0xFF8B5CF6);
      case 'delivered': return AppTheme.success;
      case 'cancelled': return AppTheme.error;
      default: return AppTheme.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Order Details')),
      body: _isLoading
        ? const PageSkeleton(items: 5)
        : _order == null
            ? const Center(child: Text('Order not found'))
            : SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildStatusTimeline(),
                    const SizedBox(height: 20),
                    if (_shouldShowPartnerRating()) ...[
                      _buildPartnerRatingSection(),
                      const SizedBox(height: 20),
                    ],
                    _buildSection('Order Items', Icons.shopping_bag_outlined, _buildItemsList()),
                    const SizedBox(height: 16),
                    _buildSection('Delivery Address', Icons.location_on_outlined, _buildAddress()),
                    const SizedBox(height: 16),
                    _buildSection('Payment Info', Icons.payment_outlined, _buildPaymentInfo()),
                    const SizedBox(height: 16),
                    _buildSection('Order Info', Icons.info_outline, _buildOrderInfo()),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tracking feature coming soon'))),
                        icon: const Icon(Icons.track_changes),
                        label: const Text('Track Order'),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => context.push('/customer/orders/${widget.orderId}/invoice'),
                        icon: const Icon(Icons.receipt_long_outlined),
                        label: const Text('View Invoice'),
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (_refunds.isNotEmpty) ...[
                      _buildRefundStatusCard(),
                      const SizedBox(height: 16),
                    ],
                    if (_refunds.isEmpty && ['delivered', 'picked_up'].contains(_orderStatus()))
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _openReportProblem,
                          icon: const Icon(Icons.report_problem_outlined, color: Color(0xFFD97706)),
                          label: const Text('Report a Problem', style: TextStyle(color: Color(0xFFD97706))),
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Color(0xFFD97706)),
                          ),
                        ),
                      ),
                    if (_cancelEligible)
                      Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: SizedBox(
                          width: double.infinity,
                          child: TextButton.icon(
                            onPressed: _cancelling ? null : _cancelOrder,
                            icon: const Icon(Icons.cancel_outlined, color: AppTheme.error),
                            label: Text('Cancel Order', style: TextStyle(color: AppTheme.error)),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
    );
  }

  Future<void> _cancelOrder() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Why are you cancelling?'),
        children: [
          for (final r in const [
            'Ordered by mistake',
            'No longer needed',
            'Delivery taking too long',
            'Found another product',
            'Other',
          ])
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, r),
              child: Text(r),
            ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel Order'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Order #${widget.orderId.length > 8 ? widget.orderId.substring(0, 8).toUpperCase() : widget.orderId}'),
            const SizedBox(height: 8),
            if (_cancelEstimate > 0)
              Text(
                _cancelRequiresReview
                    ? 'This order is out for delivery. Your cancellation will be submitted for review.'
                    : 'Estimated refund: $kPriceSymbol${_cancelEstimate.toStringAsFixed(2)} to your original payment method.',
              )
            else
              const Text('Are you sure you want to cancel this order?'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep Order')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error, foregroundColor: Colors.white),
            child: Text(_cancelRequiresReview ? 'Submit Request' : 'Yes, Cancel'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() => _cancelling = true);
    try {
      await ApiService.post('/refunds/orders/${widget.orderId}/cancel', body: {
        'reason': reason,
        'reasonCode': reason.toLowerCase().replaceAll(' ', '_'),
      });
      if (!mounted) return;
      _loadOrder();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(_cancelRequiresReview ? 'Cancellation request submitted for review' : 'Order cancelled'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to cancel'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  Future<void> _pickAndUploadEvidence(StateSetter refresh) async {
    final ImagePicker picker = ImagePicker();
    List<XFile> picked = [];
    try {
      picked = await picker.pickMultiImage(limit: 5 - _problemEvidence.length);
    } catch (_) {
      picked = [];
    }
    if (picked.isEmpty) {
      try {
        final single = await picker.pickImage(source: ImageSource.gallery);
        if (single != null) picked = [single];
      } catch (_) {
        picked = [];
      }
    }
    if (picked.isEmpty) return;

    setState(() => _uploadingEvidence = true);
    refresh(() {});
    for (final image in picked) {
      try {
        final res = await ApiService.uploadFile('/refunds/upload', image.path, 'file');
        final data = (res['data'] as Map<String, dynamic>?) ?? <String, dynamic>{};
        final url = data['url'] as String? ?? data['evidence'] as String?;
        if (url != null) {
          setState(() => _problemEvidence.add(url));
        }
      } catch (_) {}
      refresh(() {});
    }
    setState(() => _uploadingEvidence = false);
    refresh(() {});
  }

  Future<void> _reportProblem() async {
    final items = (_order!['items'] as List<dynamic>?) ?? [];
    List<Map<String, dynamic>> affectedItems = [];
    for (final item in items) {
      final m = item as Map<String, dynamic>;
      final product = m['product'] is Map ? m['product'] as Map<String, dynamic> : <String, dynamic>{};
      final pid = (m['productId'] ?? product['_id'] ?? '').toString();
      final qty = _problemQuantities[pid] ?? 0;
      if (qty > 0) {
        affectedItems.add({'productId': pid, 'quantity': qty, 'requestedAmount': null});
      }
    }
    if (_problemResolution != 'full_refund' && affectedItems.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Please select an affected product and quantity, or choose Full Refund.'),
        backgroundColor: AppTheme.error,
      ));
      return;
    }
    setState(() => _reporting = true);
    try {
      await ApiService.post('/refunds/orders/${widget.orderId}/refund-request', body: {
        'refundType': _problemReason,
        'reason': _problemReason,
        'resolution': _problemResolution,
        'description': _problemDescription.trim().isEmpty ? null : _problemDescription.trim(),
        'affectedItems': affectedItems,
        'evidence': _problemEvidence,
        'requestedAmount': null,
      });
      if (!mounted) return;
      Navigator.pop(context);
      setState(() {
        _problemReason = 'damaged_product';
        _problemResolution = 'partial_refund';
        _problemDescription = '';
        _problemQuantities = {};
        _problemEvidence = [];
      });
      _loadOrder();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Refund request submitted. You will be notified when reviewed.'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to submit request'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _reporting = false);
    }
  }

  void _openReportProblem() {
    final items = (_order!['items'] as List<dynamic>?) ?? [];
    final List<Map<String, dynamic>> productRows = [];
    for (final item in items) {
      final m = item as Map<String, dynamic>;
      final product = m['product'] is Map ? m['product'] as Map<String, dynamic> : <String, dynamic>{};
      final pid = (m['productId'] ?? product['_id'] ?? '').toString();
      final name = product['name'] as String? ?? 'Product';
      final qty = (m['quantity'] as num?)?.toInt() ?? 1;
      productRows.add({'pid': pid, 'name': name, 'qty': qty});
    }

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 16,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Report a Problem', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                const Text("What's wrong?", style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final r in const [
                      ['wrong_product', 'Wrong product'],
                      ['missing_quantity', 'Missing quantity'],
                      ['damaged_product', 'Damaged product'],
                      ['poor_quality', 'Poor quality'],
                      ['spoiled_expired', 'Spoiled/expired'],
                      ['other', 'Other'],
                    ])
                      ChoiceChip(
                        label: Text(r[1]),
                        selected: _problemReason == r[0],
                        onSelected: (_) => setSheetState(() => _problemReason = r[0]),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                if (_problemResolution != 'full_refund') ...[
                  const Text('Affected products & quantities', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  for (final row in productRows) ...[
                    Row(
                      children: [
                        Expanded(child: Text(row['name'], style: const TextStyle(fontSize: 13))),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              icon: const Icon(Icons.remove_circle_outline, size: 18),
                              onPressed: () => setSheetState(() {
                                final cur = _problemQuantities[row['pid']] ?? 0;
                                _problemQuantities[row['pid']] = cur > 0 ? cur - 1 : 0;
                              }),
                            ),
                            Text('${_problemQuantities[row['pid']] ?? 0}/${row['qty']}', style: const TextStyle(fontSize: 13)),
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              icon: const Icon(Icons.add_circle_outline, size: 18),
                              onPressed: () => setSheetState(() {
                                final cur = _problemQuantities[row['pid']] ?? 0;
                                _problemQuantities[row['pid']] = cur < row['qty'] ? cur + 1 : cur;
                              }),
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                  ],
                  const SizedBox(height: 12),
                ],
                const Text('Requested resolution', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final r in const [
                      ['full_refund', 'Refund'],
                      ['replacement', 'Replacement'],
                      ['partial_refund', 'Partial Refund'],
                    ])
                      ChoiceChip(
                        label: Text(r[1]),
                        selected: _problemResolution == r[0],
                        onSelected: (_) => setSheetState(() => _problemResolution = r[0]),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                const Text('Upload evidence', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    OutlinedButton.icon(
                      onPressed: _uploadingEvidence ? null : () => _pickAndUploadEvidence(setSheetState),
                      icon: _uploadingEvidence
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.add_a_photo_outlined, size: 18),
                      label: Text(_uploadingEvidence ? 'Uploading...' : 'Add Photos'),
                    ),
                    const SizedBox(width: 8),
                    if (_problemEvidence.isNotEmpty)
                      Text('${_problemEvidence.length}/5 photos', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
                if (_problemEvidence.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var i = 0; i < _problemEvidence.length; i++)
                        Stack(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: Image.network(
                                _problemEvidence[i],
                                width: 72,
                                height: 72,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => Container(
                                  width: 72,
                                  height: 72,
                                  color: AppTheme.background,
                                  child: const Icon(Icons.image, size: 24, color: AppTheme.textSecondary),
                                ),
                              ),
                            ),
                            Positioned(
                              top: 0,
                              right: 0,
                              child: GestureDetector(
                                onTap: () => setSheetState(() => _problemEvidence.removeAt(i)),
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.6),
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(Icons.close, size: 16, color: Colors.white),
                                ),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                ],
                TextField(
                  minLines: 2,
                  maxLines: 4,
                  onChanged: (v) => _problemDescription = v,
                  decoration: const InputDecoration(
                    hintText: 'Describe what happened (optional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _reporting ? null : _reportProblem,
                    child: Text(_reporting ? 'Submitting...' : 'Submit Request'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool _shouldShowPartnerRating() {
    if (_orderStatus() != 'delivered') return false;
    final deliveryRating = _order?['deliveryRating'];
    return deliveryRating is Map && deliveryRating['partnerId'] != null;
  }

  Widget _buildRefundStatusCard() {
    final refund = _refunds.first;
    final meta = refundStatusMeta((refund['status'] as String? ?? 'requested').toLowerCase());
    final amount = (refund['approvedAmount'] as num?)?.toDouble() ??
        (refund['requestedAmount'] as num?)?.toDouble() ??
        0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: meta.color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: meta.color.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.replay_circle_filled_outlined, color: meta.color, size: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  refund['refundId'] as String? ?? 'Refund',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                ),
                Text('$kPriceSymbol${amount.toStringAsFixed(2)}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.success)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              StatusChip(status: meta.label, color: meta.color),
              TextButton(
                onPressed: () => context.push('/customer/refunds/${refund['id'] ?? refund['_id']}'),
                child: const Text('View'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStarPicker(int value, ValueChanged<int> onChanged) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (i) {
        final s = i + 1;
        return InkWell(
          onTap: () => onChanged(s),
          borderRadius: BorderRadius.circular(4),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Icon(
              s <= value ? Icons.star_rounded : Icons.star_outline_rounded,
              color: s <= value ? const Color(0xFFF59E0B) : AppTheme.border,
              size: 30,
            ),
          ),
        );
      }),
    );
  }

  Widget _buildPartnerRatingSection() {
    final deliveryRating = _order?['deliveryRating'] is Map ? _order!['deliveryRating'] as Map<String, dynamic> : <String, dynamic>{};
    final partnerName = deliveryRating['partnerName'] as String? ?? 'your delivery partner';
    final rated = _partnerRatingData?['rated'] == true;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: rated ? AppTheme.success.withValues(alpha: 0.06) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: rated ? AppTheme.success.withValues(alpha: 0.4) : AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.local_shipping_outlined, size: 18, color: AppTheme.primaryGreen),
            const SizedBox(width: 8),
            Text('Rate your delivery partner', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          ]),
          const SizedBox(height: 6),
          Text(
            rated
                ? 'Thanks! Your rating has been recorded.'
                : 'Tell us about $partnerName. Your personal details stay private.',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 14),
          if (rated) ...[
            _buildRatedRow('Overall', (_partnerRatingData?['overallRating'] as num?)?.toInt() ?? 0),
            _buildRatedRow('On-time', (_partnerRatingData?['onTimeRating'] as num?)?.toInt() ?? 0),
            _buildRatedRow('Professionalism', (_partnerRatingData?['professionalismRating'] as num?)?.toInt() ?? 0),
            _buildRatedRow('Product handling', (_partnerRatingData?['handlingRating'] as num?)?.toInt() ?? 0),
            _buildRatedRow('Communication', (_partnerRatingData?['communicationRating'] as num?)?.toInt() ?? 0),
            if ((_partnerRatingData?['feedback'] as String?)?.isNotEmpty ?? false)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text('"${_partnerRatingData!['feedback']}"', style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: AppTheme.textSecondary)),
              ),
          ] else ...[
            _buildRatingRow('Overall experience', _overallRating, (v) => setState(() => _overallRating = v)),
            _buildRatingRow('On-time delivery', _onTimeRating, (v) => setState(() => _onTimeRating = v)),
            _buildRatingRow('Professionalism', _professionalismRating, (v) => setState(() => _professionalismRating = v)),
            _buildRatingRow('Product handling', _handlingRating, (v) => setState(() => _handlingRating = v)),
            _buildRatingRow('Communication', _communicationRating, (v) => setState(() => _communicationRating = v)),
            const SizedBox(height: 12),
            TextField(
              minLines: 2,
              maxLines: 4,
              onChanged: (v) => _feedback = v,
              decoration: InputDecoration(
                hintText: 'Anything you\'d like to share about the delivery? (optional)',
                hintStyle: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                filled: true,
                fillColor: AppTheme.background,
                contentPadding: const EdgeInsets.all(12),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: AppTheme.border)),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: AppTheme.border)),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _partnerSubmitting ? null : _submitPartnerRating,
                icon: _partnerSubmitting
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.star_outline, size: 18),
                label: Text(_partnerSubmitting ? 'Submitting...' : 'Submit Rating'),
                style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primaryGreen, foregroundColor: Colors.white),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildRatingRow(String label, int value, ValueChanged<int> onChanged) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: AppTheme.textPrimary))),
          _buildStarPicker(value, onChanged),
        ],
      ),
    );
  }

  Widget _buildRatedRow(String label, int value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(child: Text(label, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary))),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('$value', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
              const SizedBox(width: 4),
              Icon(Icons.star_rounded, color: const Color(0xFFF59E0B), size: 16),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatusTimeline() {
    final status = _orderStatus();
    final statuses = ['pending', 'confirmed', 'shipped', 'delivered'];
    final currentIndex = statuses.indexOf(status);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(statuses.length, (i) {
              final isActive = i <= currentIndex;
              final isLast = i == statuses.length - 1;
              return Expanded(
                child: Row(
                  children: [
                    Container(
                      width: 32, height: 32,
                      decoration: BoxDecoration(
                        color: isActive ? _statusColor(statuses[i]) : AppTheme.border,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(isActive ? Icons.check : Icons.circle_outlined, size: 16, color: Colors.white),
                    ),
                    if (!isLast) Expanded(
                      child: Container(
                        height: 2,
                        color: i < currentIndex ? _statusColor(statuses[i]) : AppTheme.border,
                      ),
                    ),
                  ],
                ),
              );
            }),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: statuses.map((s) => Expanded(
              child: Text(s[0].toUpperCase() + s.substring(1), textAlign: TextAlign.center, style: TextStyle(fontSize: 10, color: s == status ? _statusColor(s) : AppTheme.textSecondary, fontWeight: s == status ? FontWeight.w600 : FontWeight.normal)),
            )).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildSection(String title, IconData icon, Widget content) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Icon(icon, size: 18, color: AppTheme.primaryGreen),
          const SizedBox(width: 8),
          Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
        ]),
        const SizedBox(height: 10),
        content,
      ],
    );
  }

  Widget _buildItemsList() {
    final items = _order!['items'] as List<dynamic>? ?? [];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Column(
        children: [
          ...items.map((item) {
            final product = item['product'] is Map ? item['product'] as Map<String, dynamic> : <String, dynamic>{};
            final name = product['name'] as String? ?? 'Product';
            final qty = (item['quantity'] as num?)?.toInt() ?? 1;
            final price = (item['price'] as num?)?.toDouble() ?? 0;
            final image = product['image'] as String? ?? (product['images'] is List && (product['images'] as List).isNotEmpty ? (product['images'] as List).first as String : '');
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Container(width: 48, height: 48, color: AppTheme.background,
                      child: image.isNotEmpty ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Icon(Icons.image, size: 20, color: AppTheme.textSecondary.withValues(alpha: 0.4))) : Icon(Icons.image, size: 20, color: AppTheme.textSecondary.withValues(alpha: 0.4))),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13))),
                  Text('x$qty', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(width: 12),
                  Text('Rs ${(price * qty).toStringAsFixed(2)}', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primaryGreen)),
                ],
              ),
            );
          }),
          const Divider(),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Total', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              Text('Rs ${_totalAmount().toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.primaryGreen)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildAddress() {
    final addr = _order!['address'] is Map ? _order!['address'] as Map<String, dynamic> : (_order!['shippingAddress'] as Map<String, dynamic>? ?? {});
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (addr['street'] != null) Text(addr['street'] as String, style: const TextStyle(fontSize: 13)),
          if (addr['city'] != null || addr['pincode'] != null)
            Text('${addr['city'] as String? ?? ''} - ${addr['pincode'] as String? ?? ''}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _buildPaymentInfo() {
    final paymentMethod = _order!['paymentMethod'] as String? ?? 'COD';
    final paymentStatus = _order!['paymentStatus'] as String? ?? 'pending';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Row(
        children: [
          Icon(Icons.credit_card, color: AppTheme.primaryGreen),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Payment via ${paymentMethod.toUpperCase()}', style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
                Text(_capitalize(paymentStatus), style: TextStyle(fontSize: 12, color: paymentStatus == 'completed' ? AppTheme.success : AppTheme.accent)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderInfo() {
    final createdAt = _order!['createdAt'] as String? ?? '';
    String formattedDate = '';
    try {
      final date = DateTime.parse(createdAt);
      formattedDate = DateFormat('dd MMM yyyy, hh:mm a').format(date);
    } catch (_) {
      formattedDate = createdAt;
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            const Text('Order ID', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            Text('#${widget.orderId.length >= 12 ? widget.orderId.substring(0, 12).toUpperCase() : widget.orderId}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 4),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            const Text('Placed on', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            Text(formattedDate, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ]),
        ],
      ),
    );
  }

  double _totalAmount() => (_order?['totalAmount'] as num?)?.toDouble() ?? 0;

  String _capitalize(String value) {
    if (value.isEmpty) return value;
    return value[0].toUpperCase() + value.substring(1);
  }
}
