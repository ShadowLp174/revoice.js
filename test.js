const { API } = require("revolt-api");
const Signaling = require("./Signaling.js");
const fs = require("fs");
const prism = require("prism-media");

const { Device, useSdesMid, useAbsSendTime, MediaStreamTrack, RTCRtpCodecParameters, useFIR, useNACK, usePLI, useREMB } = require("msc-node");

const bottoken = require("./config.json").token;
const client = new API({ authentication: { revolt: bottoken }});
const signaling = new Signaling(client, "01GA8VZE79JGPEPBT6KEN54686");
signaling.on("token", console.log);
signaling.on("authenticate", (data) => {
  console.log(data);
  device.load({ routerRtpCapabilities: data.data.rtpCapabilities });
});
signaling.on("initTransports", (data) => {
  // init connection
  console.log(data);
  initTransports(data);
});
signaling.authenticate(); // start signaling flow
const device = new Device({
  headerExtensions: {
    audio: [
      useSdesMid(),
    ]
  },
  codecs: {
    audio: [
      new RTCRtpCodecParameters({
        mimeType: "audio/opus",
        clockRate: 48000,
        preferredPayloadType: 100,
        channels: 2
      })
    ]
  }
});

async function initTransports(data) {
  console.log("init");
  const sendTransport = device.createSendTransport({...data.data.sendTransport});
  sendTransport.on("connect", ({ dtlsParameters }, callback) => {
    signaling.connectTransport(sendTransport.id, dtlsParameters).then(callback);
  });
  sendTransport.on("produce", (parameters, callback) => {
    signaling.startProduce("audio", parameters.rtpParameters).then((id) => {
      console.log(id);
      callback({ id });
    });
  });

  const track = new MediaStreamTrack({ kind: "audio" });
  const socket = require("dgram").createSocket("udp4");
  socket.bind(5030);

  ffmpeg = require("child_process").spawn("ffmpeg", [
    "-re", "-i", "-", "-map", "0:a", "-b:a", "48k", "-maxrate", "48k", "-c:a", "libopus", "-f", "rtp", "rtp://127.0.0.1:" + 5030
  ]);

  const stream = fs.createReadStream(__dirname + "\\assets\\warbringer.mp3");
  /*opusEncoder.on("readable", () => {
    console.log("readable");
    while (true) {
      let chunk = opusEncoder.read(960);
      if (!chunk) break;
      socket.send(chunk, 5030, "127.0.0.1");
    }
  });*/
  let paused = false;
  let currBuffer = new Buffer([]);
  stream.on("data", (chunk) => {
    currBuffer = Buffer.concat([currBuffer, chunk]);
    try {
      if (paused) return;
      console.log(paused);
      if (typeof ffmpeg.pid != "number") return;
      ffmpeg.stdin.write(chunk);
    } catch(e) {
      console.log(e);
    }
  });

  socket.addListener("message", (data) => {
    track.writeRtp(data);
  });
  ffmpeg.stdout.on("data", (chunk) => {
    console.log(Buffer.from(chunk).toString());
  });
  let currPos = null;
  ffmpeg.stderr.on("data", (chunk) => {
    chunk = Buffer.from(chunk).toString(); // parse to string
    chunk = chunk.split(" ").map(el => el.trim()); // split by spaces and trim the items; useful for next step
    chunk = chunk.filter(el => el.startsWith("time")); // find the element indicating the time
    chunk = chunk.join("").split("=")[1]; // extract the timestamp
    if (!chunk) return;
    currPos = chunk;
  });

  setTimeout(() => {
    paused = true;
    ffmpeg.kill();
    setTimeout(() => {
      ffmpeg = require("child_process").spawn("ffmpeg", [
        "-re", "-i", "-", "-ss", currPos, "-map", "0:a", "-b:a", "48k", "-maxrate", "48k", "-c:a", "libopus", "-f", "rtp", "rtp://127.0.0.1:" + 5030
      ]);
      ffmpeg.stdin.write(currBuffer);
      paused = false;
    }, 2000);
  },2000);

  const rtpProducer = await sendTransport.produce({ track: track, appData: { type: "audio" } });
}
