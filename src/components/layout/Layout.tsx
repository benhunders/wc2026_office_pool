import type { Session } from '@supabase/supabase-js'
import { NavLink } from 'react-router-dom'
import {
  Ship, MessageSquare, Upload, Download,
  Database, ScrollText, LogOut
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/rates',   label: 'Rates',       icon: Ship },
  { to: '/update',  label: 'NL Update',   icon: MessageSquare },
  { to: '/import',  label: 'Import',      icon: Upload },
  { to: '/export',  label: 'Export',      icon: Download },
  { to: '/master',  label: 'Master Data', icon: Database },
  { to: '/audit',   label: 'Audit Log',   icon: ScrollText },
]

interface Props {
  session: Session
  children: React.ReactNode
}

export default function Layout({ session, children }: Props) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-brand-500 text-white shadow-md">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-4">
          <Ship className="w-6 h-6 flex-shrink-0" />
          <div className="flex-1">
            <h1 className="font-bold text-base leading-tight">Tender Rate Tool</h1>
            <p className="text-xs opacity-70">Freight rate management &amp; SAP TM export</p>
          </div>
          <div className="flex items-center gap-3 text-sm opacity-80">
            <span>{session.user.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="flex items-center gap-1 hover:opacity-100 transition-opacity"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <nav className="max-w-screen-xl mx-auto px-6 flex overflow-x-auto border-t border-brand-400">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold whitespace-nowrap',
                'border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-white text-white'
                  : 'border-transparent text-white/60 hover:text-white/90'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-6">
        {children}
      </main>
    </div>
  )
}
