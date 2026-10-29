export = BiquadFilterNode;
/**
 * @class BiquadFilterNode
 * @classdesc Stereo cascaded biquad EQ / filter node supporting peaking EQ, low-shelf (bassboost),
 * high-shelf (treble), lowpass, and highpass filters at 48kHz.
 */
declare class BiquadFilterNode {
    /**
     * @param {number} [sampleRate=48000]
     */
    constructor(sampleRate?: number);
    sampleRate: number;
    enabled: boolean;
    /** @type {Array<{b0:number,b1:number,b2:number,a1:number,a2:number,x1L:number,x2L:number,y1L:number,y2L:number,x1R:number,x2R:number,y1R:number,y2R:number}>} */
    sections: {
        b0: number;
        b1: number;
        b2: number;
        a1: number;
        a2: number;
        x1L: number;
        x2L: number;
        y1L: number;
        y2L: number;
        x1R: number;
        x2R: number;
        y1R: number;
        y2R: number;
    }[];
    /**
     * Clear all active filter sections.
     */
    clearFilters(): void;
    /**
     * Reset filter delay-line states (e.g., on track change or seek).
     */
    resetState(): void;
    /**
     * Configure one or more biquad filter bands or named presets.
     * @param {string|Array<{type: 'lowshelf'|'highshelf'|'peaking'|'lowpass'|'highpass', freq: number, gainDb?: number, q?: number}>|null} config
     */
    setFilter(config: string | Array<{
        type: 'lowshelf' | 'highshelf' | 'peaking' | 'lowpass' | 'highpass';
        freq: number;
        gainDb?: number;
        q?: number;
    }> | null): void;
    /**
     * Process interleaved stereo Float32 samples in-place.
     * @param {Float32Array} samples
     */
    process(samples: Float32Array): void;
    #private;
}
//# sourceMappingURL=BiquadFilterNode.d.ts.map