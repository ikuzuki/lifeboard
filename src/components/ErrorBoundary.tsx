import { Component, type ReactNode } from 'react';
import { clearState, exportState } from '../store';

/**
 * A permanently white screen is the worst outcome for a local-first app, because
 * nothing will ever overwrite the bad state on its own. Always offer an export before
 * offering a reset.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifeboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-full max-w-[460px] flex-col justify-center gap-4 px-6">
        <h1 className="text-[20px] font-semibold">Something went wrong</h1>
        <p className="text-[14px]" style={{ color: 'var(--muted-foreground)' }}>
          {this.state.error.message || 'The app could not start.'} Download your data before
          resetting, so nothing is lost.
        </p>
        <button
          type="button"
          onClick={this.download}
          className="min-h-11 rounded-lg px-4 text-[15px] font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          Download my data
        </button>
        <button
          type="button"
          onClick={() => {
            clearState();
            window.location.reload();
          }}
          className="min-h-11 rounded-lg border px-4 text-[15px]"
          style={{ borderColor: 'var(--border)', color: 'var(--now)' }}
        >
          Reset and start again
        </button>
      </div>
    );
  }
}
