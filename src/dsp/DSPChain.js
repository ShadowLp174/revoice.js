const VolumeNode = require("./VolumeNode.js");
const LoudnormNode = require("./LoudnormNode.js");
const BiquadFilterNode = require("./BiquadFilterNode.js");
const MixerNode = require("./MixerNode.js");

/**
 * @class DSPChain
 * @classdesc Zero-allocation per-channel DSP processing graph.
 * Converts 20ms Int16 frames (1,920 samples) into a pre-allocated Float32 scratch buffer,
 * runs Mixer -> BiquadFilter -> Loudnorm -> Volume, and writes clamped Int16 samples back.
 */
class DSPChain {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.sampleRate=48000]
   * @param {number} [options.channels=2]
   * @param {number} [options.frameDurationMs=20]
   * @param {boolean} [options.normalisation=true]
   * @param {number} [options.volume=1.0]
   */
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 48000;
    this.channels = options.channels || 2;
    this.frameDurationMs = options.frameDurationMs || 20;
    this.samplesPerChannel = Math.floor((this.sampleRate * this.frameDurationMs) / 1000);
    this.frameSampleCount = this.samplesPerChannel * this.channels;

    this.mixer = new MixerNode({ frameSamples: this.frameSampleCount });
    this.filter = new BiquadFilterNode(this.sampleRate);
    this.loudnorm = new LoudnormNode({ enabled: options.normalisation ?? true });
    this.volume = new VolumeNode(options.volume ?? 1.0);

    /** @type {Array<{process: (samples: Float32Array) => void}>} */
    this.customNodes = [];

    // Pre-allocated scratch buffer (7.68 KB for 20ms stereo 48kHz)
    this._floatScratch = new Float32Array(this.frameSampleCount);
  }

  /**
   * Set playback volume.
   * @param {number} v
   * @param {boolean} [immediate=false]
   */
  setVolume(v, immediate = false) {
    this.volume.setVolume(v, immediate);
  }

  /**
   * Enable or disable loudness normalization.
   * @param {boolean} enabled
   */
  setNormalisation(enabled) {
    this.loudnorm.enabled = !!enabled;
  }

  /**
   * Configure EQ preset or custom biquad filter bands.
   * @param {string|Array<Object>|null} filterConfig
   */
  setFilter(filterConfig) {
    this.filter.setFilter(filterConfig);
  }

  /**
   * Add a custom DSP processor with a `.process(float32Samples)` method.
   * @param {{process: (samples: Float32Array) => void}} node
   */
  addCustomNode(node) {
    if (node && typeof node.process === "function") {
      this.customNodes.push(node);
    }
  }

  /**
   * Reset transient filter/AGC states between tracks.
   */
  resetTrackState() {
    this.loudnorm.reset();
    this.filter.resetState();
  }

  /**
   * Process an Int16 frame in-place through the active DSP graph.
   * @param {Int16Array} int16Frame
   */
  processFrame(int16Frame) {
    const len = int16Frame.length;
    const floatBuf =
      this._floatScratch.length === len
        ? this._floatScratch
        : (this._floatScratch = new Float32Array(len));

    const hasOverlays = this.mixer.hasActiveOverlays();
    const needsDsp =
      hasOverlays ||
      this.filter.enabled ||
      this.loudnorm.enabled ||
      this.customNodes.length > 0 ||
      Math.abs(this.volume.currentVolume - 1.0) > 1e-5 ||
      Math.abs(this.volume.targetVolume - 1.0) > 1e-5;

    if (!needsDsp) {
      return; // Fast-path: unity gain, no active filters or overlays
    }

    const inv32768 = 1 / 32768;
    for (let i = 0; i < len; i++) {
      floatBuf[i] = int16Frame[i] * inv32768;
    }

    if (hasOverlays) {
      this.mixer.process(floatBuf);
    }
    if (this.filter.enabled) {
      this.filter.process(floatBuf);
    }
    if (this.loudnorm.enabled) {
      this.loudnorm.process(floatBuf);
    }
    for (let i = 0; i < this.customNodes.length; i++) {
      this.customNodes[i].process(floatBuf);
    }
    this.volume.process(floatBuf);

    // Convert back to Int16 with saturation clamping
    for (let i = 0; i < len; i++) {
      let s = floatBuf[i] * 32768;
      if (s > 32767) s = 32767;
      else if (s < -32768) s = -32768;
      int16Frame[i] = s;
    }
  }
}

module.exports = DSPChain;
