import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-8 selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black">
          <div className="max-w-md w-full bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm">
            <h1 className="text-xl font-bold uppercase tracking-widest text-zinc-900 dark:text-white mb-4">Something went wrong</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6 font-mono break-words">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-xs uppercase tracking-widest font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
              onClick={() => window.location.reload()}
            >
              Reload application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
