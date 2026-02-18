import { io as createClient } from "socket.io-client";

const socket = createClient("http://localhost:3000", {
  transports: ["websocket"],
  reconnection: false
});

let seq = 0;
let lastDummyX = null;
let moved = false;
const startedAt = Date.now();

const inputTimer = setInterval(() => {
  seq += 1;
  socket.emit("input", {
    seq,
    dt: 1 / 45,
    moveX: 0,
    moveY: 0,
    dummyMoveX: 1,
    dummyMoveY: 0,
    aimX: 1,
    aimY: 0,
    throwPressed: false
  });
}, 1000 / 30);

socket.on("snapshot", (snapshot) => {
  const dummy = snapshot.players.find((player) => player.id === "dummy:practice");
  if (!dummy) {
    return;
  }
  if (lastDummyX === null) {
    lastDummyX = dummy.x;
    return;
  }
  if (dummy.x > lastDummyX + 0.05) {
    moved = true;
    // eslint-disable-next-line no-console
    console.log(`dummy moved: ${lastDummyX.toFixed(2)} -> ${dummy.x.toFixed(2)}`);
  }
  lastDummyX = dummy.x;
});

setTimeout(() => {
  clearInterval(inputTimer);
  socket.disconnect();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ moved, elapsedMs: Date.now() - startedAt }));
  process.exit(moved ? 0 : 1);
}, 5000);
