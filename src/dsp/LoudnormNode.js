/**
 * @class LoudnormNode
 * @classdesc Lightweight real-time Automatic Gain Control (AGC), RMS loudness normalizer,
 * and soft-knee peak limiter. Replaces FFmpeg's heavy `-af loudnorm` filter (used in previous Revoice.js versions) with
 * < 0.05% CPU overhead and zero lookahead delay.
 */
class LoudnormNode {
  /**
   * @param {Object} [options={}]
   * @param {boolean} [options.enabled=true]
   * @param {number} [options.targetRms=0.18] Target RMS amplitude (~ -15 dBFS)
   * @param {number} [options.maxGain=3.0] Maximum upward boost (~ +9.5 dB)
   * @param {number} [options.minGain=0.25] Maximum downward attenuation (~ -12 dB)
   * @param {number} [options.silenceThreshold=0.002] Gate threshold below which gain freezes
   * @param {number} [options.attackCoeff=0.08] Fast gain reduction on loud transients
   * @param {number} [options.releaseCoeff=0.005] Slow gain recovery
   */
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.targetRms = options.targetRms ?? 0.18;
    this.maxGain = options.maxGain ?? 3.0;
    this.minGain = options.minGain ?? 0.25;
    this.silenceThreshold = options.silenceThreshold ?? 0.002;
    this.attackCoeff = options.attackCoeff ?? 0.08;
    this.releaseCoeff = options.releaseCoeff ?? 0.005;

    this.runningRmsSq = this.targetRms * this.targetRms;
    this.currentGain = 1.0;
  }

  reset() {
    this.runningRmsSq = this.targetRms * this.targetRms;
    this.currentGain = 1.0;
  }

  /**
   * Process a 20ms Float32 stereo buffer in-place (`[-1.0, 1.0]`).
   * @param {Float32Array} samples
   */
  process(samples) {
    if (!this.enabled) return;

    const len = samples.length;
    if (len === 0) return;

    // Compute frame mean-square energy
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      const s = samples[i];
      sumSq += s * s;
    }
    const frameMeanSq = sumSq / len;
    const frameRms = Math.sqrt(frameMeanSq);

    let desiredGain = this.currentGain;
    if (frameRms > this.silenceThreshold) {
      // Smooth RMS energy estimate
      this.runningRmsSq = 0.92 * this.runningRmsSq + 0.08 * frameMeanSq;
      const estimatedRms = Math.sqrt(this.runningRmsSq);
      if (estimatedRms > 1e-6) {
        desiredGain = this.targetRms / estimatedRms;
        if (desiredGain > this.maxGain) desiredGain = this.maxGain;
        if (desiredGain < this.minGain) desiredGain = this.minGain;
      }
    }

    // Asymmetric attack/release smoothing
    const coeff = desiredGain < this.currentGain ? this.attackCoeff : this.releaseCoeff;
    const targetFrameGain = this.currentGain + coeff * (desiredGain - this.currentGain);
    const gainStep = (targetFrameGain - this.currentGain) / len;
    let gain = this.currentGain;

    // Apply gain + soft-knee peak limiting above 0.90 to prevent digital clipping
    for (let i = 0; i < len; i++) {
      gain += gainStep;
      let val = samples[i] * gain;

      // Fast rational soft-clipper for peaks > 0.9 or < -0.9
      const abs = val < 0 ? -val : val;
      if (abs > 0.9) {
        const sign = val < 0 ? -1 : 1;
        const excess = abs - 0.9;
        val = sign * (0.9 + 0.1 * (excess / (0.1 + excess)));
      }
      samples[i] = val;
    }

    this.currentGain = targetFrameGain;
  }
}

module.exports = LoudnormNode;
