import { EVENTS } from "../../../shared/protocol/messages.js";

export function createSocketClient() {
  let socket = null;
  let playerId = null;
  let dummyId = null;
  let config = null;
  let snapshotCb = () => {};
  let inGameBalance = 0;
  let entryFee = 0;

  const listeners = {};

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
  }

  function emit(event, data) {
    if (listeners[event]) listeners[event].forEach((cb) => cb(data));
  }

  function connect() {
    if (socket) return;
    socket = window.io();
    window.__socket = socket;

    socket.on(EVENTS.CONNECTED, (payload) => {
      playerId = payload.playerId;
      dummyId = payload.dummyId ?? null;
      config = payload.config;
      inGameBalance = payload.inGameBalance ?? 0;
      entryFee = payload.entryFee ?? 0;
      emit("game:started", payload);
    });

    socket.on(EVENTS.SNAPSHOT, (snap) => { snapshotCb(snap); });
    socket.on("wallet:info", (data) => emit("wallet:info", data));
    socket.on("wallet:balance", (data) => emit("wallet:balance", data));
    socket.on("wallet:error", (data) => emit("wallet:error", data));
    socket.on("wallet:deposit_success", (data) => emit("wallet:deposit_success", data));
    socket.on("cashout:success", (data) => emit("cashout:success", data));
    socket.on("eliminated", (data) => emit("eliminated", data));
    socket.on("arena:full", () => emit("arena:full", {}));
    socket.on("auth:config", (data) => emit("auth:config", data));
    socket.on("auth:success", (data) => emit("auth:success", data));
    socket.on("auth:error", (data) => emit("auth:error", data));
    socket.on("auth:wallet_updated", (data) => emit("auth:wallet_updated", data));
  }

  return {
    connect,
    getSocket: () => socket,
    getPlayerId: () => playerId,
    getDummyId: () => dummyId,
    getConfig: () => config,
    getInGameBalance: () => inGameBalance,
    getEntryFee: () => entryFee,
    sendInput(input) { if (socket) socket.emit(EVENTS.INPUT, input); },
    sendDummyInput(input) { if (socket) socket.emit("dummy_input", input); },
    onSnapshot(listener) { snapshotCb = listener; },
    on,

    requestAuthConfig() { if (socket) socket.emit("auth:get_config"); },
    authLogin(idToken) { if (socket) socket.emit("auth:login", { idToken }); },
    setWalletAddress(walletAddress) { if (socket) socket.emit("auth:set_wallet", { walletAddress }); },
    requestWalletInfo() { if (socket) socket.emit("wallet:get_info"); },
    connectWallet(walletAddress) { if (socket) socket.emit("wallet:connect", { walletAddress }); },
    verifyDeposit(signature, amountSol) { if (socket) socket.emit("wallet:deposit_verify", { signature, amountSol }); },
    checkDeposits(walletAddress) { if (socket) socket.emit("wallet:check_deposits", { walletAddress }); },
    refreshBalance() { if (socket) socket.emit("wallet:refresh_balance"); },
    joinGame(name) { if (socket) socket.emit("wallet:join_game", { name }); },
    cashout() { if (socket) socket.emit("cashout"); }
  };
}
