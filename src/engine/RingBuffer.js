/**
 * @class RingBuffer
 * @classdesc Zero-allocation circular PCM byte buffer with high/low watermark backpressure hooks.
 * Designed for 48kHz 2-channel 16-bit signed little-endian PCM (3,840 bytes per 20ms frame).
 */
class RingBuffer {
  /**
   * @param {number} [capacityBytes=384000] Default 2 seconds of 48kHz stereo s16le (192,000 bytes/sec * 2)
   * @param {Object} [options={}]
   * @param {number} [options.highWaterMarkRatio=0.8] Pause upstream when fill exceeds 80%
   * @param {number} [options.lowWaterMarkRatio=0.35] Resume upstream when fill drops below 35%
   * @param {Function} [options.onHighWaterMark]
   * @param {Function} [options.onLowWaterMark]
   */
  constructor(capacityBytes = 384000, options = {}) {
    // Ensure capacity is a multiple of 4 bytes (stereo 16-bit sample alignment)
    this.capacity = Math.max(3840 * 4, Math.ceil(capacityBytes / 4) * 4);
    this.buffer = new Uint8Array(this.capacity);

    this.writePos = 0;
    this.readPos = 0;
    this.length = 0;

    this.highWaterMark = Math.floor(this.capacity * (options.highWaterMarkRatio ?? 0.8));
    this.lowWaterMark = Math.floor(this.capacity * (options.lowWaterMarkRatio ?? 0.35));

    this.onHighWaterMark = options.onHighWaterMark || null;
    this.onLowWaterMark = options.onLowWaterMark || null;
    this.isBackpressured = false;
  }

  /**
   * Number of bytes currently available to read.
   * @returns {number}
   */
  get availableRead() {
    return this.length;
  }

  /**
   * Number of free bytes available to write.
   * @returns {number}
   */
  get availableWrite() {
    return this.capacity - this.length;
  }

  /**
   * Write a chunk of bytes into the circular buffer.
   * If the chunk exceeds available space, writes as much as fits (aligned to 4 bytes) and returns bytes written.
   * @param {Buffer|Uint8Array} chunk
   * @param {number} [offset=0]
   * @param {number} [byteLength=chunk.byteLength - offset]
   * @returns {number} Number of bytes written
   */
  write(chunk, offset = 0, byteLength = chunk.byteLength - offset) {
    if (byteLength <= 0 || this.availableWrite === 0) return 0;

    const toWrite = Math.min(byteLength, this.availableWrite);
    const firstPart = Math.min(toWrite, this.capacity - this.writePos);

    this.buffer.set(
      chunk.subarray(offset, offset + firstPart),
      this.writePos
    );

    if (toWrite > firstPart) {
      const secondPart = toWrite - firstPart;
      this.buffer.set(
        chunk.subarray(offset + firstPart, offset + toWrite),
        0
      );
      this.writePos = secondPart;
    } else {
      this.writePos = (this.writePos + firstPart) % this.capacity;
    }

    this.length += toWrite;

    if (!this.isBackpressured && this.length >= this.highWaterMark) {
      this.isBackpressured = true;
      if (this.onHighWaterMark) this.onHighWaterMark();
    }

    return toWrite;
  }

  /**
   * Read up to `target.byteLength` bytes into `target` Uint8Array.
   * @param {Uint8Array} target
   * @returns {number} Number of bytes actually read
   */
  readInto(target) {
    const requested = target.byteLength;
    if (this.length === 0 || requested === 0) return 0;

    // Align read to 4 bytes (1 stereo sample) if partial read
    let toRead = Math.min(requested, this.length);
    if (toRead < requested) {
      toRead = toRead & ~3;
    }
    if (toRead === 0) return 0;

    const firstPart = Math.min(toRead, this.capacity - this.readPos);
    target.set(this.buffer.subarray(this.readPos, this.readPos + firstPart), 0);

    if (toRead > firstPart) {
      const secondPart = toRead - firstPart;
      target.set(this.buffer.subarray(0, secondPart), firstPart);
      this.readPos = secondPart;
    } else {
      this.readPos = (this.readPos + firstPart) % this.capacity;
    }

    this.length -= toRead;

    if (this.isBackpressured && this.length <= this.lowWaterMark) {
      this.isBackpressured = false;
      if (this.onLowWaterMark) this.onLowWaterMark();
    }

    return toRead;
  }

  /**
   * Read an exact 20ms frame (or `sampleCount` Int16 samples) into `targetInt16`.
   * If fewer samples are available and `allowPartial` is true, zero-pads the rest.
   * @param {Int16Array} targetInt16
   * @param {boolean} [allowPartial=false]
   * @returns {number} Number of Int16 samples read (before zero-padding)
   */
  readFrameInt16(targetInt16, allowPartial = false) {
    const requiredBytes = targetInt16.byteLength;
    if (this.length < requiredBytes && !allowPartial) {
      return 0;
    }

    const byteView = new Uint8Array(
      targetInt16.buffer,
      targetInt16.byteOffset,
      requiredBytes
    );
    const bytesRead = this.readInto(byteView);

    if (bytesRead < requiredBytes) {
      byteView.fill(0, bytesRead);
    }

    return bytesRead >> 1; // 2 bytes per Int16 sample
  }

  /**
   * Clear all buffered audio data.
   */
  clear() {
    this.writePos = 0;
    this.readPos = 0;
    this.length = 0;
    if (this.isBackpressured) {
      this.isBackpressured = false;
      if (this.onLowWaterMark) this.onLowWaterMark();
    }
  }
}

module.exports = RingBuffer;
