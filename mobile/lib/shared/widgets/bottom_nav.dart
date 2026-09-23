import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class _Tab {
  final String label;
  final IconData icon;
  final IconData activeIcon;
  final String pathPrefix;

  const _Tab(this.label, this.icon, this.activeIcon, this.pathPrefix);
}

const List<_Tab> _customerTabs = [
  _Tab('Home', Icons.home_outlined, Icons.home, '/customer/home'),
  _Tab('Products', Icons.grid_view_outlined, Icons.grid_view, '/customer/products'),
  _Tab('Cart', Icons.shopping_cart_outlined, Icons.shopping_cart, '/customer/cart'),
  _Tab('Orders', Icons.receipt_outlined, Icons.receipt, '/customer/orders'),
  _Tab('Profile', Icons.person_outline, Icons.person, '/customer/profile'),
];

const List<_Tab> _farmerTabs = [
  _Tab('Home', Icons.space_dashboard_outlined, Icons.space_dashboard, '/farmer/dashboard'),
  _Tab('Products', Icons.shelves, Icons.shelves, '/farmer/products'),
  _Tab('Orders', Icons.receipt_outlined, Icons.receipt, '/farmer/orders'),
  _Tab('Earnings', Icons.account_balance_wallet_outlined, Icons.account_balance_wallet, '/farmer/earnings'),
  _Tab('Profile', Icons.person_outline, Icons.person, '/farmer/profile'),
];

const List<_Tab> _deliveryTabs = [
  _Tab('Home', Icons.space_dashboard_outlined, Icons.space_dashboard, '/delivery/dashboard'),
  _Tab('Deliveries', Icons.local_shipping_outlined, Icons.local_shipping, '/delivery/deliveries'),
  _Tab('Jobs', Icons.rocket_launch_outlined, Icons.rocket_launch, '/delivery/jobs'),
  _Tab('Earnings', Icons.account_balance_wallet_outlined, Icons.account_balance_wallet, '/delivery/earnings'),
  _Tab('Profile', Icons.person_outline, Icons.person, '/delivery/profile'),
];

/// Persistent bottom navigation for a given role. Rendered inside the app shell
/// so every screen of that role shares the same navigation.
class RoleBottomNav extends StatelessWidget {
  final String role;
  final String currentPath;
  final void Function(int index) onSelect;

  const RoleBottomNav({
    super.key,
    required this.role,
    required this.currentPath,
    required this.onSelect,
  });

  List<_Tab> get _tabs => switch (role) {
        'farmer' => _farmerTabs,
        'delivery' => _deliveryTabs,
        _ => _customerTabs,
      };

  int get _activeIndex {
    var best = 0;
    var bestLen = -1;
    for (var i = 0; i < _tabs.length; i++) {
      final prefix = _tabs[i].pathPrefix;
      if (currentPath == prefix || currentPath.startsWith('$prefix/')) {
        if (prefix.length > bestLen) {
          bestLen = prefix.length;
          best = i;
        }
      }
    }
    return best;
  }

  @override
  Widget build(BuildContext context) {
    final tabs = _tabs;
    final active = _activeIndex;
    return NavigationBar(
      selectedIndex: active,
      onDestinationSelected: (i) {
        if (i == active) return;
        onSelect(i);
      },
      height: 68,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      destinations: [
        for (final t in tabs)
          NavigationDestination(
            icon: Icon(t.icon),
            selectedIcon: Icon(t.activeIcon, color: AppTheme.primaryGreen),
            label: t.label,
          ),
      ],
    );
  }
}