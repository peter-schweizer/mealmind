import { Routes, Route, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn, useAuth } from '@clerk/clerk-react'
import { useEffect } from 'react'
import Layout from './components/layout/Layout'
import Discover from './pages/Discover'
import MyRecipes from './pages/MyRecipes'
import Planner from './pages/Planner'
import Shopping from './pages/Shopping'
import Profile from './pages/Profile'
import Sources from './pages/Sources'
import { setTokenGetter } from './api'

// Syncs the Clerk session token into the Axios instance
function AuthSync() {
  const { getToken } = useAuth()
  useEffect(() => {
    setTokenGetter(() => getToken())
  }, [getToken])
  return null
}

export default function App() {
  return (
    <>
      <SignedIn>
        <AuthSync />
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/discover" replace />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/my-recipes" element={<MyRecipes />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="*" element={<Navigate to="/discover" replace />} />
          </Routes>
        </Layout>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}
