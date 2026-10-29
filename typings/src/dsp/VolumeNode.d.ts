export = VolumeNode;
/**
 * @class VolumeNode
 * @classdesc High-performance volume scaling with smooth per-sample linear ramping
 * to prevent clicks and pops during volume changes, pauses, and resumes.
 */
declare class VolumeNode {
    /**
     * @param {number} [initialVolume=1.0]
     */
    constructor(initialVolume?: number);
    targetVolume: number;
    currentVolume: number;
    enabled: boolean;
    /**
     * Set target volume (1.0 = 100%, 0.5 = 50%, etc.)
     * @param {number} v
     * @param {boolean} [immediate=false]
     */
    setVolume(v: number, immediate?: boolean): void;
    /**
     * Process Float32 samples in-place (`[-1.0, 1.0]`).
     * @param {Float32Array} samples
     */
    process(samples: Float32Array): void;
}
//# sourceMappingURL=VolumeNode.d.ts.map