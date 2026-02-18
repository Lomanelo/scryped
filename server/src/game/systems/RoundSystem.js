import { ROUND_EVENTS, ROUND_PHASES } from "../../../../shared/protocol/messages.js";

function resetPlayersForRound(state, config) {
  const connected = Array.from(state.players.values());
  const total = connected.length;
  const angleStep = total > 0 ? (Math.PI * 2) / total : 0;

  for (let i = 0; i < connected.length; i += 1) {
    const player = connected[i];
    const angle = angleStep * i;
    const radius = config.spawnRadius;
    player.x = Math.cos(angle) * radius;
    player.y = Math.sin(angle) * radius;
    player.vx = 0;
    player.vy = 0;
    player.knockbackX = 0;
    player.knockbackY = 0;
    player.alive = true;
    player.hasBoomerang = true;
    player.facingX = -Math.cos(angle);
    player.facingY = -Math.sin(angle);
  }

  state.boomerangs.clear();
}

export function runRoundSystem(state, io, now, config) {
  const playerCount = state.players.size;
  const alive = state.getAlivePlayers();

  if (playerCount < 2) {
    if (playerCount === 1) {
      const soloPlayer = Array.from(state.players.values())[0];
      if (!soloPlayer.alive || state.round.phase !== ROUND_PHASES.WAITING) {
        soloPlayer.x = 0;
        soloPlayer.y = 0;
        soloPlayer.vx = 0;
        soloPlayer.vy = 0;
        soloPlayer.knockbackX = 0;
        soloPlayer.knockbackY = 0;
        soloPlayer.alive = true;
        soloPlayer.hasBoomerang = true;
        soloPlayer.facingX = 1;
        soloPlayer.facingY = 0;
      }
    } else {
      state.boomerangs.clear();
    }

    state.round.phase = ROUND_PHASES.WAITING;
    state.round.phaseEndsAt = 0;
    state.round.winnerId = null;
    return;
  }

  if (state.round.phase === ROUND_PHASES.WAITING) {
    resetPlayersForRound(state, config);
    state.round.phase = ROUND_PHASES.WARMUP;
    state.round.phaseEndsAt = now + config.warmupMs;
    state.round.winnerId = null;
    return;
  }

  if (state.round.phase === ROUND_PHASES.WARMUP && now >= state.round.phaseEndsAt) {
    state.round.phase = ROUND_PHASES.ACTIVE;
    state.round.phaseEndsAt = 0;
    return;
  }

  if (state.round.phase === ROUND_PHASES.ACTIVE) {
    if (alive.length <= 1) {
      const winner = alive.length === 1 ? alive[0].id : null;
      state.round.phase = ROUND_PHASES.ROUND_END;
      state.round.phaseEndsAt = now + config.roundEndMs;
      state.round.winnerId = winner;
      io.emit(ROUND_EVENTS.WINNER, { winnerId: winner });
    }
    return;
  }

  if (state.round.phase === ROUND_PHASES.ROUND_END && now >= state.round.phaseEndsAt) {
    resetPlayersForRound(state, config);
    state.round.phase = ROUND_PHASES.WARMUP;
    state.round.phaseEndsAt = now + config.warmupMs;
    state.round.winnerId = null;
  }
}
