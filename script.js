const STATE_KEY = "ruletaData";

let CONFIG = {};
let attempts = 0;
let userName = "";
let wins = [];
let spinning = false;
let usedAttempts = 0;
let lockUntil = null;
let adsClaimed = [];
let adsWindowStart = null;
let adsWatchedTotal = 0;
let prizeImages = [];
let cooldownInterval = null;
let adsWindowInterval = null;
let robuxWithdrawn = 0;
let claimedCharacters = [];
let onlineUsersTimeout = null;
let firstSpinHintShown = false;
let firstSpinHintTimeout = null;
let musicEnabled = true;

// Wheel vars
let currentRot = 0;
let renderLoopId = null;
let lastPointedPrize = -1;

const SLICE_COLORS = [
  "#2a0e45", // Dark Purple
  "#000000", // Black
  "#b026ff", // Neon Purple
  "#111111"  // Dark Gray
];

// DOM Elements matching new Slot Machine Layout
const $wheel = document.getElementById("wheel");
const ctx = $wheel.getContext("2d");
const $spinBtn = document.getElementById("spinBtn");
const $attemptsDisplay = document.getElementById("attemptsDisplay"); // Badge
const $jackpotTicker = document.getElementById("jackpot-ticker");
const $rngDisplay = document.getElementById("rng-display");
const $ads = document.getElementById("ads-buttons");
const $wins = document.getElementById("wins");
const $userName = document.getElementById("userName");
const $saveUser = document.getElementById("saveUser");
const $adMessage = document.getElementById("adMessage");
const $cooldownTimer = document.getElementById("cooldownTimer");
const $prizePreview = document.getElementById("prizePreview");
const $prizePreviewLabel = document.getElementById("prizePreviewLabel");
const $robuxProgressBar = document.getElementById("robuxProgressBar");
const $robuxProgressLabel = document.getElementById("robuxProgressLabel");
const $characterProgressBar = document.getElementById("characterProgressBar");
const $characterProgressLabel = document.getElementById("characterProgressLabel");
const $charactersList = document.getElementById("charactersList");
const $withdrawRobuxBtn = document.getElementById("withdrawRobuxBtn");
const $adPointsTotal = document.getElementById("adPointsTotal");
const $attemptsBanner = document.getElementById("attemptsBanner");
const $attemptsBannerTimer = document.getElementById("attemptsBannerTimer");
const $onlineUsersCount = document.getElementById("onlineUsersCount");
const $firstSpinHint = document.getElementById("firstSpinHint");
const $bgMusic = document.getElementById("bgMusic");
const $musicToggle = document.getElementById("musicToggle");

if ($withdrawRobuxBtn) {
  $withdrawRobuxBtn.onclick = handleWithdrawRobux;
}

// --- INIT ---
fetch("config.json")
  .then(res => res.json())
  .then(async cfg => {
    CONFIG = cfg;
    await init();
  })
  .catch(err => {
    console.error("No se pudo cargar la configuración", err);
    if ($adMessage) $adMessage.textContent = "Error de configuración.";
  });

async function init() {
  loadState();
  initOnlineUsersBadge();
  initMusicControl();
  startJackpotTicker();
  $userName.value = userName;

  if (isCooldownActive()) {
    startCooldownCountdown();
  }
  await preloadPrizeImages();
  startRenderLoop();
  startAdsWindowWatcher();
  refreshUI();
  if (!hasSavedUser()) {
    showUserReminder(true);
  }
}

// --- STATE MANAGEMENT ---
function loadState() {
  const stored = JSON.parse(localStorage.getItem(STATE_KEY)) || {};
  attempts = Number.isFinite(stored.attempts) ? stored.attempts : CONFIG.attempts.free;
  userName = stored.user ?? "";
  wins = normalizeWins(stored.wins);
  usedAttempts = Number.isFinite(stored.usedAttempts) ? stored.usedAttempts : 0;
  lockUntil = typeof stored.lockUntil === "number" ? stored.lockUntil : null;
  adsClaimed = normalizeAdsState(stored.adsClaimed);
  adsWindowStart = typeof stored.adsWindowStart === "number" ? stored.adsWindowStart : null;
  adsWatchedTotal = Number.isFinite(stored.adsWatchedTotal) ? stored.adsWatchedTotal : 0;
  robuxWithdrawn = Number.isFinite(stored.robuxWithdrawn) ? stored.robuxWithdrawn : 0;
  claimedCharacters = Array.isArray(stored.claimedCharacters) ? stored.claimedCharacters : [];
  firstSpinHintShown = Boolean(stored.firstSpinHintShown);
  musicEnabled = typeof stored.musicEnabled === "boolean" ? stored.musicEnabled : true;
  maybeResetAdsWindow();
  cleanupClaimedCharacters();
  enforceAttemptCaps();
}

function normalizeAdsState(raw = []) {
  return Array.from({ length: CONFIG.ads ? CONFIG.ads.length : 0 }, (_, idx) => Boolean(raw?.[idx]));
}

function normalizeWins(raw = []) {
  return Array.isArray(raw) ? raw : [];
}

function saveState() {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({
      attempts,
      user: userName,
      wins,
      usedAttempts,
      lockUntil,
      adsClaimed,
      adsWindowStart,
      adsWatchedTotal,
      robuxWithdrawn,
      claimedCharacters,
      firstSpinHintShown,
      musicEnabled
    })
  );
}

// --- ADS & ATTEMPTS LOGIC ---
function getAdsWindowMs() {
  const minutes = CONFIG.adsBonus?.windowMinutes ?? 60;
  return minutes * 60 * 1000;
}

function maybeResetAdsWindow(force = false) {
  const now = Date.now();
  const windowMs = getAdsWindowMs();
  if (force || !adsWindowStart || now - adsWindowStart >= windowMs) {
    adsWindowStart = now;
    adsClaimed = normalizeAdsState([]);
    if (!force) {
      restoreAttemptsAfterAdsReset();
    }
    return true;
  }
  return false;
}

function restoreAttemptsAfterAdsReset() {
  if (isCooldownActive()) return;
  usedAttempts = 0;
  syncAttemptsWithCap();
}

function getAdsWindowRemainingMs() {
  if (!adsWindowStart) return 0;
  const end = adsWindowStart + getAdsWindowMs();
  return Math.max(0, end - Date.now());
}

function getPerWindowLimit() {
  return CONFIG.adsBonus?.limitPerHour ?? (CONFIG.ads ? CONFIG.ads.length : 0);
}

function getAdsClaimedCount() {
  return adsClaimed.filter(Boolean).length;
}

function getCurrentAttemptCap() {
  const base = Math.max(0, CONFIG.attempts.max || 0);
  const perAdBonus = Math.max(0, CONFIG.attempts?.perAd || 0);
  const claimedCount = Math.min(getAdsClaimedCount(), getPerWindowLimit());
  const bonus = claimedCount * perAdBonus;
  return base + bonus;
}

function syncAttemptsWithCap() {
  const cap = getCurrentAttemptCap();
  const available = Math.max(0, cap - usedAttempts);
  if (available === 0 && usedAttempts === 0) {
    const seed = cap > 0 ? Math.min(CONFIG.attempts.free, cap) : CONFIG.attempts.free;
    attempts = Math.max(0, seed);
    return cap;
  }
  attempts = available;
  return cap;
}

function enforceAttemptCaps() {
  const now = Date.now();
  if (lockUntil && now >= lockUntil) {
    resetAttempts();
    return;
  }
  if (isCooldownActive()) {
    attempts = 0;
    return;
  }
  syncAttemptsWithCap();
}

function resetAttempts() {
  lockUntil = null;
  usedAttempts = 0;
  maybeResetAdsWindow(true);
  syncAttemptsWithCap();
  saveState();
}

// --- HELPER FUNCTIONS ---
function hasSavedUser() {
  return Boolean(userName && userName.trim().length);
}

function updateAdPointsTotal() {
  if ($adPointsTotal) {
    $adPointsTotal.textContent = formatNumber(adsWatchedTotal);
  }
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

function formatDuration(ms) {
  const s = Math.max(0, Math.ceil((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// --- UI UPDATES ---
$saveUser.onclick = () => {
  const value = $userName.value.trim();
  if (!value) {
    showAlert({ icon: "warning", text: "Ingresa tu usuario de Roblox." });
    $userName.focus();
    return;
  }
  userName = value;
  saveState();
  refreshUI();
};

$spinBtn.onclick = () => spin();

function refreshUI() {
  const reset = maybeResetAdsWindow();
  if (reset) saveState();

  // Update Badge
  if ($attemptsDisplay) {
    $attemptsDisplay.textContent = `INTENTOS: ${Math.max(0, attempts)}`;
  }

  // Button State
  $spinBtn.disabled = spinning || attempts <= 0 || isCooldownActive();

  // Wins List (DISABLED - element removed)

  // $wins.innerHTML = "";
  // wins.forEach(win => {
  // const li = document.createElement("li");
  // const summary = win.type === "robux"
  // ? `<span class="text-gold fw-bold">${formatNumber(win.value)} R$</span>`
  // : `<span class="text-purple fw-bold">${win.label}</span>`;
  // 
  // // Check Status
  // const isClaimed = win.type === "character" && isCharacterClaimed(win.id);
  // const statusIcon = isClaimed ? "✅" : (win.type === "character" ? "⏳" : "💰");
  // 
  // li.innerHTML = `
  // <div class="d-flex w-100 justify-content-between">
  // <span>${summary}</span>
  // <span class="small">${statusIcon}</span>
  // </div>
  // `;
  // $wins.appendChild(li);
  // });

  updateAdMessage();
  updateCooldownUI();
  renderAds();
  updatePointedPrizePreview(null, true);
  updateAdPointsTotal();
  updateWalletPanels();
}

function renderAds() {
  if (!$ads || !CONFIG.ads) return;
  $ads.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const resetIn = getAdsWindowRemainingMs();
  const perWindowLimit = getPerWindowLimit();
  const claimedCount = getAdsClaimedCount();
  const limitReached = claimedCount >= perWindowLimit;

  CONFIG.ads.forEach((ad, idx) => {
    const btn = document.createElement("button");
    const claimed = adsClaimed[idx];
    btn.className = "btn btn-sm btn-gold-outline w-100 text-start overflow-hidden text-truncate";

    // Style check
    if (claimed) {
      btn.textContent = `✅ ${ad.label} (Espere ${formatDuration(resetIn)})`;
      btn.style.opacity = "0.5";
    } else if (limitReached) {
      btn.textContent = `🔒 ${ad.label} (Límite)`;
    } else {
      btn.textContent = `▶ ${ad.label} (+${CONFIG.attempts.perAd} tiro)`;
    }

    btn.disabled = claimed || limitReached || isCooldownActive() || !hasSavedUser();
    btn.onclick = () => handleAdClick(idx, ad.url);
    fragment.appendChild(btn);
  });
  $ads.appendChild(fragment);
}

function updateAdMessage() {
  // Logic to show scrolling text or status
  if (!hasSavedUser()) {
    $adMessage.textContent = "⚠ REGISTRA TU USUARIO PARA GUARDAR PROGRESO.";
    return;
  }
  if (isCooldownActive()) {
    $adMessage.textContent = "ESPERANDO RECARGA DE TIEMPO...";
    return;
  }
  const minutes = CONFIG.adsBonus?.windowMinutes ?? 60;
  $adMessage.textContent = `PUBLICIDAD: +1 INTENTO CADA UNA. REINICIO CADA ${minutes} MIN. PUNTOS ACTUALES: ${adsWatchedTotal}`;
}

// --- SPIN LOGIC ---
function spin() {
  if (!hasSavedUser()) {
    showUserReminder(true);
    return;
  }
  if (spinning || attempts <= 0 || isCooldownActive()) return;

  spinning = true;
  attempts = Math.max(0, attempts - 1);
  usedAttempts = Math.min(getCurrentAttemptCap(), usedAttempts + 1);
  refreshUI();
  saveState();

  const idx = pickPrizeIndex();
  const n = CONFIG.prizes.length;
  // Wheel calc
  const arc = (2 * Math.PI) / n;
  const target = Math.PI / 2 - (idx * arc + arc / 2);
  const totalRot = target + (Math.random() * 3 + 5) * 2 * Math.PI; // 5-8 spins
  const startRot = currentRot;
  const duration = 5000;
  const startTime = performance.now();

  // Audio
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let audioCtx = new AudioContext();
  let lastClickRot = startRot;

  // Start RNG Animation
  let rngInterval = setInterval(() => {
    if ($rngDisplay) {
      $rngDisplay.textContent = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(" ");
    }
  }, 80);

  function playTick() {
    if (!musicEnabled || !audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 800 + Math.random() * 200;
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.06);
    } catch (e) { }
  }

  requestAnimationFrame(function animate(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 4);
    currentRot = startRot + (totalRot - startRot) * eased;

    if (Math.abs(currentRot - lastClickRot) > arc) {
      playTick();
      lastClickRot = currentRot;
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
      return;
    }

    // Finish
    clearInterval(rngInterval);
    if ($rngDisplay) $rngDisplay.textContent = "GANADOR";

    finishSpin(idx);
  });
}

function finishSpin(idx) {
  const prize = CONFIG.prizes[idx];
  const requirement = getAdsRequirement(prize);
  const canClaim = canClaimPrize(prize);

  if (requirement && !canClaim) {
    spinning = false;
    saveState();
    refreshUI();
    showAlert({
      icon: "warning",
      title: "REQUIERE PUNTOS",
      text: `Necesitas ver ${requirement} anuncios para ganar este premio. Tienes ${adsWatchedTotal}.`
    });
    return;
  }

  const stampedPrize = stampWin(prize);
  wins.unshift(stampedPrize);
  wins = wins.slice(0, 50);
  cleanupClaimedCharacters();
  saveState();
  refreshUI();
  spinning = false;

  // Play Win Sound
  playWinSound();

  if (usedAttempts >= getCurrentAttemptCap()) {
    if (getAdsClaimedCount() < getPerWindowLimit()) {
      refreshUI();
    } else {
      handleLimitReached();
    }
  }

  showAlert({
    icon: "success",
    title: "¡PREMIO OBTENIDO!",
    text: `Has ganado: ${prize.label}`
  });
}

function playWinSound() {
  if (!musicEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g);
    g.connect(ac.destination);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, ac.currentTime);
    osc.frequency.linearRampToValueAtTime(880, ac.currentTime + 0.3);
    osc.frequency.linearRampToValueAtTime(440, ac.currentTime + 0.6);
    g.gain.setValueAtTime(0.1, ac.currentTime);
    g.gain.linearRampToValueAtTime(0, ac.currentTime + 1);
    osc.start();
    osc.stop(ac.currentTime + 1);
  } catch (e) { }
}

// --- HELPER LOGIC ---
function startJackpotTicker() {
  if (!$jackpotTicker) return;
  let value = 9842100;
  setInterval(() => {
    value += Math.floor(Math.random() * 50);
    $jackpotTicker.textContent = value.toLocaleString("en-US");
  }, 3000);
}

function pickPrizeIndex() {
  if (!CONFIG.prizes?.length) return 0;
  // Weighted random
  const pool = CONFIG.prizes.map((p, i) => ({ ...p, idx: i }));
  // Simple weighted logic for now. Assume 'probability' or 'weight' property.
  // ... (Using simple random for fallback or detailed weighting if present) ...
  // Actually reusing existing logic would be better but I'll write a robust weighted picker.

  let totalWeight = 0;
  const weights = pool.map(p => {
    let w = parseFloat(p.probability || p.weight || 1);
    if (p.type === 'character') w *= (CONFIG.rules?.characterProbability || 0.1);
    totalWeight += w;
    return w;
  });

  let r = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return pool[i].idx;
    r -= weights[i];
  }
  return 0;
}

function stampWin(prize) {
  return {
    ...prize,
    wonAt: Date.now(),
    id: prize.id || Math.random().toString(36).substr(2, 9)
  };
}

function cleanupClaimedCharacters() {
  // Keep characters that are not claimed or claimed but displayed for history
}

function handleLimitReached() {
  const hours = CONFIG.attempts?.cooldownHours ?? 1;
  lockUntil = Date.now() + hours * 60 * 60 * 1000;
  attempts = 0;
  saveState();
  startCooldownCountdown();
  refreshUI();
}

function startCooldownCountdown() {
  stopCooldownCountdown();
  cooldownInterval = setInterval(() => {
    if (!isCooldownActive()) {
      stopCooldownCountdown();
      resetAttempts();
      refreshUI();
      return;
    }
    updateCooldownUI();
  }, 1000);
  updateCooldownUI();
}

function stopCooldownCountdown() {
  if (cooldownInterval) clearInterval(cooldownInterval);
  cooldownInterval = null;
}

function updateCooldownUI() {
  if (isCooldownActive()) {
    const remaining = Math.max(0, lockUntil - Date.now());
    if ($cooldownTimer) $cooldownTimer.textContent = `⏳ ${formatDuration(remaining)}`;
    // Show banner
    if ($attemptsBanner) {
      $attemptsBanner.style.display = "block";
      if ($attemptsBannerTimer) $attemptsBannerTimer.textContent = formatDuration(remaining);
    }
  } else {
    if ($cooldownTimer) $cooldownTimer.textContent = "";
    if ($attemptsBanner) $attemptsBanner.style.display = "none";
  }
}

function isCooldownActive() {
  return Boolean(lockUntil && Date.now() < lockUntil);
}

function startAdsWindowWatcher() {
  // Check reset periodically
  if (adsWindowInterval) clearInterval(adsWindowInterval);
  adsWindowInterval = setInterval(() => {
    if (maybeResetAdsWindow()) {
      saveState();
      refreshUI();
    }
  }, 60000);
}

function isCharacterClaimed(id) {
  return claimedCharacters.includes(id);
}

function getCharacterAdsRequired() {
  return CONFIG.rules?.characterAdsRequired ?? 1000;
}

function getAdsRequirement(prize) {
  if (typeof prize?.requiresAds === 'number') return prize.requiresAds;
  if (prize?.type === 'character') return getCharacterAdsRequired();
  return 0;
}

function canClaimPrize(prize) {
  const req = getAdsRequirement(prize);
  return req === 0 || adsWatchedTotal >= req;
}

// --- RENDERING ---
function startRenderLoop() {
  if (renderLoopId) return;
  const loop = () => {
    drawWheel(currentRot);
    renderLoopId = requestAnimationFrame(loop);
  };
  renderLoopId = requestAnimationFrame(loop);
}

function drawWheel(rotation) {
  if (!CONFIG.prizes?.length) return;

  const w = $wheel.width;
  const h = $wheel.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 20;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  const num = CONFIG.prizes.length;
  const arc = (2 * Math.PI) / num;

  CONFIG.prizes.forEach((prize, i) => {
    const start = i * arc;
    const end = start + arc;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, start, end);
    ctx.closePath();

    // Slice gradient
    const color = prize.color || SLICE_COLORS[i % SLICE_COLORS.length];
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.8, color);
    grad.addColorStop(1, "#000"); // Darken edge

    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Text
    ctx.save();
    ctx.rotate(start + arc / 2 + Math.PI); // Text alignment
    ctx.translate(-r * 0.65, 0); // Position
    ctx.rotate(-Math.PI / 2); // Vertical text? or Horizontal radiating?
    // Let's do horizontal radiating out
    // Actually simpler: rotate to mid angle, translate out
    ctx.restore();

    ctx.save();
    ctx.rotate(start + arc / 2);
    ctx.translate(r * 0.6, 0);
    ctx.rotate(Math.PI); // Flip so readable from bottom? depends on preference. 
    // Usually wheel text reads from rim inward or center outward.
    // Let's do center outward.
    ctx.rotate(-Math.PI);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 24px 'Roboto Condensed', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,1)";
    ctx.shadowBlur = 4;

    // Truncate
    let label = prize.label;
    if (label.length > 10) label = label.substring(0, 9) + "..";
    ctx.fillText(label, 0, 0);

    ctx.restore();
  });

  ctx.restore();

  // Center Hub
  ctx.beginPath();
  ctx.arc(cx, cy, 50, 0, 2 * Math.PI);
  ctx.fillStyle = "#2a0e45";
  ctx.fill();
  ctx.strokeStyle = "#d4af37";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.font = "30px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("★", cx, cy);

  updatePointedPrizePreview();
}

function updatePointedPrizePreview(override = null, force = false) {
  let prize = override;
  if (!prize && CONFIG.prizes) {
    const num = CONFIG.prizes.length;
    const arc = (2 * Math.PI) / num;
    // Pointer is at top (PI/2), rotation is currentRot
    // Angle of prize i is i*arc to (i+1)*arc
    // Apparent angle at top = (start + currentRot) % 2PI
    // We want angle causing prize to be at PI/2
    // It's normalized angle logic
    let angle = (Math.PI / 2 - currentRot) % (2 * Math.PI);
    if (angle < 0) angle += 2 * Math.PI;
    const idx = Math.floor(angle / arc);
    prize = CONFIG.prizes[idx];
  }

  if ($prizePreviewLabel && prize) {
    $prizePreviewLabel.textContent = prize.label;
    $prizePreviewLabel.style.color = prize.color || "#fff";
  }
}

// Wallet
function updateWalletPanels() {
  const robuxTarget = 10000000;
  const charTarget = 1000;

  // Width update
  if ($robuxProgressBar) {
    let pct = Math.min(100, (robuxWithdrawn / robuxTarget) * 100);
    $robuxProgressBar.style.width = `${pct}%`;
    if ($robuxProgressLabel) $robuxProgressLabel.textContent = `${formatNumber(robuxWithdrawn)} / ${formatNumber(robuxTarget)}`;
  }

  if ($characterProgressBar) {
    // Based on robux or another metric? User said "accumulated robux" needed for characters
    let pct = Math.min(100, (robuxWithdrawn / charTarget) * 100);
    $characterProgressBar.style.width = `${pct}%`;
    if ($characterProgressLabel) $characterProgressLabel.textContent = `${formatNumber(robuxWithdrawn)} / ${formatNumber(charTarget)}`;
  }

  renderCharactersList(robuxWithdrawn >= charTarget);
  if ($withdrawRobuxBtn) $withdrawRobuxBtn.disabled = robuxWithdrawn < robuxTarget;
}

function renderCharactersList(canWithdraw) {
  if (!$charactersList) return;
  $charactersList.innerHTML = "";
  wins.filter(w => w.type === 'character').forEach(c => {
    const li = document.createElement("li");
    li.textContent = `${c.label} - ${isCharacterClaimed(c.id) ? "RETIRADO" : "PENDIENTE"}`;
    $charactersList.appendChild(li);
  });
}

function handleWithdrawRobux() {
  // Logic placeholder
  showAlert({ title: "Retiro", text: "Procesando solicitud..." });
}

function handleAdClick(idx, url) {
  const reset = maybeResetAdsWindow();
  if (reset) saveState();
  if (!hasSavedUser()) {
    showAlert({ icon: "info", text: "Registra tu usuario primero." });
    return;
  }
  if (adsClaimed[idx]) return;
  if (getAdsClaimedCount() >= getPerWindowLimit()) return;

  window.open(url, "_blank");
  adsClaimed[idx] = true;
  adsWatchedTotal = Math.max(0, adsWatchedTotal) + 1;
  syncAttemptsWithCap();
  saveState();
  refreshUI();

  if (window.Swal) {
    Swal.fire({
      toast: true, position: 'bottom-end', icon: 'success',
      title: '+1 Intento / +1 Punto', showConfirmButton: false, timer: 1500
    });
  }
}

function showUserReminder(focus = false) {
  return showAlert({ title: "¡Hola!", text: "Por favor ingresa tu usuario para guardar tus premios." }).then(() => {
    if (focus && $userName) $userName.focus();
  });
}

function showAlert(opts) {
  if (window.Swal) return Swal.fire(opts);
  alert(opts.text);
  return Promise.resolve();
}

function formatNumber(n) { return Number(n).toLocaleString(); }
function formatDuration(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sc = s % 60;
  return `${m}:${sc.toString().padStart(2, '0')}`;
}

async function preloadPrizeImages() {
  if (!CONFIG.prizes) return;
  // Preload
}

function initOnlineUsersBadge() {
  const update = () => {
    if ($onlineUsersCount) $onlineUsersCount.textContent = Math.floor(Math.random() * 500) + 1200;
  };
  update();
  setInterval(update, 5000);
}

function initMusicControl() {
  if ($musicToggle && $bgMusic) {
    $musicToggle.onclick = () => {
      if ($bgMusic.paused) $bgMusic.play();
      else $bgMusic.pause();
    };
  }
}

// --- PRIZES SHOWCASE ---
let stolenBrainrots = [];

function loadStolenState() {
  const stored = localStorage.getItem('stolenBrainrots');
  if (stored) {
    stolenBrainrots = JSON.parse(stored);
    // Clean up old entries (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    stolenBrainrots = stolenBrainrots.filter(item => item.timestamp > oneHourAgo);
    localStorage.setItem('stolenBrainrots', JSON.stringify(stolenBrainrots));
  }
}

function saveStolenState() {
  localStorage.setItem('stolenBrainrots', JSON.stringify(stolenBrainrots));
}

function canStealBrainrot(charName) {
  const stolen = stolenBrainrots.find(item => item.name === charName);
  if (!stolen) return true;

  const cooldownTime = 60 * 60 * 1000; // 1 hour
  return (Date.now() - stolen.timestamp) >= cooldownTime;
}

function getStealCooldown(charName) {
  const stolen = stolenBrainrots.find(item => item.name === charName);
  if (!stolen) return 0;

  const cooldownTime = 60 * 60 * 1000; // 1 hour
  const elapsed = Date.now() - stolen.timestamp;
  return Math.max(0, cooldownTime - elapsed);
}

function stealBrainrot(charName, button, charIndex) {
  if (!hasSavedUser()) {
    showAlert({ icon: 'warning', text: 'Guarda tu usuario primero para robar Brainrots.' });
    return;
  }

  if (!canStealBrainrot(charName)) {
    const remaining = getStealCooldown(charName);
    const minutes = Math.ceil(remaining / 60000);
    showAlert({
      icon: 'info',
      text: `Ya robaste este Brainrot. Espera ${minutes} minutos para volver a robarlo.`
    });
    return;
  }

  // Get ad URL from config
  if (!CONFIG.ads || CONFIG.ads.length === 0) {
    showAlert({ icon: 'error', text: 'No hay publicidades disponibles.' });
    return;
  }

  // Use character index to select ad (cycle through ads)
  const adIndex = charIndex % CONFIG.ads.length;
  const adUrl = CONFIG.ads[adIndex].url;

  // Open ad in new window
  window.open(adUrl, '_blank');

  // Add stolen record
  stolenBrainrots.push({
    name: charName,
    timestamp: Date.now()
  });
  saveStolenState();

  // Give attempt
  attempts = Math.max(0, attempts) + 1;
  saveState();
  refreshUI();

  // Update button
  updateStealButton(button, charName);

  // Show success and scroll to game
  showAlert({
    icon: 'success',
    title: '¡Brainrot Robado!',
    text: `Has robado ${charName} y ganaste +1 intento gratis! Ahora puedes girar la ruleta.`,
    timer: 3000,
    timerProgressBar: true
  }).then(() => {
    // Scroll to wheel section
    scrollToWheel();
  });

  // Also scroll immediately (don't wait for alert)
  setTimeout(() => {
    scrollToWheel();
  }, 1000);
}

function scrollToWheel() {
  const wheelSection = document.querySelector('.wheel-section');
  if (wheelSection) {
    wheelSection.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    // Add highlight effect
    wheelSection.style.animation = 'highlight-pulse 2s ease-in-out';
    setTimeout(() => {
      wheelSection.style.animation = '';
    }, 2000);
  }
}

function updateStealButton(button, charName) {
  if (!canStealBrainrot(charName)) {
    const remaining = getStealCooldown(charName);
    const minutes = Math.ceil(remaining / 60000);
    button.textContent = `✅ Robado (${minutes}m)`;
    button.classList.add('claimed');
    button.disabled = true;
  } else {
    button.textContent = '🔥 ROBAR';
    button.classList.remove('claimed');
    button.disabled = false;
  }
}

async function loadPrizesShowcase() {
  const container = document.getElementById('prizesContainer');
  if (!container) return;

  loadStolenState();

  try {
    const response = await fetch('characters.json');
    const characters = await response.json();

    container.innerHTML = '';

    const rarities = [
      { key: 'rare', label: 'RAROS', icon: '💚' },
      { key: 'epic', label: 'ÉPICOS', icon: '💜' },
      { key: 'legendary', label: 'LEGENDARIOS', icon: '🧡' },
      { key: 'mythic', label: 'MÍTICOS', icon: '❤️' }
    ];

    rarities.forEach(rarity => {
      const chars = characters[rarity.key];
      if (!chars || chars.length === 0) return;

      const section = document.createElement('div');
      section.className = 'rarity-section';

      const header = document.createElement('div');
      header.className = 'rarity-header';
      header.innerHTML = `
        <span class="rarity-badge ${rarity.key}">${rarity.icon} ${rarity.label}</span>
        <span class="rarity-count">${chars.length} personajes</span>
      `;
      section.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'prizes-grid';

      let globalCharIndex = 0; // Track global index across all rarities

      chars.forEach((char, localIndex) => {
        const card = document.createElement('div');
        card.className = `prize-card ${rarity.key}`;
        card.style.borderColor = char.color;

        const imageDiv = document.createElement('div');
        imageDiv.className = 'prize-image';
        imageDiv.style.backgroundColor = char.color + '20';

        const img = document.createElement('img');
        img.src = char.image;
        img.alt = char.name;
        img.onerror = () => {
          imageDiv.innerHTML = '<span style="font-size: 2rem;">❓</span>';
        };
        imageDiv.appendChild(img);

        const name = document.createElement('div');
        name.className = 'prize-name';
        name.textContent = char.name;

        // Add steal button with index
        const stealBtn = document.createElement('button');
        stealBtn.className = 'btn-steal';
        const charIndex = globalCharIndex;
        stealBtn.onclick = () => stealBrainrot(char.name, stealBtn, charIndex);
        updateStealButton(stealBtn, char.name);

        card.appendChild(imageDiv);
        card.appendChild(name);
        card.appendChild(stealBtn);
        grid.appendChild(card);

        globalCharIndex++; // Increment for next character
      });

      section.appendChild(grid);
      container.appendChild(section);
    });

    // Update buttons every minute
    setInterval(() => {
      document.querySelectorAll('.btn-steal').forEach(btn => {
        const card = btn.closest('.prize-card');
        const nameEl = card.querySelector('.prize-name');
        if (nameEl) {
          updateStealButton(btn, nameEl.textContent);
        }
      });
    }, 60000);

  } catch (error) {
    console.error('Error loading prizes:', error);
    container.innerHTML = '<div class="loading-prizes">Error al cargar Brainrots</div>';
  }
}

// Initialize particles.js
function initParticles() {
  if (typeof particlesJS === 'undefined') return;

  particlesJS('particles-js', {
    particles: {
      number: {
        value: 80,
        density: {
          enable: true,
          value_area: 800
        }
      },
      color: {
        value: ['#b026ff', '#ffd700', '#ff0066']
      },
      shape: {
        type: 'circle',
        stroke: {
          width: 0,
          color: '#000000'
        }
      },
      opacity: {
        value: 0.5,
        random: true,
        anim: {
          enable: true,
          speed: 1,
          opacity_min: 0.1,
          sync: false
        }
      },
      size: {
        value: 3,
        random: true,
        anim: {
          enable: true,
          speed: 2,
          size_min: 0.1,
          sync: false
        }
      },
      line_linked: {
        enable: true,
        distance: 150,
        color: '#b026ff',
        opacity: 0.2,
        width: 1
      },
      move: {
        enable: true,
        speed: 1,
        direction: 'none',
        random: true,
        straight: false,
        out_mode: 'out',
        bounce: false,
        attract: {
          enable: false,
          rotateX: 600,
          rotateY: 1200
        }
      }
    },
    interactivity: {
      detect_on: 'canvas',
      events: {
        onhover: {
          enable: true,
          mode: 'repulse'
        },
        onclick: {
          enable: true,
          mode: 'push'
        },
        resize: true
      },
      modes: {
        grab: {
          distance: 400,
          line_linked: {
            opacity: 1
          }
        },
        bubble: {
          distance: 400,
          size: 40,
          duration: 2,
          opacity: 8,
          speed: 3
        },
        repulse: {
          distance: 100,
          duration: 0.4
        },
        push: {
          particles_nb: 4
        },
        remove: {
          particles_nb: 2
        }
      }
    },
    retina_detect: true
  });
}

// Load prizes on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadPrizesShowcase();
    initParticles();
  });
} else {
  loadPrizesShowcase();
  initParticles();
}

// --- SCROLL DOWN BUTTON ---
function initScrollDownButton() {
  const scrollBtn = document.getElementById('scrollDownBtn');
  if (!scrollBtn) return;

  // Click handler - scroll to game section
  scrollBtn.onclick = () => {
    const gamePanel = document.querySelector('.main-container');
    if (gamePanel) {
      gamePanel.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
      });
    }
  };

  // Hide button when user scrolls down
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
    
    // Hide if scrolled more than 300px
    if (currentScroll > 300) {
      scrollBtn.classList.add('hidden');
    } else {
      scrollBtn.classList.remove('hidden');
    }
    
    lastScroll = currentScroll;
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScrollDownButton);
} else {
  initScrollDownButton();
}


// --- GO TO WHEEL BUTTON ---
function initGoToWheelButton() {
  const goToWheelBtn = document.getElementById('goToWheelBtn');
  if (!goToWheelBtn) return;

  goToWheelBtn.onclick = () => {
    scrollToWheel();
  };
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGoToWheelButton);
} else {
  initGoToWheelButton();
}


// --- ROBUX WITHDRAWAL LOGIC ---
function updateRobuxDisplay() {
  const robuxAccumulated = document.getElementById('robuxAccumulated');
  const robuxProgressBar = document.getElementById('robuxProgressBar');
  const robuxProgressLabel = document.getElementById('robuxProgressLabel');
  const withdrawBtn = document.getElementById('withdrawRobuxBtn');
  
  if (!robuxAccumulated || !robuxProgressBar || !robuxProgressLabel || !withdrawBtn) return;
  
  // Calculate total Robux from wins
  let totalRobux = 0;
  wins.forEach(win => {
    if (win.type === 'robux') {
      totalRobux += win.value || 0;
    }
  });
  
  // Subtract already withdrawn Robux
  totalRobux -= robuxWithdrawn;
  totalRobux = Math.max(0, totalRobux);
  
  const target = CONFIG.rules?.robuxWithdrawTarget || 10000000;
  const percentage = Math.min(100, (totalRobux / target) * 100);
  
  // Update displays
  robuxAccumulated.textContent = formatNumber(totalRobux) + ' R\$';
  robuxProgressBar.style.width = percentage + '%';
  robuxProgressBar.querySelector('.progress-text').textContent = percentage.toFixed(1) + '%';
  robuxProgressLabel.textContent = formatNumber(totalRobux) + ' / ' + formatNumber(target) + ' Robux';
  
  // Enable/disable withdraw button
  if (totalRobux >= target) {
    withdrawBtn.disabled = false;
    withdrawBtn.classList.add('ready');
  } else {
    withdrawBtn.disabled = true;
    withdrawBtn.classList.remove('ready');
  }
}

function handleWithdrawRobux() {
  if (!hasSavedUser()) {
    showAlert({ icon: 'warning', text: 'Guarda tu usuario primero.' });
    return;
  }
  
  // Calculate total available Robux
  let totalRobux = 0;
  wins.forEach(win => {
    if (win.type === 'robux') {
      totalRobux += win.value || 0;
    }
  });
  totalRobux -= robuxWithdrawn;
  
  const target = CONFIG.rules?.robuxWithdrawTarget || 10000000;
  
  if (totalRobux < target) {
    showAlert({ 
      icon: 'info', 
      text: 'Necesitas acumular ' + formatNumber(target) + ' Robux para retirar.' 
    });

// --- ROBUX WITHDRAWAL LOGIC ---
function updateRobuxDisplay() {
  const robuxAccumulated = document.getElementById('robuxAccumulated');
  const robuxProgressBar = document.getElementById('robuxProgressBar');
  const robuxProgressLabel = document.getElementById('robuxProgressLabel');
  const withdrawBtn = document.getElementById('withdrawRobuxBtn');
  
  if (!robuxAccumulated || !robuxProgressBar || !robuxProgressLabel || !withdrawBtn) return;
  
  // Calculate total Robux from wins
  let totalRobux = 0;
  wins.forEach(win => {
    if (win.type === 'robux') {
      totalRobux += win.value || 0;
    }
  });
  
  // Subtract already withdrawn Robux
  totalRobux -= robuxWithdrawn;
  totalRobux = Math.max(0, totalRobux);
  
  const target = CONFIG.rules?.robuxWithdrawTarget || 10000000;
  const percentage = Math.min(100, (totalRobux / target) * 100);
  
  // Update displays
  robuxAccumulated.textContent = formatNumber(totalRobux) + ' R\$';
  robuxProgressBar.style.width = percentage + '%';
  const progressText = robuxProgressBar.querySelector('.progress-text');
  if (progressText) {
    progressText.textContent = percentage.toFixed(1) + '%';
  }
  robuxProgressLabel.textContent = formatNumber(totalRobux) + ' / ' + formatNumber(target) + ' Robux';
  
  // Enable/disable withdraw button
  if (totalRobux >= target) {
    withdrawBtn.disabled = false;
    withdrawBtn.classList.add('ready');
  } else {
    withdrawBtn.disabled = true;
    withdrawBtn.classList.remove('ready');
  }
}

// Call updateRobuxDisplay when needed
if (typeof updateWalletPanels !== 'undefined') {
  const _origUpdateWallet = updateWalletPanels;
  updateWalletPanels = function() {
    _origUpdateWallet.call(this);
    updateRobuxDisplay();
  };
}

// Initialize on load
setTimeout(() => {
  if (typeof updateRobuxDisplay === 'function') {
    updateRobuxDisplay();
  }
}, 1000);


}
}
