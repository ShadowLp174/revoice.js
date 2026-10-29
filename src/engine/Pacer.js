/**
 * @class Pacer
 * @classdesc Consolidated drift-compensated 20ms frame clock.
 * Instead of spawning N separate timers for N concurrent voice channels, a single Pacer
 * instance drives all active AudioPipelines on the thread using `process.hrtime.bigint()`.
 */
class Pacer {
  /**
   * @param {number} [intervalMs=20]
   */
  constructor(intervalMs = 20) {
    this.intervalMs = intervalMs;
    this.intervalNs = BigInt(Math.round(intervalMs * 1_000_000));
    /** @type {Set<{tick: () => void|Promise<void>}>} */
    this.pipelines = new Set();
    this.running = false;
    this.timer = null;
    this.nextTickNs = 0n;
    this.maxCatchUpTicks = 3; // Avoid burst-flooding if event loop stalls
  }

  /**
   * Register an active pipeline to be ticked every 20ms.
   * @param {{tick: () => void|Promise<void>}} pipeline
   */
  add(pipeline) {
    this.pipelines.add(pipeline);
    if (!this.running && this.pipelines.size > 0) {
      this.start();
    }
  }

  /**
   * Unregister a pipeline. Automatically stops the master clock when no pipelines remain.
   * @param {{tick: () => void|Promise<void>}} pipeline
   */
  remove(pipeline) {
    this.pipelines.delete(pipeline);
    if (this.pipelines.size === 0) {
      this.stop();
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextTickNs = process.hrtime.bigint() + this.intervalNs;
    this.#scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  #scheduleNext() {
    if (!this.running) return;

    const nowNs = process.hrtime.bigint();
    let delayNs = this.nextTickNs - nowNs;

    // If we fell behind by more than maxCatchUpTicks, reset clock baseline to prevent burst flooding
    if (delayNs < -this.intervalNs * BigInt(this.maxCatchUpTicks)) {
      this.nextTickNs = nowNs + this.intervalNs;
      delayNs = this.intervalNs;
    }

    const delayMs = delayNs > 0n ? Number(delayNs) / 1_000_000 : 0;

    this.timer = setTimeout(() => {
      if (!this.running) return;
      this.nextTickNs += this.intervalNs;
      this.#runTick();
      this.#scheduleNext();
    }, Math.max(0, Math.floor(delayMs)));

    if (this.timer.unref) {
      // Allow process to exit cleanly if nothing else is active and no pipelines remain
    }
  }

  #runTick() {
    for (const pipeline of this.pipelines) {
      try {
        pipeline.tick();
      } catch (err) {
        if (typeof pipeline.emit === "function") {
          pipeline.emit("error", err);
        }
      }
    }
  }
}

// Shared singleton pacer per thread
Pacer.shared = new Pacer(20);

module.exports = Pacer;
