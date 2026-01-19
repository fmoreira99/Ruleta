// PATCH para script.js - Lógica de actualización de Robux

// --- Actualizar Display de Robux ---
function updateRobuxDisplay() {
    const robuxAccumulated = document.getElementById('robuxAccumulated');
    const robuxProgressBar = document.getElementById('robuxProgressBar');
    const robuxProgressLabel = document.getElementById('robuxProgressLabel');
    const withdrawBtn = document.getElementById('withdrawRobuxBtn');

    console.log('[Robux Display] Updating...', {
        robuxAccumulated: !!robuxAccumulated,
        robuxProgressBar: !!robuxProgressBar,
        robuxProgressLabel: !!robuxProgressLabel,
        withdrawBtn: !!withdrawBtn
    });

    if (!robuxAccumulated || !robuxProgressBar || !robuxProgressLabel || !withdrawBtn) {
        console.warn('[Robux Display] Missing DOM elements');
        return;
    }

    // Calculate total Robux from wins
    let totalRobux = 0;
    if (typeof wins !== 'undefined' && Array.isArray(wins)) {
        wins.forEach(win => {
            if (win.type === 'robux' && win.value) {
                totalRobux += win.value;
            }
        });
    }

    // Subtract already withdrawn Robux
    const withdrawn = typeof robuxWithdrawn !== 'undefined' ? robuxWithdrawn : 0;
    totalRobux -= withdrawn;
    totalRobux = Math.max(0, totalRobux);

    const target = (CONFIG && CONFIG.rules && CONFIG.rules.robuxWithdrawTarget) ? CONFIG.rules.robuxWithdrawTarget : 10000000;
    const percentage = Math.min(100, (totalRobux / target) * 100);

    // Format percentage with appropriate decimals based on size
    let percentageText;
    if (percentage < 0.1) {
        percentageText = percentage.toFixed(3) + '%';  // 0.005% → Shows as "0.005%"
    } else if (percentage < 1) {
        percentageText = percentage.toFixed(2) + '%';  // 0.5% → Shows as "0.50%"
    } else if (percentage < 10) {
        percentageText = percentage.toFixed(1) + '%';  // 5.0% → Shows as "5.0%"
    } else {
        percentageText = Math.round(percentage) + '%';  // 50% → Shows as "50%"
    }

    console.log('[Robux Display]', {
        totalRobux,
        withdrawn,
        target,
        percentageRaw: percentage,
        percentageText: percentageText
    });

    // Update displays
    robuxAccumulated.textContent = (typeof formatNumber === 'function' ? formatNumber(totalRobux) : totalRobux.toLocaleString()) + ' R$';
    robuxProgressBar.style.width = percentage + '%';

    const progressText = robuxProgressBar.querySelector('.progress-text');
    if (progressText) {
        progressText.textContent = percentageText;
    }

    robuxProgressLabel.textContent = (typeof formatNumber === 'function' ? formatNumber(totalRobux) : totalRobux.toLocaleString()) + ' / ' + (typeof formatNumber === 'function' ? formatNumber(target) : target.toLocaleString()) + ' Robux';

    // Enable/disable withdraw button
    if (totalRobux >= target) {
        withdrawBtn.disabled = false;
        withdrawBtn.classList.add('ready');
    } else {
        withdrawBtn.disabled = true;
        withdrawBtn.classList.remove('ready');
    }
}

// Hook into refreshUI
if (typeof refreshUI !== 'undefined') {
    const _origRefreshUI = refreshUI;
    refreshUI = function () {
        if (typeof _origRefreshUI === 'function') {
            _origRefreshUI.call(this);
        }
        updateRobuxDisplay();
    };
    console.log('[Robux Display] Hooked into refreshUI');
}

// Hook into finishSpin (when prizes are won)
if (typeof finishSpin !== 'undefined') {
    const _origFinishSpin = finishSpin;
    finishSpin = function (idx) {
        if (typeof _origFinishSpin === 'function') {
            _origFinishSpin.call(this, idx);
        }
        setTimeout(() => updateRobuxDisplay(), 500);
    };
    console.log('[Robux Display] Hooked into finishSpin');
}

// Initialize on load
setTimeout(() => {
    console.log('[Robux Display] Initializing...');
    updateRobuxDisplay();
}, 1500);

// Update every 3 seconds as fallback
setInterval(() => {
    updateRobuxDisplay();
}, 3000);

// Helper function to check current Robux status
function checkRobuxStatus() {
    console.log('=== ROBUX STATUS ===');
    console.log('Wins array:', wins);
    console.log('Total wins:', wins ? wins.length : 0);

    let totalRobux = 0;
    if (wins && Array.isArray(wins)) {
        wins.forEach((win, idx) => {
            console.log('  Win #' + idx + ':', win);
            if (win.type === 'robux' && win.value) {
                totalRobux += win.value;
            }
        });
    }

    console.log('');
    console.log('Total Robux ganados:', totalRobux.toLocaleString());
    console.log('Robux retirados:', (robuxWithdrawn || 0).toLocaleString());
    console.log('Robux disponibles:', (totalRobux - (robuxWithdrawn || 0)).toLocaleString());
    console.log('Meta:', ((CONFIG?.rules?.robuxWithdrawTarget || 10000000).toLocaleString()));
    console.log('Progreso:', ((totalRobux / 10000000) * 100).toFixed(4) + '%');
    console.log('==================');

    return totalRobux;
}

// Make it globally accessible
window.checkRobuxStatus = checkRobuxStatus;

// Call after a delay to check status
setTimeout(() => {
    checkRobuxStatus();
}, 2000);

console.log('[Robux Display] Patch loaded successfully');
console.log('Tip: Ejecuta checkRobuxStatus() en la consola para ver el estado de Robux');
