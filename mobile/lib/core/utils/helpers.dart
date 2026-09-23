double productRating(Map<String, dynamic> product) {
  final direct = (product['rating'] as num?)?.toDouble();
  if (direct != null && direct > 0) return direct;
  final ratings = product['ratings'];
  if (ratings is Map) {
    final avg = (ratings['average'] as num?)?.toDouble();
    if (avg != null && avg > 0) return avg;
  }
  return 0;
}

String productFarmerName(Map<String, dynamic> product) {
  final name = product['farmerName'];
  if (name is String && name.trim().isNotEmpty) return name;
  final farmer = product['farmer'];
  if (farmer is Map) {
    final n = farmer['name'];
    if (n is String && n.trim().isNotEmpty) return n;
    final farm = farmer['farmName'];
    if (farm is String && farm.trim().isNotEmpty) return farm;
  }
  return 'Local Farmer';
}

String? productImage(Map<String, dynamic> product) {
  final images = product['images'];
  if (images is List && images.isNotEmpty && images.first is String) {
    return images.first as String;
  }
  final image = product['image'];
  if (image is String && image.isNotEmpty) return image;
  return null;
}

String shortDate(dynamic value) {
  if (value == null) return '';
  try {
    final dt = DateTime.parse(value.toString()).toLocal();
    return '${dt.day}/${dt.month}/${dt.year}';
  } catch (_) {
    return value.toString();
  }
}

double? toDoubleValue(dynamic value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}