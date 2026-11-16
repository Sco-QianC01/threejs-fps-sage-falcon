// DUSTLINE — the HUD and menus.
// One job: every DOM element the player reads — health, ammo, timer, score,
// killfeed, buy menu, start and end screens. The sim never touches the DOM;
// main.js calls update() once per rendered frame.

import { WEAPONS, BUY_ITEMS, TEAM_NAME } from './config.js';
import { PHASE, aliveOf } from './state.js';

function el(tag, cls, parent, text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function buildHUD(callbacks) {
  const root = document.getElementById('hud');

  const crosshair = el('div', 'crosshair', root);
  for (const c of ['t', 'b', 'l', 'r']) el('div', `ch ${c}`, crosshair);
  el('div', 'ch-dot', crosshair);
  const hitmarker = el('div', 'hitmarker', root);
  for (const c of ['h1', 'h2', 'h3', 'h4']) el('div', `hm ${c}`, hitmarker);

  const topbar = el('div', 'topbar', root);
  const scoreA = el('div', 'score team-a', topbar);
  const timer = el('div', 'timer', topbar);
  const scoreB = el('div', 'score team-b', topbar);
  const roundLabel = el('div', 'round-label', topbar);

  const alive = el('div', 'alive', root);
  const aliveA = el('div', 'alive-a', alive);
  const aliveB = el('div', 'alive-b', alive);

  const msg = el('div', 'msg', root);
  const msgMain = el('div', 'msg-main', msg);
  const msgSub = el('div', 'msg-sub', msg);

  const feed = el('div', 'feed', root);

  const bomb = el('div', 'bomb', root);
  const bombLabel = el('div', 'bomb-label', bomb, 'DEVICE');
  const bombBar = el('div', 'bomb-bar', bomb);
  const bombFill = el('div', 'bomb-fill', bombBar);

  const interact = el('div', 'interact', root);
  const interactLabel = el('div', 'interact-label', interact);
  const interactBar = el('div', 'interact-bar', interact);
  const interactFill = el('div', 'interact-fill', interactBar);

  const bottomLeft = el('div', 'bottom-left', root);
  const hpNum = el('div', 'hp-num', bottomLeft, '100');
  const hpBar = el('div', 'hp-bar', bottomLeft);
  const hpFill = el('div', 'hp-fill', hpBar);
  const armorRow = el('div', 'armor-row', bottomLeft);
  el('span', '', armorRow, 'KEVLAR ');
  const armorNum = el('span', 'armor-num', armorRow, '0');

  const bottomRight = el('div', 'bottom-right', root);
  const weaponName = el('div', 'weapon-name', bottomRight, 'P9 SIDEARM');
  const ammo = el('div', 'ammo', bottomRight);
  const ammoMag = el('span', 'ammo-mag', ammo, '12');
  el('span', 'ammo-sep', ammo, ' / ');
  const ammoReserve = el('span', 'ammo-res', ammo, '48');
  const moneyRow = el('div', 'money-row', bottomRight);
  el('span', '', moneyRow, '$ ');
  const moneyNum = el('span', 'money-num', moneyRow, '800');
  const nadeRow = el('div', 'nade-row', bottomRight, 'FRAG-6 × 0  [4]');

  const vignette = el('div', 'vignette', root);
  const flash = el('div', 'flash', root);

  // --- start screen -------------------------------------------------------
  const start = el('div', 'overlay start', root);
  el('div', 'title', start, 'DUSTLINE');
  el('div', 'subtitle', start, 'ROUND-BASED TACTICAL FPS · YARD 7');
  const controls = el('div', 'controls', start);
  controls.innerHTML =
    'WASD move · Mouse aim · Click fire · Right-click aim down sights<br>' +
    'R reload · C / Ctrl crouch · Space jump · 1–3 weapons · 4 throw grenade<br>' +
    'E plant / defuse the device · B buy menu (freeze time) · Shift walk quietly';
  el('div', 'objective', start,
    'VANGUARD attacks: plant the device at site A or B, or eliminate ROOK. ' +
    'ROOK defends. First to 5 rounds takes the match.');
  const playBtn = el('button', 'big-btn', start, 'CLICK TO DEPLOY');
  playBtn.addEventListener('click', () => callbacks.onPlay());

  // --- buy menu -----------------------------------------------------------
  const buy = el('div', 'overlay buy', root);
  el('div', 'buy-title', buy, 'BUY PHASE');
  const buyTimer = el('div', 'buy-timer', buy, '');
  const buyGrid = el('div', 'buy-grid', buy);
  const buyItems = {};
  for (const item of BUY_ITEMS) {
    const card = el('div', 'buy-card', buyGrid);
    el('div', 'buy-name', card, item.name);
    el('div', 'buy-desc', card, item.desc);
    el('div', 'buy-price', card, `$${item.price}`);
    card.addEventListener('click', () => callbacks.onBuy(item.id));
    buyItems[item.id] = card;
  }
  const buyMsg = el('div', 'buy-msg', buy, '');
  const buyClose = el('button', 'big-btn small', buy, 'CLOSE [B]');
  buyClose.addEventListener('click', () => callbacks.onBuyClose());

  // --- round / match end ----------------------------------------------------
  const end = el('div', 'overlay end', root);
  const endTitle = el('div', 'end-title', end, '');
  const endSub = el('div', 'end-sub', end, '');
  const endScore = el('div', 'end-score', end, '');
  const endBtn = el('button', 'big-btn', end, 'PLAY AGAIN');
  endBtn.addEventListener('click', () => callbacks.onPlayAgain());

  return {
    root, crosshair, hitmarker, timer, scoreA, scoreB, roundLabel,
    aliveA, aliveB, msgMain, msgSub, feed, bomb, bombLabel, bombFill,
    interact, interactLabel, interactFill, hpNum, hpFill, armorNum,
    weaponName, ammoMag, ammoReserve, moneyNum, nadeRow, vignette, flash,
    start, buy, buyTimer, buyMsg, buyItems, end, endTitle, endSub, endScore,
    _msgUntil: 0, _feedItems: [],
  };
}

export function showMessage(hud, main, sub, seconds = 3) {
  hud.msgMain.textContent = main;
  hud.msgSub.textContent = sub || '';
  hud._msgUntil = performance.now() / 1000 + seconds;
}

export function addKillfeed(hud, attacker, victim, head, weapon) {
  const row = document.createElement('div');
  row.className = 'feed-row';
  const a = document.createElement('span');
  a.className = attacker.team === 0 ? 'fk-a' : 'fk-b';
  a.textContent = attacker.name;
  const w = document.createElement('span');
  w.className = 'fk-w';
  w.textContent = head ? `  ⌖ ${weapon}  ` : `  ${weapon}  `;
  const v = document.createElement('span');
  v.className = victim.team === 0 ? 'fk-a' : 'fk-b';
  v.textContent = victim.name;
  row.append(a, w, v);
  hud.feed.prepend(row);
  hud._feedItems.push(row);
  while (hud._feedItems.length > 5) hud._feedItems.shift().remove();
  setTimeout(() => row.remove(), 6000);
}

export function flashHitmarker(hud, head) {
  hud.hitmarker.classList.remove('show', 'head');
  void hud.hitmarker.offsetWidth; // restart the animation
  hud.hitmarker.classList.add('show');
  if (head) hud.hitmarker.classList.add('head');
}

export function flashDamage(hud) {
  hud.vignette.classList.remove('show');
  void hud.vignette.offsetWidth;
  hud.vignette.classList.add('show');
}

export function flashWhite(hud) {
  hud.flash.classList.remove('show');
  void hud.flash.offsetWidth;
  hud.flash.classList.add('show');
}

export function updateHUD(game, hud, now) {
  const p = game.fighters[0];
  const w = WEAPONS[p.current];
  const ammo = p.weapons[p.current];

  hud.scoreA.textContent = `${TEAM_NAME[0]} ${game.score[0]}`;
  hud.scoreB.textContent = `${game.score[1]} ${TEAM_NAME[1]}`;
  hud.roundLabel.textContent = `ROUND ${game.round} / ${Math.max(game.round, 5)}`;

  const clock = game.phase === PHASE.FREEZE ? Math.ceil(game.freezeLeft)
    : game.phase === PHASE.LIVE ? Math.ceil(game.roundTimeLeft) : 0;
  const mm = Math.floor(clock / 60);
  const ss = String(clock % 60).padStart(2, '0');
  hud.timer.textContent = `${mm}:${ss}`;
  hud.timer.classList.toggle('urgent', game.phase === PHASE.LIVE && game.roundTimeLeft < 15);
  hud.timer.classList.toggle('freeze', game.phase === PHASE.FREEZE);

  hud.aliveA.textContent = `▲ ${aliveOf(game, 0)}`;
  hud.aliveB.textContent = `▼ ${aliveOf(game, 1)}`;

  hud.hpNum.textContent = String(Math.max(0, Math.ceil(p.hp)));
  hud.hpFill.style.width = `${Math.max(0, p.hp)}%`;
  hud.hpFill.classList.toggle('low', p.hp < 30);
  hud.armorNum.textContent = String(Math.ceil(p.armor));

  hud.weaponName.textContent = w.name + (p.reloading > 0 ? ' — RELOADING' : '');
  hud.ammoMag.textContent = ammo ? String(ammo.mag) : '—';
  hud.ammoReserve.textContent = ammo ? String(ammo.reserve) : '—';
  hud.ammoMag.classList.toggle('empty', !ammo || ammo.mag === 0);
  hud.moneyNum.textContent = String(game.money);
  hud.nadeRow.textContent = `FRAG-6 × ${p.grenades}  [4]  ·  BOMB ${p.hasBomb ? 'CARRIED' : game.bomb.state === 'planted' ? 'PLANTED' : '—'}`;

  // Crosshair gap follows spread (movement + bloom + ADS).
  const gap = 5 + p.spreadBloom * 2.2 + (Math.hypot(p.vx, p.vz) > 0.6 ? 4 : 0) - (p.ads ? 3 : 0);
  hud.crosshair.style.setProperty('--gap', `${Math.max(3, gap)}px`);
  hud.crosshair.classList.toggle('hidden', game.phase === PHASE.MENU || !p.alive || !document.pointerLockElement);

  // Bomb status bar.
  const bomb = game.bomb;
  if (bomb.state === 'planted') {
    hud.bomb.style.display = 'block';
    hud.bombLabel.textContent = `DEVICE AT SITE ${bomb.plantedAt} — ${Math.ceil(bomb.fuseLeft)}s`;
    hud.bombFill.style.width = `${(bomb.fuseLeft / 35) * 100}%`;
    hud.bombFill.classList.add('danger');
  } else if (bomb.state === 'carried' && bomb.carrier === 0) {
    hud.bomb.style.display = 'block';
    hud.bombLabel.textContent = 'DEVICE CARRIED — PLANT AT A OR B [HOLD E]';
    hud.bombFill.style.width = '100%';
    hud.bombFill.classList.remove('danger');
  } else if (bomb.state === 'dropped') {
    hud.bomb.style.display = 'block';
    hud.bombLabel.textContent = 'DEVICE DROPPED — RECOVER IT';
    hud.bombFill.style.width = '100%';
    hud.bombFill.classList.remove('danger');
  } else {
    hud.bomb.style.display = 'none';
  }

  // Plant / defuse progress.
  const planting = bomb.state === 'carried' && bomb.carrier === 0 && bomb.plantProgress > 0;
  const defusing = bomb.state === 'planted' && bomb.defuser === 0;
  if (planting || bomb.plantProgress > 0) {
    hud.interact.style.display = 'block';
    hud.interactLabel.textContent = 'PLANTING DEVICE…';
    hud.interactFill.style.width = `${(bomb.plantProgress / 3) * 100}%`;
  } else if (defusing) {
    hud.interact.style.display = 'block';
    hud.interactLabel.textContent = 'DEFUSING…';
    hud.interactFill.style.width = `${(bomb.defuseProgress / 5) * 100}%`;
  } else {
    hud.interact.style.display = 'none';
  }

  // Buy menu availability.
  const buyOpen = game.phase === PHASE.FREEZE && hud._buyOpen;
  hud.buy.classList.toggle('open', buyOpen);
  if (buyOpen) {
    hud.buyTimer.textContent = `Freeze time: ${Math.ceil(game.freezeLeft)}s — money $${game.money}`;
    for (const item of BUY_ITEMS) {
      const owned = item.kind === 'weapon' && p.weapons[item.id];
      hud.buyItems[item.id].classList.toggle('owned', !!owned);
      hud.buyItems[item.id].classList.toggle('cant', game.money < item.price);
    }
  }

  // Screens.
  hud.start.classList.toggle('open', game.phase === PHASE.MENU);
  const showEnd = game.phase === PHASE.MATCH_END || (game.phase === PHASE.ROUND_END && game.roundWinner >= 0);
  hud.end.classList.toggle('open', showEnd);
  if (game.phase === PHASE.MATCH_END) {
    hud.endTitle.textContent = game.matchWinner === 0 ? 'VANGUARD WINS THE MATCH' : 'ROOK WINS THE MATCH';
    hud.endTitle.className = `end-title ${game.matchWinner === 0 ? 'win' : 'lose'}`;
    hud.endSub.textContent = `Final score ${game.score[0]} – ${game.score[1]} · Your kills ${game.playerKills} · Deaths ${game.playerDeaths}`;
    hud.endScore.textContent = '';
  } else if (game.phase === PHASE.ROUND_END) {
    hud.endTitle.textContent = game.roundWinner === 0 ? 'ROUND WON' : 'ROUND LOST';
    hud.endTitle.className = `end-title ${game.roundWinner === 0 ? 'win' : 'lose'}`;
    hud.endSub.textContent = game.roundReason;
    hud.endScore.textContent = `Score ${game.score[0]} – ${game.score[1]}`;
  }

  if (now > hud._msgUntil) {
    hud.msgMain.textContent = '';
    hud.msgSub.textContent = '';
  }
  hud.root.classList.toggle('dead', !p.alive && game.phase === PHASE.LIVE);
}
