export = User;
/**
 * @class
 * @classdesc A user object storing data about a user associated with revoice
 */
declare class User extends EventEmitter {
    constructor(participant?: {});
    id: any;
    connected: boolean;
    connectedTo: any;
    participant: {};
    metadata: {};
    username: any;
    discriminator: any;
    badges: any;
    relationship: any;
    online: any;
    rawData: {};
}
import EventEmitter = require("events");
//# sourceMappingURL=User.d.ts.map