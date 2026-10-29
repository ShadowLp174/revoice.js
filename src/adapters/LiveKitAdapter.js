const BaseTransportAdapter = require("./BaseTransportAdapter.js");

let livekitModule = null;
function getLiveKit() {
  if (!livekitModule) {
    if (!process.env.LIVEKIT_LOG_LEVEL) {
      process.env.LIVEKIT_LOG_LEVEL = "warn";
    }
    livekitModule = require("@livekit/rtc-node");
  }
  return livekitModule;
}

/**
 * @class LiveKitAdapter
 * @augments BaseTransportAdapter
 * @classdesc LiveKit WebRTC SFU transport adapter for Stoat Voice v2.
 * Supports low-latency 200ms AudioSource frame queueing and optional remote participant audio reception.
 */
class LiveKitAdapter extends BaseTransportAdapter {
  /**
   * @param {Object} [options={}]\
   * @param {number} [options.sampleRate=48000]\
   * @param {number} [options.channels=2]\
   * @param {number} [options.queueSizeMs=200] Low-latency internal queue (200ms = 10 frames of 20ms)\
   * @param {string} [options.logLevel="warn"]\
   * @param {boolean} [options.receiveAudio=false]\
   */
  constructor(options = {}) {
    super(options);
    if (options.logLevel) {
      process.env.LIVEKIT_LOG_LEVEL = options.logLevel;
    }

    this.room = null;
    this.source = null;
    this.track = null;
    this.trackPublished = false;
    this._publishPromise = null;
    this.receiveAudio = !!options.receiveAudio;
    this.audioStreams = new Map();
  }

  /**
   * Initialize LiveKit Room and bind room events.
   */
  #initRoom() {
    const { Room, RoomEvent, TrackKind, AudioStream } = getLiveKit();
    this.room = new Room();

    this.room
      .on(RoomEvent.Disconnected, (reason) => {
        this.connected = false;
        this.trackPublished = false;
        this._publishPromise = null;
        this.emit("disconnected", reason);
      })
      .on(RoomEvent.Reconnecting, () => {
        this.emit("reconnecting");
      })
      .on(RoomEvent.Reconnected, () => {
        this.connected = true;
        this.emit("reconnected");
      })
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        this.emit("connectionStateChanged", state);
      })
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this.emit("participantJoined", participant);
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.#cleanupAudioStream(participant.identity);
        this.emit("participantLeft", participant);
      });

    if (this.receiveAudio) {
      this.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === TrackKind.KIND_AUDIO) {
          this.#startAudioStream(participant.identity, track, AudioStream);
        }
      });
      this.room.on(RoomEvent.TrackUnsubscribed, (_track, _publication, participant) => {
        this.#cleanupAudioStream(participant.identity);
      });
    }
  }

  /**
   * @param {string} participantId
   * @param {Object} track
   * @param {Function} AudioStreamClass
   */
  async #startAudioStream(participantId, track, AudioStreamClass) {
    this.#cleanupAudioStream(participantId);
    try {
      const stream = new AudioStreamClass(track, this.sampleRate, this.channels);
      const state = { active: true, stream };
      this.audioStreams.set(participantId, state);

      for await (const frame of stream) {
        if (!state.active) break;
        this.emit("audioFrameReceived", participantId, frame);
      }
    } catch (err) {
      this.emit("error", err);
    }
  }

  #cleanupAudioStream(participantId) {
    const state = this.audioStreams.get(participantId);
    if (state) {
      state.active = false;
      this.audioStreams.delete(participantId);
    }
  }

  /**
   * @override
   */
  async connect({ url, token, autoSubscribe = false }) {
    if (!this.room) {
      this.#initRoom();
    }
    await this.room.connect(url, token, {
      autoSubscribe: this.receiveAudio ? true : autoSubscribe,
      logLevel: this.logLevel,
    });
    this.connected = true;
    this.emit("connected");
  }

  /**
   * @override
   */
  async publishAudioTrack() {
    if (this.trackPublished && this.source && this.track) {
      return;
    }
    if (this._publishPromise) {
      return this._publishPromise;
    }

    this._publishPromise = (async () => {
      try {
        if (!this.room || !this.connected) {
          throw new Error("Cannot publish audio track before room is connected");
        }

        const { AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource } = getLiveKit();
        if (!this.source) {
          this.source = new AudioSource(this.sampleRate, this.channels, this.queueSizeMs);
        }
        if (!this.track) {
          const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
          this.track = LocalAudioTrack.createAudioTrack("audio-" + id, this.source);
        }

        const options = new TrackPublishOptions();
        options.source = TrackSource.SOURCE_MICROPHONE;

        await this.room.localParticipant.publishTrack(this.track, options);
        this.trackPublished = true;
      } finally {
        this._publishPromise = null;
      }
    })();

    return this._publishPromise;
  }

  /**
   * Push a 20ms interleaved Int16 PCM frame to LiveKit's AudioSource.
   * Uses the frame's Int16Array directly to prevent race conditions during asynchronous delivery.
   * @override
   * @param {Int16Array} int16Samples
   * @param {number} [samplesPerChannel]
   */
  async capturePcmFrame(int16Samples, samplesPerChannel) {
    if (!this.trackPublished || !this.source) {
      await this.publishAudioTrack();
    }
    const { AudioFrame } = getLiveKit();
    const spc = samplesPerChannel || Math.trunc(int16Samples.length / this.channels);

    const frame = new AudioFrame(
      int16Samples,
      this.sampleRate,
      this.channels,
      spc
    );

    await this.source.captureFrame(frame);
  }

  /**
   * @override
   */
  clearQueue() {
    if (this.source && typeof this.source.clearQueue === "function") {
      try {
        this.source.clearQueue();
      } catch (_) {}
    }
  }

  /**
   * @override
   */
  getRemoteParticipants() {
    if (!this.room || !this.room.remoteParticipants) return [];
    const participants = [];
    for (const [, p] of this.room.remoteParticipants) {
      participants.push(p);
    }
    return participants;
  }

  /**
   * @override
   */
  async disconnect() {
    for (const id of this.audioStreams.keys()) {
      this.#cleanupAudioStream(id);
    }
    this.audioStreams.clear();

    if (this.room) {
      try {
        await this.room.disconnect();
      } catch (_) {}
      this.room = null;
    }
    this.source = null;
    this.track = null;
    this.trackPublished = false;
    this._publishPromise = null;
    this.connected = false;
  }

  /**
   * Static helper to gracefully dispose the global LiveKit FFI runtime on process exit.
   */
  static async disposeRuntime() {
    if (!livekitModule) return;
    try {
      if (typeof livekitModule.dispose === "function") {
        await livekitModule.dispose();
      }
    } catch (_) {}
  }
}

module.exports = LiveKitAdapter;
