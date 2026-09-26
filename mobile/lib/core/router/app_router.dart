import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/register_screen.dart';
import '../../features/auth/presentation/screens/otp_screen.dart';
import '../../features/auth/presentation/screens/forgot_password_screen.dart';
import '../../features/chat/presentation/screens/chat_list_screen.dart';
import '../../features/customer/presentation/screens/home_screen.dart';
import '../../features/customer/presentation/screens/products_screen.dart';
import '../../features/customer/presentation/screens/cart_screen.dart';
import '../../features/customer/presentation/screens/checkout_screen.dart';
import '../../features/customer/presentation/screens/orders_screen.dart';
import '../../features/customer/presentation/screens/order_details_screen.dart';
import '../../features/customer/presentation/screens/product_details_screen.dart';
import '../../features/customer/presentation/screens/wishlist_screen.dart';
import '../../features/customer/presentation/screens/profile_screen.dart';
import '../../features/customer/presentation/screens/nearby_screen.dart';
import '../../features/customer/presentation/screens/marketplace_hub_screen.dart';
import '../../features/customer/presentation/screens/state_marketplace_screen.dart';
import '../../features/customer/presentation/screens/national_marketplace_screen.dart';
import '../../features/customer/presentation/screens/community_buying_screen.dart';
import '../../features/customer/presentation/screens/notifications_screen.dart';
import '../../features/customer/presentation/screens/coupons_screen.dart';
import '../../features/customer/presentation/screens/payments_screen.dart';
import '../../features/customer/presentation/screens/wallet_screen.dart';
import '../../features/customer/presentation/screens/refunds_screen.dart';
import '../../features/customer/presentation/screens/refund_details_screen.dart';
import '../../features/customer/presentation/screens/reviews_screen.dart';
import '../../features/customer/presentation/screens/addresses_screen.dart';
import '../../features/customer/presentation/screens/settings_screen.dart';
import '../../features/customer/presentation/screens/agripoints_screen.dart';
import '../../features/customer/presentation/screens/preorders_screen.dart';
import '../../features/customer/presentation/screens/alerts_screen.dart';
import '../../features/customer/presentation/screens/pickups_screen.dart';
import '../../features/customer/presentation/screens/my_deliveries_screen.dart';
import '../../features/customer/presentation/screens/harvests_screen.dart';
import '../../features/customer/presentation/screens/impact_screen.dart';
import '../../features/customer/presentation/screens/customer_delivery_slots_screen.dart';
import '../../features/customer/presentation/screens/invoice_screen.dart';
import '../../features/farmer/presentation/screens/dashboard_screen.dart';
import '../../features/farmer/presentation/screens/products_screen.dart';
import '../../features/farmer/presentation/screens/add_product_screen.dart';
import '../../features/farmer/presentation/screens/orders_screen.dart';
import '../../features/farmer/presentation/screens/analytics_screen.dart';
import '../../features/farmer/presentation/screens/advisor_screen.dart';
import '../../features/farmer/presentation/screens/route_screen.dart';
import '../../features/farmer/presentation/screens/profile_screen.dart';
import '../../features/farmer/presentation/screens/delivery_calendar_screen.dart';
import '../../features/farmer/presentation/screens/smart_route_screen.dart';
import '../../features/farmer/presentation/screens/farmer_earnings_screen.dart';
import '../../features/farmer/presentation/screens/farmer_delivery_jobs_screen.dart';
import '../../features/farmer/presentation/screens/harvest_plans_screen.dart';
import '../../features/farmer/presentation/screens/b2b_screen.dart';
import '../../features/farmer/presentation/screens/bulk_b2b_orders_screen.dart';
import '../../features/farmer/presentation/screens/customers_screen.dart';
import '../../features/farmer/presentation/screens/ratings_screen.dart';
import '../../features/farmer/presentation/screens/delivery_slots_screen.dart';
import '../../features/farmer/presentation/screens/farmer_impact_screen.dart';
import '../../features/farmer/presentation/screens/order_map_screen.dart';
import '../../features/farmer/presentation/screens/security_screen.dart';
import '../../features/farmer/presentation/screens/settings_screen.dart';
import '../../features/farmer/presentation/screens/delivery_schedule_new_screen.dart';
import '../../features/farmer/presentation/screens/farm_baskets_screen.dart';
import '../../features/farmer/presentation/screens/farm_basket_form_screen.dart';
import '../../features/farmer/presentation/screens/quality_inspection_screen.dart';
import '../../features/ai/presentation/screens/ai_copilot_screen.dart';
import '../../features/delivery/presentation/screens/dashboard_screen.dart';
import '../../features/delivery/presentation/screens/delivery_modes_screen.dart';
import '../../features/delivery/presentation/screens/earnings_screen.dart';
import '../../features/delivery/presentation/screens/cash_settlement_screen.dart';
import '../../features/delivery/presentation/screens/deliveries_screen.dart';
import '../../features/delivery/presentation/screens/delivery_jobs_screen.dart';
import '../../features/delivery/presentation/screens/history_screen.dart';
import '../../features/delivery/presentation/screens/profile_screen.dart';
import '../../features/delivery/presentation/screens/support_chat_screen.dart';
import '../../features/delivery/presentation/screens/delivery_ratings_screen.dart';
import '../../features/delivery/presentation/screens/settlements_history_screen.dart';
import '../../features/delivery/presentation/screens/delivery_order_map_screen.dart';
import '../../features/delivery/presentation/screens/route_screen.dart';
import '../../features/delivery/presentation/screens/settings_screen.dart';
import 'routes.dart';
import 'middlewares.dart';
import '../../shared/widgets/bottom_nav.dart';

class AppRouter {
  static final GlobalKey<NavigatorState> _rootKey = GlobalKey<NavigatorState>();

  static final router = GoRouter(
    navigatorKey: _rootKey,
    initialLocation: AppRoutes.login,
    redirect: AppRouteMiddleware.redirect,
    routes: [
      GoRoute(path: AppRoutes.login, builder: (_, __) => const LoginScreen()),
      GoRoute(path: AppRoutes.register, builder: (_, __) => const RegisterScreen()),
      GoRoute(path: AppRoutes.otp, builder: (_, __) => const OtpScreen()),
      GoRoute(path: AppRoutes.forgotPassword, builder: (_, __) => const ForgotPasswordScreen()),

      ShellRoute(
        builder: (_, state, child) => _roleShell('customer', state, child),
        routes: [
          GoRoute(path: AppRoutes.customerHome, builder: (_, __) => const CustomerHomeScreen()),
          GoRoute(path: '/customer/dashboard', builder: (_, __) => const CustomerHomeScreen()),
          GoRoute(path: AppRoutes.customerProducts, builder: (_, state) => CustomerProductsScreen(initialQuery: state.extra as String?)),
          GoRoute(path: AppRoutes.customerCart, builder: (_, __) => const CartScreen()),
          GoRoute(path: AppRoutes.customerCheckout, builder: (_, __) => const CheckoutScreen()),
          GoRoute(path: AppRoutes.customerOrders, builder: (_, __) => const OrdersScreen()),
          GoRoute(path: AppRoutes.customerOrderDetail, builder: (_, state) => OrderDetailsScreen(orderId: state.pathParameters['id']!)),
          GoRoute(path: AppRoutes.customerProductDetail, builder: (_, state) => ProductDetailsScreen(productId: state.pathParameters['id']!)),
          GoRoute(path: AppRoutes.customerWishlist, builder: (_, __) => const WishlistScreen()),
          GoRoute(path: AppRoutes.customerProfile, builder: (_, __) => const CustomerProfileScreen()),
          GoRoute(path: AppRoutes.customerNearby, builder: (_, __) => const NearbyScreen()),
          GoRoute(path: AppRoutes.marketplaceHub, builder: (_, __) => const MarketplaceHubScreen()),
          GoRoute(path: AppRoutes.marketplaceState, builder: (_, __) => const StateMarketplaceScreen()),
          GoRoute(path: AppRoutes.marketplaceNational, builder: (_, __) => const NationalMarketplaceScreen()),
          GoRoute(path: AppRoutes.communityBuying, builder: (_, __) => const CommunityBuyingScreen()),
          GoRoute(path: AppRoutes.customerNotifications, builder: (_, __) => const NotificationsScreen()),
          GoRoute(path: AppRoutes.customerChat, builder: (_, __) => const ChatListScreen(role: 'customer')),
          GoRoute(path: AppRoutes.customerCoupons, builder: (_, __) => const CouponsScreen()),
          GoRoute(path: AppRoutes.customerPayments, builder: (_, __) => const PaymentsScreen()),
          GoRoute(path: AppRoutes.customerWallet, builder: (_, __) => const WalletScreen()),
          GoRoute(path: AppRoutes.customerRefunds, builder: (_, __) => const RefundsScreen()),
          GoRoute(path: AppRoutes.customerRefundDetail, builder: (_, state) => RefundDetailsScreen(refundId: state.pathParameters['id']!)),
          GoRoute(path: AppRoutes.customerReviews, builder: (_, __) => const ReviewsScreen()),
          GoRoute(path: AppRoutes.customerAddresses, builder: (_, __) => const AddressesScreen()),
          GoRoute(path: AppRoutes.customerSettings, builder: (_, __) => const SettingsScreen()),
          GoRoute(path: AppRoutes.customerAgriPoints, builder: (_, __) => const AgriPointsScreen()),
          GoRoute(path: AppRoutes.customerPreorders, builder: (_, __) => const PreordersScreen()),
          GoRoute(path: AppRoutes.customerAlerts, builder: (_, __) => const AlertsScreen()),
          GoRoute(path: AppRoutes.customerPickups, builder: (_, __) => const PickupsScreen()),
          GoRoute(path: AppRoutes.customerMyDeliveries, builder: (_, __) => const MyDeliveriesScreen()),
          GoRoute(path: AppRoutes.customerHarvests, builder: (_, __) => const HarvestsScreen()),
          GoRoute(path: AppRoutes.customerImpact, builder: (_, __) => const CustomerImpactScreen()),
          GoRoute(path: AppRoutes.customerDeliverySlots, builder: (_, __) => const CustomerDeliverySlotsScreen()),
          GoRoute(path: AppRoutes.customerInvoice, builder: (_, state) => InvoiceScreen(orderId: state.pathParameters['id']!)),
          GoRoute(path: AppRoutes.aiCopilot, builder: (_, __) => const AICopilotScreen()),
        ],
      ),

      ShellRoute(
        builder: (_, state, child) => _roleShell('farmer', state, child),
        routes: [
          GoRoute(path: AppRoutes.farmerDashboard, builder: (_, __) => const FarmerDashboardScreen()),
          GoRoute(path: AppRoutes.farmerProducts, builder: (_, __) => const FarmerProductsScreen()),
          GoRoute(path: AppRoutes.farmerAddProduct, builder: (_, __) => const AddProductScreen()),
          GoRoute(path: AppRoutes.farmerOrders, builder: (_, __) => const FarmerOrdersScreen()),
          GoRoute(path: AppRoutes.farmerAnalytics, builder: (_, __) => const FarmerAnalyticsScreen()),
          GoRoute(path: AppRoutes.farmerAdvisor, builder: (_, __) => const FarmerAdvisorScreen()),
          GoRoute(path: AppRoutes.farmerRoute, builder: (_, __) => const FarmerRouteScreen()),
          GoRoute(path: AppRoutes.farmerProfile, builder: (_, __) => const FarmerProfileScreen()),
          GoRoute(path: AppRoutes.farmerDeliveryCalendar, builder: (_, __) => const FarmerDeliveryCalendarScreen()),
          GoRoute(path: AppRoutes.farmerSmartRoute, builder: (_, __) => const FarmerSmartRouteScreen()),
          GoRoute(path: AppRoutes.farmerEarnings, builder: (_, __) => const FarmerEarningsScreen()),
          GoRoute(path: AppRoutes.farmerDeliveryJobs, builder: (_, __) => const FarmerDeliveryJobsScreen()),
          GoRoute(path: AppRoutes.farmerHarvests, builder: (_, __) => const FarmerHarvestPlansScreen()),
          GoRoute(path: AppRoutes.farmerB2B, builder: (_, __) => const FarmerB2BScreen()),
          GoRoute(path: AppRoutes.farmerBulkB2BOrders, builder: (_, __) => const BulkB2BOrdersScreen()),
          GoRoute(path: AppRoutes.farmerCustomers, builder: (_, __) => const FarmerCustomersScreen()),
          GoRoute(path: AppRoutes.farmerRatings, builder: (_, __) => const FarmerRatingsScreen()),
          GoRoute(path: AppRoutes.farmerCoupons, builder: (_, __) => const CouponsScreen()),
          GoRoute(path: AppRoutes.farmerDeliverySlots, builder: (_, __) => const FarmerDeliverySlotsScreen()),
          GoRoute(path: AppRoutes.farmerNotifications, builder: (_, __) => const NotificationsScreen()),
          GoRoute(path: AppRoutes.farmerChat, builder: (_, __) => const ChatListScreen(role: 'farmer')),
          GoRoute(path: AppRoutes.farmerImpact, builder: (_, __) => const FarmerImpactScreen()),
          GoRoute(path: AppRoutes.farmerOrderMap, builder: (_, __) => const FarmerOrderMapScreen()),
          GoRoute(path: AppRoutes.farmerSecurity, builder: (_, __) => const FarmerSecurityScreen()),
          GoRoute(path: AppRoutes.farmerSettings, builder: (_, __) => const FarmerSettingsScreen()),
          GoRoute(path: AppRoutes.farmerDeliveryScheduleNew, builder: (_, __) => const DeliveryScheduleNewScreen()),
          GoRoute(path: AppRoutes.farmerFarmBaskets, builder: (_, __) => const FarmBasketsScreen()),
          GoRoute(path: AppRoutes.farmerFarmBasketForm, builder: (_, __) => const FarmBasketFormScreen()),
          GoRoute(path: AppRoutes.farmerQualityInspection, builder: (_, __) => const QualityInspectionScreen()),
          GoRoute(path: AppRoutes.aiCopilot, builder: (_, __) => const AICopilotScreen()),
        ],
      ),

      ShellRoute(
        builder: (_, state, child) => _roleShell('delivery', state, child),
        routes: [
          GoRoute(path: AppRoutes.deliveryDashboard, builder: (_, __) => const DeliveryDashboardScreen()),
          GoRoute(path: AppRoutes.deliveryDeliveries, builder: (_, __) => const DeliveriesScreen()),
          GoRoute(path: AppRoutes.deliveryRoute, builder: (_, __) => const DeliveryRouteScreen()),
          GoRoute(path: AppRoutes.deliveryHistory, builder: (_, __) => const DeliveryHistoryScreen()),
          GoRoute(path: AppRoutes.deliveryProfile, builder: (_, __) => const DeliveryProfileScreen()),
          GoRoute(path: AppRoutes.deliveryModes, builder: (_, __) => const DeliveryModesScreen()),
          GoRoute(path: AppRoutes.deliveryEarnings, builder: (_, __) => const DeliveryEarningsScreen()),
          GoRoute(path: AppRoutes.deliveryCashSettlement, builder: (_, __) => const DeliveryCashSettlementScreen()),
          GoRoute(path: AppRoutes.deliverySupport, builder: (_, __) => const DeliverySupportChatScreen()),
          GoRoute(path: AppRoutes.deliveryJobs, builder: (_, __) => const DeliveryJobsScreen()),
          GoRoute(path: AppRoutes.deliveryRatings, builder: (_, __) => const DeliveryRatingsScreen()),
          GoRoute(path: AppRoutes.deliverySettlements, builder: (_, __) => const SettlementsHistoryScreen()),
          GoRoute(path: AppRoutes.deliveryNotifications, builder: (_, __) => const NotificationsScreen()),
          GoRoute(path: AppRoutes.deliveryOrderMap, builder: (_, __) => const DeliveryOrderMapScreen()),
          GoRoute(path: AppRoutes.deliverySettings, builder: (_, __) => const DeliverySettingsScreen()),
          GoRoute(path: AppRoutes.aiCopilot, builder: (_, __) => const AICopilotScreen()),
        ],
      ),
    ],
  );

  static Widget _roleShell(String role, GoRouterState state, Widget child) {
    return _AppShell(role: role, currentPath: state.uri.path, child: child);
  }
}

/// Paths where the persistent bottom navigation is hidden so the user can
/// focus (checkout, detail views, forms).
const Set<String> _immersivePaths = {
  '/customer/checkout',
  '/customer/orders/:id',
  '/customer/orders/:id/invoice',
  '/farmer/products/add',
  '/farmer/delivery-schedule/new',
  '/ai/copilot',
};

class _AppShell extends StatefulWidget {
  final String role;
  final String currentPath;
  final Widget child;
  const _AppShell({required this.role, required this.currentPath, required this.child});

  @override
  State<_AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<_AppShell> {
  late String _currentPath = widget.currentPath;

  @override
  void didUpdateWidget(_AppShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.currentPath != widget.currentPath) {
      _currentPath = widget.currentPath;
    }
  }

  void _onTabSelected(int index) {
    final target = switch (widget.role) {
      'farmer' => switch (index) {
          0 => AppRoutes.farmerDashboard,
          1 => AppRoutes.farmerProducts,
          2 => AppRoutes.farmerOrders,
          3 => AppRoutes.farmerEarnings,
          _ => AppRoutes.farmerProfile,
        },
      'delivery' => switch (index) {
          0 => AppRoutes.deliveryDashboard,
          1 => AppRoutes.deliveryDeliveries,
          2 => AppRoutes.deliveryJobs,
          3 => AppRoutes.deliveryEarnings,
          _ => AppRoutes.deliveryProfile,
        },
      _ => switch (index) {
          0 => AppRoutes.customerHome,
          1 => AppRoutes.customerProducts,
          2 => AppRoutes.customerCart,
          3 => AppRoutes.customerOrders,
          _ => AppRoutes.customerProfile,
        },
    };
    context.go(target);
  }

  @override
  Widget build(BuildContext context) {
    final hideNav = _immersivePaths.any(
      (p) => _currentPath == p || (p.contains(':') && _pathMatches(_currentPath, p)),
    );

    final isRoleDashboard = switch (widget.role) {
      'farmer' => _currentPath == AppRoutes.farmerDashboard,
      'delivery' => _currentPath == AppRoutes.deliveryDashboard,
      _ => _currentPath == AppRoutes.customerHome,
    };

    return Scaffold(
      body: Stack(
        children: [
          widget.child,
          if (!isRoleDashboard && context.canPop())
            Positioned(
              top: MediaQuery.of(context).padding.top + 10,
              left: 16,
              child: Material(
                color: Colors.white,
                elevation: 3,
                shadowColor: Colors.black26,
                borderRadius: BorderRadius.circular(22),
                child: InkWell(
                  onTap: () => context.pop(),
                  borderRadius: BorderRadius.circular(22),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.arrow_back_rounded, size: 18),
                        SizedBox(width: 6),
                        Text(
                          'Back',
                          style: TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: hideNav
          ? null
          : RoleBottomNav(
              role: widget.role,
              currentPath: _currentPath,
              onSelect: _onTabSelected,
            ),
    );
  }

  static bool _pathMatches(String actual, String pattern) {
    final a = actual.split('/');
    final p = pattern.split('/');
    if (a.length != p.length) return false;
    for (var i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) continue;
      if (a[i] != p[i]) return false;
    }
    return true;
  }
}
