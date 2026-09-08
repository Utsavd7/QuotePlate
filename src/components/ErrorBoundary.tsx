'use client';
import React from 'react';

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        if (process.env.NODE_ENV !== 'production') {
            console.error('QuotePlate render error', error, info.componentStack);
        }
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;
            const detail =
                process.env.NODE_ENV !== 'production' && this.state.error?.message
                    ? this.state.error.message
                    : 'Please try again. Your saved work is still safe.';

            return (
                <div
                    aria-labelledby="error-boundary-heading"
                    aria-live="assertive"
                    className="min-h-screen bg-[var(--workspace-canvas)] flex items-center justify-center p-8 text-[var(--workspace-ink)]"
                    role="alert"
                >
                    <div className="max-w-md w-full text-center space-y-5">
                        <div className="w-12 h-12 rounded-xl bg-[var(--workspace-selected)] border border-[var(--workspace-line)] flex items-center justify-center mx-auto text-xl" aria-hidden="true">
                            Q
                        </div>
                        <div>
                                <h2 id="error-boundary-heading" className="text-lg font-bold text-[var(--workspace-ink)] mb-2">Something went wrong</h2>
                                <p className="text-sm text-[var(--workspace-muted)] leading-relaxed">
                                    {detail}
                            </p>
                        </div>
                        <div className="flex gap-3 justify-center">
                            <button
                                className="min-h-11 px-4 py-2 rounded-lg bg-[var(--workspace-accent)] border border-[var(--workspace-accent)] text-sm font-semibold text-white hover:bg-[var(--workspace-accent-hover)] transition-colors"
                                onClick={() => this.setState({ hasError: false, error: undefined })}
                                type="button"
                            >
                                Try again
                            </button>
                            <button
                                className="min-h-11 px-4 py-2 rounded-lg bg-transparent border border-[var(--workspace-line)] text-sm font-semibold text-[var(--workspace-muted)] hover:text-[var(--workspace-ink)] transition-colors"
                                onClick={() => window.location.reload()}
                                type="button"
                            >
                                Reload page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
