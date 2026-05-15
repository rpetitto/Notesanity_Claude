import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell, { Avatar } from '../components/AppShell'
import { SCOPES, useAuth } from '../lib/auth'

type Section = 'account' | 'appearance' | 'permissions' | 'about'

export default function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [section, setSection] = useState<Section>('account')

  const topBar = (
    <div className="flex items-center px-6 h-16">
      <h1 className="text-xl font-medium">Settings</h1>
    </div>
  )

  return (
    <AppShell topBar={topBar}>
      <div className="px-6 py-6 max-w-5xl mx-auto grid grid-cols-[200px_1fr] gap-6">
        <nav className="space-y-1 text-sm">
          {(['account', 'appearance', 'permissions', 'about'] as Section[]).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={
                'w-full text-left px-3 py-2 rounded-lg capitalize ' +
                (section === s ? 'bg-[#E8F0FE] text-[#1A73E8] font-medium' : 'text-[#5F6368] hover:bg-[#F1F3F4]')
              }
            >
              {s}
            </button>
          ))}
        </nav>

        <div className="bg-white rounded-xl border border-[#E8EAED] p-6">
          {section === 'account' && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Account</h2>
              <div className="flex items-center gap-4">
                <Avatar name={user?.name ?? ''} picture={user?.picture} size={56} />
                <div>
                  <div className="font-medium">{user?.name}</div>
                  <div className="text-sm text-[#5F6368]">{user?.email}</div>
                </div>
              </div>
              <button
                onClick={() => { signOut(); navigate('/') }}
                className="h-9 px-4 rounded-full border border-[#DADCE0] text-sm hover:bg-[#F1F3F4]"
              >
                Sign out
              </button>
            </div>
          )}

          {section === 'appearance' && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Appearance</h2>
              <p className="text-sm text-[#5F6368]">Theme and color preferences will live here.</p>
            </div>
          )}

          {section === 'permissions' && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Permissions</h2>
              <p className="text-sm text-[#5F6368]">Granted Google scopes:</p>
              <ul className="text-xs text-[#5F6368] space-y-1 font-mono">
                {SCOPES.split(' ').map((s) => <li key={s} className="break-all">{s}</li>)}
              </ul>
              <button
                onClick={() => { signOut(); navigate('/') }}
                className="h-9 px-4 rounded-full border border-[#D93025] text-[#D93025] text-sm hover:bg-[#FCE8E6]"
              >
                Revoke and sign out
              </button>
            </div>
          )}

          {section === 'about' && (
            <div className="space-y-3">
              <h2 className="text-lg font-medium">About Notesanity</h2>
              <p className="text-sm text-[#5F6368]">
                Notesanity turns each Google Classroom class into a navigable digital notebook. Pages are
                Google Docs and tabs are subfolders inside your class's Drive folder — no parallel storage.
              </p>
              <div className="text-xs text-[#5F6368]">Version 0.1.0</div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
