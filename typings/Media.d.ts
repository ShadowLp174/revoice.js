/// <reference types="node" />
/// <reference types="node" />
export class Media {
    constructor(logs?: boolean, port?: number, packetHandler?: (packet: any) => void);
    track: MediaStreamTrack;
    socket: import("dgram").Socket;
    port: number;
    logs: boolean;
    playing: boolean;
    isMedia: boolean;
    ffmpeg: import("child_process").ChildProcessWithoutNullStreams;
    on(event: any, cb: any): string;
    once(event: any, cb: any): string;
    createFfmpegArgs(start?: string): string[];
    getMediaTrack(): MediaStreamTrack;
    playFile(path: any): void;
    writeStreamChunk(chunk: any): void;
    playStream(stream: any): void;
    destroy(): Promise<any>;
}
export class MediaPlayer extends Media {
    static timestampToSeconds(timestamp?: string, ceilMinutes?: boolean): string;
    constructor(logs?: boolean, port?: number);
    started: boolean;
    isMediaPlayer: boolean;
    emitter: EventEmitter;
    currTime: string;
    packets: any[];
    intervals: any[];
    lastPacket: number;
    paused: boolean;
    ffmpegKilled: boolean;
    on(event: any, cb: any): EventEmitter;
    once(event: any, cb: any): EventEmitter;
    emit(event: any, data: any): boolean;
    _save(packet: any): void;
    _write(): boolean;
    writing: boolean;
    disconnect(destroy?: boolean, f?: boolean): void;
    destroy(): Promise<[any, any]>;
    finished(): void;
    setVolume(v?: number): void;
    pause(): void;
    resume(): void;
    stop(): Promise<any>;
    sleep(ms: any): Promise<any>;
    set streamTrack(arg: void);
    get streamTrack(): void;
    set transport(arg: any);
    get transport(): any;
    sendTransport: any;
    playStream(stream: any): Promise<void>;
    producer: any;
    streamFinished: boolean;
    originStream: any;
    #private;
}
import { MediaStreamTrack } from "werift/lib/webrtc/src/media/track";
import EventEmitter = require("events");
//# sourceMappingURL=Media.d.ts.map
