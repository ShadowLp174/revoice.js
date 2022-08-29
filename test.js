const { Revoice, MediaPlayer } = require("./index.js");
const { Client } = require("revolt.js");
const config = require("./config.json");
const ytdl = require('ytdl-core');

if (!config.token) {
  console.log("Config file invalid. Missing bot token");
  exit(0);
}

const commands = [
  "join",
  "play",
  "ping",
  "pause",
  "resume",
  "leave",
  "stop"
]
var prefix = "!";

const client = new Client();
const voice = new Revoice(config.token);

client.on("ready", () => {
  client.users.edit({
    status: {
      text: "by RedTech",
      presence: "Online"
    }
  })
  console.log("Logged in as " + client.user.username);
});

voice.on("state", (s) => {
  console.log(s);
});

// Command pattern: prefix+command channelId input

const media = new Map();
var currPlayerPort = -1;
client.on("message", (message) => {
  if (message.content.toLowerCase().startsWith(prefix + commands[0])) {
    const args = message.content.split(" ");
    voice.join(args[1]).then(connection => {
      console.log(connection);
      connection.on("state", (s) => {
        console.log(s);
      })
    }).catch(e => {
      console.log(e);
    });
  } else if (message.content.toLowerCase().startsWith(prefix + commands[1])) {
    const args = message.content.split(" ");
    let m = media.get(args[1]);
    if (!m) {
      m = new MediaPlayer(false, 5030 + (++currPlayerPort));
      media.set(args[1], m);
    }
    const connection = voice.getVoiceConnection(args[1]);
    if (!connection.media) { // should be called before playing
      connection.play(m);
    }
    m.playStream(ytdl(args[2], {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1024*1024*10, // 10mb
      requestOptions: {
        headers: {
          "Cookie": "ID=" + new Date().getTime()
        }
      }
    }, {highWaterMark: 1}));
  } else if (message.content.toLowerCase().startsWith(prefix + commands[2])) {
    message.reply("Pong");
  } else if (message.content.toLowerCase().startsWith(prefix + commands[3])) {
    const args = message.content.split(" ");
    let m = media.get(args[1]);
    m.pause();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[4])) {
    const args = message.content.split(" ");
    let m = media.get(args[1]);
    m.resume();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[5])) {
    const args = message.content.split(" ");
    let connection = voice.getVoiceConnection(args[1]);
    connection.leave();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[6])) {
    const args = message.content.split(" ");
    let m = media.get(args[1]);
    m.stop();
  }
});

client.loginBot(config.token);
