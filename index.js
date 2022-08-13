const { API } = require("revolt-api");
const { WebSocket } = require("ws");
const rtc = require("rtc-everywhere")();
const RTCPeerConnection = rtc.RTCPeerConnection;
const RTCIceCandidate = rtc.RTCIceCandidate;

const bottoken = require("config.json").token;
const client = new API({ authentication: { revolt: bottoken }});

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
})();
