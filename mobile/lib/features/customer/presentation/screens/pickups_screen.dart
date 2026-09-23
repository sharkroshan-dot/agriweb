import 'package:flutter/material.dart';
import '../widgets/order_type_list.dart';

class PickupsScreen extends StatelessWidget {
  const PickupsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const OrderTypeList(isPickup: true);
  }
}