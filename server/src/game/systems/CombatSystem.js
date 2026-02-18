import { ROUND_EVENTS } from "../../../../shared/protocol/messages.js";

export function runCombatSystem(state, io, now, config) {
  for (const boomerang of state.boomerangs.values()) {
    for (const player of state.players.values()) {
      if (!player.alive || player.id === boomerang.ownerId) {
        continue;
      }

      const key = player.id;
      const lastHit = boomerang.hitTimestamps.get(key) ?? 0;
      if (now - lastHit < config.hitCooldownMs) {
        continue;
      }

      const dx = player.x - boomerang.x;
      const dy = player.y - boomerang.y;
      const hitDistance = config.playerRadius + config.boomerangRadius;
      if (dx * dx + dy * dy > hitDistance * hitDistance) {
        continue;
      }

      const magnitude = Math.max(0.0001, Math.hypot(boomerang.vx, boomerang.vy));
      const dirX = boomerang.vx / magnitude;
      const dirY = boomerang.vy / magnitude;

      player.knockbackX += dirX * config.knockbackStrength;
      player.knockbackY += dirY * config.knockbackStrength;
      boomerang.hitTimestamps.set(key, now);

      io.emit(ROUND_EVENTS.HIT, {
        sourceId: boomerang.ownerId,
        targetId: player.id
      });
    }
  }
}
