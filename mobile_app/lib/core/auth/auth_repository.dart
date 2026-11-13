import 'package:dio/dio.dart';

import '../network/api_client.dart';
import '../storage/token_store.dart';

class SessionCheck {
  const SessionCheck({
    required this.hasToken,
    required this.authenticated,
    required this.offline,
  });
  final bool hasToken;
  final bool authenticated;
  final bool offline;
}

class AuthRepository {
  AuthRepository(this._api, this._tokens);
  final ApiClient _api;
  final TokenStore _tokens;

  Future<void> login(String password) async {
    if (!_api.isConfigured) {
      throw const ApiFailure('Set the planner API URL before signing in.');
    }
    try {
      final response = await _api.dio.post<Map<String, dynamic>>(
        '/api/login',
        data: {'password': password.trim()},
      );
      final token = response.data?['token']?.toString();
      if (token == null || token.isEmpty) {
        throw const ApiFailure('The server did not return a session token.');
      }
      await _tokens.write(token);
    } catch (error) {
      throw apiFailureFrom(error);
    }
  }

  Future<SessionCheck> checkSession() async {
    final token = await _tokens.read();
    if (token == null || token.isEmpty) {
      return const SessionCheck(
        hasToken: false,
        authenticated: false,
        offline: false,
      );
    }
    if (!_api.isConfigured) {
      return const SessionCheck(
        hasToken: true,
        authenticated: true,
        offline: true,
      );
    }
    try {
      final response = await _api.dio.get<Map<String, dynamic>>(
        '/api/auth/verify',
      );
      final authenticated = response.data?['authenticated'] == true;
      if (!authenticated) await _tokens.clear();
      return SessionCheck(
        hasToken: true,
        authenticated: authenticated,
        offline: false,
      );
    } on DioException catch (error) {
      if (error.response?.statusCode == 401) {
        await _tokens.clear();
        return const SessionCheck(
          hasToken: false,
          authenticated: false,
          offline: false,
        );
      }
      // Match the web app: a stored session still unlocks the local planner when the server is unreachable.
      return const SessionCheck(
        hasToken: true,
        authenticated: true,
        offline: true,
      );
    } catch (_) {
      return const SessionCheck(
        hasToken: true,
        authenticated: true,
        offline: true,
      );
    }
  }

  Future<void> logout() async {
    try {
      if (_api.isConfigured) await _api.dio.post<void>('/api/logout');
    } catch (_) {
      // Local sign-out still succeeds when the backend is offline.
    } finally {
      await _tokens.clear();
    }
  }
}
