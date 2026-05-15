import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Home, Calendar, Archive, Settings, LogOut } from 'lucide-react'
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

export default function AppShell({ children, topBar }: { children: ReactNode; topBar?: ReactNode }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex bg-[#F8F9FA] text-[#202124]">
      <aside className="hidden md:flex flex-col w-60 bg-white border-r border-[#E8EAED]">
        <button
          type="button"
          onClick={() => navigate('/notebooks')}
          className="flex items-center gap-2 px-5 h-16 border-b border-[#E8EAED] hover:bg-[#F8F9FA]"
        >
          <Logo size={28} />
          <span className="font-semibold text-lg">Notesanity</span>
        </button>
        <nav className="flex-1 py-3">
          {NAV.map((item) =>
            item.external ? (
              <a
                key={item.label}
                href={item.to}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-5 h-10 text-sm text-[#5F6368] hover:bg-[#F1F3F4]"
              >
                {item.icon}<span>{item.label}</span>
              </a>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                end
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-5 h-10 text-sm',
                    isActive ? 'bg-[#E8F0FE] text-[#1A73E8] font-medium' : 'text-[#5F6368] hover:bg-[#F1F3F4]',
                  )
                }
              >
                {item.icon}<span>{item.label}</span>
              </NavLink>
            ),
          )}
        </nav>
        <div className="border-t border-[#E8EAED] p-3 flex items-center gap-3">
          <Avatar name={user?.name ?? ''} picture={user?.picture} />
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
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {topBar && <header className="bg-white border-b border-[#E8EAED]">{topBar}</header>}
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
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
      className="rounded-full bg-[#1A73E8] text-white flex items-center justify-center font-medium"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name || '?')}
    </div>
  )
}
