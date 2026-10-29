const { EventEmitter } = require("events");

/**
 * @class BaseTransportAdapter
 * @classdesc Abstract transport adapter interface for Stoat voice backends (LiveKit, custom SFU, or mock testing).
 * Emits:
 * - "connected": () => void
 * - "reconnecting": () => void
 * - "reconnected": () => void
 * - "disconnected": (reason?: any) => void
 * - "participantJoined": (participant: Object) => void
 * - "participantLeft": (participant: Object) => void
 * - "audioFrameReceived": (participantId: string, frame: Object) => void
 * - "error": (err: Error) => void
 */
class BaseTransportAdapter extends EventEmitter {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.sampleRate=48000]
   * @param {number} [options.channels=2]
   * @param {number} [options.queueSizeMs=200]
   * @param {string} [options.logLevel="warn"]
   */
  constructor(options = {}) {
    super();
    this.sampleRate = options.sampleRate || 48000;
    this.channels = options.channels || 2;
    this.queueSizeMs = options.queueSizeMs || 200;
    this.logLevel = options.logLevel || "warn";
    this.connected = false;
  }

  /**
   * Connect to the voice room/transport.
   * @param {Object} params
   * @param {string} params.url
   * @param {string} params.token
   * @param {string} [params.channelId]
   * @param {boolean} [params.autoSubscribe=false]
   * @returns {Promise<void>}
   */
  async connect(_params) {
    throw new Error("BaseTransportAdapter.connect() must be implemented by subclass");
  }

  /**
   * Disconnect from the voice room and release transport resources.
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error("BaseTransportAdapter.disconnect() must be implemented by subclass");
  }

  /**
   * Reconfigure transport on token refresh or region migration without tearing down the audio pipeline.
   * @param {Object} params
   * @returns {Promise<void>}
   */
  async reconfigure(params) {
    await this.disconnect();
    await this.connect(params);
  }

  /**
   * Ensure the local audio track is published to the room.
   * @returns {Promise<void>}
   */
  async publishAudioTrack() {
    throw new Error("BaseTransportAdapter.publishAudioTrack() must be implemented by subclass");
  }

  /**
   * Push a 20ms interleaved Int16 PCM frame to the voice transport.
   * @param {Int16Array} int16Samples Interleaved stereo/mono samples (e.g. 960 samples * 2 channels = 1920 Int16s)
   * @param {number} [samplesPerChannel=960]
   * @returns {Promise<void>}\
   */
  async capturePcmFrame(_int16Samples, _samplesPerChannel) {
    throw new Error("BaseTransportAdapter.capturePcmFrame() must be implemented by subclass");
  }

  /**
   * Whether the underlying transport supports direct Opus packet injection without PCM encoding.
   * @returns {boolean}
   */
  supportsOpusPassthrough() {
    return false;
  }

  /**
   * Optional fast-path for transports supporting direct Opus packet injection.
   * @param {Buffer|Uint8Array} _opusPacket
   * @param {number} _durationMs
   * @returns {Promise<void>}
   */
  async captureOpusPacket(_opusPacket, _durationMs = 20) {
    throw new Error("Opus passthrough not supported by this transport adapter");
  }

  /**
   * Clear any buffered frames in the transport's internal queue (e.g., on pause/skip).
   */
  clearQueue() {}

  /**
   * Return an array of remote participants currently in the voice room.
   * @returns {Array<Object>}
   */
  getRemoteParticipants() {
    return [];
  }

  /**
   * Optional static hook to gracefully dispose underlying native transport runtimes on process exit.
   * @returns {Promise<void>}
   */
  static async disposeRuntime() {}
}

module.exports = BaseTransportAdapter;
