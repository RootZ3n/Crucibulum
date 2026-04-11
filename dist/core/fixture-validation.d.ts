export interface FixtureValidationIssue {
    scope: "manifest" | "oracle" | "corpus";
    id: string;
    message: string;
}
export declare function listManifestPaths(): string[];
export declare function listOraclePaths(): string[];
export declare function validateRepoManifest(manifest: unknown, pathId?: string): FixtureValidationIssue[];
export declare function validateConversationalManifest(manifest: unknown, pathId?: string): FixtureValidationIssue[];
export declare function validateOracle(oracle: unknown, pathId?: string): FixtureValidationIssue[];
export declare function validateFixtureCorpus(): FixtureValidationIssue[];
//# sourceMappingURL=fixture-validation.d.ts.map