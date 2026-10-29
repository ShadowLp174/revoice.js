const { Worker } = require("worker_threads");
const os = require("os");
const path = require("path");

/**
 * @class WorkerPoolManager
 * @classdesc Manages a pool of AudioWorker threads for offloading audio demuxing, RingBuffer management,
 * multi-stream mixing, and DSP processing across concurrent voice channels.
 * Uses least-connections load balancing and automatic worker crash recovery.
 */
class WorkerPoolManager {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.poolSize] Defaults to Math.max(1, Math.min(4, os.availableParallelism() - 1))
   */
  constructor(options = {}) {
    const defaultSize = Math.max(
      1,
      Math.min(4, (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length) - 1)
    );
    this.poolSize = options.poolSize || defaultSize;
    /** @type {Array<{id: number, worker: Worker, pipelines: Set<string>}>} */
    this.workers = [];
    /** @type {Map<string, {workerEntry: Object, onEvent: Function}>} */
    this.pipelineRoutes = new Map();
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    for (let i = 0; i < this.poolSize; i++) {
      this.#spawnWorker(i);
    }
  }

  #spawnWorker(id) {
    const workerPath = path.join(__dirname, "AudioWorker.js");
    const worker = new Worker(workerPath);
    if (worker.unref) {
      worker.unref();
    }

    const entry = {
      id,
      worker,
      pipelines: new Set(),
    };

    worker.on("message", (msg) => {
      if (!msg || msg.type !== "event") return;
      const route = this.pipelineRoutes.get(msg.pipelineId);
      if (route && route.onEvent) {
        route.onEvent(msg.event, msg.data);
      }
    });

    worker.on("error", (err) => {
      for (const pid of entry.pipelines) {
        const route = this.pipelineRoutes.get(pid);
        if (route && route.onEvent) {
          route.onEvent("error", { message: err.message });
        }
      }
    });

    worker.on("exit", (code) => {
      const idx = this.workers.indexOf(entry);
      if (idx !== -1) {
        this.workers.splice(idx, 1);
      }
      if (code !== 0 && this.initialized) {
        this.#spawnWorker(id);
      }
    });

    this.workers.push(entry);
    return entry;
  }

  /**
   * Pick the worker currently handling the fewest voice channels.
   */
  #selectWorker() {
    if (!this.initialized || this.workers.length === 0) {
      this.init();
    }
    let best = this.workers[0];
    for (let i = 1; i < this.workers.length; i++) {
      if (this.workers[i].pipelines.size < best.pipelines.size) {
        best = this.workers[i];
      }
    }
    return best;
  }

  /**
   * Register a pipeline on the least-loaded worker thread.
   * @param {string} pipelineId
   * @param {Object} options
   * @param {SharedArrayBuffer} sharedStateBuffer
   * @param {(event: string, data: any) => void} onEvent
   */
  createPipeline(pipelineId, options, sharedStateBuffer, onEvent) {
    const workerEntry = this.#selectWorker();
    workerEntry.pipelines.add(pipelineId);
    this.pipelineRoutes.set(pipelineId, { workerEntry, onEvent });

    workerEntry.worker.postMessage({
      type: "create",
      pipelineId,
      options,
      sharedStateBuffer,
    });
  }

  /**
   * Send a command message to the worker hosting `pipelineId`.
   * @param {string} pipelineId
   * @param {Object} payload
   * @param {Array<ArrayBuffer>} [transferList]
   */
  post(pipelineId, payload, transferList = []) {
    const route = this.pipelineRoutes.get(pipelineId);
    if (!route) return;
    route.workerEntry.worker.postMessage(
      {
        ...payload,
        pipelineId,
      },
      transferList
    );
  }

  /**
   * Destroy a pipeline and remove its routing entry.
   * @param {string} pipelineId
   */
  destroyPipeline(pipelineId) {
    const route = this.pipelineRoutes.get(pipelineId);
    if (!route) return;
    route.workerEntry.pipelines.delete(pipelineId);
    this.pipelineRoutes.delete(pipelineId);
    try {
      route.workerEntry.worker.postMessage({
        type: "destroy",
        pipelineId,
      });
    } catch (_) {}
  }

  /**
   * Gracefully terminate all worker threads in the pool.
   */
  async shutdown() {
    this.initialized = false;
    this.pipelineRoutes.clear();
    const workers = this.workers.splice(0, this.workers.length);
    await Promise.allSettled(workers.map((w) => w.worker.terminate()));
  }
}

WorkerPoolManager.shared = new WorkerPoolManager();

module.exports = WorkerPoolManager;
