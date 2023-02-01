import 'reflect-metadata'
import './App.scss'
import React, { ReactElement, useState } from 'react'
import Link from 'next/link'

import { ErrorBoundaryWrapper } from './components/ErrorBoundary'
import { ServiceProvider } from './components/GlobalHooks'

import { DID } from './pages/DID'
import { ListRules } from './pages/rule/ListRules'
import { Rule } from './pages/rule/Rule'
import { RuleDef } from './pages/rule/RuleDef'
import { Search } from './components/Search'

import Home from './pages/Home'
import Login from './pages/Login'
import NotFound from './pages/NotFound'

export const StoreContext = React.createContext({})

const App = () => {
    const [store, updateStore] = useState({ displaySideBar: true } as any)
    // const navigate: NavigateFunction = useNavigate()

    const ProtectedRoute = ({ redirectPath = '/login', children = <></> }) => {
        if (
            !store?.account &&
            !sessionStorage.getItem('X-Rucio-Auth-Token') &&
            !sessionStorage.getItem('X-Rucio-Account')
        ) {
            // TODO: fix route redirect
            // return <Navigate to={redirectPath} replace />
        }
        return children
    }

    const protectedPathElementMap: { path: string; element: ReactElement }[] = [
        {
            path: '/home',
            element: <Home />,
        },
        {
            path: '/ruledef',
            element: <RuleDef />,
        },
        {
            path: '/r2d2',
            element: <ListRules />,
        },
        {
            path: '/did',
            element: <DID />,
        },
        {
            path: '/search',
            element: <Search />,
        },
        {
            path: '/rule',
            element: <Rule />,
        },
    ]

    const LoginComponent = () => (
        <ErrorBoundaryWrapper>
            <Login
                onLoginSuccess={(args: string) => {
                    updateStore({ account: args })
                    sessionStorage.setItem('X-Rucio-Account', args)
                    // TODO: fix route 
                    // navigate('/home')
                }}
                onLoginFailure={() => {
                    updateStore({ account: null })
                    sessionStorage.removeItem('X-Rucio-Account')
                    sessionStorage.removeItem('X-Rucio-Auth-Token')
                }}
            />
        </ErrorBoundaryWrapper>
    )

    return (
        <div className="App">
        </div>
        // <StoreContext.Provider value={{ store, updateStore }}>
        //     <ServiceProvider>
        //         <Routes>
        //             <Route index element={<LoginComponent />} />
        //             <Route path="/login" element={<LoginComponent />} />
        //             {protectedPathElementMap.map(
        //                 ({ path, element }: any, index: number) => (
        //                     <Route
        //                         key={index}
        //                         path={path}
        //                         element={
        //                             <ProtectedRoute>
        //                                 <ErrorBoundaryWrapper>
        //                                     {element}
        //                                 </ErrorBoundaryWrapper>
        //                             </ProtectedRoute>
        //                         }
        //                     />
        //                 ),
        //             )}
        //             <Route path="/*" element={<NotFound />} />
        //         </Routes>
        //     </ServiceProvider>
        // </StoreContext.Provider>
    )
}

export default App
