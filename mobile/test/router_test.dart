import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agriconnect/core/router/app_router.dart';
import 'package:agriconnect/core/router/routes.dart';
import 'package:agriconnect/features/customer/presentation/screens/home_screen.dart';
import 'package:agriconnect/features/customer/presentation/screens/products_screen.dart';

void main() {
  group('AppRoutes.dashboardForRole', () {
    test('customer maps to /customer/home', () {
      expect(AppRoutes.dashboardForRole('customer'), AppRoutes.customerHome);
    });

    test('farmer maps to /farmer/dashboard', () {
      expect(AppRoutes.dashboardForRole('farmer'), AppRoutes.farmerDashboard);
    });

    test('delivery maps to /delivery/dashboard', () {
      expect(AppRoutes.dashboardForRole('delivery'), AppRoutes.deliveryDashboard);
    });
  });

  testWidgets('/customer/dashboard alias renders the customer home screen', (tester) async {
    await tester.pumpWidget(MaterialApp.router(routerConfig: AppRouter.router));
    await tester.pumpAndSettle();
    AppRouter.router.go('/customer/dashboard');
    await tester.pumpAndSettle(const Duration(seconds: 2));
    expect(find.byType(CustomerHomeScreen), findsOneWidget);
  });

  testWidgets('/customer/products renders the products screen', (tester) async {
    await tester.pumpWidget(MaterialApp.router(routerConfig: AppRouter.router));
    await tester.pumpAndSettle();
    AppRouter.router.go('/customer/products', extra: 'potato');
    await tester.pumpAndSettle(const Duration(seconds: 2));
    expect(find.byType(CustomerProductsScreen), findsOneWidget);
  });
}