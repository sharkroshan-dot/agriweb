import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// Horizontally scrolling set of selectable filter chips. Mirrors the chip
/// styling used by marketplace and order-list filters.
class FilterChipBar extends StatelessWidget {
  final List<String> options;
  final String? selected;
  final ValueChanged<String> onSelected;
  final EdgeInsetsGeometry padding;

  const FilterChipBar({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: padding,
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final option = options[i];
          final isSelected = option == selected;
          return ChoiceChip(
            label: Text(option),
            selected: isSelected,
            showCheckmark: false,
            onSelected: (_) => onSelected(option),
            labelStyle: TextStyle(
              fontSize: 13,
              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              color: isSelected ? Colors.white : AppTheme.textSecondary,
            ),
            selectedColor: AppTheme.primaryGreen,
            backgroundColor: AppTheme.surface,
            side: BorderSide(
              color: isSelected ? AppTheme.primaryGreen : AppTheme.border,
              width: isSelected ? 1.4 : 1,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(50),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          );
        },
      ),
    );
  }
}