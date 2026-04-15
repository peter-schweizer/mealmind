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

// Syncs the Clerk session token into the Axios instance (only when logged in)
function AuthSync() {
  const { getToken } = useAuth()
  useEffect(() => {
    setTokenGetter(() => getToken())
  }, [getToken])
  return null
}

// Wraps a route so unauthenticated users are redirected to sign-in
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut><RedirectToSignIn /></SignedOut>
    </>
  )
}

export default function App() {
  return (
    <Layout>
      <SignedIn>
        <AuthSync />
      </SignedIn>
      <Routes>
        <Route path="/" element={<Navigate to="/discover" replace />} />

        {/* Public — visible without login */}
        <Route path="/discover" element={<Discover />} />

        {/* Protected — require login */}
        <Route path="/my-recipes" element={<ProtectedRoute><MyRecipes /></ProtectedRoute>} />
        <Route path="/planner"    element={<ProtectedRoute><Planner /></ProtectedRoute>} />
        <Route path="/shopping"   element={<ProtectedRoute><Shopping /></ProtectedRoute>} />
        <Route path="/profile"    element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/sources"    element={<ProtectedRoute><Sources /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/discover" replace />} />
      </Routes>
    </Layout>
  )
}
