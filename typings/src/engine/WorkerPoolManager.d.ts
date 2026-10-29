/// <reference types="node" />
export = WorkerPoolManager;
/**
 * @class WorkerPoolManager
 * @classdesc Manages a pool of AudioWorker threads for offloading audio demuxing, RingBuffer management,
 * multi-stream mixing, and DSP processing across concurrent voice channels.
 * Uses least-connections load balancing and automatic worker crash recovery.
 */
declare class WorkerPoolManager {
    /**
     * @param {Object} [options={}]
     * @param {number} [options.poolSize] Defaults to Math.max(1, Math.min(4, os.availableParallelism() - 1))
     */
    constructor(options?: {
        poolSize?: number;
    });
    poolSize: number;
    /** @type {Array<{id: number, worker: Worker, pipelines: Set<string>}>} */
    workers: {
        id: number;
        worker: Worker;
        pipelines: Set<string>;
    }[];
    /** @type {Map<string, {workerEntry: Object, onEvent: Function}>} */
    pipelineRoutes: Map<string, {
        workerEntry: any;
        onEvent: Function;
    }>;
    initialized: boolean;
    init(): void;
    /**
     * Register a pipeline on the least-loaded worker thread.
     * @param {string} pipelineId
     * @param {Object} options
     * @param {SharedArrayBuffer} sharedStateBuffer
     * @param {(event: string, data: any) => void} onEvent
     */
    createPipeline(pipelineId: string, options: any, sharedStateBuffer: SharedArrayBuffer, onEvent: (event: string, data: any) => void): void;
    /**
     * Send a command message to the worker hosting `pipelineId`.
     * @param {string} pipelineId
     * @param {Object} payload
     * @param {Array<ArrayBuffer>} [transferList]
     */
    post(pipelineId: string, payload: any, transferList?: Array<ArrayBuffer>): void;
    /**
     * Destroy a pipeline and remove its routing entry.
     * @param {string} pipelineId
     */
    destroyPipeline(pipelineId: string): void;
    /**
     * Gracefully terminate all worker threads in the pool.
     */
    shutdown(): Promise<void>;
    #private;
}
declare namespace WorkerPoolManager {
    const shared: WorkerPoolManager;
}
import { Worker } from "worker_threads";
//# sourceMappingURL=WorkerPoolManager.d.ts.map