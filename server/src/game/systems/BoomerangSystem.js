function normalize(x, y, fallbackX = 1, fallbackY = 0) {
  const length = Math.hypot(x, y);
  if (length <= 0.0001) {
    return { x: fallbackX, y: fallbackY };
  }
  return { x: x / length, y: y / length };
}

function findClosestTargetDirection(state, player, radius) {
  const radiusSqr = radius * radius;
  let closest = null;
  let closestDistanceSqr = radiusSqr;

  for (const candidate of state.players.values()) {
    if (!candidate.alive || candidate.id === player.id) {
      continue;
    }

    const dx = candidate.x - player.x;
    const dy = candidate.y - player.y;
    const distanceSqr = dx * dx + dy * dy;
    if (distanceSqr > closestDistanceSqr) {
      continue;
    }

    closestDistanceSqr = distanceSqr;
    closest = { dx, dy };
  }

  if (!closest) {
    return null;
  }

  return normalize(closest.dx, closest.dy, player.facingX, player.facingY);
}

export function tryThrowBoomerang(state, player, now, config) {
  if (!player.alive || !player.hasBoomerang) {
    return null;
  }

  if (now - player.lastThrowAt < config.throwCooldownMs) {
    return null;
  }

  // Only fire when at least one enemy is inside lock range.
  const autoAimDir = findClosestTargetDirection(state, player, config.autoAimRadius);
  if (!autoAimDir) {
    return null;
  }
  const dir = autoAimDir;
  const id = `${player.id}:b:${state.tick}`;
  const boomerang = {
    id,
    ownerId: player.id,
    x: player.x + dir.x * (config.playerRadius + 0.5),
    y: player.y + dir.y * (config.playerRadius + 0.5),
    vx: dir.x * config.boomerangSpeedOutbound,
    vy: dir.y * config.boomerangSpeedOutbound,
    phase: "outbound",
    createdAt: now,
    phaseEndsAt: now + config.boomerangOutboundMs,
    hitTimestamps: new Map()
  };

  player.hasBoomerang = false;
  player.lastThrowAt = now;
  state.boomerangs.set(id, boomerang);
  return boomerang;
}

export function runBoomerangSystem(state, dt, now, config) {
  const idsToDelete = [];

  for (const boomerang of state.boomerangs.values()) {
    const owner = state.players.get(boomerang.ownerId);
    if (!owner) {
      idsToDelete.push(boomerang.id);
      continue;
    }

    if (boomerang.phase === "outbound" && now >= boomerang.phaseEndsAt) {
      boomerang.phase = "return";
    }

    if (boomerang.phase === "return") {
      const dx = owner.x - boomerang.x;
      const dy = owner.y - boomerang.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= config.playerRadius + config.boomerangRadius) {
        owner.hasBoomerang = true;
        idsToDelete.push(boomerang.id);
        continue;
      }

      const dirX = dx / Math.max(0.0001, dist);
      const dirY = dy / Math.max(0.0001, dist);
      boomerang.vx = dirX * config.boomerangSpeedReturn;
      boomerang.vy = dirY * config.boomerangSpeedReturn;
    }

    boomerang.x += boomerang.vx * dt;
    boomerang.y += boomerang.vy * dt;

    if (now - boomerang.createdAt > config.boomerangMaxLifeMs) {
      owner.hasBoomerang = true;
      idsToDelete.push(boomerang.id);
    }
  }

  for (const id of idsToDelete) {
    state.boomerangs.delete(id);
  }
}
