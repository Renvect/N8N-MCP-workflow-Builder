// Updater UI Logic - Silent Auto-Update
(function () {
  const updateDot = document.getElementById('update-dot');
  const updateStatusText = document.getElementById('update-status-text');
  const checkUpdatesBtn = document.getElementById('check-updates-btn');

  // Check if electronAPI.updater is available
  if (!window.electronAPI || !window.electronAPI.updater) {
    console.log('[Updater UI] electronAPI.updater not available');
    return;
  }

  // Listen for status updates (new unified event)
  window.electronAPI.updater.onStatus((status) => {
    console.log('[Updater UI] Status:', status);
    updateStatus(status.state, status);
  });

  // Listen for errors
  window.electronAPI.updater.onError((error) => {
    console.error('[Updater UI] Error:', error);
    updateStatus('error', { message: error });
  });

  // Initial status check
  try {
    window.electronAPI.updater.getInfo().then((info) => {
      if (info && info.updateAvailable) {
        updateStatus('ready', { version: info.latestVersion });
      } else {
        updateStatus('idle', null);
      }
    }).catch(() => {
      updateStatus('idle', null);
    });
  } catch {
    updateStatus('idle', null);
  }

  // Manual check button
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', async () => {
      try {
        updateStatus('checking', null);
        const info = await window.electronAPI.updater.check();
        if (info && info.updateAvailable) {
          updateStatus('downloading', { version: info.latestVersion });
        } else {
          updateStatus('uptodate', null);
        }
      } catch (e) {
        updateStatus('error', { message: e?.message || String(e) });
      }
    });
  }

  function updateStatus(state, payload) {
    // Update dot color
    if (updateDot) {
      if (state === 'ready') {
        updateDot.className = 'status-dot running';
      } else if (state === 'downloading') {
        updateDot.className = 'status-dot';
        updateDot.style.background = '#ffc107'; // yellow for downloading
      } else if (state === 'error') {
        updateDot.className = 'status-dot stopped';
      } else {
        updateDot.className = 'status-dot';
        updateDot.style.background = '';
      }
    }

    if (!updateStatusText) return;

    switch (state) {
      case 'checking':
        updateStatusText.textContent = 'Updates: Checking...';
        break;
      case 'downloading':
        const pct = payload?.percent ? ` (${payload.percent}%)` : '';
        updateStatusText.textContent = `Updates: Downloading${pct}`;
        break;
      case 'ready':
        updateStatusText.textContent = `Updates: Ready (restart to apply)`;
        break;
      case 'uptodate':
        updateStatusText.textContent = 'Updates: Up to date';
        break;
      case 'error':
        updateStatusText.textContent = 'Updates: Error';
        console.error('[Updater] Error:', payload?.message);
        break;
      default:
        updateStatusText.textContent = 'Updates: -';
    }
  }

  console.log('[Updater UI] Initialized (silent mode)');
})();
