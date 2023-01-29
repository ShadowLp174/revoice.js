export = Revoice;
declare class Revoice {
    static createDevice(): Device;
    static State: {
        OFFLINE: string;
        IDLE: string;
        BUFFERING: string;
        PLAYING: string;
        PAUSED: string;
        JOINING: string;
        UNKNOWN: string;
    };
    static Error: {
        ALREADY_CONNECTED: string;
        NOT_A_VC: string;
        VC_ERROR: string;
    };
    static uid(): string;
    constructor(token: any);
    api: any;
    signals: Map<any, any>;
    signaling: Signaling;
    eventemitter: EventEmitter;
    transports: Map<any, any>;
    devices: Map<any, any>;
    connected: any[];
    connections: Map<any, any>;
    users: Map<any, any>;
    state: string;
    updateState(state: any): void;
    on(event: any, cb: any): EventEmitter;
    once(event: any, cb: any): EventEmitter;
    emit(event: any, data: any): boolean;
    getUser(id: any): false | {
        user: any;
        connection?: undefined;
    } | {
        user: any;
        connection: any;
    };
    knowsUser(id: any): boolean;
    join(channelId: any, leaveIfEmpty?: boolean): Promise<any>;
    getVoiceConnection(channelId: any): any;
}
import Signaling = require("./Signaling.js");
import EventEmitter = require("events");
import { Device } from "msc-node";
//# sourceMappingURL=Revoice.d.ts.map