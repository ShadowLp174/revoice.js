export = User;
/**
 * @class
 * @classdesc A user object storing data about a user associated with revoice
 */
declare class User extends EventEmitter {
    constructor(id: any, api: any);
    id: any;
    api: any;
    connected: boolean;
    connectedTo: any;
    username: any;
    badges: any;
    relationship: any;
    online: any;
    rawData: any;
}
import EventEmitter = require("events");
//# sourceMappingURL=User.d.ts.map