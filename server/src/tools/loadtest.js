import { io as createClient } from "socket.io-client";

const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:3000";
const CLIENTS = Number.parseInt(process.env.CLIENTS ?? "8", 10);
const DURATION_MS = Number.parseInt(process.env.DURATION_MS ?? "10000", 10);
const TICK_MS = 1000 / 30;

const sockets = [];
let snapshotsReceived = 0;
let connectedCount = 0;

function randomInput(seq) {
  const angle = Math.random() * Math.PI * 2;
  const aim = Math.random() * Math.PI * 2;
  return {
    seq,
    dt: 1 / 30,
    moveX: Math.cos(angle),
    moveY: Math.sin(angle),
    aimX: Math.cos(aim),
    aimY: Math.sin(aim),
    throwPressed: Math.random() < 0.15
  };
}

for (let i = 0; i < CLIENTS; i += 1) {
  const socket = createClient(TARGET_URL, {
    transports: ["websocket"],
    reconnection: false
  });

  let seq = 0;
  let interval = null;

  socket.on("connect", () => {
    connectedCount += 1;
    interval = setInterval(() => {
      seq += 1;
      socket.emit("input", randomInput(seq));
    }, TICK_MS);
  });

  socket.on("snapshot", () => {
    snapshotsReceived += 1;
  });

  socket.on("disconnect", () => {
    if (interval) {
      clearInterval(interval);
    }
  });

  sockets.push(socket);
}

setTimeout(() => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        target: TARGET_URL,
        clientsRequested: CLIENTS,
        clientsConnected: connectedCount,
        snapshotsReceived
      },
      null,
      2
    )
  );
  process.exit(0);
}, DURATION_MS);
