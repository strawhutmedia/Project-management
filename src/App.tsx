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
import OutreachDomainsPage from './pages/OutreachDomainsPage'
import OutreachHubPage from './pages/OutreachHubPage'
import OutreachShowPage from './pages/OutreachShowPage'
import Login from './pages/Login'
import Verify from './pages/Verify'
import PrompterPage from './pages/PrompterPage'
import RemotePage from './pages/RemotePage'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import InvoicingPage from './pages/InvoicingPage'
import VendorIntakePage from './pages/VendorIntakePage'
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
        {/* Public vendor W9 intake — token-gated, no login required. */}
        <Route path="/vendor/:token" element={<VendorIntakePage />} />
        {/* Teleprompter — standalone full-page (no app chrome), but behind
            login so its sessions can be shared across the podcast team. */}
        <Route
          path="/prompter"
          element={
            <Protected>
              <PrompterPage />
            </Protected>
          }
        />
        {/* Phone-as-remote — public, no login, no app. /r to type a code,
            or /r/CODE from the QR the prompter shows. */}
        <Route path="/r" element={<RemotePage />} />
        <Route path="/r/:code" element={<RemotePage />} />
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
          <Route path="invoicing" element={<InvoicingPage />} />
          <Route path="carousel-preview" element={<CarouselPreviewPage />} />
          <Route path="admin/outreach" element={<OutreachHubPage />} />
          <Route path="admin/outreach/shows/:projectId" element={<OutreachShowPage />} />
          <Route path="admin/outreach/domains" element={<OutreachDomainsPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
