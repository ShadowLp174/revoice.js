/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/**
 * @class
 * @classdesc Basic class to process audio streams
 */
export class Media {
    /**
     * @description Init the media object
     *
     * @param {boolean} logs=false Wether or not to output logs
     * @param {number} port=5030 A ffmpeg rtp port that this instance will be using.
     * @param {PacketHandler} packetHandler=(packet)=>{this.track.writeRtp(packet);} The function that determines how audio packets are handled.
     *
     * @return {Media} The new Media object instance
     */
    constructor(logs?: boolean, port?: number, packetHandler?: PacketHandler, inputFormat?: string);
    track: MediaStreamTrack;
    socket: import("dgram").Socket;
    inputFormat: string;
    port: number;
    logs: boolean;
    playing: boolean;
    isMedia: boolean;
    readAtNative: boolean;
    ffmpeg: import("child_process").ChildProcessWithoutNullStreams;
    on(event: any, cb: any): string;
    once(event: any, cb: any): string;
    ffmpegArgs(port: any): string[];
    /**
     * Returns an array of arguments that can be passed to ffmpeg
     *
     * @param  {string} start="00:00:00" The position in the audio to start the conversion.
     * @return {Array<string>}           The arguments.
     */
    createFfmpegArgs(start?: string): Array<string>;
    /**
     * @description Returns the current mediasoup media track
     *
     * @return {MediaStreamTrack}  The mediasoup MediaStreamTrack
     */
    getMediaTrack(): MediaStreamTrack;
    /**
     * Load and process an audio file
     *
     * @param  {string} path The file path of the file
     * @return {void}
     */
    playFile(path: string): void;
    /**
     * Writes a chunk of data into the ffmpeg process.
     *
     * @param  {object} chunk The datachunk to write.
     * @return {void}
     */
    writeStreamChunk(chunk: object): void;
    /**
     * Pipe a ReadStream into the ffmpeg process.
     *
     * @param  {ReadableStream} stream The stream to pipe.
     * @return {void}
     */
    playStream(stream: ReadableStream): void;
    /**
     * Kill the ffmpeg instance and close the socket.
     *
     * @return {Promise<void>} A promise resolving when the udp4 socket closed.
     */
    destroy(): Promise<void>;
}
/**
 * @class
 * @augments Media
 * @description An advanced version of the Media class. It also includes media controls like pausing.
 *
 * @property {number} seconds - The amount of seconds passed during playback. Extracted from ffmpeg
 * @property {string} currTimestamp - The current timestamp as given by ffmpeg. "hh:mm:ss"
 */
export class MediaPlayer extends Media {
    static timestampToSeconds(timestamp?: string, ceilMinutes?: boolean): string;
    /**
     * @description Initiates the MediaPlayer instance.
     *
     * @param  {boolean} logs=false Wether or not to print logs to the console or not.
     * @param  {number} port=5030  The port this instance should use.
     * @param  {string} iFormat="" Optional arguments that specify the input format that are passed to ffmpeg
     * @return {MediaPlayer}            The new instance.
     */
    constructor(logs?: boolean, port?: number);
    isMediaPlayer: boolean;
    emitter: EventEmitter;
    currTime: string;
    started: boolean;
    packets: any[];
    intervals: any[];
    lastPacket: number;
    paused: boolean;
    ffmpegKilled: boolean;
    ready: boolean;
    volCache: number;
    seconds: number;
    currTimestamp: string;
    volumeTransformer: prism.VolumeTransformer;
    on(event: any, cb: any): EventEmitter;
    once(event: any, cb: any): EventEmitter;
    emit(event: any, data: any): boolean;
    /**
     * setReadNative
     * @description Change if ffmpeg should read the input at its native frame rate (-re flag). Set this to `false` if your input data is already at native frame rate to prevent packet loss.
     *
     * @param  {boolean} bool=true true: read at native frame rate; false: process input as fast as possible
     * @return {void}
     */
    setReadNative(bool?: boolean): void;
    /**
     * @description Saves a data packet temporarily
     *
     * @param  {object} packet The packet to store.
     * @return {void}
     */
    _save(packet: object): void;
    /**
     * @description Start writing the data from the temporal storage to the media track. Recursive, will stop when the storage is empty.
     *
     * @return {void}
     */
    _write(): void;
    writing: boolean;
    writePacket(packet: any): void;
    /**
     * @description Cleans up this instance. Should be called when the bot is leaving.
     *
     * @param  {boolean} destroy=true Wether or not to replace the mediatrack
     * @param  {boolean} f=true       Wether or not to respawn the ffmpeg instance.
     * @return {void}
     */
    disconnect(destroy?: boolean, f?: boolean): void;
    /**
     * @description Function that is called when the ffmpeg stream finishes.
     *
     * @return {void}
     */
    finished(): void;
    /**
     * @description Pause the current playback
     *
     * @return {void}
     */
    pause(): void;
    playbackPaused: boolean;
    /**
     * @description Resume the current playback.
     *
     * @return {void}
     */
    resume(): void;
    /**
     * @description Set the volume of the current playback
     *
     * @param  {number} v=1 The new volume. 0 = nothing, 0.5 = half, 1 = default; Stay in between 0 and 1 to prevent bad music quality
     * @return {void}
     */
    setVolume(v?: number): void;
    /**
     * @description Stop the playback.
     *
     * @return {Promise<void>} Resolves when all is cleaned up.
     */
    stop(): Promise<void>;
    sleep(ms: any): Promise<any>;
    set streamTrack(arg: MediaStreamTrack);
    get streamTrack(): MediaStreamTrack;
    set transport(arg: any);
    get transport(): any;
    sendTransport: any;
    processPacket(packet: any): void;
    producer: any;
    streamFinished: boolean;
    originStream: ReadableStream<any>;
    fpcm: import("child_process").ChildProcessWithoutNullStreams;
    pcm: import("stream").Readable;
    #private;
}
import { MediaStreamTrack } from "werift/lib/webrtc/src/media/track";
import EventEmitter = require("events");
import prism = require("prism-media");
//# sourceMappingURL=Media.d.ts.map