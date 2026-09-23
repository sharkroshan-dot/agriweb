import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'dart:io';
import 'package:image_picker/image_picker.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';

class AddProductScreen extends StatefulWidget {
  const AddProductScreen({super.key});
  @override
  State<AddProductScreen> createState() => _AddProductScreenState();
}

class _AddProductScreenState extends State<AddProductScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _priceController = TextEditingController();
  final _quantityController = TextEditingController();
  final _descriptionController = TextEditingController();
  String _selectedCategory = 'vegetables';
  String _selectedUnit = 'kg';
  bool _isLoading = false;
  bool _isEditing = false;
  String? _editId;
  List<File> _selectedImages = [];
  List<String> _existingImages = [];
  final _picker = ImagePicker();

  final _categories = [
    'vegetables', 'fruits', 'grains', 'dairy', 'meat', 'spices', 'herbs', 'other'
  ];

  final _units = ['kg', 'g', 'dozen', 'piece', 'litre', 'bundle'];

  @override
  void initState() {
    super.initState();
    final extra = GoRouterState.of(context).extra as Map<String, dynamic>?;
    if (extra != null) {
      _isEditing = true;
      _editId = extra['_id'] as String?;
      _nameController.text = extra['name'] as String? ?? '';
      _priceController.text = '${extra['price'] as num? ?? ''}';
      _quantityController.text = '${extra['quantity'] as num? ?? ''}';
      _descriptionController.text = extra['description'] as String? ?? '';
      _selectedCategory = extra['category'] as String? ?? 'vegetables';
      _selectedUnit = extra['unit'] as String? ?? 'kg';
      final images = extra['images'] as List<dynamic>? ?? [];
      _existingImages = images.map((e) => e as String).toList();
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    _quantityController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickImages() async {
    final files = await _picker.pickMultiImage();
    if (!mounted) return;
    setState(() => _selectedImages.addAll(files.map((f) => File(f.path))));
  }

  Future<void> _takePhoto() async {
    final file = await _picker.pickImage(source: ImageSource.camera);
    if (file != null && mounted) {
      setState(() => _selectedImages.add(File(file.path)));
    }
  }

  void _removeSelectedImage(int index) {
    setState(() => _selectedImages.removeAt(index));
  }

  void _removeExistingImage(int index) {
    setState(() => _existingImages.removeAt(index));
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);
    try {
      if (!_isEditing) {
        if (_existingImages.isNotEmpty || _selectedImages.isNotEmpty) {
          await ApiService.post('/products', body: {
            'name': _nameController.text.trim(),
            'category': _selectedCategory,
            'price': double.parse(_priceController.text.trim()),
            'unit': _selectedUnit,
            'quantity': double.parse(_quantityController.text.trim()),
            'description': _descriptionController.text.trim(),
            'images': _existingImages,
          });
        } else {
          final res = await ApiService.post('/products', body: {
            'name': _nameController.text.trim(),
            'category': _selectedCategory,
            'price': double.parse(_priceController.text.trim()),
            'unit': _selectedUnit,
            'quantity': double.parse(_quantityController.text.trim()),
            'description': _descriptionController.text.trim(),
          });
          final id = res['data']?['_id'] as String? ?? '';
          for (final file in _selectedImages) {
            await ApiService.uploadFile('/products/$id/images', file.path, 'image');
          }
        }
      } else {
        await ApiService.put('/products/$_editId', body: {
          'name': _nameController.text.trim(),
          'category': _selectedCategory,
          'price': double.parse(_priceController.text.trim()),
          'unit': _selectedUnit,
          'quantity': double.parse(_quantityController.text.trim()),
          'description': _descriptionController.text.trim(),
          'images': _existingImages,
        });
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(_isEditing ? 'Product updated' : 'Product added'),
        backgroundColor: AppTheme.success,
      ));
      context.pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message), backgroundColor: AppTheme.error));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to save product'), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEditing ? 'Edit Product' : 'Add Product')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildImageSection(),
              const SizedBox(height: 20),
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(labelText: 'Product Name', prefixIcon: Icon(Icons.shopping_bag_outlined)),
                validator: (v) => v == null || v.trim().isEmpty ? 'Enter product name' : null,
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: _selectedCategory,
                decoration: const InputDecoration(labelText: 'Category', prefixIcon: Icon(Icons.category_outlined)),
                items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c[0].toUpperCase() + c.substring(1)))).toList(),
                onChanged: (v) => setState(() => _selectedCategory = v!),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: TextFormField(
                      controller: _priceController,
                      decoration: const InputDecoration(labelText: 'Price', prefixIcon: Icon(Icons.currency_rupee)),
                      keyboardType: TextInputType.number,
                      validator: (v) => v == null || v.isEmpty ? 'Enter price' : null,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      value: _selectedUnit,
                      decoration: const InputDecoration(labelText: 'Unit'),
                      items: _units.map((u) => DropdownMenuItem(value: u, child: Text(u))).toList(),
                      onChanged: (v) => setState(() => _selectedUnit = v!),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _quantityController,
                decoration: const InputDecoration(labelText: 'Stock Quantity', prefixIcon: Icon(Icons.inventory_outlined)),
                keyboardType: TextInputType.number,
                validator: (v) => v == null || v.isEmpty ? 'Enter quantity' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _descriptionController,
                decoration: const InputDecoration(labelText: 'Description', prefixIcon: Icon(Icons.description_outlined), alignLabelWithHint: true),
                maxLines: 4,
                validator: (v) => v == null || v.trim().isEmpty ? 'Enter description' : null,
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _submit,
                  child: _isLoading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(_isEditing ? 'Update Product' : 'Add Product'),
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildImageSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Product Images', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
        const SizedBox(height: 8),
        SizedBox(
          height: 100,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              ..._existingImages.map((url) => _ImageThumbnail(
                url: url,
                isNetwork: true,
                onRemove: () => _removeExistingImage(_existingImages.indexOf(url)),
              )),
              ..._selectedImages.asMap().entries.map((e) => _ImageThumbnail(
                file: e.value,
                isNetwork: false,
                onRemove: () => _removeSelectedImage(e.key),
              )),
              GestureDetector(
                onTap: _pickImages,
                child: Container(
                  width: 100,
                  margin: const EdgeInsets.only(right: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.background,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.border, style: BorderStyle.solid),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.photo_library_outlined, color: AppTheme.primaryGreen, size: 28),
                      const SizedBox(height: 4),
                      Text('Gallery', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                    ],
                  ),
                ),
              ),
              GestureDetector(
                onTap: _takePhoto,
                child: Container(
                  width: 100,
                  margin: const EdgeInsets.only(right: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.background,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.border, style: BorderStyle.solid),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.camera_alt_outlined, color: AppTheme.primaryGreen, size: 28),
                      const SizedBox(height: 4),
                      Text('Camera', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ImageThumbnail extends StatelessWidget {
  final String? url;
  final File? file;
  final bool isNetwork;
  final VoidCallback onRemove;
  const _ImageThumbnail({this.url, this.file, required this.isNetwork, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 100,
      height: 100,
      margin: const EdgeInsets.only(right: 8),
      child: Stack(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: isNetwork
              ? Image.network(url!, fit: BoxFit.cover, width: 100, height: 100, errorBuilder: (_, __, ___) => Container(color: AppTheme.background, child: const Icon(Icons.broken_image)))
              : Image.file(file!, fit: BoxFit.cover, width: 100, height: 100, errorBuilder: (_, __, ___) => Container(color: AppTheme.background, child: const Icon(Icons.broken_image))),
          ),
          Positioned(
            top: 4, right: 4,
            child: GestureDetector(
              onTap: onRemove,
              child: Container(
                padding: const EdgeInsets.all(2),
                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                child: const Icon(Icons.close, color: Colors.white, size: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
