export = User;
declare class User {
    constructor(id: any, api: any);
    id: any;
    api: any;
    connected: boolean;
    connectedTo: any;
    emitter: EventEmitter;
    username: any;
    badges: any;
    relationship: any;
    online: any;
    rawData: any;
    on(event: any, cb: any): EventEmitter;
    once(event: any, cb: any): EventEmitter;
    emit(event: any, data: any): boolean;
}
import EventEmitter = require("events");
//# sourceMappingURL=User.d.ts.map