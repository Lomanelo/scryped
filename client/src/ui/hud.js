export function createHud() {
  const hudEl = document.getElementById("hud");
  const bannerEl = document.getElementById("banner");

  function update(snapshot, localPlayer) {
    const kills = localPlayer?.kills ?? 0;
    const deaths = localPlayer?.deaths ?? 0;
    const coins = localPlayer?.coins ?? 0;
    const inGameBal = localPlayer?.inGameBalance ?? 0;
    const playerCount = (snapshot?.players ?? []).filter((p) => !p.dead).length;

    hudEl.innerHTML = [
      `<div style="font-size:22px;font-weight:900;color:#ffd700;margin-bottom:4px">$${inGameBal.toFixed(2)}</div>`,
      `<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:8px">In-Game Balance (${coins} coins)</div>`,
      `<div><strong>Kills:</strong> ${kills} &nbsp; <strong>Deaths:</strong> ${deaths}</div>`,
      `<div><strong>Players:</strong> ${playerCount}</div>`,
      `<div style="margin-top:8px;font-size:11px;opacity:0.4">Hold <strong>Q</strong> for 3s to cash out</div>`
    ].join("");
  }

  function setBanner(text) {
    if (!bannerEl) return;
    bannerEl.textContent = text;
    bannerEl.style.display = text ? "block" : "none";
  }

  return { update, setBanner };
}
