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
import SharePlanPage from './pages/SharePlanPage'
import ShareRecipePage from './pages/ShareRecipePage'
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
    <Routes>
      {/* ── Public share pages — no sidebar, no auth ── */}
      <Route path="/share/plan/:token"   element={<SharePlanPage />} />
      <Route path="/share/recipe/:token" element={<ShareRecipePage />} />

      {/* ── Main app — with sidebar layout ── */}
      <Route path="*" element={
        <Layout>
          <SignedIn><AuthSync /></SignedIn>
          <Routes>
            <Route path="/" element={<Navigate to="/discover" replace />} />
            <Route path="/discover"   element={<Discover />} />
            <Route path="/my-recipes" element={<ProtectedRoute><MyRecipes /></ProtectedRoute>} />
            <Route path="/planner"    element={<ProtectedRoute><Planner /></ProtectedRoute>} />
            <Route path="/shopping"   element={<ProtectedRoute><Shopping /></ProtectedRoute>} />
            <Route path="/profile"    element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/sources"    element={<ProtectedRoute><Sources /></ProtectedRoute>} />
            <Route path="*"           element={<Navigate to="/discover" replace />} />
          </Routes>
        </Layout>
      } />
    </Routes>
  )
}
