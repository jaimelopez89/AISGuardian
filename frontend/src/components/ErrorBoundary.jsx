import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Error boundary to catch and recover from React errors.
 * Particularly useful for catching deck.gl/mapbox rendering errors.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorCount: 0 }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    // Track error count for auto-recovery
    this.setState(prev => ({ errorCount: prev.errorCount + 1 }))
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      // If we've had too many errors, suggest a full reload
      const tooManyErrors = this.state.errorCount > 3

      return (
        <div className="h-full flex items-center justify-center bg-maritime-950">
          <div className="glass-panel p-8 max-w-md text-center">
            <AlertTriangle className="w-12 h-12 text-alert-high mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">
              {tooManyErrors ? 'Persistent Error' : 'Display Error'}
            </h2>
            <p className="text-maritime-300 mb-4">
              {tooManyErrors
                ? 'The map has encountered repeated errors. A page reload is recommended.'
                : 'The map encountered a rendering error. Click retry to recover.'}
            </p>

            {this.state.error && (
              <div className="bg-maritime-800 rounded p-3 text-left text-xs mb-4 max-h-24 overflow-auto">
                <code className="text-maritime-400">
                  {this.state.error.toString()}
                </code>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              {!tooManyErrors && (
                <button
                  onClick={this.handleRetry}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-maritime-700 text-white rounded hover:bg-maritime-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
