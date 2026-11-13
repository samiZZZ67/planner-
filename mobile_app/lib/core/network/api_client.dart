import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../storage/token_store.dart';

class ApiClient {
  ApiClient({required TokenStore tokenStore, String? baseUrl})
    : _tokenStore = tokenStore,
      dio = Dio(
        BaseOptions(
          baseUrl: _validBase(baseUrl)
              ? _normalizeBase(baseUrl!)
              : 'https://invalid.invalid',
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 45),
          sendTimeout: const Duration(seconds: 45),
          headers: const {'Accept': 'application/json'},
        ),
      ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokenStore.read();
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          if (error.response?.statusCode == 401) {
            await _tokenStore.clear();
            final callback = onUnauthorized;
            if (callback != null) await callback();
          }
          handler.next(error);
        },
      ),
    );
  }

  final TokenStore _tokenStore;
  final Dio dio;
  bool _configured = false;
  Future<void> Function()? onUnauthorized;

  static bool _validBase(String? value) =>
      value != null && Uri.tryParse(value.trim())?.hasAuthority == true;
  static String _normalizeBase(String value) =>
      value.trim().replaceAll(RegExp(r'/+$'), '');

  void configureBaseUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null ||
        !uri.hasAuthority ||
        !(uri.scheme == 'https' || uri.scheme == 'http')) {
      throw const FormatException(
        'Enter a complete API URL, such as https://planner.example.com.',
      );
    }
    if (kReleaseMode && uri.scheme != 'https') {
      throw const FormatException(
        'Release builds require an HTTPS planner API URL.',
      );
    }
    dio.options.baseUrl = _normalizeBase(value);
    _configured = true;
  }

  bool get isConfigured =>
      _configured || dio.options.baseUrl != 'https://invalid.invalid';
}

class ApiFailure implements Exception {
  const ApiFailure(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() => message;
}

ApiFailure apiFailureFrom(Object error) {
  if (error is DioException) {
    final response = error.response;
    final payload = response?.data;
    final message = payload is Map ? payload['error']?.toString() : null;
    return ApiFailure(
      message ??
          (error.type == DioExceptionType.connectionTimeout ||
                  error.type == DioExceptionType.receiveTimeout
              ? 'The server took too long to respond. Try again when the connection is stable.'
              : error.type == DioExceptionType.connectionError
              ? 'Could not reach the server. Check your connection and API URL.'
              : 'The request failed. Please try again.'),
      statusCode: response?.statusCode,
      code: payload is Map ? payload['code']?.toString() : null,
    );
  }
  return ApiFailure(error.toString());
}
