import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme/app_theme.dart';

/// A single map point.
class MapPoint {
  final double lat;
  final double lng;
  final String label;
  final Color color;

  const MapPoint({
    required this.lat,
    required this.lng,
    this.label = '',
    this.color = AppTheme.primaryGreen,
  });

  LatLng get latLng => LatLng(lat, lng);
}

/// Embedded OpenStreetMap view built with flutter_map. Shows [points] as
/// numbered markers plus an optional [current] "you are here" dot. Auto-fits
/// the camera to cover every point, falling back to [fallbackCenter] when no
/// coordinates are available. [onPointTap] receives the tapped point.
class MapView extends StatelessWidget {
  final List<MapPoint> points;
  final MapPoint? current;
  final double height;
  final ValueChanged<MapPoint>? onPointTap;
  final bool interactive;

  const MapView({
    super.key,
    this.points = const [],
    this.current,
    this.height = 220,
    this.onPointTap,
    this.interactive = true,
  });

  @override
  Widget build(BuildContext context) {
    final usable = points.where((p) => _valid(p.lat, p.lng)).toList();

    if (usable.isEmpty && current == null) {
      return SizedBox(
        height: height,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.map_outlined, size: 40, color: AppTheme.textTertiary.withValues(alpha: 0.6)),
              const SizedBox(height: 8),
              const Text('No location available', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            ],
          ),
        ),
      );
    }

    LatLng center;
    double zoom = 11;
    final bounds = _computeBounds(usable, current);
    if (bounds != null) {
      center = bounds.center;
    } else {
      center = (current ?? usable.first).latLng;
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(AppTheme.radiusLg),
      child: SizedBox(
        height: height,
        child: FlutterMap(
          options: MapOptions(
            initialCenter: center,
            initialZoom: zoom,
            interactionOptions: InteractionOptions(
              flags: interactive
                  ? InteractiveFlag.all
                  : InteractiveFlag.none,
            ),
            onTap: onPointTap == null ? null : (_, p) {
              final nearest = _nearestPoint(p, usable);
              if (nearest != null) onPointTap!(nearest);
            },
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.agriconnect.mobile',
            ),
            if (bounds != null)
              MarkerLayer(
                markers: [
                  Marker(
                    point: bounds.northWest,
                    width: 1,
                    height: 1,
                    child: const SizedBox.shrink(),
                  ),
                ],
              ),
            for (var i = 0; i < usable.length; i++)
              MarkerLayer(
                markers: [
                  Marker(
                    point: usable[i].latLng,
                    width: 34,
                    height: 42,
                    child: _PointMarker(
                      index: i + 1,
                      color: usable[i].color,
                      onTap: () => onPointTap?.call(usable[i]),
                    ),
                  ),
                ],
              ),
            if (current != null)
              MarkerLayer(
                markers: [
                  Marker(
                    point: current!.latLng,
                    width: 24,
                    height: 24,
                    child: _CurrentDot(color: current!.color),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  static bool _valid(double lat, double lng) {
    return lat.abs() <= 90 && lng.abs() <= 180 && !(lat == 0 && lng == 0);
  }

  LatLngBounds? _computeBounds(List<MapPoint> pts, MapPoint? cur) {
    final all = [...pts, if (cur != null) cur];
    if (all.isEmpty) return null;
    var minLat = double.infinity, maxLat = -double.infinity;
    var minLng = double.infinity, maxLng = -double.infinity;
    for (final p in all) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    // Pad the bounds so edge markers stay fully visible.
    final padLat = (maxLat - minLat) * 0.12 + 0.002;
    final padLng = (maxLng - minLng) * 0.12 + 0.002;
    return LatLngBounds(
      LatLng(minLat - padLat, minLng - padLng),
      LatLng(maxLat + padLat, maxLng + padLng),
    );
  }

  MapPoint? _nearestPoint(LatLng tap, List<MapPoint> pts) {
    MapPoint? best;
    var bestDist = double.infinity;
    for (final p in pts) {
      final d = _dist(tap.latitude, tap.longitude, p.lat, p.lng);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return bestDist < 0.05 ? best : null;
  }

  double _dist(double lat1, double lng1, double lat2, double lng2) {
    final dLat = (lat2 - lat1) * 0.0174532925;
    final dLng = (lng2 - lng1) * 0.0174532925;
    final a = dLat * dLat + dLng * dLng;
    return a; // squared degrees; threshold tuned for screen taps.
  }
}

class _PointMarker extends StatelessWidget {
  final int index;
  final Color color;
  final VoidCallback onTap;
  const _PointMarker({required this.index, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2),
              boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 4, offset: Offset(0, 1))],
            ),
            child: Text(
              '$index',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Colors.white),
            ),
          ),
          Container(
            width: 0,
            height: 8,
            decoration: const BoxDecoration(
              border: Border(left: BorderSide(color: Colors.white, width: 2)),
            ),
          ),
        ],
      ),
    );
  }
}

class _CurrentDot extends StatelessWidget {
  final Color color;
  const _CurrentDot({required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: const [
          BoxShadow(color: Color(0x44000000), blurRadius: 6, offset: Offset(0, 1)),
        ],
      ),
    );
  }
}