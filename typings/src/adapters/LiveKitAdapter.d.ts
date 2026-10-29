export = LiveKitAdapter;
/**
 * @class LiveKitAdapter
 * @augments BaseTransportAdapter
 * @classdesc LiveKit WebRTC SFU transport adapter for Stoat Voice v2.
 * Supports low-latency 200ms AudioSource frame queueing and optional remote participant audio reception.
 */
declare class LiveKitAdapter extends BaseTransportAdapter {
    /**
     * @param {Object} [options={}]\
     * @param {number} [options.sampleRate=48000]\
     * @param {number} [options.channels=2]\
     * @param {number} [options.queueSizeMs=200] Low-latency internal queue (200ms = 10 frames of 20ms)\
     * @param {string} [options.logLevel="warn"]\
     * @param {boolean} [options.receiveAudio=false]\
     */
    constructor(options?: {
        sampleRate?: number;
        channels?: number;
        queueSizeMs?: number;
        logLevel?: string;
        receiveAudio?: boolean;
    });
    room: any;
    source: any;
    track: any;
    trackPublished: boolean;
    _publishPromise: any;
    receiveAudio: boolean;
    audioStreams: Map<any, any>;
    /**
     * @override
     */
    override connect({ url, token, autoSubscribe }: {
        url: any;
        token: any;
        autoSubscribe?: boolean;
    }): Promise<void>;
    /**
     * @override
     */
    override publishAudioTrack(): Promise<any>;
    /**
     * Push a 20ms interleaved Int16 PCM frame to LiveKit's AudioSource.
     * Uses the frame's Int16Array directly to prevent race conditions during asynchronous delivery.
     * @override
     * @param {Int16Array} int16Samples
     * @param {number} [samplesPerChannel]
     */
    override capturePcmFrame(int16Samples: Int16Array, samplesPerChannel?: number): Promise<void>;
    #private;
}
import BaseTransportAdapter = require("./BaseTransportAdapter.js");
//# sourceMappingURL=LiveKitAdapter.d.ts.map