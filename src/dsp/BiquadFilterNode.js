/**
 * @class BiquadFilterNode
 * @classdesc Stereo cascaded biquad EQ / filter node supporting peaking EQ, low-shelf (bassboost),
 * high-shelf (treble), lowpass, and highpass filters at 48kHz.
 */
class BiquadFilterNode {
  /**
   * @param {number} [sampleRate=48000]
   */
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.enabled = false;
    /** @type {Array<{b0:number,b1:number,b2:number,a1:number,a2:number,x1L:number,x2L:number,y1L:number,y2L:number,x1R:number,x2R:number,y1R:number,y2R:number}>} */
    this.sections = [];
  }

  /**
   * Clear all active filter sections.
   */
  clearFilters() {
    this.sections = [];
    this.enabled = false;
  }

  /**
   * Reset filter delay-line states (e.g., on track change or seek).
   */
  resetState() {
    for (const s of this.sections) {
      s.x1L = s.x2L = s.y1L = s.y2L = 0;
      s.x1R = s.x2R = s.y1R = s.y2R = 0;
    }
  }

  /**
   * Configure one or more biquad filter bands or named presets.
   * @param {string|Array<{type: 'lowshelf'|'highshelf'|'peaking'|'lowpass'|'highpass', freq: number, gainDb?: number, q?: number}>|null} config
   */
  setFilter(config) {
    if (!config || config === "off" || config === "none") {
      this.clearFilters();
      return;
    }

    let bands = [];
    if (typeof config === "string") {
      switch (config.toLowerCase()) {
        case "bassboost":
          bands = [
            { type: "lowshelf", freq: 110, gainDb: 7.5, q: 0.707 },
            { type: "peaking", freq: 65, gainDb: 4.0, q: 1.1 },
          ];
          break;
        case "vocal":
          bands = [
            { type: "highpass", freq: 120, q: 0.707 },
            { type: "peaking", freq: 2500, gainDb: 4.5, q: 1.0 },
          ];
          break;
        case "treble":
          bands = [{ type: "highshelf", freq: 4500, gainDb: 6.0, q: 0.707 }];
          break;
        case "lo-fi":
        case "lofi":
          bands = [
            { type: "highpass", freq: 250, q: 0.707 },
            { type: "lowpass", freq: 3800, q: 0.8 },
          ];
          break;
        default:
          this.clearFilters();
          return;
      }
    } else if (Array.isArray(config)) {
      bands = config;
    }

    this.sections = bands.map((b) => this.#computeCoeffs(b));
    this.enabled = this.sections.length > 0;
  }

  #computeCoeffs({ type = "peaking", freq = 1000, gainDb = 0, q = 0.707 }) {
    const w0 = (2 * Math.PI * freq) / this.sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * q);
    const A = Math.pow(10, gainDb / 40);

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    switch (type) {
      case "lowpass":
        b0 = (1 - cosw0) / 2;
        b1 = 1 - cosw0;
        b2 = (1 - cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
      case "highpass":
        b0 = (1 + cosw0) / 2;
        b1 = -(1 + cosw0);
        b2 = (1 + cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
      case "lowshelf": {
        const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cosw0 + twoSqrtAAlpha);
        b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
        b2 = A * (A + 1 - (A - 1) * cosw0 - twoSqrtAAlpha);
        a0 = A + 1 + (A - 1) * cosw0 + twoSqrtAAlpha;
        a1 = -2 * (A - 1 + (A + 1) * cosw0);
        a2 = A + 1 + (A - 1) * cosw0 - twoSqrtAAlpha;
        break;
      }
      case "highshelf": {
        const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cosw0 + twoSqrtAAlpha);
        b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
        b2 = A * (A + 1 + (A - 1) * cosw0 - twoSqrtAAlpha);
        a0 = A + 1 - (A - 1) * cosw0 + twoSqrtAAlpha;
        a1 = 2 * (A - 1 - (A + 1) * cosw0);
        a2 = A + 1 - (A - 1) * cosw0 - twoSqrtAAlpha;
        break;
      }
      case "peaking":
      default:
        b0 = 1 + alpha * A;
        b1 = -2 * cosw0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw0;
        a2 = 1 - alpha / A;
        break;
    }

    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0,
      x1L: 0, x2L: 0, y1L: 0, y2L: 0,
      x1R: 0, x2R: 0, y1R: 0, y2R: 0,
    };
  }

  /**
   * Process interleaved stereo Float32 samples in-place.
   * @param {Float32Array} samples
   */
  process(samples) {
    if (!this.enabled || this.sections.length === 0) return;

    const len = samples.length;
    for (let sIdx = 0; sIdx < this.sections.length; sIdx++) {
      const s = this.sections[sIdx];
      const { b0, b1, b2, a1, a2 } = s;
      let { x1L, x2L, y1L, y2L, x1R, x2R, y1R, y2R } = s;

      for (let i = 0; i < len; i += 2) {
        const xL = samples[i];
        const yL = b0 * xL + b1 * x1L + b2 * x2L - a1 * y1L - a2 * y2L;
        x2L = x1L;
        x1L = xL;
        y2L = y1L;
        y1L = yL;
        samples[i] = yL;

        const xR = samples[i + 1];
        const yR = b0 * xR + b1 * x1R + b2 * x2R - a1 * y1R - a2 * y2R;
        x2R = x1R;
        x1R = xR;
        y2R = y1R;
        y1R = yR;
        samples[i + 1] = yR;
      }

      s.x1L = x1L; s.x2L = x2L; s.y1L = y1L; s.y2L = y2L;
      s.x1R = x1R; s.x2R = x2R; s.y1R = y1R; s.y2R = y2R;
    }
  }
}

module.exports = BiquadFilterNode;
