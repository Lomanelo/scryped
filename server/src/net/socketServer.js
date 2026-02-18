import { EVENTS } from "../../../shared/protocol/messages.js";
import { createInitialPlayer } from "../game/GameLoop.js";
import {
  getPlayerBalance, creditPlayer, debitPlayer, calculateCashout,
  getEntryFeeUsd, getEntryFeeSol, getSolPrice, getHouseFee,
  verifyDeposit
} from "../wallet/walletManager.js";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

const DUMMY_ID = "dummy:target";
const HOUSE_WALLET = process.env.HOUSE_WALLET || "YOUR_SOLANA_WALLET_ADDRESS_HERE";
const RPC_URL = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL);

const socketWalletMap = new Map();

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

      socketWalletMap.set(socket.id, walletAddress);
      const bal = getPlayerBalance(walletAddress);
      socket.emit("wallet:balance", { balance: bal.balance, walletAddress });
    });

    socket.on("wallet:deposit_verify", async (data) => {
      const walletAddress = socketWalletMap.get(socket.id);
      if (!walletAddress) return socket.emit("wallet:error", { message: "Connect wallet first" });

      const { signature, amountSol } = data;
      if (!signature) return socket.emit("wallet:error", { message: "No signature" });

      const expectedLamports = Math.floor((amountSol || 0) * LAMPORTS_PER_SOL);
      const result = await verifyDeposit(connection, signature, expectedLamports, HOUSE_WALLET);

      if (result.valid) {
        const solPrice = await getSolPrice();
        const usdAmount = (result.lamports / LAMPORTS_PER_SOL) * solPrice;
        creditPlayer(walletAddress, usdAmount);
        const bal = getPlayerBalance(walletAddress);
        socket.emit("wallet:balance", { balance: bal.balance, walletAddress });
        socket.emit("wallet:deposit_success", { amount: usdAmount });
      } else {
        socket.emit("wallet:error", { message: result.reason });
      }
    });

    socket.on("wallet:join_game", (data) => {
      const walletAddress = socketWalletMap.get(socket.id);
      if (!walletAddress) return socket.emit("wallet:error", { message: "Connect wallet first" });

      const entryFee = getEntryFeeUsd();
      const bal = getPlayerBalance(walletAddress);

      if (bal.balance < entryFee) {
        return socket.emit("wallet:error", { message: `Insufficient balance. Need $${entryFee.toFixed(2)}` });
      }

      if (countHumanPlayers(state) >= config.maxPlayersPerArena) {
        socket.emit("arena:full");
        return;
      }

      debitPlayer(walletAddress, entryFee);

      const player = createInitialPlayer({ id: socket.id, isBot: false });
      const clientName = data?.name;
      if (clientName && clientName.trim().length > 0) {
        player.name = clientName.trim().slice(0, 16);
      }
      const pos = state.randomPosition(player.radius + 3);
      player.x = pos.x; player.y = pos.y;
      player.walletAddress = walletAddress;
      player.entryFee = entryFee;
      player.inGameBalance = entryFee;
      state.players.set(socket.id, player);

      ensureDummy(state, player);
      syncBots(state, config);

      const newBal = getPlayerBalance(walletAddress);
      socket.emit("wallet:balance", { balance: newBal.balance, walletAddress });

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

    socket.on("cashout", () => {
      const player = state.players.get(socket.id);
      if (!player) return;
      const walletAddress = socketWalletMap.get(socket.id);
      if (!walletAddress) return;

      const coins = player.coins ?? 0;
      const inGameBalance = player.entryFee + coins;
      const { payout, fee } = calculateCashout(inGameBalance);

      creditPlayer(walletAddress, payout);

      state.players.delete(socket.id);
      state.spears = state.spears.filter((s) => s.ownerId !== socket.id);

      const bal = getPlayerBalance(walletAddress);
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
      const player = state.players.get(socket.id);
      if (player && !player.isBot) {
        // Player loses their in-game balance on disconnect (no cashout)
      }
      state.players.delete(socket.id);
      state.spears = state.spears.filter((s) => s.ownerId !== socket.id);
      socketWalletMap.delete(socket.id);
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
