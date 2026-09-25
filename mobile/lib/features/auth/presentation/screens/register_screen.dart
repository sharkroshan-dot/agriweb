import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/router/routes.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _vehicleNumberController = TextEditingController();
  final _vehicleModelController = TextEditingController();
  final _vehicleYearController = TextEditingController();
  final _capacityController = TextEditingController();
  String _selectedRole = 'customer';
  String _vehicleType = 'bike';
  String _fuelType = 'petrol';
  bool _isLoading = false;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _vehicleNumberController.dispose();
    _vehicleModelController.dispose();
    _vehicleYearController.dispose();
    _capacityController.dispose();
    super.dispose();
  }

  bool get _isDelivery => _selectedRole == 'delivery';

  String get _firstName {
    final name = _nameController.text.trim();
    if (name.isEmpty) return name;
    final parts = name.split(RegExp(r'\s+'));
    return parts.first;
  }

  String get _lastName {
    final name = _nameController.text.trim();
    if (name.isEmpty) return name;
    final parts = name.split(RegExp(r'\s+'));
    return parts.length > 1 ? parts.sublist(1).join(' ') : parts.first;
  }

  Future<void> _register() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _isLoading = true; _error = null; });
    try {
      final body = <String, dynamic>{
        'firstName': _firstName,
        'lastName': _lastName,
        'email': _emailController.text.trim(),
        'phone': _phoneController.text.trim(),
        'password': _passwordController.text,
        'role': _selectedRole,
      };
      if (_isDelivery) {
        body['vehicleType'] = _vehicleType;
        body['vehicleNumber'] = _vehicleNumberController.text.trim();
        body['vehicleModel'] = _vehicleModelController.text.trim();
        body['vehicleYear'] = int.tryParse(_vehicleYearController.text.trim());
        body['capacity'] = double.tryParse(_capacityController.text.trim());
        body['fuelType'] = _fuelType;
      }
      final res = await ApiService.post('/auth/register', body: body);
      if (!mounted) return;
      final phone = _phoneController.text.trim();
      final route = AppRoutes.dashboardForRole(_selectedRole);
      final data = (res['data'] as Map<String, dynamic>?) ?? res;
      final requiresOtp =
          data['requiresOtp'] == true || data['requiresVerification'] == true;
      if (requiresOtp) {
        context.push('/otp', extra: {'phone': phone, 'route': route});
      } else {
        await ApiService.setSession(res);
        context.go(route);
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Connection failed. Check your network.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 40),
                Icon(Icons.agriculture, size: 64, color: AppTheme.primaryGreen),
                const SizedBox(height: 12),
                Text('Create Account', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                const SizedBox(height: 32),
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: 'Full Name', prefixIcon: Icon(Icons.person_outlined)),
                  textCapitalization: TextCapitalization.words,
                  validator: (v) => v == null || v.trim().isEmpty ? 'Enter your name' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _emailController,
                  decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.email_outlined)),
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Enter email';
                    if (!v.contains('@')) return 'Enter a valid email';
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _phoneController,
                  decoration: const InputDecoration(labelText: 'Phone Number', prefixIcon: Icon(Icons.phone_outlined)),
                  keyboardType: TextInputType.phone,
                  validator: (v) => v == null || v.trim().length < 10 ? 'Enter valid phone number' : null,
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _selectedRole,
                  decoration: const InputDecoration(labelText: 'I am a', prefixIcon: Icon(Icons.badge_outlined)),
                  items: const [
                    DropdownMenuItem(value: 'customer', child: Text('Customer')),
                    DropdownMenuItem(value: 'farmer', child: Text('Farmer')),
                    DropdownMenuItem(value: 'delivery', child: Text('Delivery Partner')),
                  ],
                  onChanged: (v) => setState(() => _selectedRole = v!),
                ),
                if (_isDelivery) ...[
                  const SizedBox(height: 24),
                  Text('Vehicle Details', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: _vehicleType,
                    decoration: const InputDecoration(labelText: 'Vehicle Type', prefixIcon: Icon(Icons.directions_bike_outlined)),
                    items: const [
                      DropdownMenuItem(value: 'bike', child: Text('Bike')),
                      DropdownMenuItem(value: 'car', child: Text('Car')),
                      DropdownMenuItem(value: 'van', child: Text('Van')),
                      DropdownMenuItem(value: 'truck', child: Text('Truck')),
                      DropdownMenuItem(value: 'tempo', child: Text('Tempo')),
                    ],
                    onChanged: (v) => setState(() => _vehicleType = v!),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _vehicleNumberController,
                    decoration: const InputDecoration(labelText: 'Vehicle Number', prefixIcon: Icon(Icons.pin_outlined)),
                    textCapitalization: TextCapitalization.characters,
                    validator: (v) => v == null || v.trim().isEmpty ? 'Enter vehicle number' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _vehicleModelController,
                    decoration: const InputDecoration(labelText: 'Vehicle Model (optional)', prefixIcon: Icon(Icons.model_training)),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _vehicleYearController,
                    decoration: const InputDecoration(labelText: 'Vehicle Year (optional)', prefixIcon: Icon(Icons.calendar_today_outlined)),
                    keyboardType: TextInputType.number,
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return null;
                      final year = int.tryParse(v.trim());
                      if (year == null || year < 1980 || year > DateTime.now().year + 1) return 'Enter a valid year';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _capacityController,
                    decoration: const InputDecoration(labelText: 'Capacity (kg) - optional', prefixIcon: Icon(Icons.scale_outlined)),
                    keyboardType: TextInputType.number,
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return null;
                      return double.tryParse(v.trim()) == null ? 'Enter a valid number' : null;
                    },
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: _fuelType,
                    decoration: const InputDecoration(labelText: 'Fuel Type', prefixIcon: Icon(Icons.local_gas_station_outlined)),
                    items: const [
                      DropdownMenuItem(value: 'petrol', child: Text('Petrol')),
                      DropdownMenuItem(value: 'diesel', child: Text('Diesel')),
                      DropdownMenuItem(value: 'electric', child: Text('Electric')),
                      DropdownMenuItem(value: 'cng', child: Text('CNG')),
                    ],
                    onChanged: (v) => setState(() => _fuelType = v!),
                  ),
                ],
                const SizedBox(height: 16),
                TextFormField(
                  controller: _passwordController,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_outlined),
                    suffixIcon: IconButton(icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _obscurePassword = !_obscurePassword)),
                  ),
                  obscureText: _obscurePassword,
                  validator: (v) => v == null || v.length < 6 ? 'Min 6 characters' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _confirmPasswordController,
                  decoration: InputDecoration(
                    labelText: 'Confirm Password',
                    prefixIcon: const Icon(Icons.lock_outlined),
                    suffixIcon: IconButton(icon: Icon(_obscureConfirm ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm)),
                  ),
                  obscureText: _obscureConfirm,
                  validator: (v) => v != _passwordController.text ? 'Passwords do not match' : null,
                ),
                const SizedBox(height: 24),
                if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13), textAlign: TextAlign.center)),
                ElevatedButton(onPressed: _isLoading ? null : _register, child: _isLoading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Create Account')),
                const SizedBox(height: 16),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Text('Already have an account?', style: TextStyle(color: AppTheme.textSecondary)),
                  TextButton(onPressed: () => context.pop(), child: const Text('Sign In')),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
