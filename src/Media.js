const { MediaStreamTrack } = require("msc-node");
const EventEmitter = require("events");
const fs = require("fs");
const ffmpeg = require("ffmpeg-static");

class Media {
  constructor(logs=false, port=5030, packetHandler=(packet)=>{this.track.writeRtp(packet);}) {
    this.track = new MediaStreamTrack({ kind: "audio" });
    this.socket = require("dgram").createSocket("udp4");
    this.socket.bind(port);

    this.socket.on("message", (packet) => {
      packetHandler(packet); // defined in constructor params
    })

    this.port = port;
    this.logs = logs;
    this.playing = false;
    this.isMedia = true;

    this.ffmpeg = require("child_process").spawn(ffmpeg, [
      "-re", "-i", "-", "-map", "0:a", "-b:a", "48k", "-maxrate", "48k", "-c:a", "libopus", "-f", "rtp", "rtp://127.0.0.1:" + port
    ]);
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
  createFfmpegArgs(start="00:00:00") {
    return ["-re", "-i", "-", "-ss", start, "-map", "0:a", "-b:a", "48k", "-maxrate", "48k", "-c:a", "libopus", "-f", "rtp", "rtp://127.0.0.1:" + this.port]
  }
  getMediaTrack() {
    return this.track;
  }
  playFile(path) {
    if (!path) throw "You must specify a file to play!";
    const stream = fs.createReadStream(path);
    stream.pipe(this.ffmpeg.stdin);
  }
  writeStreamChunk(chunk) {
    if (!chunk) throw "You must pass a chunk to be written into the stream";
    this.ffmpeg.stdin.write(chunk);
  }
  playStream(stream) {
    if (!stream) throw "You must specify a stream to play!";
    stream.pipe(this.ffmpeg.stdin);
  }
  destroy() {
    return new Promise((res, rej) => {
      this.track = null;
      this.ffmpeg.kill();
      this.socket.close(res);
    });
  }
}

class MediaPlayer extends Media {
  constructor(logs=false, port=5030) {
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
    });
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

  _save(packet) {
    let time = Date.now();
    if (!this.lastPacket) this.lastPacket = time;
    this.intervals.push(time - this.lastPacket);
    this.lastPacket = time + 2;
    this.packets.push(packet);
  }
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
  finished() {
    this.track = new MediaStreamTrack({ kind: "audio" });
    this.playing = false;
    this.paused = false;
    this.disconnect(false, false);
    this.emit("finish");
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit("pause");
  }
  resume() {
    if (!this.paused) return;
    this.emit("start");
    this._write();
  }
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
    this.getMediaTrack();
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
      if (e.code == "EPIPE") return;
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
