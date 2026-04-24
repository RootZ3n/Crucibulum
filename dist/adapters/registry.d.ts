import type { AdapterConfig, CrucibulumAdapter } from "./base.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../core/judge.js";
import { type CircuitState } from "../core/circuit-breaker.js";
export type AdapterRuntimeKind = "local" | "cloud" | "subprocess";
export interface ProviderCatalogEntry {
    id: string;
    label: string;
    kind: AdapterRuntimeKind;
    available: boolean;
    reason: string | null;
    adapter: string;
    manualModelAllowed: boolean;
    models: Array<{
        id: string;
        label: string;
        available: boolean;
    }>;
    envKey: string | null;
}
export interface NotImplementedProvider {
    id: string;
    label: string;
    kind: AdapterRuntimeKind;
    implemented: false;
    blocker: string;
    envKey: string;
}
export interface AdapterProviderOption {
    id: string;
    name: string;
    kind: AdapterRuntimeKind;
    configurable: boolean;
}
export interface AdapterModelOption {
    id: string;
    name: string;
    provider: string;
    kind: AdapterRuntimeKind;
    available: boolean;
    reason: string | null;
    metadata?: Record<string, unknown> | undefined;
}
export interface AdapterCatalogEntry {
    id: string;
    name: string;
    kind: AdapterRuntimeKind;
    provider_mode: "fixed" | "configurable";
    fixed_provider: string | null;
    available: boolean;
    reason: string | null;
    supports_tool_calls: boolean;
    supports_chat: boolean;
    supports_custom_model: boolean;
    provider_options: AdapterProviderOption[];
    models: AdapterModelOption[];
    judge: typeof DETERMINISTIC_JUDGE_METADATA;
    /** Circuit breaker snapshot — degraded providers surface state:"open" here. */
    circuit: {
        state: CircuitState;
        failures: number;
        lastFailureAt: number | null;
    };
}
export interface RegistryDefinition {
    id: string;
    name: string;
    kind: AdapterRuntimeKind;
    provider_mode: "fixed" | "configurable";
    fixed_provider: string | null;
    supports_custom_model: boolean;
    create(): CrucibulumAdapter;
    provider_options: AdapterProviderOption[];
    listModels(): Promise<AdapterModelOption[]>;
    makeConfig(input: {
        model: string;
        provider?: string | null;
    }): AdapterConfig;
}
export declare function listRegisteredAdapters(): RegistryDefinition[];
export declare function resolveAdapter(adapterId: string): RegistryDefinition;
export declare function getAdapterCatalog(): Promise<AdapterCatalogEntry[]>;
export declare function listFlattenedModels(): Promise<Array<AdapterModelOption & {
    adapter: string;
    adapter_name: string;
    supports_chat: boolean;
}>>;
export declare function instantiateAdapterForRun(input: {
    adapter: string;
    model: string;
    provider?: string | null;
}): Promise<{
    adapter: CrucibulumAdapter;
    config: AdapterConfig;
    registry: RegistryDefinition;
}>;
export declare function getNotImplementedProviders(): NotImplementedProvider[];
export declare function getProviderCatalog(): Promise<{
    providers: ProviderCatalogEntry[];
    notImplemented: NotImplementedProvider[];
    judge: typeof DETERMINISTIC_JUDGE_METADATA;
}>;
//# sourceMappingURL=registry.d.ts.map