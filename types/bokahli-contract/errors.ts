/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from Bokahli `packages/contracts/src/errors.ts` at published commit
 * 9ed481bed93e0a2b936c489649ed3244b69744ec. Regenerate with:
 *
 *   node scripts/sync-bokahli-contract.mjs --sync
 *
 * Edits here are erased on the next sync and, worse, would make Luak's idea of
 * the contract diverge from the deployment it is measuring.
 */
/** Wire-level error envelope. Never leaks filesystem paths or backend internals. */
export interface BokahliError {
  readonly error: {
    readonly code: BokahliErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
}

export type BokahliErrorCode =
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL';

export function bokahliError(
  code: BokahliErrorCode,
  message: string,
  requestId: string,
): BokahliError {
  return { error: { code, message, requestId } };
}

export const ERROR_STATUS: Record<BokahliErrorCode, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
};
