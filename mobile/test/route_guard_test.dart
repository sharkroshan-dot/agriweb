import 'package:flutter_test/flutter_test.dart';
import 'package:agriconnect/core/router/routes.dart';
import 'package:agriconnect/core/services/api_service.dart';

void main() {
  test('dashboardForRole remains deterministic', () {
    expect(AppRoutes.dashboardForRole('customer'), AppRoutes.customerHome);
    expect(AppRoutes.dashboardForRole('farmer'), AppRoutes.farmerDashboard);
    expect(AppRoutes.dashboardForRole('delivery'), AppRoutes.deliveryDashboard);
  });

  test('stored session exposes the role used by the guard', () async {
    await ApiService.clearToken();
    expect(ApiService.accessToken, isEmpty);
    expect(ApiService.userRole, isNull);
  });
}
