/**
 * Domain error codes — prefixed with `BOMBOLI_` for namespacing.
 */
export const ErrorCodes = {
  // Generic
  Unknown: 'BOMBOLI_UNKNOWN',
  ValidationFailed: 'BOMBOLI_VALIDATION_FAILED',
  Unauthorized: 'BOMBOLI_UNAUTHORIZED',
  Forbidden: 'BOMBOLI_FORBIDDEN',
  NotFound: 'BOMBOLI_NOT_FOUND',
  Conflict: 'BOMBOLI_CONFLICT',
  RateLimited: 'BOMBOLI_RATE_LIMITED',

  // Auth
  InvalidToken: 'BOMBOLI_INVALID_TOKEN',
  ExpiredToken: 'BOMBOLI_EXPIRED_TOKEN',
  InvalidCredentials: 'BOMBOLI_INVALID_CREDENTIALS',
  EmailTaken: 'BOMBOLI_EMAIL_TAKEN',
  EmailNotVerified: 'BOMBOLI_EMAIL_NOT_VERIFIED',
  InvalidOtp: 'BOMBOLI_INVALID_OTP',
  PasswordTooWeak: 'BOMBOLI_PASSWORD_TOO_WEAK',
  AuthProviderError: 'BOMBOLI_AUTH_PROVIDER_ERROR',

  // Cart / orders
  CartSellerConflict: 'BOMBOLI_CART_SELLER_CONFLICT',
  OutOfStock: 'BOMBOLI_OUT_OF_STOCK',
  InvalidOrderTransition: 'BOMBOLI_INVALID_ORDER_TRANSITION',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
