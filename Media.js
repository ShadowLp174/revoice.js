const { MediaStreamTrack } = require("msc-node");
const EventEmitter = require("events");
const fs = require("fs");
const ffmpeg = require("ffmpeg-static");

class Media {
  constructor(logs=false, port=5030) {
    this.track = new MediaStreamTrack({ kind: "audio" });
    this.socket = require("dgram").createSocket("udp4");
    this.socket.bind(port);
    var msg = () => {
      return new Promise((res) => {
        socket.once("message", (msg) => {
          res(msg);
        });
      });
    }
    const socket = this.socket;
    const stream = new require("stream").Readable({
      read: async function() {
        this.push(await msg());
      }
    });
    let t = null;
    const packets = [];
    let lastPacket = null;
    stream.on("data", (d) => {
      let time = Date.now();
      if (!lastPacket) lastPacket = time;
      console.log("d ", time - lastPacket);
      lastPacket = time;
      this.track.writeRtp(d);
      if (!t) {
        t = setTimeout(() => {
          stream.pause();
          setTimeout(() => {
            stream.resume();
          }, 3000);
        }, 1000);
      }
    });

    this.socket.addListener("message", (data) => {
      //this.track.writeRtp(data);
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

  createFfmpegArgs(start="00:00:00") {
    return ["-re", "-i", "-", "-ss", start, "-map", "0:a", "-b:a", "48k", "-maxrate", "48k", "-c:a", "libopus", "-f", "rtp", "-"]
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
}

class MediaPlayer {
  constructor(logs=false, port=5030) {
    this.media = new Media(logs, port);

    this.emitter = new EventEmitter();

    this.paused = false;
    this.currTime = null;
    this.streamFinished = false;
    this.finishTimeout = null;
    this.currBuffer = new Buffer([]);
    this.logs = logs;

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

  disconnect(destroy=true) { // this should be called on leave
    if (destroy) this.media.track = null; // clean up the current data and streams
    this.originStream.destroy();
    this.paused = false;
    this.media.ffmpeg.kill();
    this.currBuffer = null;
    this.streamFinished = true;
    this.currTime = "00:00:00";

    this.media.ffmpeg = require("child_process").spawn(ffmpeg, [ // set up new ffmpeg instance
      ...this.media.createFfmpegArgs()
    ]);
  }
  cleanUp() { // TODO: similar to disconnect() but doesn't kill existing processes
    this.paused = false;
    this.currBuffer = null;
    this.currTime = "00:00:00";
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.media.ffmpeg.kill();
  }
  resume() {
    if (!this.paused) return;
    this.media.ffmpeg = require("child_process").spawn(ffmpeg, [
      ...this.media.createFfmpegArgs(this.currTime)
    ]);
    this.#setupFmpeg();
    this.media.writeStreamChunk(this.currBuffer);
    this.paused = false;
  }
  stop() { // basically the same as process on disconnect
    this.disconnect(false);
    this.emit("finish");
  }
  get track() {
    if (!this.media.track) this.media.track = new MediaStreamTrack({ kind: "audio" });
    this.media.getMediaTrack();
  }
  set track(t) {
    console.log("This should not be done.", t);
  }
  playStream(stream) {
    //if (!this.media.track) this.media.track = new MediaStreamTrack({ kind: "audio" });

    this.originStream = stream;
    this.currBuffer = new Buffer([]);
    this.playing = true;
    this.streamFinished = false;

    this.started = false;

    stream.on("data", (chunk) => {
      if (!this.started) {
        this.emit("start");
        this.started = true;
      }
      if (!chunk) return;
      this.currBuffer = Buffer.concat([ this.currBuffer, Buffer.from(chunk) ]);
      if (this.paused) return;
      this.media.writeStreamChunk(chunk);
    });
    stream.on("end", () => {
      this.streamFinished = true;
    });
    stream.on("error", (e) => {
      this.streamFinished = true;
      console.log("Audio source stream error: ", e);
    });

    // ffmpeg stuff
    this.#setupFmpeg();
  }
  #setupFmpeg() {
    this.media.ffmpeg.stderr.on("data", (chunk) => {
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
            this.playing = false;
            this.disconnect(false);
            this.emit("finish");
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
    this.media.ffmpeg.stdout.on("data", (chunk) => {
      if (this.logs) console.log("OUT", Buffer.from(chunk().toString()));
    });
    this.media.ffmpeg.stdout.on("end", () => {
      this.playing = false;
      if (this.logs) console.log("finished");
      this.emit("finish");
    });
    this.media.ffmpeg.stdout.on("readable", () => {
      if (this.logs) console.log("readable")
    });
    this.media.ffmpeg.stdin.on("error", (e) => {
      if (e.code == "EOF" || e.code == "EPIPE") return;
      console.log("Media; ffmpeg; stdin: ");
      throw e
    });
  }
  playFile(path) {
    return this.playStream(fs.createReadStream(path));
  }
}

module.exports = { Media, MediaPlayer };
