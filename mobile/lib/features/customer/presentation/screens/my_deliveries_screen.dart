import 'package:flutter/material.dart';
import '../widgets/order_type_list.dart';

class MyDeliveriesScreen extends StatelessWidget {
  const MyDeliveriesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const OrderTypeList(isPickup: false);
  }
}