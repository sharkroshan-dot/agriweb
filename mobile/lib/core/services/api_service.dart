import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static const String _envBaseUrl = String.fromEnvironment('API_BASE_URL');
  static String? _token;

  // Current signed-in user (used by chat and other features to attribute the
  // caller instead of falling back to the demo "user-1" account).
  static String? userId;
  static String? userName;
  static String? userRole;

  static String get currentUserId => userId ?? 'user-1';
  static String get currentUserName => userName ?? 'You';
  static String get currentUserRole => userRole ?? 'customer';

  static String get baseUrl {
    if (_envBaseUrl.isNotEmpty) {
      return _envBaseUrl.endsWith('/api/v1')
          ? _envBaseUrl
          : '${_envBaseUrl.replaceAll(RegExp(r'/+$'), '')}/api/v1';
    }
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:8000/api/v1';
    }
    return 'http://localhost:8000/api/v1';
  }

  static Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('auth_token');
    userId = prefs.getString('auth_user_id');
    userName = prefs.getString('auth_user_name');
    userRole = prefs.getString('auth_user_role');
  }

  static Future<void> setToken(String token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('auth_token', token);
  }

  /// Stores the auth token and current user from a login/register/OTP response.
  ///
  /// Handles both response shapes the backend returns:
  ///   - login/verify-otp: { access_token, user: { id, first_name, ... } }
  ///   - register:         { data: { userId, email, role, ... } }
  static Future<void> setSession(Map<String, dynamic> res) async {
    final token = (res['access_token'] ?? res['accessToken']) as String?;
    if (token != null) await setToken(token);

    Map<String, dynamic>? user;
    final rawUser = res['user'];
    if (rawUser is Map<String, dynamic>) {
      user = rawUser;
    } else if (res['data'] is Map<String, dynamic>) {
      final data = res['data'] as Map<String, dynamic>;
      if (data['userId'] != null || data['role'] != null) {
        user = data;
      }
    }

    if (user == null) return;
    final prefs = await SharedPreferences.getInstance();
    userId = (user['id'] ?? user['userId'] ?? '').toString();
    userRole = (user['role'] ?? currentUserRole).toString();
    final first = (user['first_name'] ?? user['firstName'] ?? '').toString();
    final last = (user['last_name'] ?? user['lastName'] ?? '').toString();
    final name = user['name']?.toString() ??
        [first, last].where((s) => s.isNotEmpty).join(' ');
    userName = name.isNotEmpty ? name : currentUserName;
    await prefs.setString('auth_user_id', userId!);
    await prefs.setString('auth_user_name', userName!);
    await prefs.setString('auth_user_role', userRole!);
  }

  static Future<void> clearToken() async {
    _token = null;
    userId = null;
    userName = null;
    userRole = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
    await prefs.remove('auth_user_id');
    await prefs.remove('auth_user_name');
    await prefs.remove('auth_user_role');
  }

  static Future<Map<String, dynamic>?> getCurrentUser() async {
    final prefs = await SharedPreferences.getInstance();
    final id = prefs.getString('auth_user_id') ?? userId;
    final role = prefs.getString('auth_user_role') ?? userRole ?? 'customer';
    final name = prefs.getString('auth_user_name') ?? userName ?? 'You';
    if (id == null && role == null && name == null) {
      return null;
    }
    return {
      'id': id ?? currentUserId,
      'role': role,
      'name': name,
    };
  }

  /// The current access token (used to authenticate WebSocket connections and
  /// multipart uploads, which cannot set headers in all environments).
  static String get accessToken => _token ?? '';

  static Map<String, String> get _headers {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (_token != null) {
      headers['Authorization'] = 'Bearer $_token';
    }
    return headers;
  }

  /// Extracts a list from a decoded API response. Handles every shape the
  /// backend returns for collections:
  ///   - a bare array  -> [ ... ]
  ///   - { "data": [...] }                       -> data
  ///   - { "data": { "products": [...] } }       -> data.products
  ///   - { "success": true, "data": { ... } }    -> data.products
  static List<dynamic> asList(dynamic res, {String key = 'products'}) {
    if (res is List) return res;
    if (res is Map) {
      final data = res['data'];
      if (data is List) return data;
      if (data is Map) {
        final nested = data[key];
        if (nested is List) return nested;
        for (final candidate in const ['items', 'list', 'results']) {
          final v = data[candidate];
          if (v is List) return v;
        }
      }
      final top = res[key];
      if (top is List) return top;
    }
    return [];
  }

  static Future<dynamic> get(String path, {Map<String, String>? params}) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: params);
    final response = await http.get(uri, headers: _headers);
    return _handleResponse(response);
  }

  static Future<dynamic> post(String path, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$baseUrl$path');
    final response = await http.post(uri, headers: _headers, body: body != null ? jsonEncode(body) : null);
    return _handleResponse(response);
  }

  static Future<dynamic> postForm(String path, {Map<String, String>? body}) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (_token != null) {
      headers['Authorization'] = 'Bearer $_token';
    }
    final response = await http.post(uri, headers: headers, body: body);
    return _handleResponse(response);
  }

  static Future<dynamic> put(String path, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$baseUrl$path');
    final response = await http.put(uri, headers: _headers, body: body != null ? jsonEncode(body) : null);
    return _handleResponse(response);
  }

  static Future<dynamic> delete(String path) async {
    final uri = Uri.parse('$baseUrl$path');
    final response = await http.delete(uri, headers: _headers);
    return _handleResponse(response);
  }

  static Future<dynamic> uploadFile(String path, String filePath, String fieldName) async {
    final uri = Uri.parse('$baseUrl$path');
    final request = http.MultipartRequest('POST', uri);
    if (_token != null) {
      request.headers['Authorization'] = 'Bearer $_token';
    }
    request.files.add(await http.MultipartFile.fromPath(fieldName, filePath));
    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);
    return _handleResponse(response);
  }

  static dynamic _handleResponse(http.Response response) {
    if (response.body.isEmpty) {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return <String, dynamic>{};
      }
      throw ApiException('Request failed', response.statusCode);
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = response.body;
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    String message = 'Request failed';
    if (decoded is Map) {
      final detail = decoded['detail'];
      if (detail is String) {
        message = detail;
      } else if (detail is List && detail.isNotEmpty) {
        final first = detail.first;
        if (first is Map) {
          message = (first['msg'] as String?) ?? message;
        }
      }
    }
    throw ApiException(message, response.statusCode);
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  ApiException(this.message, this.statusCode);
  @override
  String toString() => message;
}