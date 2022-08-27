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
})

let media = new MediaPlayer(true);
client.on("message", (message) => {
  if (message.content.toLowerCase().startsWith(prefix + commands[0])) {
    const args = message.content.split(" ");
    voice.join(args[1]);
  } else if (message.content.toLowerCase().startsWith(prefix + commands[1])) {
    const args = message.content.split(" ");
    media.playStream(ytdl(args[1], {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1024*1024*10, // 10mb
      requestOptions: {
        headers: {
          "Cookie": "ID=" + new Date().getTime()
        }
      }
    }, {highWaterMark: 1}));
    voice.play(media);
  } else if (message.content.toLowerCase().startsWith(prefix + commands[2])) {
    message.reply("Pong");
  } else if (message.content.toLowerCase().startsWith(prefix + commands[3])) {
    media.pause();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[4])) {
    media.resume();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[5])) {
    voice.leave();
  } else if (message.content.toLowerCase().startsWith(prefix + commands[6])) {
    media.stop();
  }
});

client.loginBot(config.token);
