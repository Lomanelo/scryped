export function createHud() {
  const hudEl = document.getElementById("hud");
  const bannerEl = document.getElementById("banner");

  function update(snapshot, localPlayer) {
    const kills = localPlayer?.kills ?? 0;
    const deaths = localPlayer?.deaths ?? 0;
    const playerCount = (snapshot?.players ?? []).filter((p) => !p.dead).length;

    hudEl.innerHTML = [
      `<div><strong>Kills:</strong> ${kills} &nbsp; <strong>Deaths:</strong> ${deaths}</div>`,
      `<div><strong>Players:</strong> ${playerCount}</div>`,
      `<div style="margin-top:4px;font-size:11px;opacity:0.6">WASD Move · Mouse Aim · Space Throw · Shift Dash</div>`
    ].join("");
  }

  function setBanner(text) {
    if (!bannerEl) return;
    bannerEl.textContent = text;
    bannerEl.style.display = text ? "block" : "none";
  }

  return { update, setBanner };
}
