export class GameState {
  constructor(config) {
    this.config = config;
    this.tick = 0;
    this.players = new Map();
    this.food = [];
    this.spears = [];
    this.killEvents = [];
    this.startedAt = Date.now();
  }

  randomPosition(padding = 0) {
    const radius = Math.max(1, (this.config.arenaRadius ?? 250) - padding);
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * radius;
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist
    };
  }

  ensureFoodCount() {
    while (this.food.length < this.config.foodCount) {
      const massRange = this.config.foodMassMax - this.config.foodMassMin;
      const mass = this.config.foodMassMin + Math.random() * massRange;
      const radius = Math.max(0.5, Math.sqrt(mass) * 0.55);
      const pos = this.randomPosition(2);
      this.food.push({
        id: `f:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        x: pos.x, y: pos.y, mass, radius
      });
    }
  }

  serializeSpears() {
    return this.spears.map((s) => ({
      id: s.id, ownerId: s.ownerId,
      x: s.x, y: s.y, angle: s.angle,
      radius: s.radius, returning: s.returning
    }));
  }

  serializePlayers() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id, name: p.name,
      x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      mass: p.mass, radius: p.radius, isBot: p.isBot,
      hasSpear: p.hasSpear, dashing: !!p.dashing,
      hp: p.hp, maxHp: p.maxHp, dead: !!p.dead,
      facingAngle: p.facingAngle ?? 0, color: p.color,
      kills: p.kills ?? 0, deaths: p.deaths ?? 0,
      lastDashAt: p.lastDashAt ?? 0, hitTime: p.hitTime ?? 0
    }));
  }

  serializeLeaderboard() {
    return Array.from(this.players.values())
      .filter((p) => !p.dead)
      .map((p) => ({
        id: p.id, name: p.name,
        kills: p.kills ?? 0, deaths: p.deaths ?? 0,
        isBot: p.isBot, score: p.score
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .slice(0, 10);
  }

  flushKillEvents() {
    const events = this.killEvents;
    this.killEvents = [];
    return events;
  }

  snapshot() {
    this.ensureFoodCount();
    return {
      tick: this.tick,
      world: {
        width: this.config.worldWidth,
        height: this.config.worldHeight,
        arenaRadius: this.config.arenaRadius
      },
      players: this.serializePlayers(),
      spears: this.serializeSpears(),
      food: this.food,
      leaderboard: this.serializeLeaderboard(),
      killEvents: this.flushKillEvents()
    };
  }
}
