import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { useStore } from './store';
import { decodeHash } from './share';
import { loadAutosave, saveAutosave } from './persist';
import './ui/theme.css';
import 'uplot/dist/uPlot.min.css';

/**
 * Debounced autosave + stale-share-hash hygiene: every system change is
 * written to localStorage (~800 ms after the last edit, flushed on unload),
 * and any `#s…` share payload left in the URL is dropped the moment the
 * on-screen system no longer matches it.
 */
function initAutosave() {
  let last = useStore.getState().system;
  let timer: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((state) => {
    if (state.system === last) return;
    last = state.system;
    if (/^#sj?=/.test(location.hash)) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch { /* ignore */ }
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveAutosave(useStore.getState().system, localStorage);
    }, 800);
  });
  window.addEventListener('beforeunload', () => {
    // flush only a pending save — merely VIEWING a shared link must not
    // overwrite the autosave with someone else's system on tab close
    if (!timer) return;
    clearTimeout(timer);
    saveAutosave(useStore.getState().system, localStorage);
  });
}

// boot: a share link in the hash wins, else the last autosave, else blank.
// Runs once at module level (StrictMode double-invokes effects, not this).
async function boot() {
  const fromHash = await decodeHash(location.hash);
  const sys = fromHash ?? loadAutosave(localStorage);
  if (sys) useStore.getState().loadSystem(sys);
  initAutosave();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
