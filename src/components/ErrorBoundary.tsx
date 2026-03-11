import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Label shown in the fallback UI — e.g. "Query Log tab" */
  label?: string
  /** Custom fallback node. If not provided, renders the default error card. */
  fallback?: ReactNode
  /** Called when an error is caught, e.g. for logging */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * React error boundary — catches JS errors thrown during render of descendant
 * components and shows a fallback UI instead of crashing the entire app.
 *
 * Usage:
 *   <ErrorBoundary label="Query Log tab">
 *     <QueryLogViewer ... />
 *   </ErrorBoundary>
 *
 * Because tab content is conditionally rendered (unmounted when switching tabs),
 * navigating away and back automatically resets the boundary's error state.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? 'unknown', error, info)
    this.props.onError?.(error, info)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div className="flex items-start justify-center p-8">
        <div className="max-w-lg w-full bg-ch-surface border border-red-500/30 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-ch-text">
              {this.props.label ? `${this.props.label} crashed` : 'Something went wrong'}
            </span>
          </div>
          <p className="text-xs text-ch-muted mb-4 leading-relaxed">
            A JavaScript error occurred in this view. The rest of the app is unaffected.
            You can try resetting this panel or switching to another tab.
          </p>
          {this.state.error && (
            <pre className="text-[10px] text-red-400/80 bg-ch-bg rounded-lg p-3 overflow-auto max-h-32 mb-4 font-mono leading-relaxed">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.reset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ch-accent/10 border border-ch-accent/20 text-ch-accent text-xs font-medium hover:bg-ch-accent/20 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
        </div>
      </div>
    )
  }
}
