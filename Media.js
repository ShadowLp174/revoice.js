const fs = require("fs");
const { MediaStreamTrack } = require("msc-node");

class Media {
  constructor(logs=false, port=5030) {
    this.track = new MediaStreamTrack({ kind: "audio" });
    this.socket = require("dgram").createSocket("udp4");
    this.socket.bind(port);
    this.socket.addListener("message", (data) => {
      this.track.writeRtp(data);
    });

    this.port = port;

    this.ffmpeg = require("child_process").spawn("ffmpeg", [
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
}

class MediaPlayer {
  constructor(logs=false, port=5030) {
    this.media = new Media(logs, port);

    this.paused = false;
    this.currTime = null;
    this.currBuffer = new Buffer([]);

    return this;
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.media.ffmpeg.kill();
  }
  resume() {
    if (!this.paused) return;
    this.media.ffmpeg = require("child_process").spawn("ffmpeg", [
      ...this.media.createFfmpegArgs(this.currTime)
    ]);
    this.media.writeStreamChunk(this.currBuffer);
    this.paused = false;
  }
  playStream(stream) {
    this.currBuffer = new Buffer([]);
    stream.on("data", (chunk) => {
      this.currBuffer = Buffer.concat([ this.currBuffer, Buffer.from(chunk) ]);
      if (this.paused) return;
      this.media.writeStreamChunk(chunk);
    });
    stream.on("end", () => {
    });
    stream.on("error", (e) => {
      console.log("Audio source stream error: ", e);
    });

    // ffmpeg stuff
    this.media.ffmpeg.stderr.on("data", (chunk) => { // get the current seek pos
      chunk = Buffer.from(chunk).toString(); // parse to string
      chunk = chunk.split(" ").map(el => el.trim()); // split by spaces and trim the items; useful for next step
      chunk = chunk.filter(el => el.startsWith("time")); // find the element indicating the time
      chunk = chunk.join("").split("=")[1]; // extract the timestamp
      if (!chunk) return;
      this.currTime = chunk;
    });
    this.media.ffmpeg.stdin.on("error", (e) => {
      if (e.code == "EOF" || e.code == "EPIPE") return;
      throw e
    })
  }
  playFile(path) {
    return this.playStream(fs.createReadStream(path));
  }
}

module.exports = { Media, MediaPlayer };
