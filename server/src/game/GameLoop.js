function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  if (length < 0.0001) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function massToRadius(mass) {
  return Math.max(2.2, Math.sqrt(mass) * 1.15);
}

function getSpeedFromMass(mass) {
  const base = 110;
  const drag = Math.sqrt(mass) * 2.5;
  return clamp(base - drag, 22, 105);
}

const PLAYER_COLORS = [
  "#7cf7b2", "#ff7a7a", "#7ab8ff", "#ffcf7a",
  "#d17aff", "#7affea", "#ff7ad1", "#b8ff7a"
];

const BOT_NAMES = [
  "Blaze", "Frost", "Spike", "Viper", "Nova",
  "Shade", "Bolt", "Fang", "Echo", "Raze",
  "Drift", "Jinx", "Storm", "Glitch", "Neon"
];

let colorIndex = 0;
function nextColor() {
  const c = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  colorIndex++;
  return c;
}

export class GameLoop {
  constructor({ io, state, config }) {
    this.io = io;
    this.state = state;
    this.config = config;
    this.tickMs = 1000 / config.tickRate;
    this.snapshotEveryTicks = Math.max(1, Math.round(config.tickRate / config.snapshotRate));
    this.interval = null;
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.step(), this.tickMs);
  }

  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  ingestInput(player, payload) {
    const move = normalizeVector(Number(payload?.moveX ?? 0), Number(payload?.moveY ?? 0));
    const pendingShoot = player.lastInput?.shoot || false;
    const pendingDash = player.lastInput?.dash || false;
    player.lastInput = {
      moveX: move.x, moveY: move.y,
      shoot: pendingShoot || !!payload?.shoot,
      dash: pendingDash || !!payload?.dash,
      facingAngle: Number(payload?.facingAngle ?? 0)
    };
    player.facingAngle = player.lastInput.facingAngle;
    player.lastInputAt = Date.now();
  }

  updateBots(dt) {
    const BOOM_MAX_DIST = 80;
    const now = Date.now();

    for (const bot of this.state.players.values()) {
      if (!bot.isBot || bot.dead) continue;

      bot.aiShootCooldown = (bot.aiShootCooldown ?? 0) - dt;
      bot.aiActionTimer = (bot.aiActionTimer ?? 0) - dt;

      let nearest = null;
      let nearDist = Infinity;
      for (const other of this.state.players.values()) {
        if (other.id === bot.id || other.dead) continue;
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d < nearDist) { nearDist = d; nearest = other; }
      }

      let dodging = false;
      for (const spear of this.state.spears) {
        if (spear.ownerId === bot.id) continue;
        if (spear.returning) continue;
        const sd = Math.hypot(spear.x - bot.x, spear.y - bot.y);
        if (sd < bot.radius * 5) {
          const toBot = { x: bot.x - spear.x, y: bot.y - spear.y };
          const dot = toBot.x * spear.dirX + toBot.y * spear.dirY;
          if (dot > 0) {
            const perpX = -spear.dirY;
            const perpY = spear.dirX;
            const side = (perpX * toBot.x + perpY * toBot.y) > 0 ? 1 : -1;
            bot.lastInput = {
              moveX: perpX * side, moveY: perpY * side,
              shoot: false, dash: sd < bot.radius * 2.5,
              facingAngle: bot.facingAngle ?? 0
            };
            dodging = true;
            break;
          }
        }
      }

      if (!dodging && nearest) {
        const dx = nearest.x - bot.x;
        const dy = nearest.y - bot.y;
        const aimAngle = Math.atan2(dy, dx);
        bot.facingAngle = aimAngle;

        const inRange = nearDist < BOOM_MAX_DIST + bot.radius;
        const wantsToShoot = inRange && bot.hasSpear && bot.aiShootCooldown <= 0;
        if (wantsToShoot) bot.aiShootCooldown = 0.4 + Math.random() * 0.6;

        let moveX, moveY;
        if (nearDist > BOOM_MAX_DIST * 0.7) {
          const norm = normalizeVector(dx, dy);
          moveX = norm.x; moveY = norm.y;
        } else {
          if (bot.aiActionTimer <= 0) {
            bot.aiStrafeDir = Math.random() > 0.5 ? 1 : -1;
            bot.aiActionTimer = 0.5 + Math.random() * 1.0;
          }
          const perpX = -dy / nearDist;
          const perpY = dx / nearDist;
          moveX = perpX * (bot.aiStrafeDir ?? 1);
          moveY = perpY * (bot.aiStrafeDir ?? 1);
          const norm = normalizeVector(dx, dy);
          moveX += norm.x * 0.3; moveY += norm.y * 0.3;
          const len = Math.hypot(moveX, moveY);
          if (len > 0.01) { moveX /= len; moveY /= len; }
        }

        const dashCooldownMs = 2000;
        const canDash = now - (bot.lastDashAt ?? 0) >= dashCooldownMs;
        const wantsDash = canDash && nearDist < BOOM_MAX_DIST * 0.5 && Math.random() > 0.95;

        bot.lastInput = { moveX, moveY, shoot: wantsToShoot, dash: wantsDash, facingAngle: aimAngle };
      } else if (!dodging) {
        // Check for nearby coins to pick up
        let nearestCoin = null;
        let coinDist = Infinity;
        for (const coin of this.state.coins) {
          const d = Math.hypot(coin.x - bot.x, coin.y - bot.y);
          if (d < coinDist) { coinDist = d; nearestCoin = coin; }
        }

        if (nearestCoin && coinDist < 150) {
          const dx = nearestCoin.x - bot.x;
          const dy = nearestCoin.y - bot.y;
          const norm = normalizeVector(dx, dy);
          bot.lastInput = { moveX: norm.x, moveY: norm.y, shoot: false, dash: false, facingAngle: Math.atan2(dy, dx) };
          bot.facingAngle = Math.atan2(dy, dx);
        } else {
          bot.aiWander = (bot.aiWander ?? 0) - dt;
          if (bot.aiWander <= 0) {
            const angle = Math.random() * Math.PI * 2;
            bot.lastInput = { moveX: Math.cos(angle), moveY: Math.sin(angle), shoot: false, dash: false, facingAngle: angle };
            bot.facingAngle = angle;
            bot.aiWander = 0.8 + Math.random() * 1.6;
          }
        }
      }
    }
  }

  processDashes() {
    const DASH_DIST = 55;
    const DASH_DURATION = 0.12;
    const DASH_COOLDOWN_MS = 2000;
    const now = Date.now();

    for (const player of this.state.players.values()) {
      const input = player.lastInput;
      if (!input || !input.dash) continue;
      input.dash = false;
      if (player.dead) continue;
      if (now - (player.lastDashAt ?? 0) < DASH_COOLDOWN_MS) continue;
      const mx = input.moveX; const my = input.moveY;
      if (Math.hypot(mx, my) < 0.1) continue;

      player.lastDashAt = now;
      player.dashing = true;
      player.dashTimeLeft = DASH_DURATION;
      const mag = Math.hypot(mx, my);
      player.dashVX = (mx / mag) * (DASH_DIST / DASH_DURATION);
      player.dashVY = (my / mag) * (DASH_DIST / DASH_DURATION);
    }
  }

  movePlayers(dt) {
    const hw = this.config.worldWidth * 0.5;
    const hh = this.config.worldHeight * 0.5;
    for (const player of this.state.players.values()) {
      if (player.dead) continue;
      if (player.dashing && player.dashTimeLeft > 0) {
        const step = Math.min(dt, player.dashTimeLeft);
        player.x += player.dashVX * step;
        player.y += player.dashVY * step;
        player.vx = player.dashVX; player.vy = player.dashVY;
        player.dashTimeLeft -= dt;
        if (player.dashTimeLeft <= 0) player.dashing = false;
      } else {
        const input = player.lastInput ?? { moveX: 0, moveY: 0 };
        const speed = getSpeedFromMass(player.mass);
        player.vx = input.moveX * speed;
        player.vy = input.moveY * speed;
        player.x += player.vx * dt;
        player.y += player.vy * dt;
      }

      const maxX = hw - player.radius;
      const maxY = hh - player.radius;
      player.x = Math.max(-maxX, Math.min(maxX, player.x));
      player.y = Math.max(-maxY, Math.min(maxY, player.y));
    }
  }

  processShots() {
    const BOOM_SPEED = 180;
    const BOOM_MAX_DIST = 80;
    const SPAWN_IMMUNITY_MS = 3000;
    const now = Date.now();

    for (const player of this.state.players.values()) {
      if (player.dead) continue;
      if (player.spawnedAt && now - player.spawnedAt < SPAWN_IMMUNITY_MS) continue;
      const input = player.lastInput;
      if (!input || !input.shoot) continue;
      input.shoot = false;
      if (!player.hasSpear) continue;

      player.hasSpear = false;
      const angle = input.facingAngle;
      this.state.spears.push({
        id: `s:${player.id}:${Date.now()}`,
        ownerId: player.id,
        x: player.x + Math.cos(angle) * player.radius,
        y: player.y + Math.sin(angle) * player.radius,
        angle,
        dirX: Math.cos(angle), dirY: Math.sin(angle),
        speed: BOOM_SPEED, maxDist: BOOM_MAX_DIST,
        radius: Math.max(3, player.radius * 0.3),
        traveled: 0, returning: false,
        returnTraveled: 0, hitTargets: new Set()
      });
    }
  }

  moveSpears(dt) {
    for (let i = this.state.spears.length - 1; i >= 0; i--) {
      const spear = this.state.spears[i];
      const owner = this.state.players.get(spear.ownerId);

      // Remove boomerang if owner is dead
      if (!owner || owner.dead) {
        this.state.spears.splice(i, 1);
        continue;
      }

      if (!spear.returning) {
        spear.x += spear.dirX * spear.speed * dt;
        spear.y += spear.dirY * spear.speed * dt;
        spear.traveled += spear.speed * dt;
        if (spear.traveled >= spear.maxDist) {
          spear.returning = true;
          spear.returnTraveled = 0;
        }
      } else {
        const dx = owner.x - spear.x;
        const dy = owner.y - spear.y;
        const dist = Math.hypot(dx, dy);
        if (dist < owner.radius + 4) {
          owner.hasSpear = true;
          this.state.spears.splice(i, 1);
          continue;
        }
        const nx = dx / dist; const ny = dy / dist;
        const returnSpeed = spear.speed * 1.3;
        const step = returnSpeed * dt;
        spear.x += nx * step; spear.y += ny * step;
        spear.returnTraveled = (spear.returnTraveled ?? 0) + step;
        spear.angle = Math.atan2(ny, nx);
      }
    }
  }

  boomerangHitPlayers() {
    const OUTBOUND_DAMAGE = 1;
    const RETURN_DAMAGE = 3;
    const SPAWN_IMMUNITY_MS = 3000;
    const now = Date.now();

    for (let i = this.state.spears.length - 1; i >= 0; i--) {
      const spear = this.state.spears[i];
      if (!spear.hitTargets) spear.hitTargets = new Set();

      const owner = this.state.players.get(spear.ownerId);
      if (!owner || owner.dead) continue;

      for (const player of this.state.players.values()) {
        if (player.id === spear.ownerId) continue;
        if (player.dead) continue;
        if (spear.hitTargets.has(player.id)) continue;
        if (player.spawnedAt && now - player.spawnedAt < SPAWN_IMMUNITY_MS) continue;

        const dx = player.x - spear.x;
        const dy = player.y - spear.y;
        const dist = Math.hypot(dx, dy);
        if (dist > player.radius + spear.radius) continue;

        spear.hitTargets.add(player.id);
        const isRealReturn = spear.returning && (spear.returnTraveled ?? 0) > 5;
        const damage = isRealReturn ? RETURN_DAMAGE : OUTBOUND_DAMAGE;
        player.hp -= damage;
        player.hitTime = Date.now();

        if (!spear.returning) {
          spear.returning = true;
          spear.returnTraveled = 0;
        }

        if (player.hp <= 0) {
          player.dead = true;
          player.deadSince = Date.now();
          player.deaths = (player.deaths ?? 0) + 1;

          const coinValue = player.coins ?? 1;
          this.state.coins.push({
            id: `coin:${player.id}:${Date.now()}`,
            x: player.x, y: player.y,
            value: coinValue,
            color: player.color || "#f5c542",
            droppedBy: player.id
          });
          player.coins = 0;

          if (owner) {
            owner.kills = (owner.kills ?? 0) + 1;
            owner.score += 10;
            owner.hp = Math.min(owner.maxHp, owner.hp + 1);
            this.state.killEvents.push({
              killer: owner.name, killerColor: owner.color,
              victim: player.name, victimColor: player.color,
              tick: this.state.tick
            });
          }
        }
        break;
      }
    }

    const DEATH_LINGER_MS = 1500;
    for (const player of this.state.players.values()) {
      if (!player.dead) continue;
      if (now - (player.deadSince ?? 0) < DEATH_LINGER_MS) continue;

      if (!player.isBot) {
        this.io.to(player.id).emit("eliminated", {
          playerId: player.id,
          coins: player.coins ?? 0,
          kills: player.kills ?? 0
        });
      }
      this.state.players.delete(player.id);
      this.state.spears = this.state.spears.filter((s) => s.ownerId !== player.id);
    }
  }

  consumeFood() {
    for (const player of this.state.players.values()) {
      for (let i = this.state.food.length - 1; i >= 0; i--) {
        const food = this.state.food[i];
        const dx = player.x - food.x; const dy = player.y - food.y;
        const r = player.radius + food.radius * 0.6;
        if (dx * dx + dy * dy > r * r) continue;
        player.mass = clamp(player.mass + food.mass, this.config.minMass, this.config.maxMass);
        player.radius = massToRadius(player.mass);
        player.score += food.mass;
        this.state.food.splice(i, 1);
      }
    }
    this.state.ensureFoodCount();
  }

  decayMass(dt) {
    for (const player of this.state.players.values()) {
      if (player.mass <= this.config.minMass) continue;
      const decay = player.mass * this.config.massDecayPerSecond * dt;
      player.mass = clamp(player.mass - decay, this.config.minMass, this.config.maxMass);
      player.radius = massToRadius(player.mass);
    }
  }

  regenHp() {
    const REGEN_INTERVAL_MS = 20000;
    const now = Date.now();
    for (const player of this.state.players.values()) {
      if (player.dead) continue;
      if (player.hp >= player.maxHp) continue;
      const lastHit = player.hitTime || 0;
      if (now - lastHit >= REGEN_INTERVAL_MS) {
        player.hp = Math.min(player.maxHp, player.hp + 1);
        player.hitTime = now;
      }
    }
  }

  collectCoins() {
    const PICKUP_RADIUS = 1.5;
    for (const player of this.state.players.values()) {
      if (player.dead) continue;
      for (let i = this.state.coins.length - 1; i >= 0; i--) {
        const coin = this.state.coins[i];
        const dx = player.x - coin.x;
        const dy = player.y - coin.y;
        const dist = Math.hypot(dx, dy);
        if (dist < player.radius * PICKUP_RADIUS) {
          player.coins = (player.coins ?? 0) + (coin.value ?? 1);
          player.score += 5 * (coin.value ?? 1);
          this.state.coins.splice(i, 1);
        }
      }
    }
  }

  step() {
    const dt = this.tickMs / 1000;
    this.state.tick += 1;
    this.updateBots(dt);
    this.processDashes();
    this.movePlayers(dt);
    this.processShots();
    this.moveSpears(dt);
    this.boomerangHitPlayers();
    this.regenHp();
    this.collectCoins();
    this.consumeFood();
    this.decayMass(dt);

    if (this.state.tick % this.snapshotEveryTicks === 0) {
      this.io.emit("snapshot", this.state.snapshot());
    }
  }
}

export function createInitialPlayer({ id, isBot = false }) {
  const name = isBot
    ? BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]
    : `Guest-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id, name, isBot,
    x: 0, y: 0, vx: 0, vy: 0,
    mass: 80, radius: massToRadius(80), score: 0,
    hp: 3, maxHp: 3, dead: false,
    hasSpear: true, lastShotAt: 0, lastDashAt: 0,
    facingAngle: 0, color: nextColor(),
    kills: 0, deaths: 0, hitTime: 0, coins: 1, entryFee: 1, spawnedAt: Date.now(),
    lastInput: { moveX: 0, moveY: 0, shoot: false, dash: false, facingAngle: 0 },
    lastInputAt: 0, aiWander: 0
  };
}
