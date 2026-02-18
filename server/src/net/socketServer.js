import { EVENTS } from "../../../shared/protocol/messages.js";
import { createInitialPlayer } from "../game/GameLoop.js";

const DUMMY_ID = "dummy:target";

function countHumanPlayers(state) {
  let count = 0;
  for (const player of state.players.values()) {
    if (!player.isBot && player.id !== DUMMY_ID) count += 1;
  }
  return count;
}

function ensureDummy(state, nearPlayer) {
  if (state.players.has(DUMMY_ID)) return;
  const dummy = createInitialPlayer({ id: DUMMY_ID, isBot: true });
  dummy.name = "Dummy";
  dummy.isDummy = true;
  dummy.x = (nearPlayer?.x ?? 0) + 60;
  dummy.y = nearPlayer?.y ?? 0;
  state.players.set(DUMMY_ID, dummy);
}

function removeDummy(state) {
  state.players.delete(DUMMY_ID);
  state.spears = state.spears.filter((s) => s.ownerId !== DUMMY_ID);
}

function syncBots(state, config) {
  if (!config.aiEnabled) return;
  const humanCount = countHumanPlayers(state);
  const targetBots = Math.max(0, config.aiFillPlayers - humanCount);
  const currentBots = Array.from(state.players.values()).filter((p) => p.isBot && p.id !== DUMMY_ID);

  while (currentBots.length < targetBots) {
    const bot = createInitialPlayer({ id: `bot:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, isBot: true });
    const pos = state.randomPosition(bot.radius + 5);
    bot.x = pos.x; bot.y = pos.y;
    state.players.set(bot.id, bot);
    currentBots.push(bot);
  }

  while (currentBots.length > targetBots) {
    const removed = currentBots.pop();
    state.players.delete(removed.id);
    state.spears = state.spears.filter((s) => s.ownerId !== removed.id);
  }
}

function isRateLimited(player, now, config) {
  if (!player.inputWindowStart || now - player.inputWindowStart > 1000) {
    player.inputWindowStart = now;
    player.inputCount = 0;
  }
  player.inputCount += 1;
  return player.inputCount > config.maxInputRatePerSecond;
}

export function attachSocketServer(io, gameLoop, state, config) {
  io.on("connection", (socket) => {
    if (countHumanPlayers(state) >= config.maxPlayersPerArena) {
      socket.emit("arena:full");
      socket.disconnect(true);
      return;
    }

    const player = createInitialPlayer({ id: socket.id, isBot: false });
    const clientName = socket.handshake?.query?.name;
    if (clientName && clientName.trim().length > 0) {
      player.name = clientName.trim().slice(0, 16);
    }
    const pos = state.randomPosition(player.radius + 3);
    player.x = pos.x; player.y = pos.y;
    state.players.set(socket.id, player);

    ensureDummy(state, player);
    syncBots(state, config);

    socket.emit(EVENTS.CONNECTED, {
      playerId: socket.id,
      dummyId: DUMMY_ID,
      config: {
        mode: "arena",
        tickRate: config.tickRate,
        arenaRadius: config.arenaRadius,
        world: { width: config.worldWidth, height: config.worldHeight }
      }
    });
    io.emit(EVENTS.PLAYER_JOINED, { playerId: socket.id });

    socket.on(EVENTS.INPUT, (payload) => {
      const now = Date.now();
      if (isRateLimited(player, now, config)) return;
      gameLoop.ingestInput(player, payload ?? {});
    });

    socket.on("dummy_input", (payload) => {
      const dummy = state.players.get(DUMMY_ID);
      if (!dummy) return;
      gameLoop.ingestInput(dummy, payload ?? {});
    });

    socket.on("disconnect", () => {
      state.players.delete(socket.id);
      state.spears = state.spears.filter((s) => s.ownerId !== socket.id);
      if (countHumanPlayers(state) === 0) {
        removeDummy(state);
        for (const p of state.players.values()) {
          if (p.isBot) state.players.delete(p.id);
        }
        state.spears = [];
      }
      syncBots(state, config);
      io.emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
    });
  });
}
