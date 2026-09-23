import 'api_service.dart';

class WithdrawalBankAccount {
  final String? accountHolder;
  final String? accountNumber;
  final String? ifsc;
  final String? bankName;
  final String? upiId;

  const WithdrawalBankAccount({
    this.accountHolder,
    this.accountNumber,
    this.ifsc,
    this.bankName,
    this.upiId,
  });

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{
      if (upiId != null && upiId!.trim().isNotEmpty) 'upiId': upiId!.trim(),
      if (accountHolder != null && accountHolder!.trim().isNotEmpty) 'accountHolder': accountHolder!.trim(),
      if (accountNumber != null && accountNumber!.trim().isNotEmpty) 'accountNumber': accountNumber!.trim(),
      if (ifsc != null && ifsc!.trim().isNotEmpty) 'ifsc': ifsc!.trim().toUpperCase(),
      if (bankName != null && bankName!.trim().isNotEmpty) 'bankName': bankName!.trim(),
    };
    return json;
  }

  bool get isValid =>
      (upiId != null && upiId!.trim().contains('@')) ||
      ((accountHolder?.trim().isNotEmpty ?? false) &&
          (accountNumber?.trim().isNotEmpty ?? false) &&
          (ifsc?.trim().isNotEmpty ?? false));
}

class PaymentService {
  static const double minWithdrawalAmount = 100;

  static Future<Map<String, dynamic>> getWalletInfo() async {
    return (await ApiService.get('/payments/wallet/info')) as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> getWithdrawals({
    int page = 1,
    int limit = 20,
  }) async {
    return (await ApiService.get('/payments/wallet/withdrawals', params: {
      'page': '$page',
      'limit': '$limit',
    })) as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> withdraw({
    required double amount,
    required WithdrawalBankAccount bankAccount,
  }) async {
    return (await ApiService.post('/payments/wallet/withdraw', body: {
      'amount': amount,
      'bankAccount': bankAccount.toJson(),
    })) as Map<String, dynamic>;
  }
}
