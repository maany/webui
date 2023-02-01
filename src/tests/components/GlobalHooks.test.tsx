import { render } from '@testing-library/react'
import { ServiceProvider } from '../../components/GlobalHooks'

window.scrollTo = jest.fn()

test('renders Global Hooks wrapper', () => {
    render(
            <ServiceProvider />
    )
})
