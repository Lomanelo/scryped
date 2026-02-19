const COLORS = ["#7cf7b2","#ff7a7a","#7ab8ff","#ffcf7a","#d17aff","#7affea","#ff7ad1","#b8ff7a"];
const NAMES = ["Blaze","Frost","Spike","Viper","Nova","Shade","Bolt","Fang"];
const BOT_COUNT = 6;
const WORLD = 800;
const BOOM_RANGE = 80;
const BOOM_SPEED = 180;
const DASH_CD = 2000;
const DASH_DIST = 55;
const DASH_DUR = 0.12;
const SPEED = 90;
const SEPARATION_RADIUS = 30;
const SEPARATION_FORCE = 200;
const PREFERRED_RANGE = 55;

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function lerpAngle(from, to, t) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

function createBot(i) {
  const aggression = 0.3 + Math.random() * 0.7;
  return {
    id: i, name: NAMES[i % NAMES.length], color: COLORS[i % COLORS.length],
    x: rand(-WORLD * 0.35, WORLD * 0.35), y: rand(-WORLD * 0.35, WORLD * 0.35),
    vx: 0, vy: 0, radius: 10, hp: 3, maxHp: 3, dead: false,
    hasSpear: true, facing: Math.random() * Math.PI * 2, coins: 1,
    dashing: false, dashTime: 0, dashVX: 0, dashVY: 0, lastDash: 0,
    moveX: 0, moveY: 0, shootCd: 0, actionTimer: 0, strafeDir: 1,
    retreatTimer: 0, wanderAngle: Math.random() * Math.PI * 2,
    deadSince: 0, spawnedAt: Date.now(),
    aggression,
    thinkCd: 0,
    goalAngle: Math.random() * Math.PI * 2,
    mode: "wander",
    modeTimer: 1 + Math.random() * 3,
    aimNoise: 0,
    turnSpeed: 3 + Math.random() * 3,
    speedMult: 0.7 + Math.random() * 0.3,
    hesitate: 0,
  };
}

export function createBgSim() {
  let bots = [];
  let spears = [];
  let coins = [];
  let particles = [];
  let spinAngle = 0;
  let camX = 0, camY = 0;

  for (let i = 0; i < BOT_COUNT; i++) bots.push(createBot(i));

  function respawn(bot) {
    bot.x = rand(-WORLD * 0.35, WORLD * 0.35);
    bot.y = rand(-WORLD * 0.35, WORLD * 0.35);
    bot.hp = bot.maxHp; bot.dead = false; bot.hasSpear = true;
    bot.coins = 1; bot.spawnedAt = Date.now();
    bot.retreatTimer = 0; bot.mode = "wander";
    bot.modeTimer = 1 + Math.random() * 3; bot.hesitate = 0;
  }

  function step(dt) {
    const now = Date.now();
    spinAngle += dt * 14;

    for (const b of bots) {
      if (b.dead) {
        if (now - b.deadSince > 2000) respawn(b);
        continue;
      }

      b.shootCd -= dt;
      b.actionTimer -= dt;
      b.retreatTimer -= dt;
      b.modeTimer -= dt;
      b.thinkCd -= dt;
      if (b.hesitate > 0) b.hesitate -= dt;

      let nearest = null, nearDist = Infinity;
      for (const o of bots) {
        if (o.id === b.id || o.dead) continue;
        const d = dist(b, o);
        if (d < nearDist) { nearDist = d; nearest = o; }
      }

      const immune = b.spawnedAt && now - b.spawnedAt < 3000;

      if (b.modeTimer <= 0) {
        const roll = Math.random();
        if (nearest && nearDist < BOOM_RANGE * 1.5 && roll < b.aggression) {
          b.mode = "fight";
          b.modeTimer = 1.5 + Math.random() * 2.5;
        } else if (roll < 0.15) {
          b.mode = "idle";
          b.modeTimer = 0.5 + Math.random() * 1.5;
          b.hesitate = b.modeTimer;
        } else {
          b.mode = "wander";
          b.modeTimer = 2 + Math.random() * 4;
          b.wanderAngle += (Math.random() - 0.5) * 2;
        }
        b.strafeDir = Math.random() > 0.5 ? 1 : -1;
      }

      if (nearest && nearDist < BOOM_RANGE * 0.6 && b.mode === "wander") {
        if (Math.random() < b.aggression * 0.3) b.mode = "fight";
      }

      let goalX = 0, goalY = 0;
      let desiredSpeed = b.speedMult;

      if (b.mode === "idle" || b.hesitate > 0) {
        goalX = 0; goalY = 0; desiredSpeed = 0.1;
        if (nearest) {
          const aim = Math.atan2(nearest.y - b.y, nearest.x - b.x);
          b.goalAngle = aim;
        }
      } else if (b.mode === "wander" || !nearest) {
        if (b.actionTimer <= 0) {
          b.wanderAngle += (Math.random() - 0.5) * 1.0;
          b.actionTimer = 1.5 + Math.random() * 2.5;
        }
        goalX = Math.cos(b.wanderAngle);
        goalY = Math.sin(b.wanderAngle);
        b.goalAngle = b.wanderAngle;
        desiredSpeed *= 0.6;

        if (nearest && nearDist < BOOM_RANGE && b.hasSpear && b.shootCd <= 0 && !immune && Math.random() < 0.02) {
          b.mode = "fight"; b.modeTimer = 2;
        }
      } else {
        const dx = nearest.x - b.x, dy = nearest.y - b.y;
        const rawAim = Math.atan2(dy, dx);
        b.goalAngle = rawAim;

        if (b.thinkCd <= 0) {
          b.aimNoise = (Math.random() - 0.5) * 0.4;
          b.thinkCd = 0.15 + Math.random() * 0.2;
        }

        const inRange = nearDist < BOOM_RANGE + b.radius;
        if (inRange && b.hasSpear && b.shootCd <= 0 && !immune) {
          b.shootCd = 0.8 + Math.random() * 1.2;
          b.hasSpear = false;
          const shotAngle = rawAim + b.aimNoise * 0.5;
          spears.push({
            id: `s${b.id}:${now}`, ownerId: b.id,
            x: b.x + Math.cos(shotAngle) * b.radius, y: b.y + Math.sin(shotAngle) * b.radius,
            dirX: Math.cos(shotAngle), dirY: Math.sin(shotAngle), speed: BOOM_SPEED,
            maxDist: BOOM_RANGE, traveled: 0, returning: false, returnTraveled: 0,
            radius: 3, hitTargets: new Set(), color: b.color
          });
          b.retreatTimer = 0.3 + Math.random() * 0.5;
        }

        if (b.retreatTimer > 0) {
          goalX = -dx / nearDist;
          goalY = -dy / nearDist;
          const perpX = -dy / nearDist, perpY = dx / nearDist;
          goalX += perpX * b.strafeDir * 0.6;
          goalY += perpY * b.strafeDir * 0.6;
        } else if (!b.hasSpear) {
          if (nearDist < PREFERRED_RANGE * 0.8) {
            goalX = -dx / nearDist * 0.5;
            goalY = -dy / nearDist * 0.5;
          } else {
            goalX = Math.cos(b.wanderAngle) * 0.6;
            goalY = Math.sin(b.wanderAngle) * 0.6;
          }
          const perpX = -dy / nearDist, perpY = dx / nearDist;
          goalX += perpX * b.strafeDir * 0.4;
          goalY += perpY * b.strafeDir * 0.4;
          desiredSpeed *= 0.85;
        } else if (nearDist > BOOM_RANGE * 0.9) {
          const approachNoise = b.aimNoise * 0.6;
          goalX = Math.cos(rawAim + approachNoise);
          goalY = Math.sin(rawAim + approachNoise);
        } else if (nearDist < PREFERRED_RANGE * 0.5) {
          goalX = -dx / nearDist * 0.5;
          goalY = -dy / nearDist * 0.5;
          const perpX = -dy / nearDist, perpY = dx / nearDist;
          goalX += perpX * b.strafeDir * 0.7;
          goalY += perpY * b.strafeDir * 0.7;
        } else {
          if (b.actionTimer <= 0) {
            b.strafeDir = Math.random() > 0.5 ? 1 : -1;
            b.actionTimer = 1.0 + Math.random() * 1.5;
            if (Math.random() < 0.2) { b.hesitate = 0.2 + Math.random() * 0.3; }
          }
          const perpX = -dy / nearDist, perpY = dx / nearDist;
          const approach = nearDist < PREFERRED_RANGE ? -0.15 : 0.2;
          goalX = perpX * b.strafeDir * 0.7 + (dx / nearDist) * approach;
          goalY = perpY * b.strafeDir * 0.7 + (dy / nearDist) * approach;
        }

        if (now - b.lastDash > DASH_CD && !immune && b.mode === "fight") {
          const dashRoll = Math.random();
          if (nearDist < 40 && dashRoll < 0.01) {
            b.dashing = true; b.dashTime = DASH_DUR; b.lastDash = now;
            const m = Math.hypot(goalX, goalY);
            if (m > 0.1) { b.dashVX = (goalX / m) * (DASH_DIST / DASH_DUR); b.dashVY = (goalY / m) * (DASH_DIST / DASH_DUR); }
          }
        }
      }

      b.facing = lerpAngle(b.facing, b.goalAngle, b.turnSpeed * dt);

      let sepX = 0, sepY = 0;
      for (const o of bots) {
        if (o.id === b.id || o.dead) continue;
        const dx = b.x - o.x, dy = b.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d < SEPARATION_RADIUS && d > 0.1) {
          const strength = (SEPARATION_RADIUS - d) / SEPARATION_RADIUS;
          sepX += (dx / d) * strength;
          sepY += (dy / d) * strength;
        }
      }

      const mg = Math.hypot(goalX, goalY);
      if (mg > 0.01) { goalX /= mg; goalY /= mg; }
      const targetMX = goalX * desiredSpeed + sepX * (SEPARATION_FORCE / SPEED);
      const targetMY = goalY * desiredSpeed + sepY * (SEPARATION_FORCE / SPEED);
      b.moveX += (targetMX - b.moveX) * Math.min(1, 4 * dt);
      b.moveY += (targetMY - b.moveY) * Math.min(1, 4 * dt);
      const fm = Math.hypot(b.moveX, b.moveY);
      if (fm > 1) { b.moveX /= fm; b.moveY /= fm; }

      if (b.dashing && b.dashTime > 0) {
        const s = Math.min(dt, b.dashTime);
        b.x += b.dashVX * s; b.y += b.dashVY * s;
        b.vx = b.dashVX; b.vy = b.dashVY;
        b.dashTime -= dt;
        if (b.dashTime <= 0) b.dashing = false;
      } else {
        b.vx = b.moveX * SPEED; b.vy = b.moveY * SPEED;
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
      const hw = WORLD * 0.5 - b.radius;
      b.x = clamp(b.x, -hw, hw); b.y = clamp(b.y, -hw, hw);
    }

    for (let i = spears.length - 1; i >= 0; i--) {
      const s = spears[i];
      const owner = bots.find(b => b.id === s.ownerId);
      if (!owner || owner.dead) { spears.splice(i, 1); continue; }

      if (!s.returning) {
        s.x += s.dirX * s.speed * dt; s.y += s.dirY * s.speed * dt;
        s.traveled += s.speed * dt;
        if (s.traveled >= s.maxDist) { s.returning = true; s.returnTraveled = 0; }
      } else {
        const dx = owner.x - s.x, dy = owner.y - s.y;
        const d = Math.hypot(dx, dy);
        if (d < owner.radius + 4) { owner.hasSpear = true; spears.splice(i, 1); continue; }
        const rs = s.speed * 1.3 * dt;
        s.x += (dx / d) * rs; s.y += (dy / d) * rs;
        s.returnTraveled += rs;
      }

      for (const target of bots) {
        if (target.id === s.ownerId || target.dead || s.hitTargets.has(target.id)) continue;
        if (target.spawnedAt && now - target.spawnedAt < 3000) continue;
        if (dist(s, target) > target.radius + s.radius) continue;
        s.hitTargets.add(target.id);
        const isReturn = s.returning && s.returnTraveled > 5;
        target.hp -= isReturn ? 3 : 1;
        particles.push(...burstParticles(target.x, target.y, 6));
        if (!s.returning) { s.returning = true; s.returnTraveled = 0; }
        if (target.hp <= 0) {
          target.dead = true; target.deadSince = now;
          coins.push({ x: target.x, y: target.y, value: target.coins, life: 8 });
          target.coins = 0;
          if (owner) { owner.coins += 1; owner.hp = Math.min(owner.maxHp, owner.hp + 1); }
          particles.push(...deathBurst(target.x, target.y, target.color));
        }
        break;
      }
    }

    for (const b of bots) {
      if (b.dead) continue;
      for (let i = coins.length - 1; i >= 0; i--) {
        if (dist(b, coins[i]) < b.radius * 1.5) {
          b.coins += coins[i].value; coins.splice(i, 1);
        }
      }
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      coins[i].life -= dt;
      if (coins[i].life <= 0) coins.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95;
    }

    const alive = bots.filter(b => !b.dead);
    if (alive.length > 0) {
      let ax = 0, ay = 0;
      for (const b of alive) { ax += b.x; ay += b.y; }
      camX += (ax / alive.length - camX) * 0.02;
      camY += (ay / alive.length - camY) * 0.02;
    }
  }

  function burstParticles(wx, wy, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60;
      out.push({ x: wx, y: wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.2, size: 1.5 + Math.random() * 2, color: "#fff" });
    }
    return out;
  }

  function deathBurst(wx, wy, color) {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, sp = 40 + Math.random() * 40;
      out.push({ x: wx, y: wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.3, size: 2 + Math.random() * 3, color });
    }
    out.push({ x: wx, y: wy, vx: 0, vy: 0, life: 0.4, size: 0, ring: true, ringSpeed: 120, color });
    return out;
  }

  function draw(ctx, W, H) {
    const zoom = 2.2;

    function w2s(x, y) {
      return { x: (x - camX) * zoom + W * 0.5, y: (y - camY) * zoom + H * 0.5 };
    }

    const cell = 40;
    const vw = W / zoom, vh = H / zoom;
    const sx = Math.floor((camX - vw * 0.5) / cell) * cell;
    const ex = Math.ceil((camX + vw * 0.5) / cell) * cell;
    const sy = Math.floor((camY - vh * 0.5) / cell) * cell;
    const ey = Math.ceil((camY + vh * 0.5) / cell) * cell;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let x = sx; x <= ex; x += cell) {
      for (let y = sy; y <= ey; y += cell) {
        const p = w2s(x, y);
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 * zoom, 0, Math.PI * 2); ctx.fill();
      }
    }

    const hwb = WORLD * 0.5;
    const tl = w2s(-hwb, -hwb), br = w2s(hwb, hwb);
    ctx.strokeStyle = "rgba(255,80,80,0.15)"; ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]); ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y); ctx.setLineDash([]);

    for (const c of coins) {
      const p = w2s(c.x, c.y);
      const r = 7 * zoom;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd700"; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1;
      ctx.font = `bold ${Math.max(7, 7 * zoom)}px Arial`;
      ctx.fillStyle = "#8B6914"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(c.value, p.x, p.y);
    }

    const now = Date.now();
    for (const b of bots) {
      if (b.dead) continue;
      const p = w2s(b.x, b.y);
      const r = b.radius * zoom;

      if (b.spawnedAt && now - b.spawnedAt < 3000) {
        ctx.globalAlpha = 0.3 + Math.sin(now * 0.008) * 0.1;
        ctx.strokeStyle = "#7af0ff"; ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shadeHex(b.color, -0.3); ctx.lineWidth = 1.5; ctx.stroke();

      const eo = r * 0.28, es = r * 0.15, ps = es * 0.55;
      const px = -Math.sin(b.facing), py = Math.cos(b.facing), fx = Math.cos(b.facing), fy = Math.sin(b.facing);
      for (const side of [-1, 1]) {
        const ex = p.x + px * eo * side + fx * r * 0.6, ey = p.y + py * eo * side + fy * r * 0.6;
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, es, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(ex + fx * es * 0.35, ey + fy * es * 0.35, ps, 0, Math.PI * 2); ctx.fill();
      }

      if (b.coins > 0) {
        const br2 = Math.max(5, r * 0.3);
        ctx.beginPath(); ctx.arc(p.x, p.y, br2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fill();
        ctx.strokeStyle = "#ffd700"; ctx.lineWidth = 1; ctx.stroke();
        ctx.font = `bold ${Math.max(7, br2 * 1.2)}px Arial`;
        ctx.fillStyle = "#ffd700"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(b.coins, p.x, p.y + 0.5);
      }

      if (b.hasSpear) {
        const bs = r * 0.5, od = r + bs * 0.6;
        const bx = p.x + Math.cos(b.facing) * od, by = p.y + Math.sin(b.facing) * od;
        drawBoom(ctx, bx, by, bs / zoom, b.facing + Math.PI * 0.25, zoom, b.color);
      }

      const hs = Math.max(4, r * 0.18), sp = hs * 1.3;
      const tw = b.maxHp * sp - (sp - hs);
      const hsx = p.x - tw * 0.5, hsy = p.y - r - hs - 4;
      for (let i = 0; i < b.maxHp; i++) {
        const hx = hsx + i * sp + hs * 0.5;
        ctx.save(); ctx.translate(hx, hsy);
        ctx.beginPath(); ctx.moveTo(0, hs * 0.2);
        ctx.bezierCurveTo(-hs * 0.6, -hs * 0.2, -hs * 0.3, -hs * 0.6, 0, -hs * 0.25);
        ctx.bezierCurveTo(hs * 0.3, -hs * 0.6, hs * 0.6, -hs * 0.2, 0, hs * 0.2);
        ctx.fillStyle = i < b.hp ? "#ef4444" : "rgba(0,0,0,0.3)"; ctx.fill();
        ctx.restore();
      }
    }

    for (const s of spears) {
      const p = w2s(s.x, s.y);
      drawBoom(ctx, p.x, p.y, s.radius * 1.8, spinAngle, zoom, s.color);
    }

    for (const p of particles) {
      const sp = w2s(p.x, p.y);
      if (p.ring) {
        p.size += (p.ringSpeed || 120) * (1 / 60);
        ctx.globalAlpha = p.life * 1.2; ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, 2 * zoom * p.life);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, p.size * zoom, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1, p.size * zoom * p.life), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  function drawBoom(ctx, px, py, size, spin, zoom, fill) {
    const r = size * zoom, aw = r * 0.22;
    ctx.save(); ctx.translate(px, py); ctx.rotate(spin);
    ctx.fillStyle = fill || "#f5c542"; ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, aw); ctx.lineTo(r, -r * 0.5 + aw);
    ctx.lineTo(r * 1.05, -r * 0.5 - aw * 0.3); ctx.lineTo(r * 0.9, -r * 0.5 - aw);
    ctx.lineTo(0, -aw); ctx.lineTo(-r * 0.5 + aw, -r);
    ctx.lineTo(-r * 0.5 - aw * 0.3, -r * 1.05); ctx.lineTo(-r * 0.5 - aw, -r * 0.9);
    ctx.lineTo(-aw, 0); ctx.lineTo(0, aw); ctx.closePath();
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  function shadeHex(hex, pct) {
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    r = clamp(Math.round(r * (1 + pct)), 0, 255);
    g = clamp(Math.round(g * (1 + pct)), 0, 255);
    b = clamp(Math.round(b * (1 + pct)), 0, 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  return { step, draw };
}
