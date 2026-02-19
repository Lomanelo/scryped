import { EVENTS } from "../../../shared/protocol/messages.js";
import { createInitialPlayer } from "../game/GameLoop.js";
import {
  getPlayerBalance, creditPlayerSol, debitPlayerSol, creditPayoutSol, calculateCashout,
  getEntryFeeUsd, getEntryFeeSol, getSolPrice, getHouseFee,
  verifyDeposit, scanDepositsFrom, sendSolFromHouse
} from "../wallet/walletManager.js";
import {
  isFirebaseEnabled, verifyToken, getOrCreateUser,
  setUserWallet, getUserBalance, recordHouseFee, setUserBalance,
  recordWithdrawal
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

        const bal = await getPlayerBalance(uid);
        const solPrice = await getSolPrice();
        socket.emit("auth:success", {
          uid,
          email: user.email,
          displayName: user.displayName,
          walletAddress: user.walletAddress || "",
          balanceSol: bal.balanceSol,
          solPrice
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

    socket.on("wallet:refresh_balance", async () => {
      const user = getSocketUser(socket.id);
      if (!user?.uid) return;
      const bal = await getPlayerBalance(user.uid);
      const solPrice = await getSolPrice();
      socket.emit("wallet:balance", { balanceSol: bal.balanceSol, solPrice, walletAddress: user.walletAddress });
    });

    socket.on("admin:reset_balance", async (data) => {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret || data?.secret !== adminSecret) return;
      const user = getSocketUser(socket.id);
      if (!user?.uid) return;
      const amount = parseFloat(data?.amount ?? 0);
      if (isNaN(amount) || amount < 0) return;
      await setUserBalance(user.uid, amount);
      const bal = await getPlayerBalance(user.uid);
      const solPrice = await getSolPrice();
      socket.emit("wallet:balance", { balanceSol: bal.balanceSol, solPrice, walletAddress: user.walletAddress });
      console.log(`[admin] Reset balance for ${user.uid} to ${amount} SOL`);
    });

    socket.on("wallet:connect", async (data) => {
      const walletAddress = data?.walletAddress;
      if (!walletAddress) return socket.emit("wallet:error", { message: "No wallet address" });

      const user = getSocketUser(socket.id);
      const uid = user?.uid || walletAddress;

      const bal = await getPlayerBalance(uid);
      const solPrice = await getSolPrice();
      socket.emit("wallet:balance", { balanceSol: bal.balanceSol, solPrice, walletAddress });
    });

    socket.on("wallet:deposit_verify", async (data) => {
      const user = getSocketUser(socket.id);
      const uid = user?.uid;
      if (!uid) return socket.emit("wallet:error", { message: "Sign in first" });

      const { signature, amountSol } = data;
      if (!signature) return socket.emit("wallet:error", { message: "No signature" });

      const expectedLamports = Math.floor((amountSol || 0) * LAMPORTS_PER_SOL);
      const result = await verifyDeposit(connection, signature, expectedLamports, HOUSE_WALLET, uid);

      if (result.valid) {
        const depositedSol = result.lamports / LAMPORTS_PER_SOL;
        await creditPlayerSol(uid, depositedSol);
        const bal = await getPlayerBalance(uid);
        const solPrice = await getSolPrice();
        socket.emit("wallet:balance", { balanceSol: bal.balanceSol, solPrice, walletAddress: user.walletAddress });
        socket.emit("wallet:deposit_success", { amountSol: depositedSol, amountUsd: depositedSol * solPrice });
      } else {
        socket.emit("wallet:error", { message: result.reason });
      }
    });

    socket.on("wallet:check_deposits", async (data) => {
      const user = getSocketUser(socket.id);
      const uid = user?.uid;
      if (!uid) return;
      const bal = await getPlayerBalance(uid);
      const solPrice = await getSolPrice();
      socket.emit("wallet:balance", { balanceSol: bal.balanceSol, solPrice, walletAddress: user.walletAddress });
    });

    socket.on("wallet:withdraw", async (data) => {
      try {
        const user = getSocketUser(socket.id);
        const uid = user?.uid;
        if (!uid) return socket.emit("withdraw:error", { message: "Sign in first" });

        const walletAddress = (data?.walletAddress || "").trim();
        if (walletAddress.length < 32 || walletAddress.length > 44) {
          return socket.emit("withdraw:error", { message: "Invalid Solana address" });
        }

        const bal = await getPlayerBalance(uid);
        if (bal.balanceSol <= 0) {
          return socket.emit("withdraw:error", { message: "Nothing to withdraw" });
        }

        const amountSol = bal.balanceSol;
        const debited = await debitPlayerSol(uid, amountSol);
        if (!debited) {
          return socket.emit("withdraw:error", { message: "Failed to debit balance" });
        }

        let txSignature = null;
        try {
          txSignature = await sendSolFromHouse(connection, walletAddress, amountSol);
        } catch (sendErr) {
          console.error("[withdraw] On-chain transfer failed:", sendErr.message);
          await creditPlayerSol(uid, amountSol);
          return socket.emit("withdraw:error", {
            message: "Transfer failed — balance restored. " + sendErr.message
          });
        }

        const withdrawId = await recordWithdrawal(uid, amountSol, walletAddress, txSignature);
        console.log(`[withdraw] ${uid} sent ${amountSol.toFixed(6)} SOL to ${walletAddress} — tx: ${txSignature} (id: ${withdrawId})`);

        const newBal = await getPlayerBalance(uid);
        const solPrice = await getSolPrice();
        socket.emit("withdraw:success", {
          amountSol,
          walletAddress,
          withdrawId,
          txSignature,
          balanceSol: newBal.balanceSol,
          solPrice
        });
      } catch (err) {
        console.error("[withdraw] Error:", err.message);
        socket.emit("withdraw:error", { message: "Withdrawal failed. Try again." });
      }
    });

    socket.on("wallet:join_game", async (data) => {
      try {
        const user = getSocketUser(socket.id);
        const uid = user?.uid;
        if (!uid) return socket.emit("wallet:error", { message: "Sign in first" });

        const entryFeeSol = await getEntryFeeSol();
        const solPrice = await getSolPrice();
        const bal = await getPlayerBalance(uid);

        if (bal.balanceSol < entryFeeSol - 0.000001) {
          return socket.emit("wallet:error", { message: `Insufficient balance. Need ~${entryFeeSol.toFixed(4)} SOL ($${(entryFeeSol * solPrice).toFixed(2)})` });
        }

        if (countHumanPlayers(state) >= config.maxPlayersPerArena) {
          socket.emit("arena:full");
          return;
        }

        const debited = await debitPlayerSol(uid, entryFeeSol);
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
        player.entryFeeSol = entryFeeSol;
        player.entryFee = 1;
        state.players.set(socket.id, player);

        const newBal = await getPlayerBalance(uid);
        socket.emit("wallet:balance", { balanceSol: newBal.balanceSol, solPrice, walletAddress: user.walletAddress });

        socket.emit(EVENTS.CONNECTED, {
          playerId: socket.id,
          dummyId: DUMMY_ID,
          config: {
            mode: "arena",
            tickRate: config.tickRate,
            world: { width: config.worldWidth, height: config.worldHeight }
          },
          inGameBalance: player.inGameBalance,
          entryFee: player.entryFee
        });
        io.emit(EVENTS.PLAYER_JOINED, { playerId: socket.id });
      } catch (err) {
        console.error("[join_game] Error:", err.message);
        socket.emit("wallet:error", { message: "Failed to join game. Try again." });
      }
    });

    socket.on(EVENTS.INPUT, (payload) => {
      const player = state.players.get(socket.id);
      if (!player) return;
      const now = Date.now();
      if (isRateLimited(player, now, config)) return;
      gameLoop.ingestInput(player, payload ?? {});
    });

    socket.on("cashout", async () => {
      const player = state.players.get(socket.id);
      if (!player) return;
      const user = getSocketUser(socket.id);
      const uid = user?.uid;
      if (!uid) return;

      const coins = player.coins ?? 1;
      const entryFeeSol = player.entryFeeSol || 0;
      const grossSol = entryFeeSol * coins;
      const profitSol = Math.max(0, grossSol - entryFeeSol);
      const feeSol = profitSol * getHouseFee();
      const payoutSol = grossSol - feeSol;

      await creditPayoutSol(uid, payoutSol);
      await recordHouseFee(feeSol, uid);

      state.players.delete(socket.id);
      state.spears = state.spears.filter((s) => s.ownerId !== socket.id);

      const bal = await getPlayerBalance(uid);
      const solPrice = await getSolPrice();
      socket.emit("cashout:success", {
        grossCoins: coins,
        payoutSol,
        feeSol,
        payoutUsd: payoutSol * solPrice,
        balanceSol: bal.balanceSol,
        solPrice
      });

      io.emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
    });

    socket.on("disconnect", () => {
      state.players.delete(socket.id);
      state.spears = state.spears.filter((s) => s.ownerId !== socket.id);
      socketUserMap.delete(socket.id);
      io.emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
    });
  });
}
