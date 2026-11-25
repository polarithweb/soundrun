import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info.componentStack);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-dvh w-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-slate-900 p-6 text-center shadow-2xl">
            <h1 className="font-display text-2xl font-bold text-white">
              Something went wrong
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-5 min-h-[44px] w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              Return to Game
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
