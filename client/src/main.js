import { createSocketClient } from "./net/socketClient.js";
import { createControls } from "./input/controls.js";
import { createHud } from "./ui/hud.js";
import { createWalletManager } from "./wallet/solanaWallet.js";
import { initFirebase, signInWithGoogle, signOut, waitForAuthReady, getIdToken } from "./auth/firebaseAuth.js";

const appEl = document.getElementById("app");
const hud = createHud();
const socketClient = createSocketClient();
const walletMgr = createWalletManager();

const canvas = document.createElement("canvas");
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.width = appEl.clientWidth;
canvas.height = appEl.clientHeight;
appEl.appendChild(canvas);
const ctx = canvas.getContext("2d");
const controls = createControls(canvas);

let gameStarted = false;
let balanceSol = 0;
let solPrice = 0;
let walletInfo = null;
let entryFeeUsd = 1;
let entryFeeSol = 0;
let userWalletAddress = "";
let isAuthenticated = false;
let qHoldStart = 0;
let qHolding = false;
const Q_HOLD_DURATION = 3000;
const walletBalUsd = document.getElementById("walletBalUsd");

const startScreen = document.getElementById("startScreen");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");
const hudEl = document.getElementById("hud");
const walletInput = document.getElementById("walletInput");
const walletBalEl = document.getElementById("walletBal");
const depositBtn = document.getElementById("depositBtn");
const depositModal = document.getElementById("depositModal");
const depositStatus = document.getElementById("depositStatus");
const depositClose = document.getElementById("depositClose");
const cashoutOverlay = document.getElementById("cashoutOverlay");
const cashoutAmountEl = document.getElementById("cashoutAmount");
const cashoutCanvas = document.getElementById("cashoutCanvas");
const cashoutCtx = cashoutCanvas.getContext("2d");
const cashoutResultModal = document.getElementById("cashoutResultModal");
const houseAddrDisplay = document.getElementById("houseAddrDisplay");
const pathSelect = document.getElementById("depositPathSelect");
const transferView = document.getElementById("depositTransferView");
const receiveView = document.getElementById("depositReceiveView");

const authSignedOut = document.getElementById("authSignedOut");
const authSignedIn = document.getElementById("authSignedIn");
const authStatus = document.getElementById("authStatus");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authAvatar = document.getElementById("authAvatar");

socketClient.connect();

socketClient.on("auth:config", async (data) => {
  if (data.enabled) {
    await initFirebase(data);
    const existingUser = await waitForAuthReady();
    if (existingUser) {
      const token = await getIdToken();
      if (token) socketClient.authLogin(token);
    }
  }
});
socketClient.requestAuthConfig();

function updateBalanceDisplay() {
  walletBalEl.textContent = `${balanceSol.toFixed(4)} SOL`;
  const usdVal = balanceSol * solPrice;
  walletBalUsd.textContent = solPrice > 0 ? `\u2248 $${usdVal.toFixed(2)}` : "";
  updateJoinBtn();
}

socketClient.on("auth:success", (data) => {
  isAuthenticated = true;
  authSignedOut.style.display = "none";
  authSignedIn.style.display = "";
  authName.textContent = data.displayName || data.email;
  authEmail.textContent = data.email;
  authAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.displayName || data.email)}&background=1a2540&color=ffd700&size=64`;
  balanceSol = data.balanceSol || 0;
  if (data.solPrice) solPrice = data.solPrice;
  if (data.walletAddress) {
    userWalletAddress = data.walletAddress;
    walletInput.value = data.walletAddress;
  }
  updateBalanceDisplay();
});

socketClient.on("auth:error", (data) => {
  authStatus.textContent = data.message;
  authStatus.style.color = "#ff6b6b";
});

socketClient.on("auth:wallet_updated", (data) => {
  userWalletAddress = data.walletAddress;
});

googleSignInBtn.addEventListener("click", async () => {
  authStatus.textContent = "Signing in...";
  authStatus.style.color = "rgba(255,255,255,0.4)";
  try {
    const { idToken } = await signInWithGoogle();
    authStatus.textContent = "Verifying...";
    socketClient.authLogin(idToken);
  } catch (err) {
    authStatus.textContent = err.message?.includes("popup") ? "Sign-in cancelled" : `Error: ${err.message}`;
    authStatus.style.color = "#ff6b6b";
  }
});

signOutBtn.addEventListener("click", async () => {
  await signOut();
  isAuthenticated = false;
  userWalletAddress = "";
  balanceSol = 0;
  solPrice = 0;
  walletBalEl.textContent = "0.0000 SOL";
  walletBalUsd.textContent = "";
  walletInput.value = "";
  authSignedOut.style.display = "";
  authSignedIn.style.display = "none";
  authStatus.textContent = "";
  updateJoinBtn();
});

socketClient.on("wallet:info", (data) => {
  walletInfo = data;
  entryFeeUsd = data.entryFeeUsd;
  entryFeeSol = data.entryFeeSol;
  if (data.solPrice) solPrice = data.solPrice;
  if (data.rpcUrl) walletMgr.setRpc(data.rpcUrl);
  if (data.houseWallet) houseAddrDisplay.textContent = data.houseWallet;
  document.getElementById("entryFeeBadge").textContent = `~${entryFeeSol.toFixed(4)} SOL`;
  document.getElementById("entryInfo").textContent = `Entry: ~${entryFeeSol.toFixed(4)} SOL ($${entryFeeUsd.toFixed(2)}) \u00b7 15% fee on cash out`;
  updateBalanceDisplay();
});
socketClient.requestWalletInfo();

socketClient.on("wallet:balance", (data) => {
  balanceSol = data.balanceSol;
  if (data.solPrice) solPrice = data.solPrice;
  updateBalanceDisplay();
});

socketClient.on("wallet:error", (data) => {
  depositStatus.textContent = data.message;
});

socketClient.on("wallet:deposit_success", (data) => {
  depositStatus.textContent = `Deposited ${data.amountSol?.toFixed(4) || "?"} SOL (~$${data.amountUsd?.toFixed(2) || "?"})!`;
  setTimeout(() => { resetDepositModal(); }, 2000);
});

socketClient.on("game:started", () => {
  startScreen.style.display = "none";
  if (hudEl) hudEl.style.display = "";
  gameStarted = true;
});

socketClient.on("cashout:success", (data) => {
  gameStarted = false;
  balanceSol = data.balanceSol;
  if (data.solPrice) solPrice = data.solPrice;
  updateBalanceDisplay();
  document.getElementById("crGross").textContent = `${data.grossCoins} coin${data.grossCoins !== 1 ? "s" : ""}`;
  document.getElementById("crFee").textContent = `-${data.feeSol.toFixed(4)} SOL`;
  document.getElementById("crNet").textContent = `${data.payoutSol.toFixed(4)} SOL (~$${data.payoutUsd.toFixed(2)})`;
  cashoutResultModal.style.display = "flex";
  cashoutOverlay.style.display = "none";
});

socketClient.on("eliminated", () => {
  gameStarted = false;
  cashoutOverlay.style.display = "none";
  qHolding = false;
  startScreen.style.display = "";
  updateJoinBtn();
});

document.getElementById("crClose").addEventListener("click", () => {
  cashoutResultModal.style.display = "none";
  startScreen.style.display = "";
});

function saveWalletAddress(addr) {
  userWalletAddress = addr.trim();
  if (isAuthenticated) {
    socketClient.setWalletAddress(userWalletAddress);
  }
  socketClient.connectWallet(userWalletAddress);
  updateJoinBtn();
}

walletInput.addEventListener("change", () => {
  const addr = walletInput.value.trim();
  if (addr.length >= 32 && addr.length <= 44) {
    saveWalletAddress(addr);
  }
});
walletInput.addEventListener("paste", () => {
  setTimeout(() => {
    const addr = walletInput.value.trim();
    if (addr.length >= 32 && addr.length <= 44) {
      saveWalletAddress(addr);
    }
  }, 50);
});

function updateJoinBtn() {
  const hasName = nameInput.value.trim().length > 0;
  const hasEnough = entryFeeSol > 0 ? balanceSol >= entryFeeSol - 0.000001 : balanceSol * solPrice >= entryFeeUsd;
  if (isAuthenticated && hasEnough && hasName) {
    joinBtn.classList.remove("btn-disabled");
  } else {
    joinBtn.classList.add("btn-disabled");
  }
}

document.getElementById("refreshBalBtn").addEventListener("click", () => {
  if (isAuthenticated) {
    socketClient.refreshBalance();
    if (userWalletAddress) {
      socketClient.checkDeposits(userWalletAddress);
    }
  }
});

function resetDepositModal() {
  depositModal.style.display = "none";
  depositStatus.textContent = "";
  pathSelect.style.display = "";
  transferView.style.display = "none";
  receiveView.style.display = "none";
}

depositBtn.addEventListener("click", () => {
  if (!isAuthenticated) {
    googleSignInBtn.click();
    return;
  }
  resetDepositModal();
  depositModal.style.display = "flex";
  pathSelect.style.display = "";
});
depositClose.addEventListener("click", resetDepositModal);

document.getElementById("pathTransfer").addEventListener("click", async () => {
  pathSelect.style.display = "none";
  transferView.style.display = "";
  receiveView.style.display = "none";
});

document.getElementById("pathReceive").addEventListener("click", () => {
  pathSelect.style.display = "none";
  transferView.style.display = "none";
  receiveView.style.display = "";
});

document.getElementById("copyHouseAddr").addEventListener("click", () => {
  if (walletInfo?.houseWallet) {
    navigator.clipboard.writeText(walletInfo.houseWallet);
    document.getElementById("copyHouseAddr").textContent = "Copied!";
    setTimeout(() => { document.getElementById("copyHouseAddr").textContent = "Copy Address"; }, 2000);
  }
});

document.querySelectorAll(".deposit-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const usd = parseFloat(btn.dataset.usd);
    if (!walletInfo) return;

    if (!walletMgr.isConnected()) {
      try {
        depositStatus.textContent = "Connecting wallet...";
        await walletMgr.connect();
      } catch (err) {
        depositStatus.textContent = `Error: ${err.message}`;
        return;
      }
    }

    const solAmount = usd / walletInfo.solPrice;
    depositStatus.textContent = `Sending ${solAmount.toFixed(4)} SOL...`;
    try {
      const sig = await walletMgr.sendSol(walletInfo.houseWallet, solAmount);
      depositStatus.textContent = "Verifying on-chain (this may take up to 30s)...";
      socketClient.verifyDeposit(sig, solAmount);
    } catch (err) {
      depositStatus.textContent = `Error: ${err.message}`;
    }
  });
});

document.getElementById("cashOutBtn")?.addEventListener("click", () => {
  if (walletBalance > 0) {
    alert(`Your balance: $${walletBalance.toFixed(2)}\nWithdrawal to wallet coming soon.`);
  }
});

joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!isAuthenticated || !name) return;
  const hasEnough = entryFeeSol > 0 ? balanceSol >= entryFeeSol - 0.000001 : balanceSol * solPrice >= entryFeeUsd;
  if (!hasEnough) return;
  socketClient.joinGame(name);
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
nameInput.addEventListener("input", updateJoinBtn);

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyQ" && !e.repeat && gameStarted) {
    qHolding = true;
    qHoldStart = Date.now();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "KeyQ") {
    qHolding = false;
  }
});

let snapshot = null;
let seq = 0;
let serverX = 0, serverY = 0, renderX = 0, renderY = 0;
let localRadius = 10, localName = "", localHasSpear = true;
let localHp = 3, localMaxHp = 3, localDead = false;
let localColor = "#7cf7b2", localKills = 0, localDeaths = 0, localCoins = 0, localLastDashAt = 0;
let worldWidth = 3000, worldHeight = 3000, currentZoom = 6, facingAngle = 0, showRangeCircle = true;
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

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyC" && !e.repeat) showRangeCircle = !showRangeCircle;
});

const killFeed = [];
const KILL_FEED_MAX = 5;
const KILL_FEED_DURATION = 4;

const boomerangTrails = {};
const otherPlayerRender = {};
const playerDashState = {};

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
  if (next.world?.width) worldWidth = next.world.width;
  if (next.world?.height) worldHeight = next.world.height;

  if (me) {
    serverX = me.x; serverY = me.y;
    localRadius = me.radius; localName = me.name;
    localHasSpear = me.hasSpear; localHp = me.hp; localMaxHp = me.maxHp;
    localDead = me.dead; localColor = me.color || "#7cf7b2";
    localKills = me.kills ?? 0; localDeaths = me.deaths ?? 0; localCoins = me.coins ?? 0;
    prevHp = me.hp;

    if (me.dashing && !prevDashing) {
      localLastDashAt = Date.now() - 80;
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

      if (!playerDashState[p.id]) playerDashState[p.id] = { prev: false, timer: 0, dirX: 0, dirY: 0, trail: [] };
      const ds = playerDashState[p.id];
      if (p.dashing && !ds.prev) {
        ds.timer = DASH_ANIM_DURATION;
        const mag = Math.hypot(p.vx, p.vy);
        if (mag > 0.1) { ds.dirX = p.vx / mag; ds.dirY = p.vy / mag; }
      }
      ds.prev = p.dashing;
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

function drawWorldBorder(cameraX, cameraY, zoom) {
  const hw = worldWidth * 0.5, hh = worldHeight * 0.5;
  const tl = worldToScreen(-hw, -hh, cameraX, cameraY, zoom);
  const br = worldToScreen(hw, hh, cameraX, cameraY, zoom);
  const w = br.x - tl.x, h = br.y - tl.y;

  ctx.save();
  ctx.strokeStyle = "rgba(255,80,80,0.3)";
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 10]);
  ctx.strokeRect(tl.x, tl.y, w, h);
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(255,80,80,0.06)";
  ctx.lineWidth = 12;
  ctx.strokeRect(tl.x, tl.y, w, h);
  ctx.restore();
}

function drawMinimap() {
  const SIZE = 150;
  const PADDING = 12;
  const mx = canvas.width - SIZE - PADDING;
  const my = canvas.height - SIZE - PADDING;

  ctx.save();

  ctx.fillStyle = "rgba(10, 15, 26, 0.75)";
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(mx, my, SIZE, SIZE, 6);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(mx, my, SIZE, SIZE, 6);
  ctx.clip();

  const scaleX = SIZE / worldWidth;
  const scaleY = SIZE / worldHeight;

  if (snapshot) {
    const localId = socketClient.getPlayerId();
    for (const coin of (snapshot.coins || [])) {
      const cx = mx + (coin.x + worldWidth * 0.5) * scaleX;
      const cy = my + (coin.y + worldHeight * 0.5) * scaleY;
      ctx.fillStyle = "#ffd700";
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    for (const p of snapshot.players) {
      if (p.dead) continue;
      const px = mx + (p.x + worldWidth * 0.5) * scaleX;
      const py = my + (p.y + worldHeight * 0.5) * scaleY;
      const isLocal = p.id === localId;
      ctx.fillStyle = isLocal ? "#ffffff" : (p.color || "#ff7a7a");
      ctx.beginPath();
      ctx.arc(px, py, isLocal ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (isLocal) {
        ctx.strokeStyle = p.color || "#7cf7b2";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

function drawCoins(cameraX, cameraY, zoom, time) {
  if (!snapshot || !snapshot.coins) return;
  for (const coin of snapshot.coins) {
    const sp = worldToScreen(coin.x, coin.y, cameraX, cameraY, zoom);
    const val = coin.value ?? 1;
    const r = 10 * zoom;
    const pulse = 1 + Math.sin(time * 4 + coin.x) * 0.08;

    ctx.save();
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 10 * zoom;

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * pulse, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(sp.x - r * 0.3, sp.y - r * 0.3, r * 0.1, sp.x, sp.y, r * pulse);
    grad.addColorStop(0, "#fff7aa");
    grad.addColorStop(0.4, "#ffd700");
    grad.addColorStop(1, "#b8860b");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "#8B6914";
    ctx.lineWidth = Math.max(1.5, 1.5 * zoom);
    ctx.stroke();

    const fontSize = Math.max(8, 9 * zoom);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = "#8B6914";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(val, sp.x, sp.y + 0.5);

    ctx.restore();
  }
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
  const eyeOffset = r * 0.28, eyeSize = r * 0.15, pupilSize = eyeSize * 0.55;
  const perpX = -Math.sin(facing), perpY = Math.cos(facing);
  const fwdX = Math.cos(facing), fwdY = Math.sin(facing);
  for (const side of [-1, 1]) {
    const ex = px + perpX * eyeOffset * side + fwdX * r * 0.6;
    const ey = py + perpY * eyeOffset * side + fwdY * r * 0.6;
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(ex, ey, eyeSize, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111"; ctx.beginPath();
    ctx.arc(ex + fwdX * eyeSize * 0.35, ey + fwdY * eyeSize * 0.35, pupilSize, 0, Math.PI * 2); ctx.fill();
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

  if (isLocal && showRangeCircle) drawRangeCircle(px, py, player.radius, zoom, color);

  ctx.fillStyle = drawColor; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = flashing ? "#cc0000" : strokeColor;
  ctx.lineWidth = Math.max(1.5, r * 0.06); ctx.stroke();

  drawEyes(px, py, r, fa);
  drawHearts(px, py, r, player.hp, player.maxHp);

  const coins = player.coins ?? 0;
  if (coins > 0) {
    const badgeR = Math.max(7, r * 0.3);
    ctx.beginPath();
    ctx.arc(px, py, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fill();
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = Math.max(1.5, badgeR * 0.12);
    ctx.stroke();

    const fontSize = Math.max(9, badgeR * 1.2);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd700";
    ctx.fillText(coins, px, py + 1);
  }

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
  const DASH_COOLDOWN_MS = 1700;
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
  drawWorldBorder(renderX, renderY, currentZoom);
  drawCoins(renderX, renderY, currentZoom, performance.now() / 1000);

  const localId = socketClient.getPlayerId();
  if (snapshot) {
    for (const player of snapshot.players) {
      if (player.id === localId) continue;
      const ds = playerDashState[player.id];
      if (ds) {
        ds.timer -= dt;
        if (ds.timer > 0 && ds.trail.length < MAX_TRAIL) {
          const rp = otherPlayerRender[player.id];
          if (rp) ds.trail.push({ x: rp.x, y: rp.y, life: 1.0 });
        }
        // Draw trail ghosts
        const pr = player.radius * currentZoom;
        for (let i = 0; i < ds.trail.length; i++) {
          const ghost = ds.trail[i]; ghost.life -= 0.04;
          if (ghost.life <= 0) { ds.trail.splice(i, 1); i--; continue; }
          const gp = worldToScreen(ghost.x, ghost.y, renderX, renderY, currentZoom);
          ctx.globalAlpha = ghost.life * 0.4; ctx.fillStyle = player.color || "#ff7a7a";
          ctx.beginPath(); ctx.arc(gp.x, gp.y, pr * ghost.life, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }

        if (ds.timer > 0) {
          const rp = otherPlayerRender[player.id];
          if (rp) {
            const sp = worldToScreen(rp.x, rp.y, renderX, renderY, currentZoom);
            const progress = 1 - (ds.timer / DASH_ANIM_DURATION);
            ctx.save(); ctx.translate(sp.x, sp.y);
            const angle = Math.atan2(ds.dirY, ds.dirX);
            ctx.rotate(angle);
            ctx.scale(1 + (1 - progress) * 0.35, 1 - (1 - progress) * 0.15);
            ctx.rotate(-angle); ctx.translate(-sp.x, -sp.y);
            drawPlayer(player, renderX, renderY, currentZoom, false, dt);
            ctx.restore();
            drawSpeedLines(sp.x, sp.y, pr, ds.dirX, ds.dirY, progress);
            continue;
          }
        }
      }
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
  } else if (localDead) {
    ctx.fillStyle = "rgba(255,60,60,0.8)"; ctx.font = "bold 26px Inter, Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ELIMINATED", p.x, p.y);
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
  drawMinimap();

  if (qHolding && gameStarted && !localDead) {
    const elapsed = Date.now() - qHoldStart;
    const progress = Math.min(1, elapsed / Q_HOLD_DURATION);
    const mePlayer = snapshot?.players?.find((pl) => pl.id === socketClient.getPlayerId());
    const totalCoins = mePlayer?.coins ?? localCoins;
    const payout = totalCoins * (1 - 0.15);

    const ringR = r + 8;
    const ringWidth = Math.max(4, r * 0.12);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = ringWidth;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = ringWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(p.x, p.y, ringR, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * progress);
    ctx.stroke();

    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ringR, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.globalAlpha = 0.85;
    const labelY = p.y + r + 28;
    ctx.font = "bold 13px Inter, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd700";
    ctx.fillText(`Cash out $${payout.toFixed(2)}`, p.x, labelY);

    ctx.globalAlpha = 1;
    ctx.restore();

    if (progress >= 1) {
      qHolding = false;
      socketClient.cashout();
    }
  }

  if (snapshot) {
    const mePlayer = snapshot.players.find((pl) => pl.id === socketClient.getPlayerId());
    const totalCoins = mePlayer?.coins ?? localCoins;
    hud.update(snapshot, {
      x: renderX, y: renderY, mass: 80, radius: localRadius, name: localName,
      kills: localKills, deaths: localDeaths, coins: localCoins, inGameBalance: totalCoins
    });
  }
}

tick();
