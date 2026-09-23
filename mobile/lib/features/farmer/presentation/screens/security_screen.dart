import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/services/api_service.dart';
import '../../../../core/utils/helpers.dart';

class FarmerSecurityScreen extends StatefulWidget {
  const FarmerSecurityScreen({super.key});
  @override
  State<FarmerSecurityScreen> createState() => _FarmerSecurityScreenState();
}

class _FarmerSecurityScreenState extends State<FarmerSecurityScreen> {
  bool _isLoading = true;
  Map<String, dynamic> _data = {};
  final _totpController = TextEditingController();
  bool _enablingMfa = false;
  bool _revoking = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _totpController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ApiService.get('/auth/security-center');
      if (!mounted) return;
      setState(() => _data = res['data'] as Map<String, dynamic>? ?? res as Map<String, dynamic>? ?? {});
    } catch (_) {
      if (mounted) setState(() => _data = {});
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _enableMfa() async {
    final code = _totpController.text.trim();
    if (code.length != 6) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Enter a 6-digit code'),
        backgroundColor: AppTheme.error,
      ));
      return;
    }
    setState(() => _enablingMfa = true);
    try {
      await ApiService.post('/auth/2fa/enable', body: {'code': code});
      if (!mounted) return;
      _totpController.clear();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Two-factor authentication enabled'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _enablingMfa = false);
    }
  }

  Future<void> _revokeAll() async {
    setState(() => _revoking = true);
    try {
      await ApiService.post('/auth/sessions/revoke-all');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Other sessions revoked'),
        backgroundColor: AppTheme.success,
      ));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppTheme.error));
    } finally {
      if (mounted) setState(() => _revoking = false);
    }
  }

  String _riskLevel() => (_data['riskLevel'] as String? ?? 'low').toLowerCase();

  Color _riskColor() {
    switch (_riskLevel()) {
      case 'high': return AppTheme.error;
      case 'medium': return AppTheme.accent;
      default: return AppTheme.success;
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessions = (_data['sessions'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    final activeSessions = (_data['activeSessions'] as num?)?.toInt() ?? sessions.length;
    final verification = _data['verification'] is Map ? _data['verification'] as Map<String, dynamic> : {};
    final verified = verification.values.whereType<bool>().where((v) => v).length;
    final riskFlags = (_data['riskFlags'] as List<dynamic>? ?? []).whereType<String>().toList();
    final mfaEnabled = _data['mfaEnabled'] as bool? ?? false;

    return Scaffold(
      appBar: AppBar(title: const Text('Security Center')),
      body: _isLoading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _card(
                  title: 'Account Security',
                  subtitle: 'Risk posture, 2FA and account activity.',
                  child: Column(
                    children: [
                      _rowBetween(
                        'Risk score',
                        Row(mainAxisSize: MainAxisSize.min, children: [
                          Text('${_data['riskScore'] ?? 0}/100', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(color: _riskColor().withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                            child: Text(_riskLevel().toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: _riskColor())),
                          ),
                        ]),
                      ),
                      const SizedBox(height: 12),
                      if (riskFlags.isNotEmpty)
                        ...riskFlags.map((f) => Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(children: [
                            const Icon(Icons.warning_amber_rounded, size: 16, color: AppTheme.error),
                            const SizedBox(width: 8),
                            Expanded(child: Text(f.replaceAll('_', ' '), style: const TextStyle(fontSize: 13, color: AppTheme.error))),
                          ]),
                        ))
                      else
                        const Row(children: [
                          Icon(Icons.shield_outlined, size: 16, color: AppTheme.success),
                          SizedBox(width: 8),
                          Text('No risk flags', style: TextStyle(fontSize: 13, color: AppTheme.success)),
                        ]),
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Column(
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Row(children: [
                                  Icon(Icons.key_outlined, size: 16, color: AppTheme.textSecondary),
                                  SizedBox(width: 8),
                                  Text('Two-factor authentication', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                                ]),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: (mfaEnabled ? AppTheme.success : AppTheme.textSecondary).withValues(alpha: 0.1),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Text(mfaEnabled ? 'On' : 'Off', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: mfaEnabled ? AppTheme.success : AppTheme.textSecondary)),
                                ),
                              ],
                            ),
                            if (!mfaEnabled) ...[
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _totpController,
                                      keyboardType: TextInputType.number,
                                      maxLength: 6,
                                      decoration: const InputDecoration(
                                        hintText: '6-digit code',
                                        counterText: '',
                                        contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  ElevatedButton(
                                    onPressed: _enablingMfa ? null : _enableMfa,
                                    style: ElevatedButton.styleFrom(minimumSize: const Size(0, 44)),
                                    child: _enablingMfa
                                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                      : const Text('Enable 2FA'),
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _card(
                  title: 'Active Sessions',
                  subtitle: '$activeSessions device(s) currently signed in.',
                  child: Column(
                    children: [
                      if (sessions.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Text('No session details available', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                        )
                      else
                        ...sessions.map((s) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Row(children: [
                            const Icon(Icons.smartphone, size: 16, color: AppTheme.textSecondary),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(s['device'] as String? ?? 'Device', style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
                                  Text(
                                    '${s['ip'] ?? 'Unknown IP'} · last seen ${s['lastSeenAt'] != null ? shortDate(s['lastSeenAt']) : 'recently'}',
                                    style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                                  ),
                                ],
                              ),
                            ),
                          ]),
                        )),
                      if (activeSessions > 1)
                        OutlinedButton.icon(
                          onPressed: _revoking ? null : _revokeAll,
                          icon: _revoking
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.logout, size: 16),
                          label: const Text('Sign out other devices'),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _card(
                  title: 'Verification & Trust',
                  child: Row(
                    children: [
                      Expanded(child: _statBox('${_data['trustScore'] ?? 0}/100', 'Trust score', AppTheme.success)),
                      const SizedBox(width: 10),
                      Expanded(child: _statBox('$verified/${verification.length}', 'Verifications', AppTheme.primaryGreen)),
                      const SizedBox(width: 10),
                      Expanded(child: _statBox('$activeSessions', 'Active sessions', const Color(0xFF3B82F6))),
                    ],
                  ),
                ),
              ],
            ),
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

  Widget _rowBetween(String label, Widget trailing) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
        trailing,
      ],
    );
  }

  Widget _statBox(String value, String label, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        children: [
          Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color)),
          const SizedBox(height: 2),
          Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
}