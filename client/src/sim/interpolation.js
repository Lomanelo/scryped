function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mapById(items) {
  const result = new Map();
  for (const item of items) {
    result.set(item.id, item);
  }
  return result;
}

function extrapolatePlayers(snapshot, dtSeconds) {
  return snapshot.players.map((player) => ({
    ...player,
    x: player.x + player.vx * dtSeconds,
    y: player.y + player.vy * dtSeconds
  }));
}

export class SnapshotInterpolator {
  constructor() {
    this.buffer = [];
    this.interpDelayMs = 34;
  }

  push(snapshot) {
    this.buffer.push({
      receivedAt: performance.now(),
      snapshot
    });
    if (this.buffer.length > 20) {
      this.buffer.shift();
    }
  }

  sample() {
    if (this.buffer.length === 0) {
      return null;
    }

    const targetTime = performance.now() - this.interpDelayMs;
    let older = this.buffer[0];
    let newer = this.buffer[this.buffer.length - 1];

    for (let i = 0; i < this.buffer.length - 1; i += 1) {
      const current = this.buffer[i];
      const next = this.buffer[i + 1];
      if (current.receivedAt <= targetTime && next.receivedAt >= targetTime) {
        older = current;
        newer = next;
        break;
      }
    }

    if (older === newer) {
      const aheadMs = Math.max(0, Math.min(120, targetTime - older.receivedAt));
      return {
        ...older.snapshot,
        players: extrapolatePlayers(older.snapshot, aheadMs / 1000),
        // Keep boomerangs at authoritative positions while waiting for a new snapshot.
        // Extrapolation made fast projectiles visually overshoot and snap back.
        boomerangs: older.snapshot.boomerangs
      };
    }

    const span = Math.max(1, newer.receivedAt - older.receivedAt);
    const t = Math.max(0, Math.min(1, (targetTime - older.receivedAt) / span));
    const oldPlayers = mapById(older.snapshot.players);
    const newPlayers = mapById(newer.snapshot.players);
    const players = [];
    for (const [id, oldP] of oldPlayers.entries()) {
      const newP = newPlayers.get(id) ?? oldP;
      players.push({
        ...newP,
        x: lerp(oldP.x, newP.x, t),
        y: lerp(oldP.y, newP.y, t),
        facing: {
          x: lerp(oldP.facing.x, newP.facing.x, t),
          y: lerp(oldP.facing.y, newP.facing.y, t)
        }
      });
    }
    return {
      ...newer.snapshot,
      players,
      // Projectiles are fast and short-lived; rendering latest authoritative positions
      // avoids interpolation artifacts on spawn/despawn and direction changes.
      boomerangs: newer.snapshot.boomerangs
    };
  }
}
