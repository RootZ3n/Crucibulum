/**
 * Crucible CLI — doctor command
 * crucible doctor
 * Reports provider availability, configuration status, and blockers.
 */
import { getProviderCatalog } from "../../adapters/registry.js";
export async function doctorCommand(_args) {
    console.log("");
    console.log("=".repeat(60));
    console.log("  CRUCIBLE DOCTOR — Provider Status");
    console.log("=".repeat(60));
    console.log("");
    const catalog = await getProviderCatalog();
    // Implemented providers
    console.log("  IMPLEMENTED PROVIDERS");
    console.log("-".repeat(60));
    for (const p of catalog.providers) {
        const status = p.available
            ? "\x1b[32m✓ available\x1b[0m"
            : "\x1b[31m✗ unavailable\x1b[0m";
        console.log(`  ${p.label.padEnd(20)} ${status}`);
        console.log(`    Kind:     ${p.kind}`);
        console.log(`    Adapter:  ${p.adapter}`);
        if (p.envKey) {
            const envSet = process.env[p.envKey] ? "set" : "NOT SET";
            console.log(`    Env:      ${p.envKey} (${envSet})`);
        }
        if (!p.available && p.reason) {
            console.log(`    Reason:   ${p.reason}`);
        }
        if (p.available && p.models.length > 0) {
            console.log(`    Models:   ${p.models.length} discovered`);
        }
        else if (p.available && p.manualModelAllowed) {
            console.log(`    Models:   manual entry (no discovery)`);
        }
        console.log("");
    }
    // Not implemented providers
    const notImpl = catalog.notImplemented;
    if (notImpl.length > 0) {
        console.log("  NOT YET IMPLEMENTED");
        console.log("-".repeat(60));
        for (const p of notImpl) {
            console.log(`  ${p.label.padEnd(20)} \x1b[33m⚠ not implemented\x1b[0m`);
            console.log(`    Blocker:  ${p.blocker}`);
            console.log(`    Env:      ${p.envKey}`);
            console.log("");
        }
    }
    // Summary
    const available = catalog.providers.filter((p) => p.available).length;
    const total = catalog.providers.length;
    console.log("-".repeat(60));
    console.log(`  ${available}/${total} providers available`);
    if (notImpl.length > 0) {
        console.log(`  ${notImpl.length} provider${notImpl.length === 1 ? "" : "s"} not yet implemented`);
    }
    console.log(`  Judge: ${catalog.judge.kind}`);
    console.log("=".repeat(60));
    console.log("");
}
//# sourceMappingURL=doctor.js.map