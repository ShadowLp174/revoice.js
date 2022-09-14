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
    voice.join(args[1], 5).then(connection => {
      connection.on("state", (s) => {
        console.log(s);
      });
    }).catch(e => {
      console.log(e);
    });
  } else if (message.content.toLowerCase().startsWith(prefix + commands[1])) {
    const args = message.content.split(" ");
    const user = voice.getUser(message.author_id).user;
    if (!user) return message.reply("It doesn't seem like we're in a voice channel together...");
    const cid = user.connectedTo;
    let m = media.get(cid);
    if (!m) {
      m = new MediaPlayer(false, 5030 + (++currPlayerPort));
      media.set(cid, m);
    }
    const connection = voice.getVoiceConnection(cid);
    if (!connection.media) { // should be called before playing
      connection.play(m);
    }
    m.playStream(ytdl(args[1], {
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
    const user = voice.getUser(message.author_id).user;
    if (!user) return message.reply("It doesn't seem like we're in a voice channel together...");
    const cid = user.connectedTo;
    let m = media.get(cid);
    m.pause();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[4])) {
    const user = voice.getUser(message.author_id).user;
    if (!user) return message.reply("It doesn't seem like we're in a voice channel together...");
    const cid = user.connectedTo;
    let m = media.get(cid);
    m.resume();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[5])) {
    const user = voice.getUser(message.author_id).user;
    if (!user) return message.reply("It doesn't seem like we're in a voice channel together...");
    const cid = user.connectedTo;
    let connection = voice.getVoiceConnection(cid);
    connection.leave();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[6])) {
    const user = voice.getUser(message.author_id).user;
    if (!user) return message.reply("It doesn't seem like we're in a voice channel together...");
    const cid = user.connectedTo;
    let m = media.get(cid);
    m.stop();
  }
});

client.loginBot(config.token);
