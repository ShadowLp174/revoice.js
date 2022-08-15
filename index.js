const { API } = require("revolt-api");
const Signaling = require("./Signaling.js");
const fs = require("fs");
const { OpusEncoder } = require("@discordjs/opus");
const prism = require("prism-media");
const { createSocket } = require("dgram");
const { exec } = require("child_process");

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
const encoder = new OpusEncoder(48000, 2);
const opusEncoder = new prism.opus.Encoder({
  frameSize: 960,
  channels: 2,
  rate: 48000
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


  const udp = createSocket("udp4");
  udp.bind(5030);
  udp.addListener("message", (data) => {
    track.writeRtp(data);
  });

  /*const stream = fs.createReadStream(__dirname + "\\assets\\warbringer.mp3");
  stream.pipe(opusEncoder);
  opusEncoder.on("data", (data) => {
    track.writeRtp(data);
  });*/

  const rtpProducer = await sendTransport.produce({ track: track, appData: { type: "audio" } });

  exec(
    "ffmpeg -re -i ./assets/warbringer.mp3 -map 0:a -b:a 48k -maxrate 48k -c:a libopus -f rtp rtp://127.0.0.1:5030",
  (err, stdout, stderr) => {
    console.log(stderr);
  });
}
/*

function getToken(channelId) {
  return new Promise((res) => {
    client.post("/channels/" + channelId + "/join_call").then(data => {
      res(data);
    });
  });
}

function initTransport(data) {
  const connection = new RTCPeerConnection();

  const candidates = [];

  data.data.sendTransport.iceCandidates.forEach((candidate) => {
    const d = candidate;
    const c = new RTCIceCandidate({
      candidate: "a=" + d.foundation + " 1 " + d.protocol + " " + d.priority + " " + d.ip + " " + d.port + " " + d.type,
      usernameFragment: data.data.sendTransport.iceParameters.usernameFragment
    });
    candidates.push(c);
  });

  candidates.forEach(c => {
    connection.addIceCandidate(c);
  });
}

(async () => {
  const channelId = "01GA8VZE79JGPEPBT6KEN54686";
  const auth = await getToken(channelId); // tken for the websocket

  console.log(auth);

  const socket = new WebSocket("wss://vortex.revolt.chat");
  socket.on("message", (m) => {
    const data = JSON.parse(Buffer.from(m).toString());
    console.log(data);

    if (data.type == "InitializeTransports") return initTransport(data);

    if (data.type != "Authenticate") return;
    // initialize transport
    const request = {
      id: data.id + 1,
      type: "InitializeTransports",
      data: {
        mode: "SplitWebRTC",
        rtpCapabilities: data.data.rtpCapabilities
      }
    }
    socket.send(JSON.stringify(request));
  });
  socket.on("open", () => {
    const data = JSON.stringify({ id: 0, type: "Authenticate", data: {
      token: auth.token,
      roomId: channelId
    }});
    console.log(data);
    socket.send(data);
  });
  socket.on("close", (e) => {
    console.log("closed", e);
  });
  socket.on("error", (e) => {
    console.log("error", e);
  });
})();*/
