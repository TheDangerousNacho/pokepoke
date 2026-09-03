import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

const STORAGE_KEY = 'pokepoke.profiles.v1';

/**
 * Catches render errors so a crash does not leave a blank page.
 *
 * The important part is not the apology, it is the escape route. On a phone,
 * a white screen has no console and no devtools, and the only recovery anyone
 * would find is clearing site data — which silently destroys every roster.
 * So this offers to download the raw stored data BEFORE offering to reset it,
 * and reset is deliberately the last option rather than the obvious button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    // Nothing is reported anywhere; this is a personal tool with no backend.
    // The console is here for the case where someone does have devtools open.
    console.error('Raid Planner crashed:', error, info.componentStack);
  }

  /** Saves whatever is in storage, even if the app cannot read it properly. */
  private downloadRawData = () => {
    let raw = '';
    try {
      raw = localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      raw = '';
    }
    if (!raw) {
      alert('Nothing is saved on this device, so there is nothing to download.');
      return;
    }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pokepoke-rescue.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  private reset = () => {
    if (!confirm('Delete every roster saved on this device? This cannot be undone.')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing more to do; reloading is still worth a try.
    }
    location.reload();
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app">
        <h1>Something broke</h1>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            The app hit an error and stopped. <strong>Your Pokémon are still
            saved on this device</strong> — this did not touch them.
          </p>
          <div className="row">
            <button className="primary" onClick={() => location.reload()}>Reload</button>
            <button onClick={this.downloadRawData}>Download my data</button>
          </div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            If reloading keeps failing, download your data first — that file can
            be imported later — and only then try resetting.
          </p>
        </div>

        <details className="card">
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            What went wrong
          </summary>
          <pre
            className="small mono"
            style={{
              margin: '8px 0 0', padding: 8, background: 'var(--surface-2)',
              borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 260, overflow: 'auto',
            }}
          >
            {error.message}
            {componentStack ? `\n${componentStack}` : ''}
          </pre>
        </details>

        <div className="card">
          <button className="ghost danger" onClick={this.reset}>
            Reset all app data
          </button>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            Last resort. Deletes every trainer and roster on this device.
          </p>
        </div>
      </div>
    );
  }
}
