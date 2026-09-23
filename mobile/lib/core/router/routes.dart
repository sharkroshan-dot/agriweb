class AppRoutes {
  static const String login = '/login';
  static const String register = '/register';
  static const String otp = '/otp';
  static const String forgotPassword = '/forgot-password';

  /// Returns the dashboard route for a role. The customer dashboard is
  /// `/customer/home` (no `/customer/dashboard` route is registered).
  static String dashboardForRole(String role) {
    if (role == 'customer') return customerHome;
    return '/$role/dashboard';
  }

  static const String customerHome = '/customer/home';
  static const String customerProducts = '/customer/products';
  static const String customerProductDetail = '/customer/product/:id';
  static const String customerCart = '/customer/cart';
  static const String customerCheckout = '/customer/checkout';
  static const String customerOrders = '/customer/orders';
  static const String customerOrderDetail = '/customer/orders/:id';
  static const String customerWishlist = '/customer/wishlist';
  static const String customerProfile = '/customer/profile';
  static const String customerNearby = '/customer/nearby';
  static const String customerChat = '/customer/chat';
  static const String customerNotifications = '/customer/notifications';
  static const String customerCoupons = '/customer/coupons';
  static const String customerPayments = '/customer/payments';
  static const String customerWallet = '/customer/wallet';
  static const String customerRefunds = '/customer/refunds';
  static const String customerRefundDetail = '/customer/refunds/:id';
  static const String customerReviews = '/customer/reviews';
  static const String customerAddresses = '/customer/addresses';
  static const String customerSettings = '/customer/settings';
  static const String customerAgriPoints = '/customer/agripoints';
  static const String customerPreorders = '/customer/preorders';
  static const String customerAlerts = '/customer/alerts';
  static const String customerPickups = '/customer/pickups';
  static const String customerMyDeliveries = '/customer/my-deliveries';
  static const String customerHarvests = '/customer/harvests';
  static const String customerImpact = '/customer/impact';
  static const String customerDeliverySlots = '/customer/delivery-slots';
  static const String customerInvoice = '/customer/orders/:id/invoice';

  static const String farmerDashboard = '/farmer/dashboard';
  static const String farmerProducts = '/farmer/products';
  static const String farmerAddProduct = '/farmer/products/add';
  static const String farmerOrders = '/farmer/orders';
  static const String farmerAnalytics = '/farmer/analytics';
  static const String farmerAdvisor = '/farmer/advisor';
  static const String farmerRoute = '/farmer/route';
  static const String farmerProfile = '/farmer/profile';
  static const String farmerChat = '/farmer/chat';
  static const String farmerDiseaseDetect = '/farmer/disease-detect';
  static const String farmerHarvests = '/farmer/harvests';
  static const String farmerB2B = '/farmer/b2b';
  static const String farmerBulkB2BOrders = '/farmer/bulk-b2b';
  static const String farmerCustomers = '/farmer/customers';
  static const String farmerRatings = '/farmer/ratings';
  static const String farmerCoupons = '/farmer/coupons';
  static const String farmerDeliverySlots = '/farmer/delivery-slots';
  static const String farmerNotifications = '/farmer/notifications';
  static const String farmerImpact = '/farmer/impact';
  static const String farmerOrderMap = '/farmer/order-map';
  static const String farmerSecurity = '/farmer/security';
  static const String farmerSettings = '/farmer/settings';
  static const String farmerDeliveryScheduleNew = '/farmer/delivery-schedule/new';
  static const String farmerFarmBaskets = '/farmer/farm-baskets';
  static const String farmerFarmBasketForm = '/farmer/farm-baskets/form';
  static const String farmerQualityInspection = '/farmer/quality-inspection';
  static const String aiCopilot = '/ai/copilot';

  static const String deliveryDashboard = '/delivery/dashboard';
  static const String deliveryDeliveries = '/delivery/deliveries';
  static const String deliveryHistory = '/delivery/history';
  static const String deliveryRoute = '/delivery/route';
  static const String deliveryProfile = '/delivery/profile';
  static const String deliveryJobs = '/delivery/jobs';

  static const String marketplaceHub = '/customer/marketplace';
  static const String marketplaceState = '/customer/marketplace/state';
  static const String marketplaceNational = '/customer/marketplace/national';
  static const String communityBuying = '/customer/marketplace/community';
  static const String farmerDeliveryCalendar = '/farmer/delivery-calendar';
  static const String farmerSmartRoute = '/farmer/smart-route';
  static const String farmerEarnings = '/farmer/earnings';
  static const String farmerDeliveryJobs = '/farmer/delivery-jobs';
  static const String deliveryModes = '/delivery/modes';
  static const String deliveryEarnings = '/delivery/earnings';
  static const String deliveryCashSettlement = '/delivery/cash-settlement';
  static const String deliverySupport = '/delivery/support';
  static const String deliveryRatings = '/delivery/ratings';
  static const String deliverySettlements = '/delivery/settlements';
  static const String deliveryNotifications = '/delivery/notifications';
  static const String deliveryOrderMap = '/delivery/order-map';
  static const String deliverySettings = '/delivery/settings';
}
