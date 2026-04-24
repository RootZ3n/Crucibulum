import "dotenv/config";
/**
 * Crucible — API server entrypoint
 *
 * This file only bootstraps the server. All routing logic lives in app.ts so
 * tests can import createApp() without binding a port.
 */
import { log } from "../utils/logger.js";
import { startServer } from "./app.js";
startServer().catch((err) => {
    log("error", "api", `Server failed to start: ${String(err)}`);
    process.exitCode = 1;
});
//# sourceMappingURL=api.js.map