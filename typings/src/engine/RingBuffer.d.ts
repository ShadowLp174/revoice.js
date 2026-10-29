export = RingBuffer;
/**
 * @class RingBuffer
 * @classdesc Zero-allocation circular PCM byte buffer with high/low watermark backpressure hooks.
 * Designed for 48kHz 2-channel 16-bit signed little-endian PCM (3,840 bytes per 20ms frame).
 */
declare class RingBuffer {
    /**
     * @param {number} [capacityBytes=384000] Default 2 seconds of 48kHz stereo s16le (192,000 bytes/sec * 2)
     * @param {Object} [options={}]
     * @param {number} [options.highWaterMarkRatio=0.8] Pause upstream when fill exceeds 80%
     * @param {number} [options.lowWaterMarkRatio=0.35] Resume upstream when fill drops below 35%
     * @param {Function} [options.onHighWaterMark]
     * @param {Function} [options.onLowWaterMark]
     */
    constructor(capacityBytes?: number, options?: {
        highWaterMarkRatio?: number;
        lowWaterMarkRatio?: number;
        onHighWaterMark?: Function;
        onLowWaterMark?: Function;
    });
    capacity: number;
    buffer: Uint8Array;
    writePos: number;
    readPos: number;
    length: number;
    highWaterMark: number;
    lowWaterMark: number;
    onHighWaterMark: Function;
    onLowWaterMark: Function;
    isBackpressured: boolean;
    /**
     * Number of bytes currently available to read.
     * @returns {number}
     */
    get availableRead(): number;
    /**
     * Number of free bytes available to write.
     * @returns {number}
     */
    get availableWrite(): number;
    /**
     * Write a chunk of bytes into the circular buffer.
     * If the chunk exceeds available space, writes as much as fits (aligned to 4 bytes) and returns bytes written.
     * @param {Buffer|Uint8Array} chunk
     * @param {number} [offset=0]
     * @param {number} [byteLength=chunk.byteLength - offset]
     * @returns {number} Number of bytes written
     */
    write(chunk: Buffer | Uint8Array, offset?: number, byteLength?: number): number;
    /**
     * Read up to `target.byteLength` bytes into `target` Uint8Array.
     * @param {Uint8Array} target
     * @returns {number} Number of bytes actually read
     */
    readInto(target: Uint8Array): number;
    /**
     * Read an exact 20ms frame (or `sampleCount` Int16 samples) into `targetInt16`.
     * If fewer samples are available and `allowPartial` is true, zero-pads the rest.
     * @param {Int16Array} targetInt16
     * @param {boolean} [allowPartial=false]
     * @returns {number} Number of Int16 samples read (before zero-padding)
     */
    readFrameInt16(targetInt16: Int16Array, allowPartial?: boolean): number;
    /**
     * Clear all buffered audio data.
     */
    clear(): void;
}
//# sourceMappingURL=RingBuffer.d.ts.map