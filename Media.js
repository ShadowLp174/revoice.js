const { MediaStreamTrack } = require("msc-node");
const EventEmitter = require("events");
const fs = require("fs");
const ffmpeg = require("ffmpeg-static");

class Media {
  constructor(logs=false, port=5030, packetHandler=(packet)=>{this.track.writeRtp(packet);}) {
    this.track = new MediaStreamTrack({ kind: "audio" });
    this.socket = require("dgram").createSocket("udp4");
    this.socket.bind(port);

    const _this = this;
    this.opusPackets = new require("stream").Readable({
      read: async function() {
        this.push(await _this.getRtpMessage());
      }
    });
    this.opusPackets.on("data", (packet) => {
      packetHandler(packet); // defined in the constructor params
    });

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

  getRtpMessage() {
    return new Promise((res) => {
      this.socket.once("message", (msg) => {
        res(msg);
      });
    });
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
      this.opusPackets.destroy();
      this.socket.close(res);
    });
  }
}

class MediaPlayer extends Media {
  constructor(logs=false, port=5030) {
    super(logs, port, (packet) => {
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
  disconnect(destroy=true) { // this should be called on leave
    if (destroy) this.track = new MediaStreamTrack({ kind: "audio" }); // clean up the current data and streams
    this.paused = false;
    this.ffmpeg.kill();
    this.originStream.destroy();
    this.currTime = "00:00:00";

    this.ffmpeg = require("child_process").spawn(ffmpeg, [ // set up new ffmpeg instance
      ...this.createFfmpegArgs()
    ]);
    this.packets = [];
    this.intervals = [];
    this.opusPackets.once("data", () => {
      this.started = true;
      this.emit("start");
    });
    this.#setupFmpeg();
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
    this.playing = false;
    this.disconnect(false);
    this.emit("finish");
  }
  cleanUp() { // TODO: similar to disconnect() but doesn't kill existing processes
    this.paused = false;
    this.currBuffer = null;
    this.currTime = "00:00:00";
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit("pause");
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.emit("start");
    this._write();
  }
  stop() { // basically the same as process on disconnect
    this.disconnect(false);
    this.emit("finish");
  }
  get streamTrack() {
    if (!this.track) this.track = new MediaStreamTrack({ kind: "audio" });
    this.getMediaTrack();
  }
  set streamTrack(t) {
    console.log("This should not be done.", t);
  }
  playStream(stream) {
    this.emit("buffer");
    this.started = false;
    this.streamFinished = false;
    this.originStream = stream;
    this.originStream.on("end", () => {
      this.streamFinished = true;
    });
    this.opusPackets.once("data", () => {
      this.started = true;
      this.emit("start");
    });

    // ffmpeg stuff
    this.#setupFmpeg();

    super.playStream(stream); // start playing
  }
  #setupFmpeg() {
    this.ffmpeg.stderr.on("data", (chunk) => {
      if (this.logs) console.log("err", Buffer.from(chunk).toString());
      chunk = Buffer.from(chunk).toString(); // parse to string
      if (chunk.includes("time")) {  // get the current seek pos
        chunk = chunk.split(" ").map(el => el.trim()); // split by spaces and trim the items; useful for next step
        chunk = chunk.filter(el => el.startsWith("time")); // find the element indicating the time
        chunk = chunk.join("").split("=")[1]; // extract the timestamp
        if (!chunk) return;
        this.currTime = chunk;
        if (this.finishTimeout) clearTimeout(this.finishTimeout);
        this.finishTimeout = setTimeout(() => { // TODO: I REALLY need a better way to do this
          if (this.streamFinished) {
            this.socket.send("FINISHPACKET", this.port);
            // reset ffmpeg to prepare for next stream
            this.ffmpeg.kill();
            this.originStream.destroy();
            this.currTime = "00:00:00";
            this.ffmpeg = require("child_process").spawn(ffmpeg, [ // set up new ffmpeg instance
              ...this.createFfmpegArgs()
            ]);
          }
        }, 2000);
      } else if (chunk.trim().toLowerCase().includes("duration")) { // get the duration in seconds
        chunk = chunk.trim().toLowerCase(); // clean it up a bit
        chunk = chunk.split("\n").map(el => el.trim()).find(el => el.includes("duration")); // find the element that displays the duration
        chunk = chunk.split(",")[0].trim(); // get the duration part out of the line and clean i up
        chunk = chunk.split(":").slice(1).join(":").trim(); // remove the "duration: " from the start
        if (this.logs) console.log("Audio duration: ", MediaPlayer.timestampToSeconds(chunk));
      }
    });
    this.ffmpeg.stdout.on("data", (chunk) => {
      if (this.logs) console.log("OUT", Buffer.from(chunk().toString()));
    });
    this.ffmpeg.stdout.on("end", () => {
      this.playing = false;
      if (this.logs) console.log("finished");
      this.emit("finish");
    });
    this.ffmpeg.stdout.on("readable", () => {
      if (this.logs) console.log("readable")
    });
    this.ffmpeg.stdin.on("error", (e) => {
      if (e.code == "EOF" || e.code == "EPIPE") return;
      console.log("Media; ffmpeg; stdin: ");
      throw e
    });
  }
}

module.exports = { Media, MediaPlayer };
