export = BaseTransportAdapter;
/**
 * @class BaseTransportAdapter
 * @classdesc Abstract transport adapter interface for Stoat voice backends (LiveKit, custom SFU, or mock testing).
 * Emits:
 * - "connected": () => void
 * - "reconnecting": () => void
 * - "reconnected": () => void
 * - "disconnected": (reason?: any) => void
 * - "participantJoined": (participant: Object) => void
 * - "participantLeft": (participant: Object) => void
 * - "audioFrameReceived": (participantId: string, frame: Object) => void
 * - "error": (err: Error) => void
 */
declare class BaseTransportAdapter extends EventEmitter {
    /**
     * Optional static hook to gracefully dispose underlying native transport runtimes on process exit.
     * @returns {Promise<void>}
     */
    static disposeRuntime(): Promise<void>;
    /**
     * @param {Object} [options={}]
     * @param {number} [options.sampleRate=48000]
     * @param {number} [options.channels=2]
     * @param {number} [options.queueSizeMs=200]
     * @param {string} [options.logLevel="warn"]
     */
    constructor(options?: {
        sampleRate?: number;
        channels?: number;
        queueSizeMs?: number;
        logLevel?: string;
    });
    sampleRate: number;
    channels: number;
    queueSizeMs: number;
    logLevel: string;
    connected: boolean;
    /**
     * Connect to the voice room/transport.
     * @param {Object} params
     * @param {string} params.url
     * @param {string} params.token
     * @param {string} [params.channelId]
     * @param {boolean} [params.autoSubscribe=false]
     * @returns {Promise<void>}
     */
    connect(_params: any): Promise<void>;
    /**
     * Disconnect from the voice room and release transport resources.
     * @returns {Promise<void>}
     */
    disconnect(): Promise<void>;
    /**
     * Reconfigure transport on token refresh or region migration without tearing down the audio pipeline.
     * @param {Object} params
     * @returns {Promise<void>}
     */
    reconfigure(params: any): Promise<void>;
    /**
     * Ensure the local audio track is published to the room.
     * @returns {Promise<void>}
     */
    publishAudioTrack(): Promise<void>;
    /**
     * Push a 20ms interleaved Int16 PCM frame to the voice transport.
     * @param {Int16Array} int16Samples Interleaved stereo/mono samples (e.g. 960 samples * 2 channels = 1920 Int16s)
     * @param {number} [samplesPerChannel=960]
     * @returns {Promise<void>}\
     */
    capturePcmFrame(_int16Samples: any, _samplesPerChannel: any): Promise<void>;
    /**
     * Whether the underlying transport supports direct Opus packet injection without PCM encoding.
     * @returns {boolean}
     */
    supportsOpusPassthrough(): boolean;
    /**
     * Optional fast-path for transports supporting direct Opus packet injection.
     * @param {Buffer|Uint8Array} _opusPacket
     * @param {number} _durationMs
     * @returns {Promise<void>}
     */
    captureOpusPacket(_opusPacket: Buffer | Uint8Array, _durationMs?: number): Promise<void>;
    /**
     * Clear any buffered frames in the transport's internal queue (e.g., on pause/skip).
     */
    clearQueue(): void;
    /**
     * Return an array of remote participants currently in the voice room.
     * @returns {Array<Object>}
     */
    getRemoteParticipants(): Array<any>;
}
import { EventEmitter } from "events";
//# sourceMappingURL=BaseTransportAdapter.d.ts.map