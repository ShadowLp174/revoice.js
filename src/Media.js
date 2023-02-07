const { MediaStreamTrack } = require("msc-node");
const EventEmitter = require("events");
const fs = require("fs");
const ffmpeg = require("ffmpeg-static");

/**
 * @class
 * @classdesc Basic class to process audio streams
 */
class Media {
  /**
   * @description Init the media object
   *
   * @param {boolean} logs=false Wether or not to output logs
   * @param {number} port=5030 A ffmpeg rtp port that this instance will be using.
   * @param {PacketHandler} packetHandler=(packet)=>{this.track.writeRtp(packet);} The function that determines how audio packets are handled.
   *
   * @return {Media} The new Media object instance
   */
  constructor(logs=false, port=5030, packetHandler=(packet)=>{this.track.writeRtp(packet);}, inputFormat="") {
    this.track = new MediaStreamTrack({ kind: "audio" });
    this.socket = require("dgram").createSocket("udp4");
    this.socket.bind(port);

    this.socket.on("message", (packet) => {
      packetHandler(packet); // defined in constructor params
    })

    this.inputFormat = inputFormat.trim() + " ";
    this.port = port;
    this.logs = logs;
    this.playing = false;
    this.isMedia = true;

    this.ffmpeg = require("child_process").spawn(ffmpeg, this.ffmpegArgs(port));
    if (logs) {
      this.ffmpeg.stdout.on("data", (data) => {
        console.log(Buffer.from(data).toString());
      })
      this.ffmpeg.stderr.on("data", (data) => {
        console.log(Buffer.from(data).toString());
      });
    }

    return this;
  }
  on(event, cb) {
    return "Unimplemented";
  }
  once(event, cb) {
    return "Unimplemented";
  }

  ffmpegArgs(port) {
    return ("-re " + this.inputFormat + "-i - -map 0:a -b:a 48k -maxrate 48k -acodec libopus -ar 48000 -ac 2 -f rtp rtp://127.0.0.1:" + port).split(" ");
  }
  /**
   * Returns an array of arguments that can be passed to ffmpeg
   *
   * @param  {string} start="00:00:00" The position in the audio to start the conversion.
   * @return {Array<string>}           The arguments.
   */
  createFfmpegArgs(start="00:00:00") {
    return this.ffmpegArgs(this.port);
  }
  /**
   * @description Returns the current mediasoup media track
   *
   * @return {MediaStreamTrack}  The mediasoup MediaStreamTrack
   */
  getMediaTrack() {
    return this.track;
  }
  /**
   * Load and process an audio file
   *
   * @param  {string} path The file path of the file
   * @return {void}
   */
  playFile(path) {
    if (!path) throw "You must specify a file to play!";
    const stream = fs.createReadStream(path);
    stream.pipe(this.ffmpeg.stdin);
  }
  /**
   * Writes a chunk of data into the ffmpeg process.
   *
   * @param  {object} chunk The datachunk to write.
   * @return {void}
   */
  writeStreamChunk(chunk) {
    if (!chunk) throw "You must pass a chunk to be written into the stream";
    this.ffmpeg.stdin.write(chunk);
  }
  /**
   * Pipe a ReadStream into the ffmpeg process.
   *
   * @param  {Stream} stream The stream to pipe.
   * @return {void}
   */
  playStream(stream) {
    if (!stream) throw "You must specify a stream to play!";
    stream.pipe(this.ffmpeg.stdin);
  }
  /**
   * Kill the ffmpeg instance and close the socket.
   *
   * @return {Promise<void>} A promise resolving when the udp4 socket closed.
   */
  destroy() {
    return new Promise((res, _rej) => {
      this.track = null;
      this.ffmpeg.kill();
      this.socket.close(res);
    });
  }
}

/**
 * @class
 * @augments Media
 * @description An advanced version of the Media class. It also includes media controls like pausing.
 */
class MediaPlayer extends Media {
  /**
   * @description Initiates the MediaPlayer instance.
   *
   * @param  {boolean} logs=false Wether or not to print logs to the console or not.
   * @param  {number} port=5030  The port this instance should use.
   * @param  {string} iFormat="" Optional arguments that specify the input format that are passed to ffmpeg
   * @return {MediaPlayer}            The new instance.
   */
  constructor(logs=false, port=5030, iFormat) {
    super(logs, port, (packet) => {
      if (!this.started) {
        this.started = true;
        this.emit("start");
      }
      if (this.paused) {
        return this._save(packet);
      }
      if (packet == "FINISHPACKET") return this.finished();
      this.track.writeRtp(packet);
    }, iFormat);
    this.isMediaPlayer = true;

    this.emitter = new EventEmitter();

    this.currTime = null;
    this.logs = logs;
    this.started = false;
    this.packets = [];
    this.intervals = [];
    this.lastPacket = null;
    this.paused = false;
    this.ffmpegKilled = false;

    return this;
  }
  on(event, cb) {
    return this.emitter.on(event, cb);
  }
  once(event, cb) {
    return this.emitter.once(event, cb);
  }
  emit(event, data) {
    return this.emitter.emit(event, data);
  }

  static timestampToSeconds(timestamp="00:00:00", ceilMinutes=false) {
    timestamp = timestamp.split(":").map((el, index) => {
      if (index < 2) {
        return parseInt(el);
      } else {
        return ((ceilMinutes) ? Math.ceil(parseFloat(el)) : parseFloat(el));
      }
    });
    const hours = timestamp[0];
    const minutes = timestamp[1];
    const currSeconds = timestamp[2];
    return (hours * 60 * 60) + (minutes * 60) + currSeconds; // convert everything to seconds
  }

  /**
   * @description Saves a data packet temporarily
   *
   * @param  {object} packet The packet to store.
   * @return {void}
   */
  _save(packet) {
    let time = Date.now();
    if (!this.lastPacket) this.lastPacket = time;
    this.intervals.push(time - this.lastPacket);
    this.lastPacket = time + 2;
    this.packets.push(packet);
  }
  /**
   * @description Start writing the data from the temporal storage to the media track. Recursive, will stop when the storage is empty.
   *
   * @return {void}
   */
  _write() {
    if (this.packets.length == 0) { this.paused = false; return this.writing = false;}
    this.writing = true;
    let interval = this.intervals.shift();
    let packet = this.packets.shift();
    setTimeout(() => {
      if (packet == "FINISHPACKET") {
        this.finished();
        return this._write();
      }
      this.track.writeRtp(packet);
      this._write();
    }, interval);
  }
  /**
   * @description Cleans up this instance. Should be called when the bot is leaving.
   *
   * @param  {boolean} destroy=true Wether or not to replace the mediatrack
   * @param  {boolean} f=true       Wether or not to respawn the ffmpeg instance.
   * @return {void}
   */
  disconnect(destroy=true, f=true) { // this should be called on leave
    if (destroy) this.track = new MediaStreamTrack({ kind: "audio" }); // clean up the current data and streams
    this.paused = false;
    if (f) {this.ffmpegKilled = true; this.ffmpeg.kill();}
    this.originStream.destroy();
    this.currTime = "00:00:00";

    if (f) {
      this.ffmpeg = require("child_process").spawn(ffmpeg, [ // set up new ffmpeg instance
        ...this.createFfmpegArgs()
      ]);
    }
    this.packets = [];
    this.intervals = [];
    this.started = false
    if (f) this.#setupFmpeg();
  }
  /**
   * @description Destroys all streams and frees the port.
   *
   * @return {Promise<void>} A promise that resolves when everything is finished.
   */
  destroy() {
    return Promise.all([
      super.destroy(),
      new Promise((res) => {
        this.packets = [];
        this.intervals = [];
        this.originStream.destroy();
        res();
      })
    ]);
  }
  /**
   * @description Function that is called when the ffmpeg stream finishes.
   *
   * @return {void}
   */
  finished() {
    this.track = new MediaStreamTrack({ kind: "audio" });
    this.playing = false;
    this.paused = false;
    this.disconnect(false, false);
    this.emit("finish");
  }
  /**
   * @description Pause the current playback
   *
   * @return {void}
   */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit("pause");
  }
  /**
   * @description Resume the current playback.
   *
   * @return {void}
   */
  resume() {
    if (!this.paused) return;
    this.emit("start");
    this._write();
  }
  /**
   * @description Stop the playback.
   *
   * @return {Promise<void>} Resolves when all is cleaned up.
   */
  stop() {
    return new Promise(async (res) => {
      this.ffmpegKilled = true;
      this.ffmpeg.kill();
      this.ffmpeg = require("child_process").spawn(ffmpeg, [ // set up new ffmpeg instance
        ...this.createFfmpegArgs()
      ]);
      await this.sleep(1000);
      this.paused = false;
      this.originStream.destroy();

      this.packets = [];
      this.intervals = [];
      this.started = false;
      this.track = new MediaStreamTrack({ kind: "audio" });
      this.emit("finish");
      res();
    });
  }
  sleep(ms) {
    return new Promise((res) => {
      setTimeout(res, ms);
    });
  }
  get streamTrack() {
    if (!this.track) this.track = new MediaStreamTrack({ kind: "audio" });
    return this.getMediaTrack();
  }
  set streamTrack(t) {
    console.log("This should not be done.", t);
  }
  set transport(t) {
    this.sendTransport = t;
  }
  get transport() {
    return this.sendTransport;
  }

  /**
   * @description Play an audio read stream to the media track.
   *
   * @param  {ReadableStream} stream The stream to play.
   * @return {void}
   */
  async playStream(stream) {
    if (this.sendTransport) this.producer = await this.sendTransport.produce({ track: this.track, appData: { type: "audio" } });
    this.emit("buffer", this.producer);
    this.started = false;
    this.streamFinished = false;
    this.originStream = stream;
    this.originStream.on("end", () => {
      this.streamFinished = true;
    });

    // ffmpeg stuff
    this.#setupFmpeg();

    super.playStream(stream); // start playing
  }
  async #ffmpegFinished() {
    await this.sleep(1000); // prevent bug with no music after 3rd song
    this.socket.send("FINISHPACKET", this.port);
    this.originStream.destroy();
    this.ffmpeg.kill();
    this.currTime = "00:00:00";
    this.ffmpeg = require("child_process").spawn(ffmpeg, [ // set up new ffmpeg instance
      ...this.createFfmpegArgs()
    ]);
  }
  #setupFmpeg() {
    this.ffmpeg.on("exit", async (_c, s) => {
      if (s == "SIGTERM" || this.ffmpegKilled) return this.ffmpegKilled = false; // killed intentionally
      this.#ffmpegFinished();
    });
    this.ffmpeg.stdin.on("error", (e) => {
      //if (e.code == "EPIPE") return;
      console.log("Ffmpeg error: ", e);
    });
    if (!this.logs) return;
    this.ffmpeg.stderr.on("data", (chunk) => {
      console.log("err", Buffer.from(chunk).toString());
    });
    this.ffmpeg.stdout.on("data", (chunk) => {
      console.log("OUT", Buffer.from(chunk().toString()));
    });
    this.ffmpeg.stdout.on("end", () => {
      console.log("finished");
    });
    this.ffmpeg.stdout.on("readable", () => {
      console.log("readable")
    });
  }
}

module.exports = { Media, MediaPlayer };
