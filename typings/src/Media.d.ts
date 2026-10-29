export type Livekit = typeof import("@livekit/rtc-node");
/**
 * @class MediaPlayer
 * @augments Media
 * @classdesc High-performance audio player for Revoice.js.
 * Supports:
 * - Zero-FFmpeg direct PCM streaming (e.g. from NodeLink/Lavalink or raw streams)
 * - Automatic FFmpeg demuxing for arbitrary files, HTTP streams, and radio stations
 * - Worker-thread offloading via `WorkerPoolManager` (or in-thread execution)
 * - In-memory DSP chain: Volume ramping, real-time AGC/Loudnorm, Biquad EQ filters, and multi-stream overlay mixing
 *
 * @property {number} seconds - Elapsed playback duration in seconds.
 * @property {string} currTimestamp - Elapsed timestamp in `hh:mm:ss` format.
 * @property {boolean} paused - Whether playback is currently paused.
 * @property {boolean} playbackPaused - Alias for `paused` (for backwards compatibility).
 */
export class MediaPlayer extends Media {
    /**
     * @param {boolean|Object} [normalisationOrOptions=true] Pass a boolean for loudness normalisation, or an options object.
     * @param {boolean} [normalisationOrOptions.normalisation=true] Whether to enable real-time loudness normalization.
     * @param {boolean} [normalisationOrOptions.useWorker=true] Whether to offload demuxing & DSP to the AudioWorker pool.
     * @param {number} [normalisationOrOptions.volume=1.0] Initial playback volume.
     * @param {number} [normalisationOrOptions.queueSizeMs=200] Internal WebRTC frame queue size in ms.
     */
    constructor(normalisationOrOptions?: boolean | any);
    isMediaPlayer: boolean;
    loudnessNormalisation: any;
    useWorker: any;
    error: any;
    sharedStateBuffer: SharedArrayBuffer;
    sharedState: Int32Array;
    _localPipeline: AudioPipeline;
    _activeBridgedStream: any;
    _destroyed: boolean;
    initValues(initialVolume?: number): void;
    ready: boolean;
    _volume: number;
    _filter: string | any[];
    _paused: boolean;
    playing: boolean;
    started: boolean;
    codecData: any;
    set paused(arg: boolean);
    /**
     * Whether playback is currently paused.
     * @returns {boolean}
     */
    get paused(): boolean;
    /**
     * Alias for `paused` to preserve compatibility with callers checking `player.playbackPaused`.
     * @returns {boolean}
     */
    get playbackPaused(): boolean;
    /**
     * Current playback volume (`1.0` = 100%).
     * @returns {number}
     */
    get volume(): number;
    /**
     * Elapsed playback time in seconds for the current track.
     * Read synchronously from SharedArrayBuffer with zero IPC overhead.
     * @returns {number}
     */
    get seconds(): number;
    /**
     * Total track duration in seconds (if reported by demuxer).
     * @returns {number}
     */
    get duration(): number;
    /**
     * Formatted elapsed timestamp `hh:mm:ss`.
     * Fixed bug from earlier Media.js where `this.seconds()` was called as a function instead of a getter.
     * @returns {string}
     */
    get currTimestamp(): string;
    /**
     * Pause playback immediately.
     */
    pause(): void;
    /**
     * Resume paused playback.
     */
    resume(): void;
    /**
     * Adjust playback volume smoothly without clicks/pops.
     * @param {number} [v=1] Volume multiplier (`1.0` = 100%, `0.5` = 50%).
     */
    setVolume(v?: number): void;
    /**
     * Apply a real-time EQ preset (`"bassboost"`, `"vocal"`, `"treble"`, `"lofi"`, `"off"`)
     * or an array of custom biquad filter band definitions.
     * @param {string|Array<Object>|null} filterConfig
     */
    setFilter(filterConfig: string | Array<any> | null): void;
    /**
     * Enable or disable real-time loudness normalization (AGC + limiter).
     * @param {boolean} enabled
     */
    setNormalisation(enabled: boolean): void;
    /**
     * Play an audio file from disk.
     * When `useWorker` is enabled, the file path is sent directly to the worker thread so
     * zero file bytes cross the main thread.
     * @override
     * @param {string} filePath
     * @param {string[]|Object} [inputOptions=[]]
     */
    override playFile(filePath: string, inputOptions?: string[] | any): Promise<void>;
    /**
     * Play a Node.js Readable stream, file path, or HTTP(S) URL.
     * If `inputOptions` specifies raw 48kHz stereo PCM (`["-f s16le", "-ar 48000", "-ac 2"]` or `{ rawPcm: true }`),
     * the engine bypasses FFmpeg completely and streams directly into the RingBuffer & DSP chain.
     *
     * @override
     * @param {import("stream").Readable|string} streamOrUrl
     * @param {string[]|Object} [inputOptions=[]]
     */
    override playStream(streamOrUrl: import("stream").Readable | string, inputOptions?: string[] | any): Promise<void>;
    /**
     * Mix an overlay audio source (soundboard effect, TTS clip, etc.) over the currently playing audio
     * in memory without spawning extra FFmpeg `amix` trees.
     * @param {import("stream").Readable|string|Buffer} source
     * @param {Object} [options={}]
     * @param {number} [options.volume=1.0]
     * @param {boolean} [options.duckPrimary=false]
     * @param {boolean} [options.rawPcm=false]
     * @param {string[]} [options.inputOptions=[]]
     */
    playOverlay(source: import("stream").Readable | string | Buffer, options?: {
        volume?: number;
        duckPrimary?: boolean;
        rawPcm?: boolean;
        inputOptions?: string[];
    }): string;
    /**
     * Stop current playback immediately and clean up active streams/processes.
     * @param {boolean} [init=true]
     */
    stop(init?: boolean): void;
    /**
     * Destroy the MediaPlayer and release its worker pipeline.
     */
    destroy(): void;
    #private;
}
/**
 * @class Media
 * @augments EventEmitter
 * @classdesc Base class for audio sources and track publishing in Revoice.js.
 * Supports both direct LiveKit `Room` publishing (backwards-compatible) and
 * pluggable `BaseTransportAdapter` sinks.
 */
export class Media extends EventEmitter {
    /**
     * @param {Object} [options={}]
     * @param {number} [options.sampleRate=48000]
     * @param {number} [options.channels=2]
     * @param {number} [options.queueSizeMs=200]
     */
    constructor(options?: {
        sampleRate?: number;
        channels?: number;
        queueSizeMs?: number;
    });
    SAMPLE_RATE: number;
    CHANNELS: number;
    QUEUE_SIZE_MS: number;
    id: any;
    adapter: any;
    _source: any;
    _track: any;
    _reusableFrame: import("@livekit/rtc-node/dist/audio_frame.js").AudioFrame;
    _reusableSamples: Int16Array;
    set source(arg: any);
    get source(): any;
    set track(arg: any);
    get track(): any;
    get localAudioTrack(): any;
    get publishOptions(): {};
    /**
     * Attach a transport adapter (e.g. `LiveKitAdapter`) or publish directly to a LiveKit `Room`.
     * @param {Object} roomOrAdapter
     */
    publishToRoom(roomOrAdapter: any): Promise<void>;
    /**
     * Push a 20ms Int16 PCM frame to the attached transport adapter or LiveKit AudioSource.
     * @param {Int16Array} int16Samples
     * @param {number} [samplesPerChannel=960]
     */
    _capturePcmFrame(int16Samples: Int16Array, samplesPerChannel?: number): Promise<void>;
    playFile(filePath: any): void;
    playStream(stream: any): void;
    #private;
}
import AudioPipeline = require("./engine/AudioPipeline.js");
import { EventEmitter } from "events";
//# sourceMappingURL=Media.d.ts.map