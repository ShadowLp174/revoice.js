
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
  getMediaTrack() {
    return this.track;
  }
  playFile(path) {
    if (!path) throw "You must specify a file to play!";
    const stream = fs.createReadStream(path);
    stream.pipe(this.ffmpeg.stdin);
  }
  playStream(stream) {
    if (!stream) throw "You must specify a stream to play!";
    stream.pipe(this.ffmpeg.stdin);
  }
}

module.exports = Media;
