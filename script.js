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
let prizeImages = [];
let renderLoopId = null;
let cooldownInterval = null;
let adsWindowInterval = null;
let lastPointedPrize = -1;

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
  $userName.value = userName;
  $wheelInfoImg.src = CONFIG.wheelImage;
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
  wins = Array.isArray(stored.wins) ? stored.wins : [];
  usedAttempts = Number.isFinite(stored.usedAttempts) ? stored.usedAttempts : 0;
  lockUntil = typeof stored.lockUntil === "number" ? stored.lockUntil : null;
  adsClaimed = normalizeAdsState(stored.adsClaimed);
  adsWindowStart = typeof stored.adsWindowStart === "number" ? stored.adsWindowStart : null;
  maybeResetAdsWindow();
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

  const maxAvailable = Math.max(0, CONFIG.attempts.max - usedAttempts);
  attempts = Math.min(Math.max(0, attempts), maxAvailable);
  if (attempts === 0 && usedAttempts === 0) {
    attempts = Math.min(CONFIG.attempts.free, CONFIG.attempts.max);
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
      adsWindowStart
    })
  );
}

$saveUser.onclick = () => {
  userName = $userName.value.trim();
  saveState();
};

$spinBtn.onclick = () => spin();

function refreshUI() {
  const reset = maybeResetAdsWindow();
  if (reset) saveState();
  $spinBtn.textContent = `🎰 Girar (${Math.max(0, attempts)} intentos)`;
  $spinBtn.disabled = spinning || attempts <= 0 || isCooldownActive();
  $wins.innerHTML = "";
  wins.forEach(w => {
    const li = document.createElement("li");
    li.className = "list-group-item bg-transparent text-light";
    li.textContent = `${w.icon || "🎁"} ${w.label}`;
    $wins.appendChild(li);
  });
  updateAdMessage();
  updateCooldownUI();
  renderAds();
  updatePointedPrizePreview(true);
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
    btn.className = "btn btn-sm btn-outline-info";
    if (claimed) {
      btn.textContent = `${ad.label} (en ${formatDuration(resetIn)})`;
    } else if (limitReached) {
      btn.textContent = `${ad.label} (límite alcanzado)`;
    } else {
      btn.textContent = `${ad.label} (+${CONFIG.attempts.perAd})`;
    }
    btn.disabled =
      claimed ||
      limitReached ||
      !canEarnMoreAttempts() ||
      spinning ||
      isCooldownActive();
    btn.onclick = () => handleAdClick(idx, ad.url);
    fragment.appendChild(btn);
  });

  $ads.appendChild(fragment);
}

function handleAdClick(idx, url) {
  const reset = maybeResetAdsWindow();
  if (reset) saveState();
  if (adsClaimed[idx] || !canEarnMoreAttempts()) return;
  if (getAdsClaimedCount() >= getPerWindowLimit()) return;
  window.open(url, "_blank");
  adsClaimed[idx] = true;
  const quotaLeft = Math.max(0, CONFIG.attempts.max - totalAttemptsBudget());
  if (quotaLeft > 0) {
    attempts += Math.min(CONFIG.attempts.perAd, quotaLeft);
  }
  saveState();
  refreshUI();
}

function canEarnMoreAttempts() {
  return !isCooldownActive() && totalAttemptsBudget() < CONFIG.attempts.max;
}

function totalAttemptsBudget() {
  return attempts + usedAttempts;
}

function updateAdMessage() {
  if (isCooldownActive()) {
    $adMessage.textContent = `Agotaste los ${CONFIG.attempts.max} intentos. Espera el cronómetro para volver a jugar.`;
    return;
  }

  const minutes = CONFIG.adsBonus?.windowMinutes ?? 60;
  const perWindowLimit = Math.min(getPerWindowLimit(), CONFIG.ads.length);
  const claimedCount = getAdsClaimedCount();
  const availableAds = Math.max(0, perWindowLimit - claimedCount);
  const nextReset = formatDuration(getAdsWindowRemainingMs());
  $adMessage.textContent = `Intentos usados hoy: ${usedAttempts}/${CONFIG.attempts.max}. Disponibles ahora: ${attempts}. Publicidades restantes esta hora: ${availableAds}/${perWindowLimit} (reinicio en ${nextReset} cada ${minutes} min).`;
}

function spin() {
  if (spinning || attempts <= 0 || isCooldownActive()) return;
  spinning = true;
  attempts = Math.max(0, attempts - 1);
  usedAttempts = Math.min(CONFIG.attempts.max, usedAttempts + 1);
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
  wins.unshift(prize);
  wins = wins.slice(0, 50);
  saveState();
  refreshUI();
  spinning = false;

  if (usedAttempts >= CONFIG.attempts.max) {
    handleLimitReached();
  }

  alert(`🎉 ${userName || "Jugador"}, ganaste: ${prize.label}`);
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
  const weights = CONFIG.prizes.map(p => p.weight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return 0;
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

function drawWheel(rotation = 0, timestamp = performance.now()) {
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
    const img = prizeImages[index];

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = prize.color;
    ctx.fillRect(-radius, -radius, diameter, diameter);
    if (img) {
      drawImageCover(img, diameter, diameter, -radius, -radius);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!img) {
      ctx.save();
      ctx.rotate(start + arc / 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 24px sans-serif";
      ctx.textAlign = "center";
      ctx.translate(radius * 0.35, 0);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(prize.icon || "?", 0, 0);
      ctx.restore();
    }

    ctx.save();
    ctx.rotate(start + arc / 2);
    ctx.fillStyle = "#fff";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.translate(radius * 0.42, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(prize.label, 0, 0);
    ctx.restore();
  });

  ctx.restore();
  updatePointedPrizePreview();
}

function drawImageCover(img, targetWidth, targetHeight, dx = -targetWidth / 2, dy = -targetHeight / 2) {
  const naturalWidth = img.naturalWidth || img.width || targetWidth;
  const naturalHeight = img.naturalHeight || img.height || targetHeight;
  if (!naturalWidth || !naturalHeight) {
    ctx.drawImage(img, dx, dy, targetWidth, targetHeight);
    return;
  }

  const sourceAspect = naturalWidth / naturalHeight;
  const targetAspect = targetWidth / targetHeight;
  let sx = 0;
  let sy = 0;
  let sw = naturalWidth;
  let sh = naturalHeight;

  if (sourceAspect > targetAspect) {
    sh = naturalHeight;
    sw = sh * targetAspect;
    sx = (naturalWidth - sw) / 2;
  } else {
    sw = naturalWidth;
    sh = sw / targetAspect;
    sy = (naturalHeight - sh) / 2;
  }

  ctx.drawImage(
    img,
    sx,
    sy,
    sw,
    sh,
    dx,
    dy,
    targetWidth,
    targetHeight
  );
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

  if (prize.image) {
    $prizePreview.style.backgroundImage = `url(${prize.image})`;
    $prizePreview.classList.add("has-image");
    $prizePreview.textContent = "";
  } else {
    $prizePreview.style.backgroundImage = "none";
    $prizePreview.classList.remove("has-image");
    $prizePreview.textContent = prize.icon || prize.label || "?";
  }

  $prizePreviewLabel.textContent = prize.label || "Premio";
}
