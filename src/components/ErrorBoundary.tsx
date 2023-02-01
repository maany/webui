import { ErrorBoundary } from 'react-error-boundary'
import { Button } from '../stories/Button/Button'

export function ErrorFallback({ error, resetErrorBoundary }: any) {
    return (
        <div className="m-l-20 m-t-20">
            <p className="m-b-20">Something went wrong:</p>
            <pre className="m-b-20">{error?.message}</pre>
            <Button
                kind="secondary"
                type="reset"
                show="danger"
                onClick={resetErrorBoundary}
                label="Try again"
                size="large"
            />
        </div>
    )
}

export const ErrorHandler = (
    error: Error,
    info: { componentStack: string },
) => {
    console.error('Logging anomaly into monitoring service', error)
}

export const ErrorBoundaryWrapper = ({ children }: any) => {
    return (
        <ErrorBoundary
            FallbackComponent={ErrorFallback}
            onError={ErrorHandler}
            onReset={() => {
                // TODO: Redirect to home page
            }}
        >
            {children}
        </ErrorBoundary>
    )
}
