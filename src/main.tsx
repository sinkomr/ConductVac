import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { useStore } from './store';
import { decodeHash } from './share';
import { clearAutosave, loadAutosave, saveAutosave } from './persist';
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

/**
 * Last line of defence: a render error must not leave a blank page that
 * autosave then reproduces on every reload. Offers the two ways out.
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>ConductVac hit an error it could not recover from</h2>
        <pre>{String(this.state.error)}</pre>
        <p>Your system is still in this browser's autosave. Reloading may be enough; if the same error returns, the saved system is what triggers it.</p>
        <button className="btn" onClick={() => location.reload()}>Reload</button>{' '}
        <button
          className="btn danger"
          onClick={() => {
            clearAutosave(localStorage);
            location.replace(location.pathname + location.search);
          }}
        >
          Discard the saved system and restart
        </button>
      </div>
    );
  }
}

/** load the system a `#s=…` hash carries; false if the hash holds none */
async function loadFromHash(): Promise<boolean> {
  const raw = await decodeHash(location.hash);
  return raw !== null && useStore.getState().importSystem(raw);
}

// boot: a share link in the hash wins, else the last autosave, else blank.
// Runs once at module level (StrictMode double-invokes effects, not this).
async function boot() {
  try {
    if (!(await loadFromHash())) {
      const saved = loadAutosave(localStorage);
      if (saved !== null && !useStore.getState().importSystem(saved)) clearAutosave(localStorage);
    }
  } catch (err) {
    // a system that cannot even be loaded must not block the app from starting
    console.error('could not restore the previous system', err);
  }
  initAutosave();
  // a share link pasted into an already-open tab only changes the hash
  window.addEventListener('hashchange', () => void loadFromHash().catch(() => undefined));

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void boot();
