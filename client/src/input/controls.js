function normalize(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < 0.0001) return { x: 0, y: 0 };
  return { x: x / mag, y: y / mag };
}

export function createControls(canvas) {
  const keys = new Set();
  const pointer = { x: 0, y: 0 };
  const center = { x: 0, y: 0 };
  let shootPressed = false;
  let dashPressed = false;

  function onKeyDown(event) {
    if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
    if (event.code === "Space" && !event.repeat) shootPressed = true;
    if (event.code === "ShiftLeft" && !event.repeat) dashPressed = true;
    keys.add(event.code);
  }

  function onKeyUp(event) {
    if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
    keys.delete(event.code);
  }

  function onMouseMove(event) {
    const rect = canvas.getBoundingClientRect();
    center.x = rect.left + rect.width * 0.5;
    center.y = rect.top + rect.height * 0.5;
    pointer.x = event.clientX - center.x;
    pointer.y = event.clientY - center.y;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);

  return {
    readInput() {
      const keyX = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
      const keyY = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
      const move = normalize(keyX, keyY);
      const aimAngle = Math.atan2(pointer.y, pointer.x);
      const shoot = shootPressed;
      const dash = dashPressed;
      shootPressed = false;
      dashPressed = false;
      return { moveX: move.x, moveY: move.y, aimAngle, shoot, dash };
    },

    readDummyInput() {
      const dx = Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
      const dy = Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
      const move = normalize(dx, dy);
      return { moveX: move.x, moveY: move.y, shoot: false, facingAngle: Math.atan2(move.y, move.x) };
    }
  };
}
