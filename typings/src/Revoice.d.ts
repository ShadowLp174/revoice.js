export = Revoice;
/**
 * Login information required, when you want to use a user account and not a bot. Please note that an account with MFA will not work.
 * @typedef {Object} Login
 * @property {String} email The email of the account.
 * @property {String} password The password of the account.
 */
/**
 * revolt-api configuration object. May be used for self-hosted revolt instances. @see {@link https://github.com/insertish/oapi#example} The last example for further information.
 * @typedef {Object} APIConfig
 * @property {String} [baseURL] The base url of the api of your revolt instance
 * @property {String} [logLevel="warn"] LiveKit log level ("debug", "info", "warn", "error")
 * @property {typeof BaseTransportAdapter} [adapterClass] Optional custom voice transport adapter class
 * @property {Object} [adapterOptions] Optional options passed to the transport adapter
 */
/**
 * @class
 * @classdesc The main class used to join channels and initiate voice connections
 * @augments EventEmitter
 */
declare class Revoice extends EventEmitter {
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
    static VoiceConnection: any;
    static BaseTransportAdapter: typeof BaseTransportAdapter;
    static LiveKitAdapter: typeof LiveKitAdapter;
    static uid(): string;
    /**
     * @description Initiate a new Revoice instance
     *
     * @param {(Login|string)} loginData The way to login. If you're using a bot use your token, otherwise specify an email and password.
     * @param {(APIConfig)} [apiConfig={}] A configuration object for revolt-api and Revoice options.
     * @return {Revoice}
     */
    constructor(loginData: (Login | string), apiConfig?: (APIConfig));
    client: any;
    api: any;
    /** @type {Map<string, VoiceConnection>} */
    connections: Map<string, VoiceConnection>;
    state: string;
    adapterClass: typeof BaseTransportAdapter | typeof LiveKitAdapter;
    adapterOptions: any;
    /** @type {Map<string, User>} */
    users: Map<string, User>;
    _sigintHandler: () => Promise<never>;
    login(data: any, config?: {}): Promise<any>;
    session: any;
    connect(config: any): Promise<void>;
    /**
     * Join a Stoat voice channel.
     * @param {string} channelId
     * @param {boolean|number} [leaveIfEmpty=false]
     * @param {Object} [joinOptions={}]
     * @param {string} [joinOptions.node="worldwide"]
     * @param {string} [joinOptions.token] Pre-fetched call token (optional)
     * @param {string} [joinOptions.url] Pre-fetched call WebSocket URL (optional)
     * @returns {Promise<VoiceConnection>}
     */
    join(channelId: string, leaveIfEmpty?: boolean | number, joinOptions?: {
        node?: string;
        token?: string;
        url?: string;
    }): Promise<VoiceConnection>;
    /**
     * @param {string} channelId
     */
    getVoiceConnection(channelId: string): VoiceConnection;
    updateState(state: any): void;
    /**
     * @param {string} id
     */
    getUser(id: string): false | {
        user: User;
        connection?: undefined;
    } | {
        user: User;
        connection: VoiceConnection;
    };
    /**
     * @param {string} id
     */
    knowsUser(id: string): boolean;
}
declare namespace Revoice {
    export { Login, APIConfig };
}
import { EventEmitter } from "events";
/**
 * @class VoiceConnection
 * @classdesc Operates media sources and users in voice channels using a pluggable transport adapter
 * @augments EventEmitter
 */
declare class VoiceConnection extends EventEmitter {
    /**
     *
     * @param {string} channelId
     * @param {Revoice} voice
     * @param {Object} opts
     * @param {string} opts.url
     * @param {string} opts.token
     * @param {boolean|number} opts.leaveOnEmpty
     * @param {typeof BaseTransportAdapter} opts.adapterClass The class, not the instance
     */
    constructor(channelId: string, voice: Revoice, opts?: {
        url: string;
        token: string;
        leaveOnEmpty: boolean | number;
        adapterClass: typeof BaseTransportAdapter;
    });
    adapter: BaseTransportAdapter | LiveKitAdapter;
    url: string;
    token: string;
    voice: import("./Revoice");
    channelId: string;
    media: Media;
    /** @type {User[]} */
    users: User[];
    preferredVolume: number;
    leaving: NodeJS.Timeout;
    leaveTimeout: number | boolean;
    state: string;
    get room(): any;
    onSIGINT(): Promise<void>;
    updateState(state: any): void;
    getUsers(): User[];
    resetUser(user: any): void;
    handleJoin(participant: any): void;
    handleLeave(participant: any): void;
    initLeave(): void;
    isConnected(): boolean;
    get connected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    leave(): Promise<void>;
    destroy(): Promise<void>;
    /**
     * @param {Media} media
     */
    play(media: Media): Promise<void>;
    handleDisconnected(): void;
}
import BaseTransportAdapter = require("./adapters/BaseTransportAdapter.js");
import LiveKitAdapter = require("./adapters/LiveKitAdapter.js");
import User = require("./User");
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
    password: string;
};
/**
 * revolt-api configuration object. May be used for self-hosted revolt instances. @see {@link https://github.com/insertish/oapi#example} The last example for further information.
 */
type APIConfig = {
    /**
     * The base url of the api of your revolt instance
     */
    baseURL?: string;
    /**
     * LiveKit log level ("debug", "info", "warn", "error")
     */
    logLevel?: string;
    /**
     * Optional custom voice transport adapter class
     */
    adapterClass?: typeof BaseTransportAdapter;
    /**
     * Optional options passed to the transport adapter
     */
    adapterOptions?: any;
};
import { Media } from "./Media";
//# sourceMappingURL=Revoice.d.ts.map