import { render } from '@testing-library/react'
import App from '../App'

window.scrollTo = jest.fn()

test('renders react app', () => {
    render(
            <App />
    )
})
