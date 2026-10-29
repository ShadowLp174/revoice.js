export = LoudnormNode;
/**
 * @class LoudnormNode
 * @classdesc Lightweight real-time Automatic Gain Control (AGC), RMS loudness normalizer,
 * and soft-knee peak limiter. Replaces FFmpeg's heavy `-af loudnorm` filter (used in previous Revoice.js versions) with
 * < 0.05% CPU overhead and zero lookahead delay.
 */
declare class LoudnormNode {
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
    constructor(options?: {
        enabled?: boolean;
        targetRms?: number;
        maxGain?: number;
        minGain?: number;
        silenceThreshold?: number;
        attackCoeff?: number;
        releaseCoeff?: number;
    });
    enabled: boolean;
    targetRms: number;
    maxGain: number;
    minGain: number;
    silenceThreshold: number;
    attackCoeff: number;
    releaseCoeff: number;
    runningRmsSq: number;
    currentGain: number;
    reset(): void;
    /**
     * Process a 20ms Float32 stereo buffer in-place (`[-1.0, 1.0]`).
     * @param {Float32Array} samples
     */
    process(samples: Float32Array): void;
}
//# sourceMappingURL=LoudnormNode.d.ts.map