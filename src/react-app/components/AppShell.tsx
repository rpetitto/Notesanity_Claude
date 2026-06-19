import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Home, Calendar, Archive, Settings, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import Logo from './Logo'
import { useAuth } from '../lib/auth'
import { cn, initials } from '../lib/utils'

interface NavItem { to: string; icon: ReactNode; label: string; external?: boolean }

const NAV: NavItem[] = [
  { to: '/notebooks', icon: <Home className="w-5 h-5" />, label: 'Home' },
  { to: 'https://classroom.google.com/u/0/h', icon: <Calendar className="w-5 h-5" />, label: 'Calendar', external: true },
  { to: '/notebooks', icon: <Archive className="w-5 h-5" />, label: 'Archived' },
  { to: '/settings', icon: <Settings className="w-5 h-5" />, label: 'Settings' },
]

const COLLAPSE_KEY = 'notesanity:sidebarCollapsed'

export default function AppShell({ children, topBar }: { children: ReactNode; topBar?: ReactNode }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch {} }, [collapsed])

  const wide = collapsed ? 'w-14' : 'w-60'

  return (
    <div className="h-screen flex bg-[#F8F9FA] text-[#202124]">
      <aside className={cn('hidden md:flex flex-col bg-white border-r border-[#E8EAED] transition-[width] duration-150', wide)}>
        <div className={cn('flex items-center h-16 border-b border-[#E8EAED]', collapsed ? 'justify-center' : 'justify-between px-3')}>
          {!collapsed && (
            <button
              type="button"
              onClick={() => navigate('/notebooks')}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[#F8F9FA]"
            >
              <Logo size={26} />
              <span className="font-semibold text-base">Notesanity</span>
            </button>
          )}
          <button
            type="button"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((v) => !v)}
            className="p-2 rounded-full text-[#5F6368] hover:bg-[#F1F3F4]"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map((item) =>
            item.external ? (
              <a
                key={item.label}
                href={item.to}
                target="_blank"
                rel="noreferrer"
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center h-10 text-sm text-[#5F6368] hover:bg-[#F1F3F4]',
                  collapsed ? 'justify-center px-0' : 'gap-3 px-5',
                )}
              >
                {item.icon}{!collapsed && <span>{item.label}</span>}
              </a>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                end
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center h-10 text-sm',
                    collapsed ? 'justify-center px-0' : 'gap-3 px-5',
                    isActive ? 'bg-[#E8F0FE] text-[#1A73E8] font-medium' : 'text-[#5F6368] hover:bg-[#F1F3F4]',
                  )
                }
              >
                {item.icon}{!collapsed && <span>{item.label}</span>}
              </NavLink>
            ),
          )}
        </nav>
        <div className={cn('border-t border-[#E8EAED] p-3 flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <Avatar name={user?.name ?? ''} picture={user?.picture} />
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user?.name}</div>
                <div className="text-xs text-[#5F6368] truncate">{user?.email}</div>
              </div>
              <button
                type="button"
                title="Sign out"
                onClick={() => { signOut(); navigate('/') }}
                className="p-2 rounded-full hover:bg-[#F1F3F4] text-[#5F6368]"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {topBar && <header className="bg-white border-b border-[#E8EAED]">{topBar}</header>}
        <main className="flex-1 min-h-0 overflow-auto">{children}</main>
      </div>
      <FlingBadge />
    </div>
  )
}

export function FlingBadge() {
  return (
    <a
      href="https://flingit.io"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-3 left-3 z-50 flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-[#E8EAED] rounded-full shadow-sm text-xs text-[#5F6368] hover:text-[#202124] hover:border-[#DADCE0]"
    >
      <span className="inline-block w-3 h-3 rounded-sm bg-[#1A73E8]" />
      Made with Fling
    </a>
  )
}

export function Avatar({ name, picture, size = 32 }: { name: string; picture?: string; size?: number }) {
  if (picture) {
    return (
      <img
        src={picture}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    )
  }
  return (
    <div
      className="rounded-full bg-[#1A73E8] text-white flex items-center justify-center font-medium shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name || '?')}
    </div>
  )
}
