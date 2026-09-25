import 'package:flutter_test/flutter_test.dart';

import 'package:agriconnect/core/router/routes.dart';

void main() {
  test('dashboard routes are defined for supported mobile roles', () {
    expect(dashboardForRole('customer'), AppRoutes.customerHome);
    expect(dashboardForRole('farmer'), '/farmer/dashboard');
    expect(dashboardForRole('delivery'), '/delivery/dashboard');
  });

  test('role route constants remain stable', () {
    expect(AppRoutes.customerHome, '/customer/home');
    expect(AppRoutes.farmerDashboard, '/farmer/dashboard');
    expect(AppRoutes.deliveryDashboard, '/delivery/dashboard');
  });
}
