/**
 * @class VolumeNode
 * @classdesc High-performance volume scaling with smooth per-sample linear ramping
 * to prevent clicks and pops during volume changes, pauses, and resumes.
 */
class VolumeNode {
  /**
   * @param {number} [initialVolume=1.0]
   */
  constructor(initialVolume = 1.0) {
    this.targetVolume = Math.max(0, initialVolume);
    this.currentVolume = this.targetVolume;
    this.enabled = true;
  }

  /**
   * Set target volume (1.0 = 100%, 0.5 = 50%, etc.)
   * @param {number} v
   * @param {boolean} [immediate=false]
   */
  setVolume(v, immediate = false) {
    const clamped = Math.max(0, Number.isFinite(v) ? v : 1.0);
    this.targetVolume = clamped;
    if (immediate) {
      this.currentVolume = clamped;
    }
  }

  /**
   * Process Float32 samples in-place (`[-1.0, 1.0]`).
   * @param {Float32Array} samples
   */
  process(samples) {
    if (!this.enabled) return;

    const target = this.targetVolume;
    let current = this.currentVolume;
    const len = samples.length;

    if (Math.abs(target - current) < 1e-5) {
      this.currentVolume = target;
      if (Math.abs(target - 1.0) < 1e-5) return; // Unity gain fast-path
      if (target === 0) {
        samples.fill(0);
        return;
      }
      for (let i = 0; i < len; i++) {
        samples[i] *= target;
      }
      return;
    }

    // Smoothly ramp gain across the 20ms frame to eliminate clicks/zipper noise
    const step = (target - current) / len;
    for (let i = 0; i < len; i++) {
      current += step;
      samples[i] *= current;
    }
    this.currentVolume = target;
  }
}

module.exports = VolumeNode;
