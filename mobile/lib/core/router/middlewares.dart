import 'package:go_router/go_router.dart';
import '../services/api_service.dart';
import 'routes.dart';

class AppRouteMiddleware {
  static const _publicPaths = <String>{
    AppRoutes.login,
    AppRoutes.register,
    AppRoutes.otp,
    AppRoutes.forgotPassword,
  };

  static String? redirect(GoRouterState state) {
    final path = state.uri.path;
    if (_publicPaths.contains(path)) return null;

    final token = ApiService.accessToken;
    final role = ApiService.userRole;
    if (token.isEmpty || role == null || role.isEmpty) {
      return '${AppRoutes.login}?redirect=${Uri.encodeComponent(path)}';
    }

    final requiredRole = _requiredRole(path);
    if (requiredRole != null && role != requiredRole) {
      return AppRoutes.dashboardForRole(role);
    }
    return null;
  }

  static String? _requiredRole(String path) {
    const roles = <String, String>{
      'customer': 'customer',
      'farmer': 'farmer',
      'delivery': 'delivery',
      'warehouse': 'warehouse',
      'business': 'business',
      'admin': 'admin',
    };
    for (final entry in roles.entries) {
      if (path == '/${entry.key}' || path.startsWith('/${entry.key}/')) return entry.value;
    }
    return null;
  }
}
