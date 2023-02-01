import { render } from '@testing-library/react'
import { ErrorBoundaryWrapper } from '../../components/ErrorBoundary'

test('renders Error Boundary Page', () => {
    render(
            <ErrorBoundaryWrapper />
    )
})
