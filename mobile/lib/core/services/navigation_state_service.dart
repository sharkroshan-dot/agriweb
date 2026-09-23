import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Where the user came from on a listing/marketplace page, so Product Details
/// can offer an exact "Back to {listing}" target (route + query preserved).
class ListingReferrer {
  const ListingReferrer({required this.route, required this.query});

  final String route;
  final Map<String, String> query;

  Map<String, dynamic> toJson() => {'route': route, 'query': query};

  factory ListingReferrer.fromJson(Map<String, dynamic> json) => ListingReferrer(
        route: json['route'] as String? ?? '',
        query: Map<String, String>.from((json['query'] as Map<String, dynamic>?) ?? {}),
      );
}

/// Session-scoped navigation state for the Flutter app. This mirrors the web
/// app's sessionStorage stores (scroll-restore, navigation-state, drafts):
///
/// - the last listing location for the product-details Back button,
/// - per-route scroll offsets,
/// - per-route filter/view state (sort, category, radius, ...) so leaving and
///   returning to a marketplace restores exactly what the user configured.
///
/// Only non-sensitive filter/view state is persisted — never tokens, addresses,
/// or coordinates.
class NavigationStateService {
  NavigationStateService._();

  static final NavigationStateService instance = NavigationStateService._();

  static const String _referrerKey = 'nav_listing_referrer';
  static const String _scrollKey = 'nav_scroll_offsets';
  static const String _filtersPrefix = 'nav_filters_';

  SharedPreferences? _prefs;

  ListingReferrer? _referrer;
  final Map<String, double> _scrollOffsets = {};
  final Map<String, Map<String, String>> _filters = {};

  Future<SharedPreferences> _getPrefs() async {
    if (_prefs != null) return _prefs!;
    final prefs = await SharedPreferences.getInstance();
    _prefs = prefs;
    _loadIntoMemory(prefs);
    return prefs;
  }

  void _loadIntoMemory(SharedPreferences prefs) {
    final referrerRaw = prefs.getString(_referrerKey);
    if (referrerRaw != null) {
      try {
        _referrer = ListingReferrer.fromJson(jsonDecode(referrerRaw) as Map<String, dynamic>);
      } catch (_) {}
    }
    final scrollRaw = prefs.getString(_scrollKey);
    if (scrollRaw != null) {
      try {
        final decoded = jsonDecode(scrollRaw) as Map<String, dynamic>;
        decoded.forEach((key, value) {
          final offset = (value as num?)?.toDouble();
          if (offset != null) _scrollOffsets[key] = offset;
        });
      } catch (_) {}
    }
  }

  // ---- Listing referrer (product-details Back) ----

  Future<void> setListingReferrer(String route, Map<String, String> query) async {
    final prefs = await _getPrefs();
    _referrer = ListingReferrer(route: route, query: query);
    await prefs.setString(_referrerKey, jsonEncode(_referrer!.toJson()));
  }

  Future<ListingReferrer?> getListingReferrer() async {
    await _getPrefs();
    return _referrer;
  }

  Future<void> clearListingReferrer() async {
    final prefs = await _getPrefs();
    _referrer = null;
    await prefs.remove(_referrerKey);
  }

  // ---- Scroll offsets ----

  /// Records an offset in memory. Call [flushScrollOffsets] when the screen is
  /// disposed / refreshed to avoid writing SharedPreferences on every frame.
  void setScrollOffset(String key, double offset) {
    if (offset <= 0) {
      _scrollOffsets.remove(key);
    } else {
      _scrollOffsets[key] = offset;
    }
  }

  Future<void> flushScrollOffsets() async {
    final prefs = await _getPrefs();
    if (_scrollOffsets.isEmpty) {
      await prefs.remove(_scrollKey);
    } else {
      await prefs.setString(_scrollKey, jsonEncode(_scrollOffsets));
    }
  }

  Future<double> restoreScrollOffset(String key) async {
    await _getPrefs();
    return _scrollOffsets[key] ?? 0;
  }

  // ---- Per-route filter/view state ----

  Future<void> saveFilters(String route, Map<String, String> filters) async {
    final prefs = await _getPrefs();
    _filters[route] = Map<String, String>.from(filters);
    await prefs.setString('$_filtersPrefix$route', jsonEncode(filters));
  }

  Future<Map<String, String>> loadFilters(String route) async {
    final prefs = await _getPrefs();
    final cached = _filters[route];
    if (cached != null) return Map<String, String>.from(cached);
    final raw = prefs.getString('$_filtersPrefix$route');
    if (raw == null) return {};
    try {
      final decoded = Map<String, String>.from(jsonDecode(raw) as Map<String, dynamic>);
      _filters[route] = decoded;
      return decoded;
    } catch (_) {
      return {};
    }
  }

  // ---- Full reset (sign-out / session change) ----

  Future<void> clearAll() async {
    final prefs = await _getPrefs();
    _referrer = null;
    _scrollOffsets.clear();
    _filters.clear();
    await prefs.remove(_referrerKey);
    await prefs.remove(_scrollKey);
    final keys = prefs.getKeys().where((k) => k.startsWith(_filtersPrefix)).toList();
    for (final key in keys) {
      await prefs.remove(key);
    }
  }
}
