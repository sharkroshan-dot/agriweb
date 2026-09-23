import 'package:geolocator/geolocator.dart';

/// Outcome of a location lookup: either a [position] or the [failure] reason
/// so screens can translate it into a targeted message.
enum LocationFailure { serviceDisabled, permissionDenied, lookupFailed }

class LocationResult {
  final Position? position;
  final LocationFailure? failure;

  const LocationResult({this.position, this.failure});

  bool get ok => position != null;
}

/// Centralised geolocation flow for the delivery module.
///
/// Screens (deliveries, jobs, order map, live route) used to duplicate the
/// permission + live-position dance. This service keeps one consistent path,
/// one set of error reasons and a shared live stream helper.
class LocationService {
  LocationService._();

  static Future<bool> isServiceEnabled() => Geolocator.isLocationServiceEnabled();

  /// Requests permission when needed and reports whether access was granted.
  static Future<bool> hasPermission() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;
  }

  /// High-accuracy one-shot position. Returns a [LocationResult] carrying the
  /// precise failure reason instead of throwing, so callers can offer helpful
  /// copy (e.g. "Turn on location to see nearby orders").
  static Future<LocationResult> currentPosition() async {
    if (!await isServiceEnabled()) {
      return const LocationResult(failure: LocationFailure.serviceDisabled);
    }
    if (!await hasPermission()) {
      return const LocationResult(failure: LocationFailure.permissionDenied);
    }
    try {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 15),
      );
      return LocationResult(position: position);
    } catch (_) {
      return const LocationResult(failure: LocationFailure.lookupFailed);
    }
  }

  /// Live stream of position updates (used by the live-route screen and by the
  /// order map's "follow me" mode).
  static Stream<Position> positionStream({int distanceFilterMeters = 10}) {
    return Geolocator.getPositionStream(
      locationSettings: LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilterMeters,
      ),
    );
  }
}
