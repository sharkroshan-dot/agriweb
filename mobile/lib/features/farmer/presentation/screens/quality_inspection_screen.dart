import 'dart:io';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../shared/widgets/skeleton.dart';

class QualityInspectionScreen extends StatefulWidget {
  const QualityInspectionScreen({super.key});
  @override
  State<QualityInspectionScreen> createState() => _QualityInspectionScreenState();
}

class _QualityInspectionScreenState extends State<QualityInspectionScreen> {
  final ImagePicker _picker = ImagePicker();
  List<XFile> _photos = [];
  List<String> _previewUrls = [];
  double _freshness = 85;
  double _damagedPct = 2;
  double _weightKg = 0;
  String _declaredGrade = '';
  Map<String, dynamic>? _assessment;
  bool _isAnalyzing = false;
  String? _voiceCommand;
  bool _isListening = false;

  @override
  void dispose() {
    super.dispose();
  }

  Future<void> _pickImages() async {
    if (_photos.length >= 5) {
      _showToast('Maximum 5 photos allowed');
      return;
    }

    final List<XFile> images = await _picker.pickMultiImage(
      maxWidth: 1920,
      maxHeight: 1080,
      imageQuality: 85,
    );

    if (images.isNotEmpty) {
      setState(() {
        final remaining = 5 - _photos.length;
        _photos.addAll(images.take(remaining));
        _previewUrls = _photos.map((f) => f.path).toList();
      });
    }
  }

  void _removePhoto(int index) {
    setState(() {
      _photos.removeAt(index);
      _previewUrls.removeAt(index);
    });
  }

  Future<void> _analyzeQuality() async {
    if (_photos.isEmpty) {
      _showToast('Please upload at least one photo');
      return;
    }
    if (_weightKg <= 0) {
      _showToast('Please enter the weight');
      return;
    }

    setState(() => _isAnalyzing = true);

    try {
      final formData = {
        'freshness': _freshness.round(),
        'damagedPct': _damagedPct.round(),
        'weightKg': _weightKg,
        'farmerDeclaredGrade': _declaredGrade,
        'photoPaths': _previewUrls,
      };

      final response = await ApiService.post('/ai/quality-check', body: formData);

      if (!mounted) return;
      setState(() {
        _assessment = response['data'] ?? response;
        _isAnalyzing = false;
      });
      _showToast('Quality analysis complete!');
    } catch (e) {
      if (!mounted) return;
      setState(() => _isAnalyzing = false);
      _showToast('Analysis failed: ${e.toString()}');
    }
  }

  void _showToast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppTheme.primaryGreen),
    );
  }

  void _resetForm() {
    setState(() {
      _photos.clear();
      _previewUrls.clear();
      _freshness = 85;
      _damagedPct = 2;
      _weightKg = 0;
      _declaredGrade = '';
      _assessment = null;
      _voiceCommand = null;
    });
  }

  String _getGradeLabel(String grade) {
    switch (grade) {
      case 'A':
        return 'Premium Quality';
      case 'B':
        return 'Good Quality';
      case 'C':
        return 'Needs Improvement';
      default:
        return 'Unknown';
    }
  }

  String _getGradeDescription(String grade) {
    switch (grade) {
      case 'A':
        return 'Excellent freshness, minimal damage, meets export standards';
      case 'B':
        return 'Good freshness, minor cosmetic issues, suitable for local markets';
      case 'C':
        return 'Significant damage or freshness concerns, requires sorting';
      default:
        return '';
    }
  }

  Color _getGradeColor(String grade) {
    switch (grade) {
      case 'A':
        return AppTheme.success;
      case 'B':
        return AppTheme.warning;
      case 'C':
        return AppTheme.error;
      default:
        return AppTheme.textSecondary;
    }
  }

  Widget _buildGradeBadge(String grade, {double size = 24}) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: size * 0.6, vertical: size * 0.3),
      decoration: BoxDecoration(
        color: _getGradeColor(grade).withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(size * 0.5),
        border: Border.all(color: _getGradeColor(grade), width: 1.5),
      ),
      child: Text(
        'Grade $grade',
        style: TextStyle(
          fontSize: size * 0.7,
          fontWeight: FontWeight.bold,
          color: _getGradeColor(grade),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Quality Inspection'),
        actions: [
          if (_assessment != null)
            IconButton(
              onPressed: _resetForm,
              icon: const Icon(Icons.refresh),
              tooltip: 'New Inspection',
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header Info
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: AppTheme.brandGradient,
                borderRadius: BorderRadius.circular(AppTheme.radiusLg),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.2),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.verified_outlined, color: Colors.white, size: 24),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'AI Quality Inspection',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Computer vision grading with heuristic fallback',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.9),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Photo Upload Section
            _SectionCard(
              title: 'Photo Evidence',
              icon: Icons.camera_alt_outlined,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Upload 1-5 clear photos from different angles',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  if (_previewUrls.isNotEmpty)
                    SizedBox(
                      height: 100,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _previewUrls.length + (_photos.length < 5 ? 1 : 0),
                        separatorBuilder: (_, __) => const SizedBox(width: 10),
                        itemBuilder: (_, i) {
                          if (i == _previewUrls.length) {
                            return _buildAddPhotoPlaceholder();
                          }
                          return _buildPhotoItem(i);
                        },
                      ),
                    )
                  else
                    _buildAddPhotoPlaceholder(),
                ],
              ),
            ),

            const SizedBox(height: 16),

            // Quality Parameters Section
            _SectionCard(
              title: 'Quality Parameters',
              icon: Icons.tune_outlined,
              child: Column(
                children: [
                  _SliderField(
                    label: 'Freshness Score (%)',
                    value: _freshness,
                    min: 0,
                    max: 100,
                    divisions: 20,
                    activeColor: AppTheme.success,
                    onChanged: (v) => setState(() => _freshness = v),
                    helperText: '0% = Overripe, 100% = Just harvested',
                  ),
                  const SizedBox(height: 16),
                  _SliderField(
                    label: 'Damage Percentage (%)',
                    value: _damagedPct,
                    min: 0,
                    max: 50,
                    divisions: 25,
                    activeColor: AppTheme.error,
                    onChanged: (v) => setState(() => _damagedPct = v),
                    helperText: '% of produce with visible damage/bruising',
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    initialValue: _weightKg > 0 ? _weightKg.toString() : '',
                    decoration: const InputDecoration(
                      labelText: 'Weight (kg)',
                      prefixIcon: Icon(Icons.scale_outlined),
                      helperText: 'Total weight of the harvest lot',
                    ),
                    keyboardType: TextInputType.numberWithOptions(decimal: true),
                    onChanged: (v) => setState(() => _weightKg = double.tryParse(v) ?? 0),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: _declaredGrade.isEmpty ? null : _declaredGrade,
                    decoration: const InputDecoration(
                      labelText: 'Declared Grade (Optional)',
                      prefixIcon: Icon(Icons.grade_outlined),
                      helperText: 'Your declared grade for AI comparison',
                    ),
                    items: ['A', 'B', 'C'].map((g) => DropdownMenuItem(
                      value: g,
                      child: Text('Grade $g - ${_getGradeLabel(g)}'),
                    )).toList(),
                    onChanged: (v) => setState(() => _declaredGrade = v ?? ''),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Analyze Button
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton.icon(
                onPressed: _isAnalyzing ? null : _analyzeQuality,
                icon: _isAnalyzing
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.psychology_outlined, size: 22),
                label: Text(
                  _isAnalyzing ? 'Analyzing...' : 'Run AI Inspection',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryGreen,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Assessment Result
            if (_assessment != null) _buildAssessmentResult(),

            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildAddPhotoPlaceholder() {
    return GestureDetector(
      onTap: _pickImages,
      child: Container(
        width: 86,
        decoration: BoxDecoration(
          color: AppTheme.surfaceVariant,
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(
            color: AppTheme.border.withValues(alpha: 0.5),
            style: BorderStyle.solid,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_a_photo_outlined, color: AppTheme.primaryGreen, size: 28),
            const SizedBox(height: 4),
            Text(
              '${_photos.length}/5',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppTheme.primaryGreen,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPhotoItem(int index) {
    return Stack(
      children: [
        Container(
          width: 86,
          height: 86,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            border: Border.all(color: AppTheme.border.withValues(alpha: 0.3)),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            child: Image.file(
              File(_previewUrls[index]),
              fit: BoxFit.cover,
              width: 86,
              height: 86,
            ),
          ),
        ),
        Positioned(
          top: 4,
          right: 4,
          child: GestureDetector(
            onTap: () => _removePhoto(index),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: const BoxDecoration(
                color: AppTheme.error,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAssessmentResult() {
    final assessment = _assessment!;
    final grade = assessment['estimatedGrade'] as String? ?? 'A';
    final confidence = (assessment['confidence'] as num?)?.toDouble() ?? 0.0;
    final model = assessment['model'] as String? ?? 'heuristic';
    final findings = (assessment['findings'] as List<dynamic>?)?.cast<String>() ?? [];
    final mismatch = assessment['mismatch'] as bool? ?? false;
    final recommendation = assessment['recommendation'] as String? ?? 'review_evidence';
    final declaredGrade = assessment['declaredGrade'] as String? ?? '';

    return _SectionCard(
      title: 'Assessment Result',
      icon: Icons.check_circle_outline,
      borderColor: mismatch ? AppTheme.warning : AppTheme.success,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Grade Display
          Row(
            children: [
              _buildGradeBadge(grade, size: 32),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _getGradeLabel(grade),
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _getGradeDescription(grade),
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Confidence & Model
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Confidence',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                    const SizedBox(height: 4),
                    Stack(
                      children: [
                        Container(
                          height: 6,
                          decoration: BoxDecoration(
                            color: AppTheme.border,
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                        FractionallySizedBox(
                          widthFactor: confidence.clamp(0.0, 1.0),
                          child: Container(
                            height: 6,
                            decoration: BoxDecoration(
                              color: _getGradeColor(grade),
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${(confidence * 100).round()}%',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: _getGradeColor(grade),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Model Used',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: model == 'quality_vision'
                            ? AppTheme.info.withValues(alpha: 0.1)
                            : AppTheme.warning.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: model == 'quality_vision'
                              ? AppTheme.info.withValues(alpha: 0.3)
                              : AppTheme.warning.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Text(
                        model == 'quality_vision' ? 'Computer Vision' : 'Heuristic Analysis',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: model == 'quality_vision' ? AppTheme.info : AppTheme.warning,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          // Grade Mismatch Warning
          if (declaredGrade.isNotEmpty && mismatch) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.warning.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.warning.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  Icon(Icons.warning_amber_outlined, color: AppTheme.warning, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Grade Mismatch Detected',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.warning,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Farmer declared Grade $declaredGrade, AI estimates Grade $grade. '
                          'Manual inspection required before "Verified" status.',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppTheme.warning.withValues(alpha: 0.9),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Findings
          if (findings.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
              'Findings',
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            ...findings.map((f) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.circle, size: 6, color: _getGradeColor(grade)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      f,
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                  ),
                ],
              ),
            )),
          ],

          // Recommendation
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.primarySoft.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.primaryGreen.withValues(alpha: 0.2)),
            ),
            child: Row(
              children: [
                Icon(
                  recommendation == 'manual_inspection'
                      ? Icons.assignment_outlined
                      : recommendation == 'sample_verification'
                          ? Icons.verified_outlined
                          : Icons.visibility_outlined,
                  color: AppTheme.primaryGreen,
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        recommendation == 'manual_inspection'
                            ? 'Manual Inspection Required'
                            : recommendation == 'sample_verification'
                                ? 'Sample Verification Sufficient'
                                : 'Review Evidence Needed',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.primaryGreen,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        recommendation == 'manual_inspection'
                            ? 'Mismatch between declared and estimated grade. Schedule a physical inspection.'
                            : recommendation == 'sample_verification'
                                ? 'Declared grade consistent with evidence. Random sample check recommended.'
                                : 'Insufficient evidence. Add more photos and verified weight before verification.',
                        style: TextStyle(
                          fontSize: 11,
                          color: AppTheme.primaryGreen.withValues(alpha: 0.9),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Action Buttons
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _resetForm,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('New Inspection'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.primaryGreen,
                    side: const BorderSide(color: AppTheme.primaryGreen),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () {
                    // TODO: Download/Share report
                    _showToast('Report download coming soon');
                  },
                  icon: const Icon(Icons.download_outlined, size: 18),
                  label: const Text('Download Report'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryGreen,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Widget child;
  final Color? borderColor;

  const _SectionCard({
    required this.title,
    required this.icon,
    required this.child,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: AppTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        side: BorderSide(
          color: borderColor ?? AppTheme.border.withValues(alpha: 0.6),
          width: borderColor != null ? 1.5 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: (borderColor ?? AppTheme.primaryGreen).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 20, color: borderColor ?? AppTheme.primaryGreen),
                ),
                const SizedBox(width: 10),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            child,
          ],
        ),
      ),
    );
  }
}

class _SliderField extends StatelessWidget {
  final String label;
  final double value;
  final double min;
  final double max;
  final int divisions;
  final Color activeColor;
  final ValueChanged<double> onChanged;
  final String helperText;

  const _SliderField({
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.divisions,
    required this.activeColor,
    required this.onChanged,
    required this.helperText,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            Text(
              value.toStringAsFixed(0),
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: activeColor,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            activeTrackColor: activeColor,
            inactiveTrackColor: activeColor.withValues(alpha: 0.15),
            thumbColor: activeColor,
            overlayColor: activeColor.withValues(alpha: 0.2),
            trackHeight: 4,
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 10),
          ),
          child: Slider(
            value: value,
            min: min,
            max: max,
            divisions: divisions,
            onChanged: onChanged,
          ),
        ),
        Text(helperText, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
      ],
    );
  }
}