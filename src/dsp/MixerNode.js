const RingBuffer = require("../engine/RingBuffer.js");

/**
 * @class MixerNode
 * @classdesc In-memory multi-stream PCM audio mixer.
 * Supports mixing multiple secondary/overlay streams (e.g. soundboard clips, TTS, alerts)
 * onto the primary audio stream with optional primary-track ducking.
 */
class MixerNode {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.frameSamples=1920] 960 stereo samples = 1920 Int16 values per 20ms
   * @param {number} [options.duckingGain=0.5] Gain applied to primary stream when an overlay with `duckPrimary=true` is active
   */
  constructor(options = {}) {
    this.frameSamples = options.frameSamples || 1920;
    this.defaultDuckingGain = options.duckingGain ?? 0.5;
    /** @type {Map<string, {id: string, buffer: RingBuffer, volume: number, duckPrimary: boolean, eof: boolean, onFinish?: Function}>} */
    this.overlays = new Map();
    this._scratchInt16 = new Int16Array(this.frameSamples);
    this._currentDuckGain = 1.0;
  }

  /**
   * Create and register a new overlay stream slot.
   * @param {string} id
   * @param {Object} [opts={}]
   * @param {number} [opts.volume=1.0]
   * @param {boolean} [opts.duckPrimary=false]
   * @param {number} [opts.capacityBytes=192000]
   * @param {Function} [opts.onHighWaterMark]
   * @param {Function} [opts.onLowWaterMark]
   * @param {Function} [opts.onFinish]
   * @returns {RingBuffer}
   */
  createOverlay(id, opts = {}) {
    const ring = new RingBuffer(opts.capacityBytes || 192000, {
      onHighWaterMark: opts.onHighWaterMark,
      onLowWaterMark: opts.onLowWaterMark,
    });
    this.overlays.set(id, {
      id,
      buffer: ring,
      volume: opts.volume ?? 1.0,
      duckPrimary: !!opts.duckPrimary,
      eof: false,
      onFinish: opts.onFinish || null,
    });
    return ring;
  }

  /**
   * Mark an overlay stream as having reached end-of-stream (it will be removed once its RingBuffer drains).
   * @param {string} id
   */
  markOverlayEof(id) {
    const slot = this.overlays.get(id);
    if (slot) {
      slot.eof = true;
      if (slot.buffer.availableRead === 0) {
        this.removeOverlay(id);
      }
    }
  }

  /**
   * Remove an overlay stream immediately.
   * @param {string} id
   */
  removeOverlay(id) {
    const slot = this.overlays.get(id);
    if (!slot) return;
    this.overlays.delete(id);
    if (slot.onFinish) {
      try {
        slot.onFinish();
      } catch (_) {}
    }
  }

  /**
   * Clear all active overlays.
   */
  clear() {
    for (const id of this.overlays.keys()) {
      this.removeOverlay(id);
    }
    this._currentDuckGain = 1.0;
  }

  /**
   * Whether any overlay stream currently has buffered audio to play.
   * @returns {boolean}
   */
  hasActiveOverlays() {
    for (const slot of this.overlays.values()) {
      if (slot.buffer.availableRead > 0) return true;
    }
    return false;
  }

  /**
   * Mix active overlay streams into `primaryFloat32` (`[-1.0, 1.0]`).
   * @param {Float32Array} primaryFloat32
   */
  process(primaryFloat32) {
    if (this.overlays.size === 0) return;

    const len = primaryFloat32.length;
    let shouldDuck = false;

    for (const slot of this.overlays.values()) {
      if (slot.buffer.availableRead > 0 && slot.duckPrimary) {
        shouldDuck = true;
        break;
      }
    }

    const targetDuck = shouldDuck ? this.defaultDuckingGain : 1.0;
    if (Math.abs(targetDuck - this._currentDuckGain) > 1e-4 || targetDuck < 1.0) {
      const step = (targetDuck - this._currentDuckGain) / len;
      let g = this._currentDuckGain;
      for (let i = 0; i < len; i++) {
        g += step;
        primaryFloat32[i] *= g;
      }
      this._currentDuckGain = targetDuck;
    }

    const scratch = this._scratchInt16;
    const invInt16 = 1 / 32768;

    for (const [id, slot] of this.overlays.entries()) {
      if (slot.buffer.availableRead === 0) {
        if (slot.eof) {
          this.removeOverlay(id);
        }
        continue;
      }

      const samplesRead = slot.buffer.readFrameInt16(scratch, true);
      if (samplesRead > 0) {
        const vol = slot.volume;
        for (let i = 0; i < len; i++) {
          primaryFloat32[i] += scratch[i] * invInt16 * vol;
        }
      }

      if (slot.eof && slot.buffer.availableRead === 0) {
        this.removeOverlay(id);
      }
    }
  }
}

module.exports = MixerNode;
