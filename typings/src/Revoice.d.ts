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
 * @property {String} baseURL The base url of the api of your revolt instance
 */
/**
 * @class
 * @classdesc The main class used to join channels and initiate voice connections
 * @augments EventEmitter
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
     * @param {(APIConfig)} [apiConfig={}] A configuration object for revolt-api. @see {@link https://github.com/insertish/oapi#example} The last example for further information
     * @return {Revoice}
     */
    constructor(loginData: (Login | string), apiConfig?: (APIConfig));
    session: any;
    signals: Map<any, any>;
    signaling: Signaling;
    transports: Map<any, any>;
    devices: Map<any, any>;
    connected: any[];
    connections: Map<any, any>;
    users: Map<any, any>;
    state: string;
    login(data: any, config: any): Promise<API>;
    api: any;
    connect(config: any): Promise<void>;
    updateState(state: any): void;
    /**
     * @typedef UserData
     * @property {User} user The Revoice user object associated with the user
     * @property {VoiceConnection} connection The voice connection that is connected to the user
     */
    /**
     * @description Retrieve the user object
     *
     * @param  {string} id The id of the user
     * @return {UserData} An object containing the Revoice user object and the voice connection, the user is in.
     */
    getUser(id: string): {
        /**
         * The Revoice user object associated with the user
         */
        user: User;
        /**
         * The voice connection that is connected to the user
         */
        connection: VoiceConnection;
    };
    knowsUser(id: any): boolean;
    /**
     * @description Join a specified channel
     * @example
     * voice.join("channel", 60).then(connection => { // leave after 60 seconds of inactivity
     *   const player = new MediaPlayer();
     *   connection.play(player);
     *   player.playFile("audio.mp3");
     * });
     *
     * @param  {string} channelId        The id of the voice channel you want the bot to join
     * @param  {(false|number)} leaveIfEmpty=false Specifies the amount of time in sconds, after which the bot leaves an empty voice channel. If this is set to `false`, the bot will stay unless told to leave
     * @return {Promise<VoiceConnection>} A promise containing the resulting VoiceConnection for this channel.
     */
    join(channelId: string, leaveIfEmpty?: (false | number)): Promise<VoiceConnection>;
    /**
     * @description Retrieve the VoiceConnection object for a specified voice channel
     *
     * @param  {string} channelId The id of the voice channel
     * @return {VoiceConnection}           The voice connection object
     */
    getVoiceConnection(channelId: string): VoiceConnection;
}
declare namespace Revoice {
    export { Login, APIConfig };
}
import EventEmitter = require("events");
import Signaling = require("./Signaling.js");
import { API } from "revolt-api";
/**
 * @class
 * @classdesc Operates media sources and users in voice channels
 */
declare class VoiceConnection extends EventEmitter {
    constructor(channelId: any, voice: any, opts: any);
    voice: any;
    channelId: any;
    users: any[];
    device: any;
    signaling: any;
    leaveTimeout: any;
    initialConnect: boolean;
    media: any;
    updateState(state: any): void;
    state: any;
    /**
     * @description Get all the users associated with this voice connection
     *
     * @return {User[]} An array containing all the User objects
     */
    getUsers(): User[];
    /**
     * @description Check if a user is connected to this voice channel
     *
     * @param  {string} userId The id of the user
     * @return {boolean}        Wether the user is in the voice channel
     */
    isConnected(userId: string): boolean;
    setupSignaling(): void;
    leaving: NodeJS.Timeout;
    initLeave(): void;
    initTransports(data: any): void;
    sendTransport: any;
    resetUser(user: any): void;
    /**
     * @description Attach a Media object to this connection
     *
     * @example
     * const connection = voice.getVoiceConnection("someChannelId");
     * const player = new MediaPlayer();
     * connection.play(player);
     *
     * player.playFile("./audio.mp3");
     *
     * @param  {(Media|MediaPlayer)} media The media object that should be attached
     * @return {void}
     */
    play(media: (Media | MediaPlayer)): void;
    producer: any;
    closeTransport(): Promise<any>;
    disconnect(): Promise<any>;
    destroy(): Promise<any>;
    /**
     * @description Leave the voice channel
     * @async
     * @return {void}
     */
    leave(): void;
}
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
    password: string;
};
/**
 * revolt-api configuration object. May be used for self-hosted revolt instances. @see {@link https://github.com/insertish/oapi#example} The last example for further information.
 */
type APIConfig = {
    /**
     * The base url of the api of your revolt instance
     */
    baseURL: string;
};
//# sourceMappingURL=Revoice.d.ts.map