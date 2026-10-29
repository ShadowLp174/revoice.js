/// <reference types="node" />
import EventEmitter = require("events");
import { Readable } from "stream";

export interface MediaOptions {
    sampleRate?: number;
    channels?: number;
    queueSizeMs?: number;
}

export interface MediaPlayerOptions extends MediaOptions {
    normalisation?: boolean;
    useWorker?: boolean;
    volume?: number;
}

export interface BiquadBandConfig {
    type: "lowshelf" | "highshelf" | "peaking" | "lowpass" | "highpass";
    freq: number;
    gainDb?: number;
    q?: number;
}

export interface OverlayOptions {
    volume?: number;
    duckPrimary?: boolean;
    rawPcm?: boolean;
    inputOptions?: string[];
}

/**
 * @class Media
 * @classdesc Base class for audio sources and track publishing in Revoice.js.
 */
export class Media extends EventEmitter {
    constructor(options?: MediaOptions);
    SAMPLE_RATE: number;
    CHANNELS: number;
    QUEUE_SIZE_MS: number;
    id: string;
    adapter: any;
    source: any;
    track: any;
    readonly localAudioTrack: any;
    readonly publishOptions: any;
    publishToRoom(roomOrAdapter: any): Promise<void>;
    playFile(filePath: string): void;
    playStream(stream: Readable | string, inputOptions?: string[] | Record<string, any>): void;
}

/**
 * @class MediaPlayer
 * @augments Media
 * @classdesc High-performance audio player with worker-thread offloading, RingBuffer backpressure,
 * and in-memory DSP (Volume ramping, Loudnorm AGC, Biquad EQ, and multi-stream Overlay Mixing).
 */
export class MediaPlayer extends Media {
    constructor(normalisationOrOptions?: boolean | MediaPlayerOptions);
    isMediaPlayer: boolean;
    loudnessNormalisation: boolean;
    useWorker: boolean;
    error: Error | null;
    sharedStateBuffer: SharedArrayBuffer;
    sharedState: Int32Array;
    ready: boolean;
    playing: boolean;
    started: boolean;
    codecData: { duration?: number } | null;

    paused: boolean;
    readonly playbackPaused: boolean;
    readonly volume: number;
    readonly seconds: number;
    readonly duration: number;
    readonly currTimestamp: string;

    pause(): void;
    resume(): void;
    setVolume(v?: number): void;
    setFilter(filterConfig: string | BiquadBandConfig[] | null): void;
    setNormalisation(enabled: boolean): void;
    playFile(filePath: string, inputOptions?: string[] | Record<string, any>): Promise<void>;
    playStream(streamOrUrl: Readable | string, inputOptions?: string[] | Record<string, any>): Promise<void>;
    playOverlay(source: Readable | string | Buffer | Uint8Array, options?: OverlayOptions): string | void;
    stop(init?: boolean): void;
    destroy(): void;
}
