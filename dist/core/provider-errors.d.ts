import type { StructuredProviderError, ProviderErrorKind, ProviderErrorOrigin } from "../types/provider-error.js";
interface ProviderErrorContext {
    provider?: string | null;
    adapter?: string | null;
    attempt?: number | null;
    durationMs?: number | null;
    requestId?: string | null;
    origin?: ProviderErrorOrigin | null;
}
interface ProviderFailureErrorOptions extends ProviderErrorContext {
    kind: ProviderErrorKind;
    origin: ProviderErrorOrigin;
    statusCode?: number | null;
    retryable?: boolean;
    rawMessage: string;
    rawCode?: string | null;
    cause?: string | null;
}
export declare class ProviderFailureError extends Error {
    readonly structured: StructuredProviderError;
    constructor(options: ProviderFailureErrorOptions);
}
export declare function makeHttpProviderError(response: Response, rawBody: string, context: ProviderErrorContext, fallbackMessage?: string): ProviderFailureError;
export declare function makeProviderFailureError(options: ProviderFailureErrorOptions): ProviderFailureError;
export declare function makeEmptyResponseError(context: ProviderErrorContext, rawMessage: string): ProviderFailureError;
export declare function makeInvalidResponseError(context: ProviderErrorContext, rawMessage: string): ProviderFailureError;
export declare function makeProcessProviderError(context: ProviderErrorContext, rawMessage: string, rawCode?: string | null): ProviderFailureError;
export declare function getStructuredProviderError(error: unknown): StructuredProviderError | null;
export declare function normalizeProviderError(error: unknown, context: ProviderErrorContext): StructuredProviderError;
/**
 * Operator-facing failure text that preserves both the error bucket ("Invalid
 * provider payload") AND the detailed rawMessage ("MiniMax error 2049: invalid
 * api key (base=…)"). The UI previously displayed only the summary bucket,
 * which was actively misleading — an operator seeing "Invalid provider
 * payload" on every run had no way to know whether it was a bad API key, a
 * wrong model id, or a regional endpoint mismatch. Use this anywhere the raw
 * message adds information the summary doesn't.
 */
export declare function providerErrorDetail(error: StructuredProviderError): string;
export declare function providerErrorSummary(error: StructuredProviderError): string;
export {};
//# sourceMappingURL=provider-errors.d.ts.map