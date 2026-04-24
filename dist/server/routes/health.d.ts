/**
 * Crucible — Health Routes
 * Health check, adapter status, judge info.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export declare function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleScorers(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleScorersHealth(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAdaptersHealth(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleJudge(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleSuites(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleTasks(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAdapters(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleModels(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleProviders(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleResetAdapterCircuit(_req: IncomingMessage, res: ServerResponse, adapterId: string): Promise<void>;
//# sourceMappingURL=health.d.ts.map