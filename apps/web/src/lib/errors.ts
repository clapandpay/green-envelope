// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Dict } from '../i18n/en';
import { ServiceError, type ServiceErrorCode } from '../services/types';

/** The code of anything a service call threw. */
export function errorCode(error: unknown): ServiceErrorCode {
  return error instanceof ServiceError ? error.code : 'unknown';
}

/** A sentence for an error code, for forms and sheets. */
export function errorText(code: ServiceErrorCode, t: Dict): string {
  switch (code) {
    case 'network':
      return t.errors.network;
    case 'wallet_cancelled':
      return t.errors.cancelled;
    case 'insufficient_funds':
      return t.errors.insufficient;
    case 'invalid_recipient':
      return t.errors.invalidRecipient;
    case 'handle_not_found':
      return t.errors.handleNotFound;
    case 'handle_expired':
      return t.errors.handleExpired;
    case 'handle_not_payable':
      return t.errors.handleNotPayable;
    case 'handles_unavailable':
      return t.errors.handlesUnavailable;
    case 'handles_mainnet_only':
      return t.errors.handlesMainnetOnly;
    default:
      return t.errors.unknown;
  }
}
