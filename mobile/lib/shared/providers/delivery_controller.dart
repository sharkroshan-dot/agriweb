import 'package:flutter/material.dart';

import '../../core/services/api_service.dart';

/// App-wide delivery-partner state (currently: availability and a lightweight
/// profile snapshot for the KYC banner).
///
/// Mirrors the [ThemeController] pattern: a singleton [ChangeNotifier] exposed
/// through an [InheritedWidget] so the dashboard, profile and settings screens
/// share one source of truth instead of each keeping a disconnected copy.
class DeliveryController extends ChangeNotifier {
  DeliveryController._();

  static DeliveryController? _instance;

  static DeliveryController init() {
    return _instance ??= DeliveryController._();
  }

  static DeliveryController of(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<DeliveryScope>()!
        .controller;
  }

  static DeliveryController? get instance => _instance;

  bool _isAvailable = true;
  bool get isAvailable => _isAvailable;

  Map<String, dynamic>? _profile;
  Map<String, dynamic>? get profile => _profile;

  /// Updates availability without a network call. Used to sync the controller
  /// with data that a screen already fetched (e.g. `/delivery/me/dashboard` or
  /// `/delivery/me/profile`) so toggling on any screen reflects everywhere.
  void syncAvailability(bool value) {
    if (_isAvailable == value) return;
    _isAvailable = value;
    notifyListeners();
  }

  void syncProfile(Map<String, dynamic> profile) {
    _profile = profile;
    final available = profile['isAvailable'];
    if (available is bool) syncAvailability(available);
    notifyListeners();
  }

  /// Optimistically flips availability, persists it and reverts on failure.
  /// Returns true when the update reached the backend.
  Future<bool> setAvailable(bool value) async {
    final previous = _isAvailable;
    syncAvailability(value);
    try {
      await ApiService.put('/delivery/me/availability',
          body: <String, dynamic>{'isAvailable': value});
      return true;
    } catch (_) {
      syncAvailability(previous);
      return false;
    }
  }
}

class DeliveryScope extends InheritedWidget {
  final DeliveryController controller;

  const DeliveryScope({
    super.key,
    required this.controller,
    required super.child,
  });

  @override
  bool updateShouldNotify(DeliveryScope oldWidget) =>
      controller != oldWidget.controller;
}