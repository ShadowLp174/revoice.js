export = Revoice;
/**
 * Login information required, when you want to use a user account and not a bot. Please note that an account with MFA will not work.
 * @typedef {Object} Login
 * @property {String} email The email of the account.
 * @property {Stirng} password The password of the account.
 */
declare class Revoice extends EventEmitter {
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
    /**
     * @description Initiate a new Revoice instance
     *
     * @param  {(Login|string)} loginData The way to login. If you're using a bot use your token, otherwise specify an email and password.
     * @return {Revoice}
     */
    constructor(loginData: (Login | string));
    session: any;
    signals: Map<any, any>;
    signaling: Signaling;
    transports: Map<any, any>;
    devices: Map<any, any>;
    connected: any[];
    connections: Map<any, any>;
    users: Map<any, any>;
    state: string;
    login(data: any): Promise<API>;
    api: any;
    connect(): Promise<void>;
    updateState(state: any): void;
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
declare namespace Revoice {
    export { Login };
}
import EventEmitter = require("events");
import Signaling = require("./Signaling.js");
import { API } from "revolt-api";
import { Device } from "msc-node";
/**
 * Login information required, when you want to use a user account and not a bot. Please note that an account with MFA will not work.
 */
type Login = {
    /**
     * The email of the account.
     */
    email: string;
    /**
     * The password of the account.
     */
    password: Stirng;
};
//# sourceMappingURL=Revoice.d.ts.map