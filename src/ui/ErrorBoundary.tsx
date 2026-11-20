import { Component, type ReactNode } from 'react';

/** Keeps one broken panel (e.g. a failed lazy chunk) from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[Tandem] ${this.props.label} crashed:`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(this.state.error.message);
    return (
      <div className={`error-card ${this.props.compact ? 'compact' : ''}`} role="alert">
        <b>{chunk ? `The ${this.props.label} didn’t finish loading.` : `The ${this.props.label} hit a problem.`}</b>
        <span className="muted">{chunk ? 'This usually fixes itself with a reload. Your work is saved.' : this.state.error.message}</span>
        <div className="row">
          <button className="btn sm" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn sm aqua" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
