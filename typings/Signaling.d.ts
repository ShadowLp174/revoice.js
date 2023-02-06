export = Signaling;
declare class Signaling {
    constructor(apiClient: any, channelId: any, reconnectTimeout?: number);
    client: any;
    channelId: any;
    reconnectTimeout: number;
    eventemitter: EventEmitter;
    currId: number;
    reconnecting: boolean;
    users: any[];
    roomEmpty: boolean;
    emit(event: any, cb: any): boolean;
    on(event: any, cb: any): EventEmitter;
    once(event: any, cb: any): EventEmitter;
    authenticate(): void;
    connect(channel: any): void;
    disconnect(): void;
    reconnect(): void;
    initWebSocket(data: any): void;
    ws: any;
    processWS(data: any): void;
    addUser(user: any): void;
    removeUser(id: any): any;
    isConnected(userId: any): boolean;
    fetchRoomInfo(): Promise<any>;
    eventToPromise(emitter: any, event: any): Promise<any>;
    connectTransport(id: any, params: any): Promise<any>;
    startProduce(type: any, params: any): Promise<any>;
    stopProduce(type?: string): Promise<any>;
}
import EventEmitter = require("events");
//# sourceMappingURL=Signaling.d.ts.map