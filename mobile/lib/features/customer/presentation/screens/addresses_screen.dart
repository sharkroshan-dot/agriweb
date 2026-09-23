import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class AddressesScreen extends StatefulWidget {
  const AddressesScreen({super.key});
  @override
  State<AddressesScreen> createState() => _AddressesScreenState();
}

class _AddressesScreenState extends State<AddressesScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _addresses = [];

  @override
  void initState() {
    super.initState();
    _loadAddresses();
  }

  Future<void> _loadAddresses() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/users/me/addresses');
      if (!mounted) return;
      setState(() {
        final list = res is List ? res : (res['data'] as List<dynamic>? ?? []);
        _addresses = list.cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (mounted) setState(() => _addresses = []);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _setDefault(String id) async {
    try {
      await ApiService.put('/users/me/addresses/$id/default');
      if (!mounted) return;
      setState(() {
        for (final a in _addresses) {
          a['is_default'] = a['id'] == id;
        }
      });
    } catch (e) {
      if (mounted) _showError(e.toString());
    }
  }

  Future<void> _delete(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete address'),
        content: const Text('Are you sure you want to delete this address?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await ApiService.delete('/users/me/addresses/$id');
      if (!mounted) return;
      setState(() => _addresses.removeWhere((a) => a['id'] == id));
    } catch (e) {
      if (mounted) _showError(e.toString());
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppTheme.error),
    );
  }

  void _openForm([Map<String, dynamic>? address]) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _AddressFormScreen(
          address: address,
          onSaved: _loadAddresses,
        ),
      ),
    );
  }

  String _addressLine(Map<String, dynamic> a) {
    final parts = <String>[
      a['address_line1'] as String? ?? '',
      a['address_line2'] as String? ?? '',
    ].where((s) => s.isNotEmpty).toList();
    return parts.join(', ');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Saved Addresses')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppTheme.primaryGreen,
        onPressed: () => _openForm(),
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _addresses.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.location_on_outlined,
                          size: 56, color: AppTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('No addresses saved',
                          style: TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () => _openForm(),
                        child: const Text('Add address'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadAddresses,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _addresses.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final a = _addresses[index];
                      final isDefault = a['is_default'] == true;
                      final id = (a['id'] ?? a['_id'] ?? '').toString();
                      return Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: isDefault ? AppTheme.primaryGreen : AppTheme.border,
                            width: isDefault ? 1.5 : 1,
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(Icons.home_outlined,
                                    size: 20, color: AppTheme.primaryGreen),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    _addressLine(a),
                                    style: const TextStyle(
                                        fontSize: 14, fontWeight: FontWeight.w600),
                                  ),
                                ),
                                if (isDefault)
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AppTheme.primaryGreen.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: const Text('DEFAULT',
                                        style: TextStyle(
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                            color: AppTheme.primaryGreen)),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${a['address_line2'] as String? ?? ''}'
                              '${(a['address_line2'] as String? ?? '').isNotEmpty ? ', ' : ''}'
                              '${a['city'] as String? ?? ''}'
                              '${(a['city'] as String? ?? '').isNotEmpty ? ' - ' : ''}'
                              '${a['zip_code'] as String? ?? ''}',
                              style: TextStyle(
                                  fontSize: 13, color: AppTheme.textSecondary),
                            ),
                            if (a['landmark'] != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(
                                  'Landmark: ${a['landmark']}',
                                  style: const TextStyle(
                                      fontSize: 12, color: AppTheme.textSecondary),
                                ),
                              ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                if (!isDefault)
                                  TextButton.icon(
                                    onPressed: () => _setDefault(id),
                                    icon: const Icon(Icons.check_circle_outline,
                                        size: 18),
                                    label: const Text('Set default'),
                                    style: TextButton.styleFrom(
                                      foregroundColor: AppTheme.primaryGreen,
                                      padding: const EdgeInsets.symmetric(horizontal: 8),
                                    ),
                                  ),
                                TextButton.icon(
                                  onPressed: () => _openForm(a),
                                  icon: const Icon(Icons.edit_outlined, size: 18),
                                  label: const Text('Edit'),
                                  style: TextButton.styleFrom(
                                    foregroundColor: AppTheme.textSecondary,
                                    padding: const EdgeInsets.symmetric(horizontal: 8),
                                  ),
                                ),
                                const Spacer(),
                                IconButton(
                                  icon: const Icon(Icons.delete_outline,
                                      color: AppTheme.error, size: 20),
                                  onPressed: () => _delete(id),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}

class _AddressFormScreen extends StatefulWidget {
  final Map<String, dynamic>? address;
  final VoidCallback onSaved;
  const _AddressFormScreen({this.address, required this.onSaved});

  @override
  State<_AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends State<_AddressFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _line1;
  late final TextEditingController _line2;
  late final TextEditingController _city;
  late final TextEditingController _state;
  late final TextEditingController _zip;
  late final TextEditingController _landmark;
  bool _isDefault = false;
  bool _isSaving = false;
  bool get _isEdit => widget.address != null;

  @override
  void initState() {
    super.initState();
    final a = widget.address ?? {};
    _line1 = TextEditingController(text: a['address_line1'] as String? ?? '');
    _line2 = TextEditingController(text: a['address_line2'] as String? ?? '');
    _city = TextEditingController(text: a['city'] as String? ?? '');
    _state = TextEditingController(text: a['state'] as String? ?? '');
    _zip = TextEditingController(text: a['zip_code'] as String? ?? '');
    _landmark = TextEditingController(text: a['landmark'] as String? ?? '');
    _isDefault = a['is_default'] == true;
  }

  @override
  void dispose() {
    _line1.dispose();
    _line2.dispose();
    _city.dispose();
    _state.dispose();
    _zip.dispose();
    _landmark.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);
    final body = {
      'address_line1': _line1.text.trim(),
      'address_line2': _line2.text.trim().isEmpty ? null : _line2.text.trim(),
      'city': _city.text.trim(),
      'state': _state.text.trim(),
      'zip_code': _zip.text.trim(),
      'country': 'India',
      'landmark': _landmark.text.trim().isEmpty ? null : _landmark.text.trim(),
      'address_type': 'home',
      'is_default': _isDefault,
    };
    try {
      if (_isEdit) {
        final id = (widget.address!['id'] ?? widget.address!['_id'] ?? '').toString();
        await ApiService.put('/users/me/addresses/$id', body: body);
      } else {
        await ApiService.post('/users/me/addresses', body: body);
      }
      if (!mounted) return;
      widget.onSaved();
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit Address' : 'Add Address')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _line1,
                decoration: const InputDecoration(
                    labelText: 'Address line 1', hintText: 'House / street'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _line2,
                decoration: const InputDecoration(
                    labelText: 'Address line 2 (optional)'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _city,
                decoration: const InputDecoration(labelText: 'City'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _state,
                decoration: const InputDecoration(labelText: 'State'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _zip,
                decoration: const InputDecoration(labelText: 'Pincode'),
                keyboardType: TextInputType.number,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _landmark,
                decoration: const InputDecoration(labelText: 'Landmark (optional)'),
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                value: _isDefault,
                onChanged: (v) => setState(() => _isDefault = v),
                title: const Text('Set as default address'),
                activeColor: AppTheme.primaryGreen,
                contentPadding: EdgeInsets.zero,
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: _isSaving ? null : _save,
                child: _isSaving
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Save Address'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}