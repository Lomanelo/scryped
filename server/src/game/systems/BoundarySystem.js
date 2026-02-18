import { ROUND_EVENTS } from "../../../../shared/protocol/messages.js";

export function runBoundarySystem(state, io, config) {
  const ringOutDistance = config.arenaRadius - config.playerRadius * 0.2;
  const ringOutSqr = ringOutDistance * ringOutDistance;

  for (const player of state.players.values()) {
    if (!player.alive) {
      continue;
    }

    const d2 = player.x * player.x + player.y * player.y;
    if (d2 <= ringOutSqr) {
      continue;
    }

    player.alive = false;
    player.vx = 0;
    player.vy = 0;
    player.knockbackX = 0;
    player.knockbackY = 0;

    io.emit(ROUND_EVENTS.ELIMINATED, { playerId: player.id });
  }
}
