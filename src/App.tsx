import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import RatesPage from '@/pages/RatesPage'
import RateDetailPage from '@/pages/RateDetailPage'
import NlUpdatePage from '@/pages/NlUpdatePage'
import ImportPage from '@/pages/ImportPage'
import ExportPage from '@/pages/ExportPage'
import MasterDataPage from '@/pages/MasterDataPage'
import AuditLogPage from '@/pages/AuditLogPage'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Loading…</div>
  }

  if (!session) {
    return <LoginPage />
  }

  return (
    <BrowserRouter>
      <Layout session={session}>
        <Routes>
          <Route path="/" element={<Navigate to="/rates" replace />} />
          <Route path="/rates" element={<RatesPage />} />
          <Route path="/rates/:versionId" element={<RateDetailPage />} />
          <Route path="/update" element={<NlUpdatePage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/master" element={<MasterDataPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
