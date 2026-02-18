import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { GAME_CONFIG } from "./game/config.js";
import { GameState } from "./game/GameState.js";
import { GameLoop } from "./game/GameLoop.js";
import { attachSocketServer } from "./net/socketServer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../");
const clientDir = path.join(rootDir, "client");
const sharedDir = path.join(rootDir, "shared");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use("/client", express.static(clientDir));
app.use("/shared", express.static(sharedDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

const state = new GameState(GAME_CONFIG);
const gameLoop = new GameLoop({ io, state, config: GAME_CONFIG });
attachSocketServer(io, gameLoop, state, GAME_CONFIG);

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(
      `Port ${port} is already in use. Stop the existing server or run with a different port (PowerShell: $env:PORT=3001; npm run dev).`
    );
    process.exit(1);
  }
  throw error;
});

server.listen(port, "0.0.0.0", () => {
  gameLoop.start();
  // eslint-disable-next-line no-console
  console.log(`Snapback.io server running at http://0.0.0.0:${port}`);
});
