import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'dart:math' as math;
import 'package:geolocator/geolocator.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/services/navigation_state_service.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/utils/helpers.dart';

class NearbyScreen extends StatefulWidget {
  const NearbyScreen({super.key});
  @override
  State<NearbyScreen> createState() => _NearbyScreenState();
}

class _NearbyScreenState extends State<NearbyScreen> {
  static const String _stateKey = AppRoutes.customerNearby;

  bool _isLoading = true;
  List<Map<String, dynamic>> _products = [];
  String _sortBy = 'distance';
  int _radius = 10;
  double _userLat = 11.2322;
  double _userLng = 77.34;
  String? _locationError;

  final ScrollController _scrollController = ScrollController();

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

  /// Restores the saved sort + scroll position (mirrors the web app restoring
  /// query params + scroll keyed by URL).
  Future<void> _restoreState() async {
    final filters = await NavigationStateService.instance.loadFilters(_stateKey);
    final savedSort = filters['sortBy'];
    if (savedSort != null && savedSort != _sortBy) {
      setState(() => _sortBy = savedSort);
    }
    await _loadNearbyProducts();

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

  Future<Position?> _getLivePosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      _locationError = 'Location services are off. Showing default location.';
      return null;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      _locationError = 'Location permission denied. Showing default location.';
      return null;
    }
    return Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high);
  }

  double _haversine(double lat1, double lng1, double lat2, double lng2) {
    const r = 6371.0;
    final dLat = (lat2 - lat1) * math.pi / 180;
    final dLng = (lng2 - lng1) * math.pi / 180;
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180) * math.cos(lat2 * math.pi / 180) *
        math.sin(dLng / 2) * math.sin(dLng / 2);
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  List<double> _productCoords(Map<String, dynamic> product) {
    final loc = product['location'];
    if (loc is Map) {
      final coords = loc['coordinates'];
      if (coords is List && coords.length >= 2) {
        return [(coords[1] as num).toDouble(), (coords[0] as num).toDouble()];
      }
    }
    final lat = (product['lat'] as num?)?.toDouble();
    final lng = (product['lng'] as num?)?.toDouble();
    if (lat != null && lng != null) return [lat, lng];
    return [_userLat, _userLng];
  }

  Future<void> _loadNearbyProducts() async {
    setState(() => _isLoading = true);
    try {
      final position = await _getLivePosition();
      if (position != null) {
        _userLat = position.latitude;
        _userLng = position.longitude;
      }
      if (!mounted) return;
      setState(() {});
      final res = await ApiService.get('/products/search', params: {
        'sortBy': 'createdAt',
        'sortOrder': 'desc',
        'limit': '100',
        'lat': _userLat.toString(),
        'lng': _userLng.toString(),
        'radius': _radius.toString(),
      });
      if (!mounted) return;
      final all = ApiService.asList(res).cast<Map<String, dynamic>>();
      final withinRadius = <Map<String, dynamic>>[];
      for (final p in all) {
        final coords = _productCoords(p);
        final distance = _haversine(_userLat, _userLng, coords[0], coords[1]);
        if (distance <= _radius) {
          p['distance'] = distance;
          withinRadius.add(p);
        }
      }
      switch (_sortBy) {
        case 'price':
          withinRadius.sort((a, b) => ((a['price'] as num?)?.toDouble() ?? 0).compareTo((b['price'] as num?)?.toDouble() ?? 0));
        case '-price':
          withinRadius.sort((a, b) => ((b['price'] as num?)?.toDouble() ?? 0).compareTo((a['price'] as num?)?.toDouble() ?? 0));
        case 'rating':
          withinRadius.sort((a, b) => productRating(b).compareTo(productRating(a)));
        default:
          withinRadius.sort((a, b) => ((a['distance'] as num?)?.toDouble() ?? 0).compareTo((b['distance'] as num?)?.toDouble() ?? 0));
      }
      setState(() => _products = withinRadius);
    } catch (_) {
      if (mounted) setState(() => _locationError = 'Unable to load nearby products');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _changeSort(String value) async {
    setState(() => _sortBy = value);
    await NavigationStateService.instance
        .saveFilters(_stateKey, {'sortBy': value});
    await _loadNearbyProducts();
  }

  Future<void> _openProduct(String id) async {
    await NavigationStateService.instance.setListingReferrer(_stateKey, {
      'sortBy': _sortBy,
    });
    await NavigationStateService.instance.flushScrollOffsets();
    if (!mounted) return;
    context.push('/customer/product/$id');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Nearby Products'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort),
            onSelected: _changeSort,
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'distance', child: Text('Nearest First')),
              const PopupMenuItem(value: 'price', child: Text('Price: Low to High')),
              const PopupMenuItem(value: '-price', child: Text('Price: High to Low')),
              const PopupMenuItem(value: 'rating', child: Text('Top Rated')),
            ],
          ),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _products.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.location_off_outlined, size: 80, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                    const SizedBox(height: 16),
                    Text('No nearby products found', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textSecondary)),
                    const SizedBox(height: 8),
                    Text('Enable location to see products near you', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                    const SizedBox(height: 24),
                    ElevatedButton.icon(onPressed: _loadNearbyProducts, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _loadNearbyProducts,
                child: Column(
                  children: [
                    if (_locationError != null)
                      Container(
                        margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: AppTheme.accent.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.warning_amber_rounded, size: 16, color: AppTheme.accent),
                            const SizedBox(width: 8),
                            Expanded(child: Text(_locationError!, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
                          ],
                        ),
                      ),
                    Expanded(
                      child: ListView.separated(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(16),
                  itemCount: _products.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final product = _products[i];
                    final id = product['_id'] as String? ?? '';
                    final name = product['name'] as String? ?? 'Product';
                    final price = (product['price'] as num?)?.toDouble() ?? 0;
                    final rating = (product['rating'] as num?)?.toDouble() ?? 0;
                    final distance = (product['distance'] as num?)?.toDouble();
                    final image = product['images'] is List && (product['images'] as List).isNotEmpty
                        ? (product['images'] as List).first as String? : product['image'] as String?;
                    final farmer = product['farmer'] is Map ? (product['farmer'] as Map)['name'] as String? ?? 'Local Farmer' : 'Local Farmer';

                    return GestureDetector(
                      onTap: () => _openProduct(id),
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 1))],
                        ),
                        child: Row(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: Container(width: 90, height: 90, color: AppTheme.background,
                                child: image != null && image.isNotEmpty
                                  ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Icon(Icons.image, color: AppTheme.textSecondary.withValues(alpha: 0.4)))
                                  : Icon(Icons.image, color: AppTheme.textSecondary.withValues(alpha: 0.4))),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  const SizedBox(height: 4),
                                  Text(farmer, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      Text('Rs $price', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.primaryGreen)),
                                      const Spacer(),
                                      if (rating > 0) Row(
                                        children: [
                                          Icon(Icons.star, size: 14, color: AppTheme.accent),
                                          Text(rating.toStringAsFixed(1), style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                          const SizedBox(width: 8),
                                        ],
                                      ),
                                      if (distance != null)
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                          decoration: BoxDecoration(color: AppTheme.primaryGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                                          child: Text('${distance.toStringAsFixed(1)} km', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.primaryGreen)),
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
                  },
                ),
                    ),
                  ],
                ),
              ),
    );
  }
}
