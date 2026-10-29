/// <reference types="node" />
/// <reference types="node" />
export = AudioPipeline;
/**
 * @class AudioPipeline
 * @augments EventEmitter
 * @classdesc Pull-driven per-channel audio processing pipeline.
 * Supports:
 * - Direct PCM Fast-Path (`s16le` 48kHz 2ch from NodeLink/Lavalink or raw PCM streams), does not use any FFmpeg processes for higher performance.
 * - Managed FFmpeg Demuxer fallback for encoded files, HTTP streams, and Icecast/Shoutcast radio stations,
 *   with guaranteed child-process termination (`SIGTERM` + `SIGKILL` guard) on skip/stop/destroy.
 * - Bounded `RingBuffer` with automatic `.pause()` / `.resume()` backpressure on upstream streams.
 * - In-memory `DSPChain` (`MixerNode` overlays, `BiquadFilterNode`, `LoudnormNode`, `VolumeNode`).
 */
declare class AudioPipeline extends EventEmitter {
    static STATE_IDX: {
        STATE: number;
        PAUSED: number;
        PLAYED_SAMPLES: number;
        VOLUME_MILLI: number;
        BUFFER_BYTES: number;
        UNDERRUNS: number;
        DURATION_MS: number;
    };
    /**
     * Detect if `inputOptions` indicate the input stream is already raw 48kHz 2ch s16le PCM.
     * This enables the Zero-FFmpeg Fast Path (e.g. NodeLink `loadDirectStream`).
     * @param {string[]|Object} [inputOptions]
     * @returns {boolean}
     */
    static isRawS16le48kStereo(inputOptions?: string[] | any): boolean;
    /**
     * @param {Object} [options={}]
     * @param {number} [options.sampleRate=48000]
     * @param {number} [options.channels=2]
     * @param {number} [options.frameDurationMs=20]
     * @param {number} [options.bufferDurationMs=2500] RingBuffer capacity (default 2.5s = 480 KB)
     * @param {number} [options.prebufferFrames=3] Minimum 20ms frames buffered before starting playback (60ms)
     * @param {boolean} [options.normalisation=true]
     * @param {number} [options.volume=1.0]
     * @param {Pacer} [options.pacer]
     * @param {SharedArrayBuffer} [options.sharedStateBuffer]
     * @param {(frame: Int16Array, samplesPerChannel: number) => Promise<void>|void} [options.onFrame]
     */
    constructor(options?: {
        sampleRate?: number;
        channels?: number;
        frameDurationMs?: number;
        bufferDurationMs?: number;
        prebufferFrames?: number;
        normalisation?: boolean;
        volume?: number;
        pacer?: Pacer;
        sharedStateBuffer?: SharedArrayBuffer;
        onFrame?: (frame: Int16Array, samplesPerChannel: number) => Promise<void> | void;
    });
    sampleRate: number;
    channels: number;
    frameDurationMs: number;
    samplesPerChannel: number;
    frameSamples: number;
    frameBytes: number;
    prebufferBytes: number;
    pacer: Pacer;
    onFrame: (frame: Int16Array, samplesPerChannel: number) => Promise<void> | void;
    sharedState: Int32Array;
    dsp: DSPChain;
    ringBuffer: RingBuffer;
    _frameBuffer: Int16Array;
    _activeSourceStream: any;
    _activeFfmpegProc: import("child_process").ChildProcess;
    _activeHttpReq: http.ClientRequest;
    _primaryRemainder: any;
    _overlayCleanupMap: Map<any, any>;
    playing: boolean;
    paused: boolean;
    started: boolean;
    sourceEof: boolean;
    playedOutSamples: number;
    durationSec: number;
    _capturingFrame: boolean;
    /**
     * Play a file path, HTTP(S) URL, or Node.js Readable stream.
     * @param {import("stream").Readable|string} source
     * @param {string[]|Object} [inputOptions=[]]
     */
    playStream(source: import("stream").Readable | string, inputOptions?: string[] | any): void;
    /**
     * Play an overlay stream (e.g. soundboard clip, TTS announcement) mixed in-memory over the current track.
     * @param {import("stream").Readable|string|Buffer} source
     * @param {Object} [options={}]
     * @param {number} [options.volume=1.0]
     * @param {boolean} [options.duckPrimary=false]
     * @param {boolean} [options.rawPcm=false]
     * @returns {string} Overlay ID that can be used to cancel the overlay
     */
    playOverlay(source: import("stream").Readable | string | Buffer, options?: {
        volume?: number;
        duckPrimary?: boolean;
        rawPcm?: boolean;
    }): string;
    /**
     * Called every 20ms by the master Pacer.
     */
    tick(): void;
    pause(): void;
    resume(): void;
    setVolume(v?: number): void;
    setFilter(filterConfig: any): void;
    setNormalisation(enabled: any): void;
    /**
     * Stop current track playback and reset pipeline state.
     * @param {boolean} [emitFinish=true]
     */
    stop(emitFinish?: boolean): void;
    destroy(): void;
    #private;
}
import { EventEmitter } from "events";
import Pacer = require("./Pacer.js");
import DSPChain = require("../dsp/DSPChain.js");
import RingBuffer = require("./RingBuffer.js");
import http = require("http");
//# sourceMappingURL=AudioPipeline.d.ts.map