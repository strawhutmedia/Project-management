import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ProjectPage from './pages/ProjectPage'
import SongPage from './pages/SongPage'
import StripboardPage from './pages/StripboardPage'
import TranscriptPage from './pages/TranscriptPage'
import TranscriptsLibraryPage from './pages/TranscriptsLibraryPage'
import SchedulerPage from './pages/SchedulerPage'
import CarouselPreviewPage from './pages/CarouselPreviewPage'
import Login from './pages/Login'
import Verify from './pages/Verify'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import { AuthProvider, useAuth } from './auth'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted text-sm">Loading…</div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/verify" element={<Verify />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="projects/:projectId/stripboard" element={<StripboardPage />} />
          <Route path="projects/:projectId/transcripts" element={<TranscriptsLibraryPage />} />
          <Route path="projects/:projectId/transcripts/:transcriptId" element={<TranscriptPage />} />
          <Route path="projects/:projectId/songs/:songId" element={<SongPage />} />
          <Route path="scheduler" element={<SchedulerPage />} />
          <Route path="carousel-preview" element={<CarouselPreviewPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
