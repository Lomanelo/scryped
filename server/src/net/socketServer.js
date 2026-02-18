import { EVENTS } from "../../../shared/protocol/messages.js";
import { createInitialPlayer } from "../game/GameLoop.js";
import {
  getPlayerBalance, creditPlayer, debitPlayer, creditPayout, calculateCashout,
  getEntryFeeUsd, getEntryFeeSol, getSolPrice, getHouseFee,
  verifyDeposit, scanDepositsFrom
} from "../wallet/walletManager.js";
import {
  isFirebaseEnabled, verifyToken, getOrCreateUser,
  setUserWallet, getUserBalance
} from "../auth/firebaseAdmin.js";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

const DUMMY_ID = "dummy:target";
const HOUSE_WALLET = (process.env.HOUSE_WALLET || "YOUR_SOLANA_WALLET_ADDRESS_HERE").trim();
const RPC_URL = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "";
const FIREBASE_AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN || "";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
const connection = new Connection(RPC_URL);

const socketUserMap = new Map();

function getSocketUser(socketId) {
  return socketUserMap.get(socketId) || null;
}

function countHumanPlayers(state) {
  let count = 0;
  for (const player of state.players.values()) {
    if (!player.isBot && player.id !== DUMMY_ID) count += 1;
  }
  return count;
}

function ensureDummy(state, nearPlayer) {
  if (state.players.has(DUMMY_ID)) return;
  const dummy = createInitialPlayer({ id: DUMMY_ID, isBot: true });
  dummy.name = "Dummy";
  dummy.isDummy = true;
  dummy.x = (nearPlayer?.x ?? 0) + 60;
  dummy.y = nearPlayer?.y ?? 0;
  state.players.set(DUMMY_ID, dummy);
}

function removeDummy(state) {
  state.players.delete(DUMMY_ID);
  state.spears = state.spears.filter((s) => s.ownerId !== DUMMY_ID);
}

function syncBots(state, config) {
  if (!config.aiEnabled) return;
  const humanCount = countHumanPlayers(state);
  const targetBots = Math.max(0, config.aiFillPlayers - humanCount);
  const currentBots = Array.from(state.players.values()).filter((p) => p.isBot && p.id !== DUMMY_ID);

  while (currentBots.length < targetBots) {
    const bot = createInitialPlayer({ id: `bot:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, isBot: true });
    const pos = state.randomPosition(bot.radius + 5);
    bot.x = pos.x; bot.y = pos.y;
    bot.entryFee = getEntryFeeUsd();
    state.players.set(bot.id, bot);
    currentBots.push(bot);
  }

  while (currentBots.length > targetBots) {
    const removed = currentBots.pop();
    state.players.delete(removed.id);
    state.spears = state.spears.filter((s) => s.ownerId !== removed.id);
  }
}

function isRateLimited(player, now, config) {
  if (!player.inputWindowStart || now - player.inputWindowStart > 1000) {
    player.inputWindowStart = now;
    player.inputCount = 0;
  }
  player.inputCount += 1;
  return player.inputCount > config.maxInputRatePerSecond;
}

export function attachSocketServer(io, gameLoop, state, config) {
  io.on("connection", (socket) => {

    socket.on("auth:get_config", () => {
      socket.emit("auth:config", {
        apiKey: FIREBASE_API_KEY,
        authDomain: FIREBASE_AUTH_DOMAIN,
        projectId: FIREBASE_PROJECT_ID,
        enabled: isFirebaseEnabled() && !!FIREBASE_API_KEY
      });
    });

    socket.on("auth:login", async (data) => {
      const { idToken } = data || {};
      if (!idToken) return socket.emit("auth:error", { message: "No token provided" });

      if (!isFirebaseEnabled()) {
        return socket.emit("auth:error", { message: "Authentication not configured on server" });
      }

      try {
        const decoded = await verifyToken(idToken);
        const uid = decoded.uid;
        const user = await getOrCreateUser(uid, {
          email: decoded.email || "",
          displayName: decoded.name || decoded.email?.split("@")[0] || ""
        });

        socketUserMap.set(socket.id, {
          uid,
          email: user.email,
          displayName: user.displayName,
          walletAddress: user.walletAddress || ""
        });

        const bal = await getUserBalance(uid);
        socket.emit("auth:success", {
          uid,
          email: user.email,
          displayName: user.displayName,
          walletAddress: user.walletAddress || "",
          balance: bal.balance
        });
      } catch (err) {
        console.error("[auth] Login failed:", err.message);
        socket.emit("auth:error", { message: "Authentication failed: " + err.message });
      }
    });

    socket.on("auth:set_wallet", async (data) => {
      const user = getSocketUser(socket.id);
      if (!user) return socket.emit("auth:error", { message: "Not authenticated" });

      const walletAddress = (data?.walletAddress || "").trim();
      if (walletAddress.length < 32 || walletAddress.length > 44) {
        return socket.emit("auth:error", { message: "Invalid wallet address" });
      }

      user.walletAddress = walletAddress;
      socketUserMap.set(socket.id, user);

      if (isFirebaseEnabled()) {
        await setUserWallet(user.uid, walletAddress);
      }

      socket.emit("auth:wallet_updated", { walletAddress });
    });

    socket.on("wallet:get_info", async () => {
      const solPrice = await getSolPrice();
      const entryFeeSol = await getEntryFeeSol();
      socket.emit("wallet:info", {
        houseWallet: HOUSE_WALLET,
        entryFeeUsd: getEntryFeeUsd(),
        entryFeeSol,
        solPrice,
        houseFeePercent: getHouseFee() * 100,
        rpcUrl: RPC_URL
      });
    });

    socket.on("wallet:connect", async (data) => {
      const walletAddress = data?.walletAddress;
      if (!walletAddress) return socket.emit("wallet:error", { message: "No wallet address" });

      const user = getSocketUser(socket.id);
      const uid = user?.uid || walletAddress;

      const bal = await getPlayerBalance(uid);
      socket.emit("wallet:balance", { balance: bal.balance, walletAddress });
    });

    socket.on("wallet:deposit_verify", async (data) => {
      const user = getSocketUser(socket.id);
      const uid = user?.uid;
      if (!uid) return socket.emit("wallet:error", { message: "Sign in first" });

      const { signature, amountSol } = data;
      if (!signature) return socket.emit("wallet:error", { message: "No signature" });

      const expectedLamports = Math.floor((amountSol || 0) * LAMPORTS_PER_SOL);
      const result = await verifyDeposit(connection, signature, expectedLamports, HOUSE_WALLET);

      if (result.valid) {
        const solPrice = await getSolPrice();
        const usdAmount = (result.lamports / LAMPORTS_PER_SOL) * solPrice;
        await creditPlayer(uid, usdAmount);
        const bal = await getPlayerBalance(uid);
        socket.emit("wallet:balance", { balance: bal.balance, walletAddress: user.walletAddress });
        socket.emit("wallet:deposit_success", { amount: usdAmount });
      } else {
        socket.emit("wallet:error", { message: result.reason });
      }
    });

    socket.on("wallet:check_deposits", async (data) => {
      const user = getSocketUser(socket.id);
      const uid = user?.uid;
      const walletAddress = data?.walletAddress || user?.walletAddress;
      if (!walletAddress || !uid) return;

      const deposits = await scanDepositsFrom(connection, walletAddress, HOUSE_WALLET);
      if (deposits.length > 0) {
        const solPrice = await getSolPrice();
        let totalUsd = 0;
        for (const dep of deposits) {
          const usd = (dep.lamports / LAMPORTS_PER_SOL) * solPrice;
          await creditPlayer(uid, usd);
          totalUsd += usd;
        }
        const bal = await getPlayerBalance(uid);
        socket.emit("wallet:balance", { balance: bal.balance, walletAddress });
        if (totalUsd > 0) {
          socket.emit("wallet:deposit_success", { amount: totalUsd });
        }
      } else {
        const bal = await getPlayerBalance(uid);
        socket.emit("wallet:balance", { balance: bal.balance, walletAddress });
      }
    });

    socket.on("wallet:join_game", async (data) => {
      const user = getSocketUser(socket.id);
      const uid = user?.uid;
      if (!uid) return socket.emit("wallet:error", { message: "Sign in first" });

      const entryFee = getEntryFeeUsd();
      const bal = await getPlayerBalance(uid);

      if (bal.balance < entryFee) {
        return socket.emit("wallet:error", { message: `Insufficient balance. Need $${entryFee.toFixed(2)}` });
      }

      if (countHumanPlayers(state) >= config.maxPlayersPerArena) {
        socket.emit("arena:full");
        return;
      }

      const debited = await debitPlayer(uid, entryFee);
      if (!debited) {
        return socket.emit("wallet:error", { message: "Failed to debit entry fee" });
      }

      const player = createInitialPlayer({ id: socket.id, isBot: false });
      const clientName = data?.name;
      if (clientName && clientName.trim().length > 0) {
        player.name = clientName.trim().slice(0, 16);
      } else if (user.displayName) {
        player.name = user.displayName.slice(0, 16);
      }
      const pos = state.randomPosition(player.radius + 3);
      player.x = pos.x; player.y = pos.y;
      player.uid = uid;
      player.walletAddress = user.walletAddress;
      player.entryFee = entryFee;
      player.inGameBalance = entryFee;
      state.players.set(socket.id, player);

      ensureDummy(state, player);
      syncBots(state, config);

      const newBal = await getPlayerBalance(uid);
      socket.emit("wallet:balance", { balance: newBal.balance, walletAddress: user.walletAddress });

      socket.emit(EVENTS.CONNECTED, {
        playerId: socket.id,
        dummyId: DUMMY_ID,
        config: {
          mode: "arena",
          tickRate: config.tickRate,
          world: { width: config.worldWidth, height: config.worldHeight }
        },
        inGameBalance: player.inGameBalance,
        entryFee
      });
      io.emit(EVENTS.PLAYER_JOINED, { playerId: socket.id });
    });

    socket.on(EVENTS.INPUT, (payload) => {
      const player = state.players.get(socket.id);
      if (!player) return;
      const now = Date.now();
      if (isRateLimited(player, now, config)) return;
      gameLoop.ingestInput(player, payload ?? {});
    });

    socket.on("dummy_input", (payload) => {
      const dummy = state.players.get(DUMMY_ID);
      if (!dummy) return;
      gameLoop.ingestInput(dummy, payload ?? {});
    });

    socket.on("cashout", async () => {
      const player = state.players.get(socket.id);
      if (!player) return;
      const user = getSocketUser(socket.id);
      const uid = user?.uid;
      if (!uid) return;

      const coins = player.coins ?? 0;
      const inGameBalance = player.entryFee + coins;
      const { payout, fee } = calculateCashout(inGameBalance);

      await creditPayout(uid, payout);

      state.players.delete(socket.id);
      state.spears = state.spears.filter((s) => s.ownerId !== socket.id);

      const bal = await getPlayerBalance(uid);
      socket.emit("cashout:success", {
        grossAmount: inGameBalance,
        fee,
        netPayout: payout,
        walletBalance: bal.balance
      });

      if (countHumanPlayers(state) === 0) {
        removeDummy(state);
        for (const p of state.players.values()) {
          if (p.isBot) state.players.delete(p.id);
        }
        state.spears = [];
        state.coins = [];
      }
      syncBots(state, config);
      io.emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
    });

    socket.on("disconnect", () => {
      state.players.delete(socket.id);
      state.spears = state.spears.filter((s) => s.ownerId !== socket.id);
      socketUserMap.delete(socket.id);
      if (countHumanPlayers(state) === 0) {
        removeDummy(state);
        for (const p of state.players.values()) {
          if (p.isBot) state.players.delete(p.id);
        }
        state.spears = [];
        state.coins = [];
      }
      syncBots(state, config);
      io.emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
    });
  });
}
