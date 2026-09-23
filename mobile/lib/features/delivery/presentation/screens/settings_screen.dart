import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/providers/delivery_controller.dart';

class DeliverySettingsScreen extends StatefulWidget {
  const DeliverySettingsScreen({super.key});
  @override
  State<DeliverySettingsScreen> createState() => _DeliverySettingsScreenState();
}

class _DeliverySettingsScreenState extends State<DeliverySettingsScreen> {
  static const _weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  bool _isLoading = true;
  bool _isAvailable = false;
  bool _savingAvailability = false;
  bool _savingVehicle = false;
  bool _savingPrefs = false;
  bool _uploadingDl = false;

  final _vehicle = {
    'vehicleType': 'bike',
    'vehicleNumber': '',
    'vehicleModel': '',
    'vehicleYear': '',
    'capacity': '',
    'fuelType': 'petrol',
  };

  final Map<String, TextEditingController> _vehicleControllers = {
    'vehicleNumber': TextEditingController(),
    'vehicleModel': TextEditingController(),
    'vehicleYear': TextEditingController(),
    'capacity': TextEditingController(),
  };

  final Map<String, Map<String, String>> _workingHours = {};
  final Map<String, TextEditingController> _timeControllers = {};
  String _paymentMethod = 'bank_transfer';
  final _upiId = TextEditingController();
  final _minWithdrawal = TextEditingController(text: '200');
  bool _autoWithdraw = false;

  String _licenseNumber = '';
  String _expiryDate = '';
  final _licenseNumberController = TextEditingController();
  final _expiryDateController = TextEditingController();
  Map<String, dynamic>? _drivingLicense;

  Map<String, dynamic> _earnings = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _vehicleControllers.values) {
      c.dispose();
    }
    for (final c in _timeControllers.values) {
      c.dispose();
    }
    _upiId.dispose();
    _minWithdrawal.dispose();
    _licenseNumberController.dispose();
    _expiryDateController.dispose();
    super.dispose();
  }

  String get _photoBase {
    final base = ApiService.baseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
    return base;
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        ApiService.get('/delivery/me/stats'),
        ApiService.get('/delivery/me'),
        ApiService.get('/delivery/me/profile'),
        ApiService.get('/delivery/me/earnings'),
        ApiService.get('/settings/mine'),
      ]);
      if (!mounted) return;
      final stats = results[0]['data'] as Map<String, dynamic>? ?? results[0] as Map<String, dynamic>? ?? {};
      final profile = results[1]['data'] as Map<String, dynamic>? ?? results[1] as Map<String, dynamic>? ?? {};
      final profileDetail = results[2]['data'] as Map<String, dynamic>? ?? results[2] as Map<String, dynamic>? ?? {};
      final earnings = results[3]['data'] as Map<String, dynamic>? ?? results[3] as Map<String, dynamic>? ?? {};
      final settings = results[4]['data'] as Map<String, dynamic>? ?? results[4] as Map<String, dynamic>? ?? {};

      setState(() {
        _isAvailable = stats['isAvailable'] as bool? ?? profile['isAvailable'] as bool? ?? true;
        DeliveryController.instance?.syncAvailability(_isAvailable);
        _vehicle['vehicleType'] = profile['vehicleType'] as String? ?? 'bike';
        _vehicleControllers['vehicleNumber']!.text = profile['vehicleNumber'] as String? ?? '';
        _vehicleControllers['vehicleModel']!.text = profile['vehicleModel'] as String? ?? '';
        _vehicleControllers['vehicleYear']!.text = profile['vehicleYear'] != null ? '${profile['vehicleYear']}' : '';
        _vehicleControllers['capacity']!.text = profile['capacity'] != null ? '${profile['capacity']}' : '';
        _vehicle['fuelType'] = profile['fuelType'] as String? ?? 'petrol';

        final dl = profileDetail['drivingLicense'];
        if (dl is Map) {
          _drivingLicense = Map<String, dynamic>.from(dl);
          _licenseNumber = dl['licenseNumber'] as String? ?? '';
          _expiryDate = dl['expiryDate'] as String? ?? '';
        }

        _earnings = earnings;

        final savedWorking = settings['workingHours'];
        if (savedWorking is Map) {
          for (final day in _weekDays) {
            final v = savedWorking[day];
            if (v is Map) {
              _workingHours[day] = {
                'start': v['start'] as String? ?? '09:00',
                'end': v['end'] as String? ?? '18:00',
                'off': '${v['off']}' == 'true' ? 'true' : 'false',
              };
            } else {
              _workingHours[day] = {'start': '09:00', 'end': '18:00', 'off': 'false'};
            }
          }
        } else {
          for (final day in _weekDays) {
            _workingHours[day] = {'start': '09:00', 'end': '18:00', 'off': 'false'};
          }
        }

        final payout = settings['payout'];
        if (payout is Map) {
          _paymentMethod = payout['paymentMethod'] as String? ?? 'bank_transfer';
          _upiId.text = payout['upiId'] as String? ?? '';
          _minWithdrawal.text = '${payout['minWithdrawal'] ?? 200}';
          _autoWithdraw = payout['autoWithdraw'] as bool? ?? false;
        }

        for (final day in _weekDays) {
          final start = _workingHours[day]?['start'] ?? '09:00';
          final end = _workingHours[day]?['end'] ?? '18:00';
          _timeControllers['$day-start'] ??= TextEditingController();
          _timeControllers['$day-start']!.text = start;
          _timeControllers['$day-end'] ??= TextEditingController();
          _timeControllers['$day-end']!.text = end;
        }
        _licenseNumberController.text = _licenseNumber;
        _expiryDateController.text = _expiryDate;
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleAvailability() async {
    final controller = DeliveryController.of(context);
    final target = !controller.isAvailable;
    setState(() => _savingAvailability = true);
    final ok = await controller.setAvailable(target);
    if (!mounted) return;
    setState(() {
      _isAvailable = controller.isAvailable;
      _savingAvailability = false;
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(
        ok
            ? (controller.isAvailable ? 'You are now Online' : 'You are now Offline')
            : 'Failed to update availability',
      ),
      backgroundColor: ok
          ? (controller.isAvailable ? AppTheme.success : AppTheme.textSecondary)
          : AppTheme.error,
    ));
  }

  Future<void> _saveVehicle() async {
    setState(() => _savingVehicle = true);
    try {
      await ApiService.put('/delivery/me', body: {
        'vehicleType': _vehicle['vehicleType'],
        'vehicleNumber': _vehicleControllers['vehicleNumber']!.text.trim(),
        'vehicleModel': _vehicleControllers['vehicleModel']!.text.trim(),
        'vehicleYear': int.tryParse(_vehicleControllers['vehicleYear']!.text.trim()),
        'capacity': int.tryParse(_vehicleControllers['capacity']!.text.trim()),
        'fuelType': _vehicle['fuelType'],
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Vehicle details saved'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _savingVehicle = false);
    }
  }

  Future<void> _savePrefs() async {
    setState(() => _savingPrefs = true);
    try {
      await ApiService.put('/settings/mine', body: {
        'workingHours': _workingHours.map((day, v) => MapEntry(day, {
          'start': v['start'],
          'end': v['end'],
          'off': v['off'] == 'true',
        })),
        'payout': {
          'paymentMethod': _paymentMethod,
          'upiId': _upiId.text.trim(),
          'minWithdrawal': int.tryParse(_minWithdrawal.text.trim()) ?? 200,
          'autoWithdraw': _autoWithdraw,
        },
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Settings saved'),
        backgroundColor: AppTheme.success,
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _savingPrefs = false);
    }
  }

  Future<void> _pickAndUploadLicense() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 85);
    if (picked == null) return;
    setState(() => _uploadingDl = true);
    try {
      await ApiService.uploadFile('/delivery/me/documents/driving-license', picked.path, 'photo');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Driving licence submitted for verification'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Upload failed, please try again'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _uploadingDl = false);
    }
  }

  String _dlStatus() => _drivingLicense?['status'] as String? ?? 'not_submitted';

  @override
  Widget build(BuildContext context) {
    final dlStatus = _dlStatus();
    final dlPhotoUrl = _drivingLicense?['photoUrl'] as String?;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          TextButton.icon(
            onPressed: _savingPrefs ? null : _savePrefs,
            icon: _savingPrefs
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.save_outlined, size: 18),
            label: const Text('Save'),
          ),
        ],
      ),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _card(
                  title: 'Availability & Working Hours',
                  subtitle: 'Control when you receive assignments.',
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Online mode', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                Text(_isAvailable ? 'Accept new deliveries when enabled' : 'You are currently offline', style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                              ],
                            ),
                          ),
                          Switch(
                            value: _isAvailable,
                            onChanged: _savingAvailability ? null : (_) => _toggleAvailability(),
                            activeColor: AppTheme.primaryGreen,
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      ..._weekDays.map((day) {
                        final h = _workingHours[day] ?? {'start': '09:00', 'end': '18:00', 'off': 'false'};
                        final off = h['off'] == 'true';
                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          margin: const EdgeInsets.only(bottom: 8),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppTheme.border),
                          ),
                          child: Row(
                            children: [
                              SizedBox(width: 78, child: Text(day, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500))),
                              Switch(
                                value: !off,
                                onChanged: (v) => setState(() => _workingHours[day] = {...h, 'off': v ? 'false' : 'true'}),
                                activeColor: AppTheme.primaryGreen,
                              ),
                              const SizedBox(width: 8),
                              if (off)
                                const Text('Off', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary))
                              else
                                Row(
                                  children: [
                                    _timeField(day, h, 'start'),
                                    const Padding(padding: EdgeInsets.symmetric(horizontal: 4), child: Text('-', style: TextStyle(fontSize: 12))),
                                    _timeField(day, h, 'end'),
                                  ],
                                ),
                            ],
                          ),
                        );
                      }),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _card(
                  title: 'Vehicle Details',
                  subtitle: 'Used to match you with suitable deliveries.',
                  child: Column(
                    children: [
                      DropdownButtonFormField<String>(
                        value: _vehicle['vehicleType'],
                        decoration: const InputDecoration(labelText: 'Vehicle type'),
                        items: const [
                          DropdownMenuItem(value: 'bike', child: Text('Bike')),
                          DropdownMenuItem(value: 'scooter', child: Text('Scooter')),
                          DropdownMenuItem(value: 'car', child: Text('Car')),
                          DropdownMenuItem(value: 'van', child: Text('Van')),
                          DropdownMenuItem(value: 'truck', child: Text('Truck')),
                        ],
                        onChanged: (v) => setState(() => _vehicle['vehicleType'] = v ?? 'bike'),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(child: _field(_vehicleControllers['vehicleNumber']!, 'Vehicle number')),
                          const SizedBox(width: 10),
                          Expanded(child: _field(_vehicleControllers['vehicleModel']!, 'Vehicle model')),
                        ],
                      ),
                      Row(
                        children: [
                          Expanded(child: _field(_vehicleControllers['vehicleYear']!, 'Year')),
                          const SizedBox(width: 10),
                          Expanded(child: _field(_vehicleControllers['capacity']!, 'Capacity (kg)')),
                        ],
                      ),
                      DropdownButtonFormField<String>(
                        value: _vehicle['fuelType'],
                        decoration: const InputDecoration(labelText: 'Fuel type'),
                        items: const [
                          DropdownMenuItem(value: 'petrol', child: Text('Petrol')),
                          DropdownMenuItem(value: 'diesel', child: Text('Diesel')),
                          DropdownMenuItem(value: 'electric', child: Text('Electric')),
                          DropdownMenuItem(value: 'cng', child: Text('CNG')),
                        ],
                        onChanged: (v) => setState(() => _vehicle['fuelType'] = v ?? 'petrol'),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _savingVehicle ? null : _saveVehicle,
                          icon: _savingVehicle
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.save_outlined, size: 16),
                          label: const Text('Save vehicle'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _card(
                  title: 'Documents & Verification',
                  subtitle: 'Upload a copy of your driving licence.',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            dlStatus == 'verified' ? Icons.check_circle : dlStatus == 'rejected' ? Icons.cancel : Icons.description_outlined,
                            color: dlStatus == 'verified' ? AppTheme.success : dlStatus == 'rejected' ? AppTheme.error : AppTheme.primaryGreen,
                            size: 24,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Driving licence', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                Text(
                                  dlStatus == 'submitted'
                                    ? 'Submitted — under admin review.'
                                    : dlStatus == 'verified'
                                      ? 'Verified by admin.'
                                      : dlStatus == 'rejected'
                                        ? 'Rejected. Please upload a clear copy.'
                                        : 'Not submitted yet. Upload a clear photocopy.',
                                  style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                                ),
                              ],
                            ),
                          ),
                          _statusChip(dlStatus),
                        ],
                      ),
                      if (_drivingLicense?['remark'] != null) ...[
                        const SizedBox(height: 8),
                        Text('Admin note: ${_drivingLicense!['remark']}', style: const TextStyle(fontSize: 12, color: AppTheme.error)),
                      ],
                      if (dlPhotoUrl != null) ...[
                        const SizedBox(height: 10),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.network(
                            '$_photoBase$dlPhotoUrl',
                            height: 110,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Container(
                              height: 110,
                              width: double.infinity,
                              color: AppTheme.background,
                              child: const Icon(Icons.broken_image_outlined, color: AppTheme.textSecondary),
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(child: _field(_licenseNumberController, 'Licence number', readOnly: true)),
                          const SizedBox(width: 10),
                          Expanded(child: _field(_expiryDateController, 'Expiry date', readOnly: true)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: dlStatus == 'verified' || _uploadingDl ? null : _pickAndUploadLicense,
                          icon: _uploadingDl
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.upload_file, size: 16),
                          label: Text(_uploadingDl ? 'Uploading...' : 'Submit for verification'),
                          style: OutlinedButton.styleFrom(side: const BorderSide(color: AppTheme.primaryGreen), foregroundColor: AppTheme.primaryGreen),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _card(
                  title: 'Earnings & Payouts',
                  subtitle: 'Your earnings summary and payout preferences.',
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(child: _earnBox('Today', _earnings['todayEarnings'])),
                          const SizedBox(width: 10),
                          Expanded(child: _earnBox('Week', _earnings['weekEarnings'])),
                          const SizedBox(width: 10),
                          Expanded(child: _earnBox('Month', _earnings['monthEarnings'])),
                        ],
                      ),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        value: _paymentMethod,
                        decoration: const InputDecoration(labelText: 'Payment method'),
                        items: const [
                          DropdownMenuItem(value: 'bank_transfer', child: Text('Bank transfer')),
                          DropdownMenuItem(value: 'upi', child: Text('UPI')),
                        ],
                        onChanged: (v) => setState(() => _paymentMethod = v ?? 'bank_transfer'),
                      ),
                      const SizedBox(height: 10),
                      _field(_upiId, 'UPI ID'),
                      _field(_minWithdrawal, 'Minimum withdrawal (Rs)'),
                      Container(
                        margin: const EdgeInsets.only(top: 4),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Row(
                          children: [
                            const Expanded(child: Text('Auto-withdraw', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
                            Switch(
                              value: _autoWithdraw,
                              onChanged: (v) => setState(() => _autoWithdraw = v),
                              activeColor: AppTheme.primaryGreen,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _savingPrefs ? null : _savePrefs,
                  icon: _savingPrefs
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.save_outlined, size: 16),
                  label: const Text('Save preferences'),
                ),
              ],
            ),
          ),
    );
  }

  Widget _timeField(String day, Map<String, String> h, String key) {
    final controller = _timeControllers['$day-$key'] ??= TextEditingController(text: h[key]);
    return Container(
      width: 88,
      height: 34,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.border),
      ),
      child: TextField(
        controller: controller,
        style: const TextStyle(fontSize: 12),
        keyboardType: TextInputType.datetime,
        onChanged: (v) => setState(() => _workingHours[day] = {...h, key: v}),
        decoration: const InputDecoration(
          isDense: true,
          border: InputBorder.none,
          contentPadding: EdgeInsets.symmetric(vertical: 8),
        ),
      ),
    );
  }

  Widget _statusChip(String status) {
    final label = status == 'verified'
        ? 'Verified'
        : status == 'submitted'
          ? 'Under review'
          : status == 'rejected'
            ? 'Rejected'
            : 'Not submitted';
    final color = status == 'verified'
        ? AppTheme.success
        : status == 'submitted'
          ? AppTheme.accent
          : status == 'rejected'
            ? AppTheme.error
            : AppTheme.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
      child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color)),
    );
  }

  Widget _earnBox(String label, dynamic value) {
    final amount = value is num ? value.toDouble() : 0.0;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        children: [
          Text('Rs ${amount.toStringAsFixed(0)}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          Text(label, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _card({required String title, String? subtitle, required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(subtitle, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ],
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  Widget _field(TextEditingController controller, String label, {bool readOnly = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextField(
        controller: controller,
        readOnly: readOnly,
        keyboardType: label.contains('(kg)') || label.contains('(Rs)') ? TextInputType.number : TextInputType.text,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }
}