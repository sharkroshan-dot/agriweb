import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// Maps a canonical order/delivery status to a color used app-wide.
Color statusColor(String status) {
  switch (status.toLowerCase()) {
    case 'pending':
      return AppTheme.warning;
    case 'processing':
    case 'preparing':
    case 'confirmed':
      return const Color(0xFF3B82F6);
    case 'in_transit':
    case 'out_for_delivery':
      return const Color(0xFF8B5CF6);
    case 'completed':
    case 'delivered':
    case 'paid':
    case 'settled':
    case 'active':
      return AppTheme.success;
    case 'cancelled':
    case 'refunded':
    case 'failed':
    case 'expired':
      return AppTheme.error;
    default:
      return AppTheme.textSecondary;
  }
}

/// Small pill used to indicate an order/delivery status. Tinted background with
/// a matching foreground color keeps lists scannable.
class StatusChip extends StatelessWidget {
  final String status;
  final bool subtle;
  final Color? color;

  const StatusChip({super.key, required this.status, this.subtle = true, this.color});

  @override
  Widget build(BuildContext context) {
    final c = color ?? statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: subtle ? c.withValues(alpha: 0.12) : c,
        borderRadius: BorderRadius.circular(50),
      ),
      child: Text(
        status.isEmpty ? '—' : status[0].toUpperCase() + status.substring(1),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: subtle ? c : Colors.white,
        ),
      ),
    );
  }
}