import 'package:flutter_test/flutter_test.dart';
import 'package:agriconnect/core/router/middlewares.dart';
import 'package:agriconnect/core/router/routes.dart';
import 'package:agriconnect/core/services/api_service.dart';
import 'package:go_router/go_router.dart';

void main() {
  test('public routes do not require authentication', () {
    final state = GoRouterState(
      RouteConfiguration(
        navigatorKey: GlobalKey<NavigatorState>(),
        routes: const [],
      ),
      uri: Uri.parse(AppRoutes.login),
      matchedLocation: AppRoutes.login,
      fullPath: AppRoutes.login,
      pathParameters: const {},
      extra: null,
      error: null,
      pageKey: const ValueKey('login'),
      topRoute: null,
    );
    expect(AppRouteMiddleware.redirect(state), isNull);
  });

  test('dashboardForRole remains deterministic', () {
    expect(AppRoutes.dashboardForRole('customer'), AppRoutes.customerHome);
    expect(AppRoutes.dashboardForRole('farmer'), AppRoutes.farmerDashboard);
  });

  test('stored session exposes the role used by the guard', () async {
    await ApiService.clearToken();
    expect(ApiService.accessToken, isEmpty);
    expect(ApiService.userRole, isNull);
  });
}
