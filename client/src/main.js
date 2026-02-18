import { createSocketClient } from "./net/socketClient.js";
import { createControls } from "./input/controls.js";
import { createHud } from "./ui/hud.js";

const appEl = document.getElementById("app");
const hud = createHud();
const socketClient = createSocketClient();

const canvas = document.createElement("canvas");
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.width = appEl.clientWidth;
canvas.height = appEl.clientHeight;
appEl.appendChild(canvas);
const ctx = canvas.getContext("2d");
const controls = createControls(canvas);

let gameStarted = false;

const startScreen = document.getElementById("startScreen");
const nameInput = document.getElementById("nameInput");
const playBtn = document.getElementById("playBtn");
const hudEl = document.getElementById("hud");

function startGame() {
  const name = nameInput.value.trim() || "";
  startScreen.style.display = "none";
  if (hudEl) hudEl.style.display = "";
  socketClient.connect(name);
  gameStarted = true;
}

playBtn.addEventListener("click", startGame);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startGame();
});

let snapshot = null;
let seq = 0;
let serverX = 0, serverY = 0, renderX = 0, renderY = 0;
let localRadius = 10, localName = "", localHasSpear = true;
let localHp = 3, localMaxHp = 3, localDead = false;
let localColor = "#7cf7b2", localKills = 0, localDeaths = 0, localLastDashAt = 0;
let arenaRadius = 250, currentZoom = 6, facingAngle = 0;
let lastTime = performance.now(), spinAngle = 0;
let lastInputSend = 0;
const INPUT_SEND_INTERVAL = 1000 / 30;

let dashTimer = 0;
const DASH_ANIM_DURATION = 0.2;
let dashDirX = 0, dashDirY = 0;
const dashTrail = [];
const MAX_TRAIL = 8;

const hitParticles = [];
const deathParticles = [];

const killFeed = [];
const KILL_FEED_MAX = 5;
const KILL_FEED_DURATION = 4;

const boomerangTrails = {};
const otherPlayerRender = {};

function getTargetZoom(radius) { return Math.max(0.35, 60 / (radius + 4)); }

function resize() { canvas.width = appEl.clientWidth; canvas.height = appEl.clientHeight; }
window.addEventListener("resize", resize);

function shadeColor(hex, percent) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, Math.max(0, Math.round(r * (1 + percent))));
  g = Math.min(255, Math.max(0, Math.round(g * (1 + percent))));
  b = Math.min(255, Math.max(0, Math.round(b * (1 + percent))));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

let prevDashing = false, prevHp = 3;

socketClient.onSnapshot((next) => {
  snapshot = next;
  const localId = socketClient.getPlayerId();
  const me = next.players.find((p) => p.id === localId);
  if (next.world?.arenaRadius) arenaRadius = next.world.arenaRadius;

  if (me) {
    serverX = me.x; serverY = me.y;
    localRadius = me.radius; localName = me.name;
    localHasSpear = me.hasSpear; localHp = me.hp; localMaxHp = me.maxHp;
    localDead = me.dead; localColor = me.color || "#7cf7b2";
    localKills = me.kills ?? 0; localDeaths = me.deaths ?? 0;
    localLastDashAt = me.lastDashAt ?? 0;
    prevHp = me.hp;

    if (me.dashing && !prevDashing) {
      dashTimer = DASH_ANIM_DURATION;
      const mag = Math.hypot(me.vx, me.vy);
      if (mag > 0.1) { dashDirX = me.vx / mag; dashDirY = me.vy / mag; }
    }
    prevDashing = me.dashing;
  }

  if (next.killEvents) {
    for (const evt of next.killEvents) {
      killFeed.unshift({ ...evt, timer: KILL_FEED_DURATION });
      if (killFeed.length > KILL_FEED_MAX) killFeed.pop();
    }
  }

  if (next.players) {
    for (const p of next.players) {
      if (p.id === localId) continue;
      if (!otherPlayerRender[p.id]) otherPlayerRender[p.id] = { x: p.x, y: p.y };
      otherPlayerRender[p.id].targetX = p.x;
      otherPlayerRender[p.id].targetY = p.y;
    }
  }

  if (next.spears) {
    const pColors = {};
    for (const pl of next.players) pColors[pl.id] = pl.color || "#f5c542";
    for (const s of next.spears) {
      if (!boomerangTrails[s.id]) boomerangTrails[s.id] = [];
      const trail = boomerangTrails[s.id];
      trail.push({ x: s.x, y: s.y, life: 1.0, color: pColors[s.ownerId] || "#f5c542" });
      if (trail.length > 12) trail.shift();
    }
    const activeIds = new Set(next.spears.map((s) => s.id));
    for (const id of Object.keys(boomerangTrails)) {
      if (!activeIds.has(id)) boomerangTrails[id].forEach((t) => (t.fade = true));
    }
  }
});

function worldToScreen(x, y, cameraX, cameraY, zoom) {
  return { x: (x - cameraX) * zoom + canvas.width * 0.5, y: (y - cameraY) * zoom + canvas.height * 0.5 };
}

function drawBackground(cameraX, cameraY, zoom) {
  const grad = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.5, 0, canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.7);
  grad.addColorStop(0, "#141e30"); grad.addColorStop(1, "#0a0f1a");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cell = 40;
  const viewW = canvas.width / zoom, viewH = canvas.height / zoom;
  const startX = Math.floor((cameraX - viewW * 0.5) / cell) * cell;
  const endX = Math.ceil((cameraX + viewW * 0.5) / cell) * cell;
  const startY = Math.floor((cameraY - viewH * 0.5) / cell) * cell;
  const endY = Math.ceil((cameraY + viewH * 0.5) / cell) * cell;

  const dotR = Math.max(1.2, 1.5 * zoom);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let x = startX; x <= endX; x += cell) {
    for (let y = startY; y <= endY; y += cell) {
      const sx = (x - cameraX) * zoom + canvas.width * 0.5;
      const sy = (y - cameraY) * zoom + canvas.height * 0.5;
      ctx.beginPath(); ctx.arc(sx, sy, dotR, 0, Math.PI * 2); ctx.fill();
    }
  }

  const crossSize = Math.max(3, 4 * zoom);
  ctx.strokeStyle = "rgba(255,255,255,0.035)"; ctx.lineWidth = 1;
  for (let x = startX; x <= endX; x += cell * 3) {
    for (let y = startY; y <= endY; y += cell * 3) {
      const sx = (x - cameraX) * zoom + canvas.width * 0.5;
      const sy = (y - cameraY) * zoom + canvas.height * 0.5;
      ctx.beginPath(); ctx.moveTo(sx - crossSize, sy); ctx.lineTo(sx + crossSize, sy);
      ctx.moveTo(sx, sy - crossSize); ctx.lineTo(sx, sy + crossSize); ctx.stroke();
    }
  }
}

function drawArenaBoundary(cameraX, cameraY, zoom) {
  const center = worldToScreen(0, 0, cameraX, cameraY, zoom);
  const r = arenaRadius * zoom;
  ctx.save();
  ctx.setLineDash([16, 10]); ctx.strokeStyle = "rgba(255,80,80,0.25)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(center.x, center.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle = "rgba(255,80,80,0.06)"; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(center.x, center.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawBoomerang(px, py, size, spin, zoom, fillColor) {
  const r = size * zoom; const armW = r * 0.22;
  ctx.save(); ctx.translate(px, py); ctx.rotate(spin);
  ctx.fillStyle = fillColor || "#f5c542"; ctx.strokeStyle = "#111111";
  ctx.lineWidth = Math.max(2, r * 0.14); ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, armW); ctx.lineTo(r, -r * 0.5 + armW);
  ctx.lineTo(r * 1.05, -r * 0.5 - armW * 0.3); ctx.lineTo(r * 0.9, -r * 0.5 - armW);
  ctx.lineTo(0, -armW); ctx.lineTo(-r * 0.5 + armW, -r);
  ctx.lineTo(-r * 0.5 - armW * 0.3, -r * 1.05); ctx.lineTo(-r * 0.5 - armW, -r * 0.9);
  ctx.lineTo(-armW, 0); ctx.lineTo(0, armW); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawHeldBoomerang(px, py, angle, playerR, zoom, color) {
  const boomSize = playerR * 0.5;
  const offsetDist = playerR + boomSize * 0.6;
  const bx = px + Math.cos(angle) * offsetDist;
  const by = py + Math.sin(angle) * offsetDist;
  drawBoomerang(bx, by, boomSize / zoom, angle + Math.PI * 0.25, zoom, color);
}

function drawHearts(px, py, r, hp, maxHp) {
  const heartSize = Math.max(6, r * 0.22);
  const spacing = heartSize * 1.3;
  const totalW = maxHp * spacing - (spacing - heartSize);
  const startX = px - totalW * 0.5;
  const y = py - r - heartSize - 6;
  for (let i = 0; i < maxHp; i++) {
    const hx = startX + i * spacing + heartSize * 0.5;
    drawHeart(hx, y, heartSize * 0.5, i < hp);
  }
}

function drawHeart(cx, cy, size, filled) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, size * 0.35);
  ctx.bezierCurveTo(-size, -size * 0.3, -size * 0.5, -size, 0, -size * 0.4);
  ctx.bezierCurveTo(size * 0.5, -size, size, -size * 0.3, 0, size * 0.35);
  ctx.closePath();
  if (filled) { ctx.fillStyle = "#ef4444"; ctx.fill(); ctx.strokeStyle = "#991b1b"; }
  else { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.15)"; }
  ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}

const BOOM_RANGE = 84;

function drawRangeCircle(px, py, playerRadius, zoom, color) {
  const rangeR = (BOOM_RANGE + playerRadius) * zoom;
  ctx.setLineDash([8, 6]); ctx.strokeStyle = color;
  ctx.lineWidth = 1.5; ctx.globalAlpha = 0.2;
  ctx.beginPath(); ctx.arc(px, py, rangeR, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

function drawEyes(px, py, r, facing) {
  const eyeOffset = r * 0.3, eyeSize = r * 0.18, pupilSize = eyeSize * 0.55;
  const perpX = -Math.sin(facing), perpY = Math.cos(facing);
  const fwdX = Math.cos(facing), fwdY = Math.sin(facing);
  for (const side of [-1, 1]) {
    const ex = px + perpX * eyeOffset * side + fwdX * r * 0.35;
    const ey = py + perpY * eyeOffset * side + fwdY * r * 0.35;
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(ex, ey, eyeSize, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111"; ctx.beginPath();
    ctx.arc(ex + fwdX * eyeSize * 0.3, ey + fwdY * eyeSize * 0.3, pupilSize, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPlayer(player, cameraX, cameraY, zoom, isLocal, dt) {
  if (player.dead) return;
  let px, py;
  if (isLocal) {
    const p = worldToScreen(renderX, renderY, cameraX, cameraY, zoom);
    px = p.x; py = p.y;
  } else {
    const rp = otherPlayerRender[player.id];
    if (rp) {
      const lerpT = Math.min(1, 20 * dt);
      rp.x += (rp.targetX - rp.x) * lerpT; rp.y += (rp.targetY - rp.y) * lerpT;
      const p = worldToScreen(rp.x, rp.y, cameraX, cameraY, zoom);
      px = p.x; py = p.y;
    } else {
      const p = worldToScreen(player.x, player.y, cameraX, cameraY, zoom);
      px = p.x; py = p.y;
    }
  }

  const r = player.radius * zoom;
  const color = player.color || (isLocal ? "#7cf7b2" : "#ff7a7a");
  const strokeColor = shadeColor(color, -0.3);
  const fa = player.facingAngle ?? 0;
  const hitAge = Date.now() - (player.hitTime ?? 0);
  const flashing = hitAge < 150;
  const drawColor = flashing ? "#ff3333" : color;

  drawRangeCircle(px, py, player.radius, zoom, color);

  ctx.fillStyle = drawColor; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = flashing ? "#cc0000" : strokeColor;
  ctx.lineWidth = Math.max(1.5, r * 0.06); ctx.stroke();

  drawEyes(px, py, r, fa);

  ctx.fillStyle = "#0a1020";
  ctx.font = `bold ${Math.max(10, r * 0.3)}px Inter, Arial`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(player.name, px, py + r * 0.5);

  drawHearts(px, py, r, player.hp, player.maxHp);

  if (player.hasSpear) drawHeldBoomerang(px, py, fa, r, zoom, color);
}

function spawnHitParticles(worldX, worldY, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 80;
    hitParticles.push({
      x: worldX, y: worldY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.3, size: 1.5 + Math.random() * 2.5,
      color: Math.random() > 0.5 ? "#fff" : "#f5c542"
    });
  }
}

function spawnDeathExplosion(worldX, worldY, color) {
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const speed = 60 + Math.random() * 50;
    deathParticles.push({
      x: worldX, y: worldY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.4, size: 2 + Math.random() * 4, color: color || "#ff7a7a"
    });
  }
  deathParticles.push({ x: worldX, y: worldY, vx: 0, vy: 0, life: 0.5, size: 0, ring: true, ringSpeed: 180, color: color || "#ff7a7a" });
}

function updateAndDrawParticles(particles, cameraX, cameraY, zoom, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (p.ring) {
      p.size += p.ringSpeed * dt;
      const sp = worldToScreen(p.x, p.y, cameraX, cameraY, zoom);
      ctx.globalAlpha = p.life * 1.5; ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1.5, 3 * zoom * p.life);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, p.size * zoom, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95;
      const sp = worldToScreen(p.x, p.y, cameraX, cameraY, zoom);
      ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1, p.size * zoom * p.life), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
}

function drawBoomerangTrails(cameraX, cameraY, zoom, dt) {
  for (const id of Object.keys(boomerangTrails)) {
    const trail = boomerangTrails[id];
    for (let i = trail.length - 1; i >= 0; i--) {
      const t = trail[i]; t.life -= dt * 3;
      if (t.life <= 0 || t.fade) { trail.splice(i, 1); continue; }
      const sp = worldToScreen(t.x, t.y, cameraX, cameraY, zoom);
      ctx.globalAlpha = t.life * 0.5; ctx.fillStyle = t.color || "#f5c542";
      ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1, 3 * zoom * t.life), 0, Math.PI * 2); ctx.fill();
    }
    if (trail.length === 0) delete boomerangTrails[id];
  }
  ctx.globalAlpha = 1;
}

function drawDashTrail(cameraX, cameraY, zoom, r) {
  for (let i = 0; i < dashTrail.length; i++) {
    const ghost = dashTrail[i]; ghost.life -= 0.04;
    if (ghost.life <= 0) { dashTrail.splice(i, 1); i--; continue; }
    const gp = worldToScreen(ghost.x, ghost.y, cameraX, cameraY, zoom);
    ctx.globalAlpha = ghost.life * 0.4; ctx.fillStyle = localColor;
    ctx.beginPath(); ctx.arc(gp.x, gp.y, r * ghost.life, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
}

function drawSpeedLines(px, py, r, dirX, dirY, progress) {
  const count = 6; ctx.globalAlpha = Math.max(0, 1 - progress) * 0.6;
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1.5, r * 0.04); ctx.lineCap = "round";
  const perpX = -dirY, perpY = dirX;
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) - 0.5;
    const spread = r * 1.4 * t;
    const ox = px - dirX * r * (1.2 + Math.random() * 0.5) + perpX * spread;
    const oy = py - dirY * r * (1.2 + Math.random() * 0.5) + perpY * spread;
    const len = r * (0.4 + Math.random() * 0.6);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox - dirX * len, oy - dirY * len); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawKillFeed(dt) {
  ctx.save(); const x = canvas.width - 20; let y = 60;
  for (let i = killFeed.length - 1; i >= 0; i--) {
    killFeed[i].timer -= dt;
    if (killFeed[i].timer <= 0) killFeed.splice(i, 1);
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const entry of killFeed) {
    const alpha = Math.min(1, entry.timer / 0.5);
    ctx.globalAlpha = alpha * 0.9; ctx.font = "bold 13px Inter, Arial";
    const text = `${entry.killer}  eliminated  ${entry.victim}`;
    const measured = ctx.measureText(text);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath(); ctx.roundRect(x - measured.width - 16, y - 12, measured.width + 16, 24, 6); ctx.fill();
    ctx.fillStyle = entry.killerColor || "#fff";
    ctx.fillText(entry.killer, x - ctx.measureText(`  eliminated  ${entry.victim}`).width, y);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(`  eliminated  `, x - ctx.measureText(entry.victim).width, y);
    ctx.fillStyle = entry.victimColor || "#ff7a7a";
    ctx.fillText(entry.victim, x, y);
    y += 30;
  }
  ctx.globalAlpha = 1; ctx.restore();
}

function drawDashCooldownIndicator(px, py, r) {
  const DASH_COOLDOWN_MS = 1500;
  const elapsed = Date.now() - localLastDashAt;
  if (elapsed >= DASH_COOLDOWN_MS) return;
  const progress = Math.min(1, elapsed / DASH_COOLDOWN_MS);
  const indicatorR = Math.max(8, r * 0.3);
  const ix = px + r + indicatorR + 6, iy = py;
  ctx.globalAlpha = 0.5; ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath(); ctx.arc(ix, iy, indicatorR, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.8; ctx.strokeStyle = "#7af0ff"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(ix, iy, indicatorR - 2, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * progress); ctx.stroke();
  ctx.globalAlpha = 0.7; ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.max(7, indicatorR * 0.7)}px Inter, Arial`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("\u21e7", ix, iy); ctx.globalAlpha = 1;
}

function drawScoreboard() {
  if (!snapshot) return;
  ctx.save(); const x = 12; let y = 60;
  const lb = snapshot.leaderboard ?? [];
  const localId = socketClient.getPlayerId();
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.globalAlpha = 0.85; ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.roundRect(x, y - 4, 200, 28 + lb.length * 22, 8); ctx.fill();
  ctx.globalAlpha = 1; ctx.font = "bold 14px Inter, Arial"; ctx.fillStyle = "#fff";
  ctx.fillText("Scoreboard", x + 10, y); y += 22;
  ctx.font = "12px Inter, Arial";
  for (let i = 0; i < lb.length; i++) {
    const entry = lb[i]; const isMe = entry.id === localId;
    ctx.fillStyle = isMe ? "#7cf7b2" : "rgba(255,255,255,0.7)";
    const suffix = entry.isBot ? " [BOT]" : "";
    ctx.fillText(`${i + 1}. ${entry.name}${suffix}  K:${entry.kills ?? 0}  D:${entry.deaths ?? 0}`, x + 10, y);
    y += 20;
  }
  ctx.restore();
}

let prevPlayerStates = {};
function detectHitsAndDeaths() {
  if (!snapshot) return;
  const currentStates = {};
  for (const p of snapshot.players) currentStates[p.id] = { hp: p.hp, dead: p.dead, x: p.x, y: p.y, color: p.color };
  for (const id of Object.keys(currentStates)) {
    const cur = currentStates[id], prev = prevPlayerStates[id];
    if (!prev) continue;
    if (cur.hp < prev.hp && !cur.dead) spawnHitParticles(cur.x, cur.y, 10);
    if (cur.dead && !prev.dead) spawnDeathExplosion(cur.x, cur.y, cur.color);
  }
  prevPlayerStates = currentStates;
}

function tick() {
  requestAnimationFrame(tick);
  if (!gameStarted) return;

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  spinAngle += dt * 14;

  const input = controls.readInput();
  const dummyInput = controls.readDummyInput();
  facingAngle = input.aimAngle;

  const dummyActive = dummyInput.moveX !== 0 || dummyInput.moveY !== 0;
  if (now - lastInputSend >= INPUT_SEND_INTERVAL || input.shoot || input.dash || dummyActive) {
    lastInputSend = now;
    seq += 1;
    socketClient.sendInput({ seq, moveX: input.moveX, moveY: input.moveY, shoot: input.shoot, dash: input.dash, facingAngle });
    socketClient.sendDummyInput(dummyInput);
  }

  const lerpSpeed = 50;
  const t = Math.min(1, lerpSpeed * dt);
  renderX += (serverX - renderX) * t;
  renderY += (serverY - renderY) * t;

  if (dashTimer > 0) {
    dashTimer -= dt;
    if (dashTrail.length < MAX_TRAIL) dashTrail.push({ x: renderX, y: renderY, life: 1.0 });
  }

  const targetZoom = getTargetZoom(localRadius);
  currentZoom += (targetZoom - currentZoom) * 0.05;

  detectHitsAndDeaths();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground(renderX, renderY, currentZoom);
  drawArenaBoundary(renderX, renderY, currentZoom);

  const localId = socketClient.getPlayerId();
  if (snapshot) {
    for (const player of snapshot.players) {
      if (player.id === localId) continue;
      drawPlayer(player, renderX, renderY, currentZoom, false, dt);
    }
  }

  const p = worldToScreen(renderX, renderY, renderX, renderY, currentZoom);
  const r = localRadius * currentZoom;

  if (!localDead) {
    const meData = snapshot?.players?.find((pl) => pl.id === localId);
    const me = meData ? { ...meData, facingAngle, color: localColor } : {
      x: renderX, y: renderY, radius: localRadius, name: localName,
      hasSpear: localHasSpear, hp: localHp, maxHp: localMaxHp,
      dead: localDead, facingAngle, color: localColor, hitTime: 0
    };

    drawDashTrail(renderX, renderY, currentZoom, r);

    const isDashing = dashTimer > 0;
    if (isDashing) {
      const progress = 1 - (dashTimer / DASH_ANIM_DURATION);
      ctx.save(); ctx.translate(p.x, p.y);
      const angle = Math.atan2(dashDirY, dashDirX);
      ctx.rotate(angle);
      ctx.scale(1 + (1 - progress) * 0.35, 1 - (1 - progress) * 0.15);
      ctx.rotate(-angle); ctx.translate(-p.x, -p.y);
    }

    drawPlayer(me, renderX, renderY, currentZoom, true, dt);

    if (isDashing) {
      ctx.restore();
      drawSpeedLines(p.x, p.y, r, dashDirX, dashDirY, 1 - (dashTimer / DASH_ANIM_DURATION));
    }

    drawDashCooldownIndicator(p.x, p.y, r);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "bold 22px Inter, Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Respawning...", p.x, p.y);
  }

  drawBoomerangTrails(renderX, renderY, currentZoom, dt);
  if (snapshot && snapshot.spears) {
    const playerColors = {};
    for (const pl of snapshot.players) playerColors[pl.id] = pl.color || "#f5c542";
    for (const spear of snapshot.spears) {
      const sp = worldToScreen(spear.x, spear.y, renderX, renderY, currentZoom);
      drawBoomerang(sp.x, sp.y, spear.radius * 1.8, spinAngle, currentZoom, playerColors[spear.ownerId] || "#f5c542");
    }
  }

  updateAndDrawParticles(hitParticles, renderX, renderY, currentZoom, dt);
  updateAndDrawParticles(deathParticles, renderX, renderY, currentZoom, dt);

  drawKillFeed(dt);
  drawScoreboard();

  if (snapshot) {
    hud.update(snapshot, { x: renderX, y: renderY, mass: 80, radius: localRadius, name: localName, kills: localKills, deaths: localDeaths });
  }
}

tick();
