export type ProviderErrorKind =
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "NETWORK"
  | "CONNECTION_RESET"
  | "DNS"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "EMPTY_RESPONSE"
  | "INVALID_RESPONSE"
  | "AUTH"
  | "UNAVAILABLE"
  | "PROCESS_ERROR"
  | "CANCELLED"
  | "UNKNOWN";

export type ProviderErrorOrigin =
  | "PROVIDER"
  | "NETWORK"
  | "LOCAL_RUNTIME"
  | "ADAPTER";

export interface StructuredProviderError {
  kind: ProviderErrorKind;
  origin: ProviderErrorOrigin;
  provider: string | null;
  adapter: string | null;
  statusCode: number | null;
  retryable: boolean;
  rawMessage: string;
  rawCode: string | null;
  cause: string | null;
  attempt: number | null;
  durationMs: number | null;
  requestId: string | null;
}
