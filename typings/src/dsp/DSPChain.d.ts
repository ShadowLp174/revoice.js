export = DSPChain;
/**
 * @class DSPChain
 * @classdesc Zero-allocation per-channel DSP processing graph.
 * Converts 20ms Int16 frames (1,920 samples) into a pre-allocated Float32 scratch buffer,
 * runs Mixer -> BiquadFilter -> Loudnorm -> Volume, and writes clamped Int16 samples back.
 */
declare class DSPChain {
    /**
     * @param {Object} [options={}]
     * @param {number} [options.sampleRate=48000]
     * @param {number} [options.channels=2]
     * @param {number} [options.frameDurationMs=20]
     * @param {boolean} [options.normalisation=true]
     * @param {number} [options.volume=1.0]
     */
    constructor(options?: {
        sampleRate?: number;
        channels?: number;
        frameDurationMs?: number;
        normalisation?: boolean;
        volume?: number;
    });
    sampleRate: number;
    channels: number;
    frameDurationMs: number;
    samplesPerChannel: number;
    frameSampleCount: number;
    mixer: MixerNode;
    filter: BiquadFilterNode;
    loudnorm: LoudnormNode;
    volume: VolumeNode;
    /** @type {Array<{process: (samples: Float32Array) => void}>} */
    customNodes: {
        process: (samples: Float32Array) => void;
    }[];
    _floatScratch: Float32Array;
    /**
     * Set playback volume.
     * @param {number} v
     * @param {boolean} [immediate=false]
     */
    setVolume(v: number, immediate?: boolean): void;
    /**
     * Enable or disable loudness normalization.
     * @param {boolean} enabled
     */
    setNormalisation(enabled: boolean): void;
    /**
     * Configure EQ preset or custom biquad filter bands.
     * @param {string|Array<Object>|null} filterConfig
     */
    setFilter(filterConfig: string | Array<any> | null): void;
    /**
     * Add a custom DSP processor with a `.process(float32Samples)` method.
     * @param {{process: (samples: Float32Array) => void}} node
     */
    addCustomNode(node: {
        process: (samples: Float32Array) => void;
    }): void;
    /**
     * Reset transient filter/AGC states between tracks.
     */
    resetTrackState(): void;
    /**
     * Process an Int16 frame in-place through the active DSP graph.
     * @param {Int16Array} int16Frame
     */
    processFrame(int16Frame: Int16Array): void;
}
import MixerNode = require("./MixerNode.js");
import BiquadFilterNode = require("./BiquadFilterNode.js");
import LoudnormNode = require("./LoudnormNode.js");
import VolumeNode = require("./VolumeNode.js");
//# sourceMappingURL=DSPChain.d.ts.map