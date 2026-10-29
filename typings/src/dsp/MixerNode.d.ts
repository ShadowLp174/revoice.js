export = MixerNode;
/**
 * @class MixerNode
 * @classdesc In-memory multi-stream PCM audio mixer.
 * Supports mixing multiple secondary/overlay streams (e.g. soundboard clips, TTS, alerts)
 * onto the primary audio stream with optional primary-track ducking.
 */
declare class MixerNode {
    /**
     * @param {Object} [options={}]
     * @param {number} [options.frameSamples=1920] 960 stereo samples = 1920 Int16 values per 20ms
     * @param {number} [options.duckingGain=0.5] Gain applied to primary stream when an overlay with `duckPrimary=true` is active
     */
    constructor(options?: {
        frameSamples?: number;
        duckingGain?: number;
    });
    frameSamples: number;
    defaultDuckingGain: number;
    /** @type {Map<string, {id: string, buffer: RingBuffer, volume: number, duckPrimary: boolean, eof: boolean, onFinish?: Function}>} */
    overlays: Map<string, {
        id: string;
        buffer: RingBuffer;
        volume: number;
        duckPrimary: boolean;
        eof: boolean;
        onFinish?: Function;
    }>;
    _scratchInt16: Int16Array;
    _currentDuckGain: number;
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
    createOverlay(id: string, opts?: {
        volume?: number;
        duckPrimary?: boolean;
        capacityBytes?: number;
        onHighWaterMark?: Function;
        onLowWaterMark?: Function;
        onFinish?: Function;
    }): RingBuffer;
    /**
     * Mark an overlay stream as having reached end-of-stream (it will be removed once its RingBuffer drains).
     * @param {string} id
     */
    markOverlayEof(id: string): void;
    /**
     * Remove an overlay stream immediately.
     * @param {string} id
     */
    removeOverlay(id: string): void;
    /**
     * Clear all active overlays.
     */
    clear(): void;
    /**
     * Whether any overlay stream currently has buffered audio to play.
     * @returns {boolean}
     */
    hasActiveOverlays(): boolean;
    /**
     * Mix active overlay streams into `primaryFloat32` (`[-1.0, 1.0]`).
     * @param {Float32Array} primaryFloat32
     */
    process(primaryFloat32: Float32Array): void;
}
import RingBuffer = require("../engine/RingBuffer.js");
//# sourceMappingURL=MixerNode.d.ts.map