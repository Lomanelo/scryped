import { EVENTS } from "../../../shared/protocol/messages.js";

export function createSocketClient() {
  let socket = null;
  let playerId = null;
  let dummyId = null;
  let config = null;
  let onSnapshot = () => {};

  function connect(name) {
    socket = window.io({ query: { name: name || "" } });

    socket.on(EVENTS.CONNECTED, (payload) => {
      playerId = payload.playerId;
      dummyId = payload.dummyId ?? null;
      config = payload.config;
    });

    socket.on(EVENTS.SNAPSHOT, (snap) => {
      onSnapshot(snap);
    });
  }

  return {
    connect,
    getSocket: () => socket,
    getPlayerId: () => playerId,
    getDummyId: () => dummyId,
    getConfig: () => config,
    sendInput(input) { if (socket) socket.emit(EVENTS.INPUT, input); },
    sendDummyInput(input) { if (socket) socket.emit("dummy_input", input); },
    onSnapshot(listener) { onSnapshot = listener; }
  };
}
