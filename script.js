const STATE_KEY = "ruletaData";

let CONFIG = {};
let attempts = 0;
let userName = "";
let wins = [];
let spinning = false;
let currentRot = 0;
let usedAttempts = 0;
let lockUntil = null;
let adsClaimed = [];
let adsWindowStart = null;
let adsWatchedTotal = 0;
let prizeImages = [];
let renderLoopId = null;
let cooldownInterval = null;
let adsWindowInterval = null;
let lastPointedPrize = -1;
let robuxWithdrawn = 0;
let claimedCharacters = [];
let onlineUsersTimeout = null;
let firstSpinHintShown = false;
let firstSpinHintTimeout = null;
let musicEnabled = true;
let firstInteractionListenerBound = false;
const SLICE_COLORS = [
  "#ff6b6b",
  "#feca57",
  "#1dd1a1",
  "#54a0ff",
  "#5f27cd",
  "#ff9ff3",
  "#48dbfb",
  "#ff9f43",
  "#00d2d3",
  "#c8d6e5"
];

const $wheel = document.getElementById("wheel");
const ctx = $wheel.getContext("2d");
const $spinBtn = document.getElementById("spinBtn");
const $ads = document.getElementById("ads-buttons");
const $wins = document.getElementById("wins");
const $userName = document.getElementById("userName");
const $saveUser = document.getElementById("saveUser");
const $adMessage = document.getElementById("adMessage");
const $wheelInfoImg = document.getElementById("wheelInfoImg");
const $cooldownTimer = document.getElementById("cooldownTimer");
const $prizePreview = document.getElementById("prizePreview");
const $prizePreviewLabel = document.getElementById("prizePreviewLabel");
const $adsProgress = document.getElementById("adsProgress");
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

fetch("config.json")
  .then(res => res.json())
  .then(async cfg => {
    CONFIG = cfg;
    await init();
  })
  .catch(err => {
    console.error("No se pudo cargar la configuración", err);
    $adMessage.textContent = "No se pudo cargar la configuración de la ruleta.";
  });

async function init() {
  loadState();
  initOnlineUsersBadge();
  initMusicControl();
  $userName.value = userName;
  if ($wheelInfoImg && CONFIG.wheelImage) {
    $wheelInfoImg.src = CONFIG.wheelImage;
  }
  if (isCooldownActive()) {
    startCooldownCountdown();
  }
  await preloadPrizeImages();
  startRenderLoop();
  startAdsWindowWatcher();
  refreshUI();
}

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
  return Array.from({ length: CONFIG.ads.length }, (_, idx) => Boolean(raw?.[idx]));
}

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
    return true;
  }
  return false;
}

function getAdsWindowRemainingMs() {
  if (!adsWindowStart) return 0;
  const end = adsWindowStart + getAdsWindowMs();
  return Math.max(0, end - Date.now());
}

function getPerWindowLimit() {
  return CONFIG.adsBonus?.limitPerHour ?? CONFIG.ads.length;
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

  const cap = getCurrentAttemptCap();
  const maxAvailable = Math.max(0, cap - usedAttempts);
  attempts = Math.min(Math.max(0, attempts), maxAvailable);
  if (attempts === 0 && usedAttempts === 0) {
    const seed = cap > 0 ? Math.min(CONFIG.attempts.free, cap) : CONFIG.attempts.free;
    attempts = Math.max(attempts, seed);
  }
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

$saveUser.onclick = () => {
  const value = $userName.value.trim();
  if (!value) {
    showAlert({
      icon: "warning",
      title: "Usuario requerido",
      text: "Debes ingresar tu usuario de Roblox para guardar el progreso."
    });
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
  $spinBtn.textContent = `🎰 Girar (${Math.max(0, attempts)} intentos)`;
  $spinBtn.disabled = spinning || attempts <= 0 || isCooldownActive() || !hasSavedUser();
  $wins.innerHTML = "";
  wins.forEach(win => {
    const li = document.createElement("li");
    li.className = "list-group-item bg-transparent text-light";
    const summary =
      win.type === "robux"
        ? `${win.label} · ${formatNumber(win.value || 0)} Robux`
        : win.label;
    const characterStatus =
      win.type === "character" && isCharacterClaimed(win.id) ? " (retirado)" : "";
    li.textContent = `${summary}${characterStatus}`;
    $wins.appendChild(li);
  });
  updateAdMessage();
  updateCooldownUI();
  renderAds();
  updatePointedPrizePreview(true);
  updateRulesProgress();
  updateAdPointsTotal();
  updateWalletPanels();
}

function renderAds() {
  if (!CONFIG.ads) return;
  $ads.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const resetIn = getAdsWindowRemainingMs();
  const perWindowLimit = getPerWindowLimit();
  const claimedCount = getAdsClaimedCount();
  const limitReached = claimedCount >= perWindowLimit;

  CONFIG.ads.forEach((ad, idx) => {
    const btn = document.createElement("button");
    const claimed = adsClaimed[idx];
    btn.className = "btn btn-sm btn-juego";
    if (claimed) {
      btn.textContent = `${ad.label} (en ${formatDuration(resetIn)})`;
    } else if (limitReached) {
      btn.textContent = `${ad.label} (límite alcanzado)`;
    } else {
      btn.textContent = `${ad.label} (+${CONFIG.attempts.perAd} intento · +1 punto)`;
    }
    btn.disabled =
      claimed ||
      limitReached ||
      spinning ||
      isCooldownActive() ||
      !hasSavedUser();
    btn.onclick = () => handleAdClick(idx, ad.url);
    fragment.appendChild(btn);
  });

  $ads.appendChild(fragment);
}

function handleAdClick(idx, url) {
  const reset = maybeResetAdsWindow();
  if (reset) saveState();
  if (!hasSavedUser()) {
    showAlert({
      icon: "info",
      title: "Usuario requerido",
      text: "Guarda tu usuario de Roblox antes de reclamar publicidades."
    });
    return;
  }
  if (adsClaimed[idx]) return;
  if (getAdsClaimedCount() >= getPerWindowLimit()) return;
  window.open(url, "_blank");
  adsClaimed[idx] = true;
  adsWatchedTotal = Math.max(0, adsWatchedTotal) + 1;
  const cap = getCurrentAttemptCap();
  const maxAvailable = Math.max(0, cap - usedAttempts);
  attempts = Math.min((attempts || 0) + (CONFIG.attempts.perAd || 0), maxAvailable);
  saveState();
  refreshUI();
  showAdRewardToast();
}

function hasSavedUser() {
  return Boolean(userName && userName.trim().length);
}

function updateAdMessage() {
  if (!hasSavedUser()) {
    $adMessage.textContent = "Guarda tu usuario de Roblox para acumular premios, puntos y retiros.";
    return;
  }
  if (isCooldownActive()) {
    $adMessage.textContent = `Agotaste los ${CONFIG.attempts.max} intentos. Espera el cronómetro para volver a jugar.`;
    return;
  }

  const minutes = CONFIG.adsBonus?.windowMinutes ?? 60;
  const perWindowLimit = Math.min(getPerWindowLimit(), CONFIG.ads.length);
  const claimedCount = getAdsClaimedCount();
  const availableAds = Math.max(0, perWindowLimit - claimedCount);
  const nextReset = formatDuration(getAdsWindowRemainingMs());
  const adsRequired = getCharacterAdsRequired();
  const adsProgress = Math.min(adsWatchedTotal, adsRequired);
  $adMessage.textContent = `Oportunidades totales: ${CONFIG.attempts.max} · usadas: ${usedAttempts}. Intentos activos: ${attempts}. Publicidades disponibles esta hora: ${availableAds}/${perWindowLimit} (reinicio en ${nextReset} cada ${minutes} min). Puntos acumulados: ${formatNumber(adsWatchedTotal)}. Progreso para personajes: ${adsProgress}/${adsRequired}.`;
}

function updateRulesProgress() {
  if (!$adsProgress) return;
  const required = getCharacterAdsRequired();
  const progress = Math.min(required, adsWatchedTotal);
  $adsProgress.textContent = `${progress}/${required}`;
}

function getCharacterAdsRequired() {
  return CONFIG.rules?.characterAdsRequired ?? 1000;
}

function getAdsRequirement(prize) {
  if (!prize) return 0;
  if (typeof prize.requiresAds === "number") return prize.requiresAds;
  if (prize.type === "character") return getCharacterAdsRequired();
  return 0;
}

function canClaimPrize(prize) {
  const requirement = getAdsRequirement(prize);
  return requirement === 0 || adsWatchedTotal >= requirement;
}

function spin() {
  if (!hasSavedUser()) {
    showAlert({
      icon: "info",
      title: "Usuario requerido",
      text: "Guarda tu nombre antes de usar la ruleta."
    });
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
  const arc = (2 * Math.PI) / n;
  const target = Math.PI / 2 - (idx * arc + arc / 2);
  const totalRot = target + (Math.random() * 3 + 5) * 2 * Math.PI;
  const startRot = currentRot;
  const duration = 4000;
  const start = performance.now();

  requestAnimationFrame(function animate(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    currentRot = startRot + (totalRot - startRot) * eased;
    if (progress < 1) {
      requestAnimationFrame(animate);
      return;
    }

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
      title: "Publicidad requerida",
      text: `Para reclamar ${prize.label} necesitas ver ${requirement} publicidades. Progreso actual: ${adsWatchedTotal}/${requirement}.`
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

  if (usedAttempts >= getCurrentAttemptCap()) {
    if (getAdsClaimedCount() < getPerWindowLimit()) {
      refreshUI();
    } else {
      handleLimitReached();
    }
  }

  showAlert({
    icon: "success",
    title: "🎉 Premio conseguido",
    text: `${userName || "Jugador"}, ganaste: ${prize.label}`
  });
  if (!firstSpinHintShown) {
    showFirstSpinHint();
  }
}

function handleLimitReached() {
  const hours = CONFIG.attempts.cooldownHours ?? 3;
  lockUntil = Date.now() + hours * 60 * 60 * 1000;
  attempts = 0;
  saveState();
  startCooldownCountdown();
  refreshUI();
}

function pickPrizeIndex() {
  if (!CONFIG.prizes?.length) return 0;
  const entries = CONFIG.prizes.map((prize, idx) => ({ prize, idx }));
  const characterChance = CONFIG.rules?.characterProbability ?? 0.1;
  const characterPool = entries.filter(entry => entry.prize.type === "character");
  const robuxPool = entries.filter(entry => entry.prize.type !== "character");
  const shouldPickCharacter = characterPool.length && Math.random() < characterChance;
  const pool = shouldPickCharacter
    ? characterPool
    : robuxPool.length
    ? robuxPool
    : entries;
  return weightedPick(pool);
}

function weightedPick(pool) {
  if (!pool.length) return 0;
  const weights = pool.map(entry => {
    const probability = Number(entry.prize.probability);
    if (Number.isFinite(probability) && probability > 0) return probability;
    const weight = Number(entry.prize.weight);
    return Number.isFinite(weight) && weight > 0 ? weight : 1;
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    const weight = weights[i];
    if (r < weight) return pool[i].idx;
    r -= weight;
  }
  return pool[0].idx;
}

function isCooldownActive() {
  return Boolean(lockUntil && Date.now() < lockUntil);
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
  if (cooldownInterval) {
    clearInterval(cooldownInterval);
    cooldownInterval = null;
  }
}

function updateCooldownUI() {
  if (isCooldownActive()) {
    const remaining = Math.max(0, lockUntil - Date.now());
    $cooldownTimer.textContent = `⏳ Podrás volver a intentar en ${formatDuration(remaining)}`;
  } else {
    $cooldownTimer.textContent = "";
  }
  updateAttemptsBanner();
}

function updateAttemptsBanner() {
  if (!$attemptsBanner) return;
  const noAttemptsLeft = Math.max(0, attempts) === 0;
  const shouldShow = noAttemptsLeft && isCooldownActive();
  if (!shouldShow) {
    $attemptsBanner.classList.remove("is-visible");
    $attemptsBanner.setAttribute("aria-hidden", "true");
    if ($attemptsBannerTimer) {
      $attemptsBannerTimer.textContent = "00:00:00";
    }
    return;
  }

  $attemptsBanner.classList.add("is-visible");
  $attemptsBanner.removeAttribute("aria-hidden");
  if ($attemptsBannerTimer) {
    const remaining = Math.max(0, lockUntil - Date.now());
    $attemptsBannerTimer.textContent = formatDuration(remaining);
  }
}

function showFirstSpinHint() {
  if (!$firstSpinHint || firstSpinHintShown) return;
  firstSpinHintShown = true;
  $firstSpinHint.classList.add("is-visible");
  $firstSpinHint.setAttribute("aria-hidden", "false");
  if (firstSpinHintTimeout) {
    clearTimeout(firstSpinHintTimeout);
  }
  firstSpinHintTimeout = setTimeout(() => {
    hideFirstSpinHint();
  }, 5000);
  saveState();
}

function hideFirstSpinHint() {
  if (!$firstSpinHint) return;
  $firstSpinHint.classList.remove("is-visible");
  $firstSpinHint.setAttribute("aria-hidden", "true");
  if (firstSpinHintTimeout) {
    clearTimeout(firstSpinHintTimeout);
    firstSpinHintTimeout = null;
  }
}

function initOnlineUsersBadge() {
  if (!$onlineUsersCount) return;
  if (onlineUsersTimeout) {
    clearTimeout(onlineUsersTimeout);
  }
  updateOnlineUsersCount();
  scheduleOnlineUsersUpdate();
}

function updateOnlineUsersCount() {
  if (!$onlineUsersCount) return;
  $onlineUsersCount.textContent = getRandomOnlineUsers();
}

function getRandomOnlineUsers() {
  const min = 50;
  const max = 200;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleOnlineUsersUpdate() {
  const nextInterval = getRandomUsersInterval();
  onlineUsersTimeout = setTimeout(() => {
    updateOnlineUsersCount();
    scheduleOnlineUsersUpdate();
  }, nextInterval);
}

function getRandomUsersInterval() {
  const min = 4000;
  const max = 15000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function initMusicControl() {
  if (!$bgMusic || !$musicToggle) return;
  updateMusicUI();
  $bgMusic.volume = 0.35;
  $musicToggle.onclick = () => {
    setMusicEnabled(!musicEnabled);
  };
  attachFirstInteractionListener();
  if (musicEnabled) {
    playBgMusic();
  } else {
    pauseBgMusic();
  }
}

function attachFirstInteractionListener() {
  if (firstInteractionListenerBound) return;
  document.addEventListener(
    "click",
    () => {
      if (musicEnabled) {
        playBgMusic();
      }
    },
    { once: true }
  );
  firstInteractionListenerBound = true;
}

function setMusicEnabled(value) {
  musicEnabled = value;
  updateMusicUI();
  if (musicEnabled) {
    playBgMusic();
  } else {
    pauseBgMusic();
  }
  saveState();
}

function updateMusicUI() {
  if (!$musicToggle) return;
  $musicToggle.textContent = musicEnabled ? "🔊" : "🔇";
  $musicToggle.setAttribute("aria-pressed", String(musicEnabled));
  $musicToggle.title = musicEnabled ? "Silenciar música de fondo" : "Activar música de fondo";
}

function playBgMusic() {
  if (!$bgMusic) return;
  $bgMusic.play().catch(() => {
    // Autoplay might be blocked; button will retry.
  });
}

function pauseBgMusic() {
  if (!$bgMusic) return;
  $bgMusic.pause();
}

function resetAttempts() {
  attempts = CONFIG.attempts.free;
  usedAttempts = 0;
  lockUntil = null;
  maybeResetAdsWindow(true);
  stopCooldownCountdown();
  saveState();
  renderAds();
}

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

async function preloadPrizeImages() {
  const loaders = CONFIG.prizes.map(prize => {
    if (!prize.image) return Promise.resolve(null);
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = prize.image;
    });
  });
  prizeImages = await Promise.all(loaders);
}

function startRenderLoop() {
  if (renderLoopId) return;
  const loop = timestamp => {
    drawWheel(currentRot, timestamp);
    renderLoopId = requestAnimationFrame(loop);
  };
  renderLoopId = requestAnimationFrame(loop);
}

function startAdsWindowWatcher() {
  if (adsWindowInterval) return;
  adsWindowInterval = setInterval(() => {
    if (maybeResetAdsWindow()) {
      saveState();
      refreshUI();
    }
  }, 1000);
}

function drawWheel(rotation = 0) {
  if (!CONFIG.prizes?.length) return;
  const radius = 380;
  const diameter = radius * 2;
  const scale = window.devicePixelRatio || 1;
  const targetWidth = diameter * scale;
  const targetHeight = diameter * scale;

  if ($wheel.width !== targetWidth || $wheel.height !== targetHeight) {
    $wheel.width = targetWidth;
    $wheel.height = targetHeight;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, $wheel.width, $wheel.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.save();
  ctx.translate(radius, radius);
  ctx.rotate(rotation);

  const prizes = CONFIG.prizes;
  const arc = (2 * Math.PI) / prizes.length;

  prizes.forEach((prize, index) => {
    const start = index * arc;
    const end = start + arc;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = getSliceColor(prize, index);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.restore();
  drawSliceLabels(rotation, radius, arc);
  updatePointedPrizePreview();
}

function getSliceColor(prize, index) {
  if (prize?.color) return prize.color;
  return SLICE_COLORS[index % SLICE_COLORS.length];
}

function drawSliceLabels(rotation, radius, arc) {
  const prizes = CONFIG.prizes;
  ctx.save();
  ctx.translate(radius, radius);
  const textRadius = radius * 0.6;
  prizes.forEach((prize, index) => {
    const midAngle = rotation + index * arc + arc / 2;
    const x = Math.cos(midAngle) * textRadius;
    const y = Math.sin(midAngle) * textRadius;
    ctx.save();
    ctx.translate(x, y);
    ctx.font = "600 15px 'Segoe UI', sans-serif";
    const label = (prize.label || "").toUpperCase();
    const metrics = ctx.measureText(label);
    const paddingX = 12;
    const paddingY = 6;
    const textHeight =
      (metrics.actualBoundingBoxAscent || 12) + (metrics.actualBoundingBoxDescent || 4);
    const boxWidth = metrics.width + paddingX * 2;
    const boxHeight = textHeight + paddingY * 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.beginPath();
    ctx.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function normalizeAngle(angle) {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function getPointedPrizeIndex(rotation = currentRot) {
  if (!CONFIG.prizes?.length) return -1;
  const arc = (2 * Math.PI) / CONFIG.prizes.length;
  const normalized = normalizeAngle(Math.PI / 2 - rotation - arc / 2);
  const idx = Math.floor(normalized / arc);
  return (idx + CONFIG.prizes.length) % CONFIG.prizes.length;
}

function updatePointedPrizePreview(force = false) {
  if (!$prizePreview || !$prizePreviewLabel || !CONFIG.prizes?.length) return;
  const idx = getPointedPrizeIndex();
  if (idx < 0) return;
  if (!force && idx === lastPointedPrize) return;
  lastPointedPrize = idx;
  const prize = CONFIG.prizes[idx];
  if (!prize) return;

  const hasImage = Boolean(prize.image);
  if (hasImage) {
    $prizePreview.style.backgroundImage = `url(${prize.image})`;
    $prizePreview.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
    $prizePreview.textContent = "";
  } else {
    $prizePreview.style.backgroundImage = "none";
    $prizePreview.style.backgroundColor = prize.color || "rgba(255,255,255,0.08)";
    $prizePreview.textContent = prize.label || "Premio";
  }

  $prizePreview.classList.add("active");
  $prizePreview.classList.toggle("has-image", hasImage);

  const requirement = getAdsRequirement(prize);
  if (requirement) {
    const progress = Math.min(requirement, adsWatchedTotal);
    $prizePreviewLabel.textContent = `${prize.label} · requiere ${requirement} publicidades/puntos (${progress}/${requirement})`;
  } else {
    $prizePreviewLabel.textContent = prize.label || "Premio";
  }
}

function normalizeWins(rawWins = []) {
  if (!Array.isArray(rawWins)) return [];
  return rawWins
    .map(entry => {
      if (!entry) return null;
      const normalized = { ...entry };
      const fallback = findPrizeByLabel(normalized.label);
      normalized.id = normalized.id || generateWinId();
      normalized.label = normalized.label || fallback?.label || "Premio misterioso";
      normalized.type = normalized.type || fallback?.type || (typeof normalized.value === "number" ? "robux" : "character");
      if (normalized.type === "robux") {
        const value = Number(normalized.value);
        normalized.value =
          Number.isFinite(value) && value > 0 ? value : Number(fallback?.value) || 0;
      } else {
        normalized.value = Number(normalized.value) || 0;
      }
      normalized.wonAt = normalized.wonAt || Date.now();
      return normalized;
    })
    .filter(Boolean);
}

function findPrizeByLabel(label) {
  return CONFIG.prizes?.find(prize => prize.label === label);
}

function stampWin(prize) {
  const stamped = {
    ...prize,
    id: generateWinId(),
    wonAt: Date.now()
  };
  if (stamped.type === "robux") {
    stamped.value = Number(prize.value) || 0;
  }
  return stamped;
}

function generateWinId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `win-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanupClaimedCharacters() {
  if (!Array.isArray(claimedCharacters)) {
    claimedCharacters = [];
    return;
  }
  const ids = new Set(wins.map(win => win.id));
  claimedCharacters = claimedCharacters.filter(id => ids.has(id));
}

function getRobuxWithdrawTarget() {
  return CONFIG.rules?.robuxWithdrawTarget ?? 10000;
}

function getCharacterRobuxRequirement() {
  return CONFIG.rules?.characterWithdrawRobuxMin ?? 10000000000;
}

function getTotalRobuxWon() {
  return wins
    .filter(win => win.type === "robux")
    .reduce((sum, win) => sum + (Number(win.value) || 0), 0);
}

function getWithdrawableRobux() {
  return Math.max(0, getTotalRobuxWon() - robuxWithdrawn);
}

function canWithdrawCharacter() {
  return hasSavedUser() && getWithdrawableRobux() >= getCharacterRobuxRequirement();
}

function updateWalletPanels() {
  if (!$robuxProgressBar && !$characterProgressBar && !$charactersList) return;
  const withdrawable = getWithdrawableRobux();
  updateRobuxPanel(withdrawable);
  updateCharacterPanel(withdrawable);
}

function updateRobuxPanel(withdrawable) {
  if (!$robuxProgressBar || !$robuxProgressLabel || !$withdrawRobuxBtn) return;
  const target = getRobuxWithdrawTarget();
  const percentage = target > 0 ? Math.min(100, (withdrawable / target) * 100) : 0;
  $robuxProgressBar.style.width = `${percentage}%`;
  $robuxProgressBar.textContent = `${Math.floor(percentage)}%`;
  $robuxProgressLabel.textContent = `${formatNumber(withdrawable)} / ${formatNumber(target)} Robux disponibles`;
  $withdrawRobuxBtn.disabled = withdrawable < target || spinning || !hasSavedUser();
}

function updateCharacterPanel(withdrawable) {
  if (!$characterProgressBar || !$characterProgressLabel) return;
  const requirement = getCharacterRobuxRequirement();
  const percentage = requirement > 0 ? Math.min(100, (withdrawable / requirement) * 100) : 0;
  $characterProgressBar.style.width = `${percentage}%`;
  $characterProgressBar.textContent = `${Math.floor(percentage)}%`;
  $characterProgressLabel.textContent = `Robux actuales ${formatNumber(withdrawable)} / ${formatNumber(requirement)}`;
  renderCharactersList(canWithdrawCharacter());
}

function renderCharactersList(canWithdraw) {
  if (!$charactersList) return;
  $charactersList.innerHTML = "";
  const characters = wins.filter(win => win.type === "character");
  if (!characters.length) {
    const empty = document.createElement("li");
    empty.className = "list-group-item bg-transparent text-light empty-state";
    empty.textContent = "Todavía no ganas personajes.";
    $charactersList.appendChild(empty);
    return;
  }

  characters.forEach(character => {
    const claimed = isCharacterClaimed(character.id);
    const li = document.createElement("li");
    li.className = "list-group-item bg-transparent text-light d-flex align-items-center justify-content-between gap-2";

    const info = document.createElement("div");
    info.className = "text-start";
    const name = document.createElement("div");
    name.className = "fw-semibold";
    name.textContent = character.label;
    const meta = document.createElement("small");
    meta.className = "text-secondary";
    meta.textContent = `Ganado el ${formatWinDate(character.wonAt)}`;
    info.appendChild(name);
    info.appendChild(meta);

    const btn = document.createElement("button");
    btn.className = "btn btn-sm btn-brand btn-animacion";
    btn.textContent = claimed ? "Retirado" : "Retirar";
    btn.disabled = claimed || !canWithdraw || spinning || !hasSavedUser();
    btn.onclick = () => handleCharacterWithdraw(character.id);

    li.appendChild(info);
    li.appendChild(btn);
    $charactersList.appendChild(li);
  });
}

function handleWithdrawRobux() {
  if (!hasSavedUser()) {
    showAlert({
      icon: "info",
      title: "Usuario requerido",
      text: "Guarda tu usuario de Roblox antes de solicitar un retiro."
    });
    return;
  }
  const target = getRobuxWithdrawTarget();
  const withdrawable = getWithdrawableRobux();
  if (withdrawable < target) {
    showAlert({
      icon: "warning",
      title: "Fondos insuficientes",
      text: `Necesitas ${formatNumber(target)} Robux disponibles para retirar.`
    });
    return;
  }
  robuxWithdrawn += target;
  saveState();
  refreshUI();
  showAlert({
    icon: "success",
    title: "Retiro solicitado",
    text: `Se registró tu solicitud de retiro por ${formatNumber(target)} Robux.`
  });
}

function handleCharacterWithdraw(characterId) {
  if (!hasSavedUser()) {
    showAlert({
      icon: "info",
      title: "Usuario requerido",
      text: "Guarda tu usuario de Roblox antes de reclamar un personaje."
    });
    return;
  }
  if (!characterId || isCharacterClaimed(characterId)) return;
  if (!canWithdrawCharacter()) {
    showAlert({
      icon: "warning",
      title: "Fondos insuficientes",
      text: `Necesitas al menos ${formatNumber(getCharacterRobuxRequirement())} Robux disponibles para retirar personajes.`
    });
    return;
  }
  claimedCharacters.push(characterId);
  saveState();
  refreshUI();
  showAlert({
    icon: "success",
    title: "Solicitud registrada",
    text: "Solicitud de retiro de personaje registrada."
  });
}

function isCharacterClaimed(id) {
  return claimedCharacters?.includes(id);
}

function formatWinDate(timestamp) {
  if (!timestamp) return "fecha desconocida";
  try {
    return new Date(timestamp).toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "fecha desconocida";
  }
}

function updateAdPointsTotal() {
  if ($adPointsTotal) {
    $adPointsTotal.textContent = formatNumber(adsWatchedTotal);
  }
}

function formatNumber(value = 0) {
  return Number(value || 0).toLocaleString("es-ES");
}

function showAlert({
  icon = "info",
  title = "",
  text = "",
  confirmButtonText = "Entendido"
} = {}) {
  if (window.Swal) {
    return Swal.fire({
      icon,
      title,
      text,
      confirmButtonText,
      background: "#0a0004",
      color: "#fff",
      confirmButtonColor: "#ff4b6e"
    });
  }
  window.alert(title || text || "");
  return Promise.resolve();
}

function showAdRewardToast() {
  if (window.Swal) {
    Swal.fire({
      toast: true,
      icon: "success",
      title: "Intento +1 y punto +1",
      position: "bottom-end",
      timer: 2200,
      showConfirmButton: false,
      background: "#0a0004",
      color: "#fff"
    });
  }
}
