export = Pacer;
/**
 * @class Pacer
 * @classdesc Consolidated drift-compensated 20ms frame clock.
 * Instead of spawning N separate timers for N concurrent voice channels, a single Pacer
 * instance drives all active AudioPipelines on the thread using `process.hrtime.bigint()`.
 */
declare class Pacer {
    /**
     * @param {number} [intervalMs=20]
     */
    constructor(intervalMs?: number);
    intervalMs: number;
    intervalNs: bigint;
    /** @type {Set<{tick: () => void|Promise<void>}>} */
    pipelines: Set<{
        tick: () => void | Promise<void>;
    }>;
    running: boolean;
    timer: NodeJS.Timeout;
    nextTickNs: bigint;
    maxCatchUpTicks: number;
    /**
     * Register an active pipeline to be ticked every 20ms.
     * @param {{tick: () => void|Promise<void>}} pipeline
     */
    add(pipeline: {
        tick: () => void | Promise<void>;
    }): void;
    /**
     * Unregister a pipeline. Automatically stops the master clock when no pipelines remain.
     * @param {{tick: () => void|Promise<void>}} pipeline
     */
    remove(pipeline: {
        tick: () => void | Promise<void>;
    }): void;
    start(): void;
    stop(): void;
    #private;
}
declare namespace Pacer {
    const shared: Pacer;
}
//# sourceMappingURL=Pacer.d.ts.map