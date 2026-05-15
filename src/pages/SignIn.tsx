import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { HAS_REAL_AUTH, useAuth } from '../lib/auth'
import Logo from '../components/Logo'

export default function SignIn() {
  const { user, signIn, isReady } = useAuth()
  const navigate = useNavigate()

  if (user) {
    navigate('/notebooks', { replace: true })
    return null
  }

  const onGoogle = async () => {
    try { await signIn(); navigate('/notebooks') }
    catch (e: any) { toast.error(e?.message ?? 'Sign-in failed') }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-elevation-2 p-10 text-center">
          <div className="flex justify-center mb-6"><Logo size={56} /></div>
          <h1 className="text-3xl font-semibold text-[#202124]">Notesanity</h1>
          <p className="mt-2 text-[#5F6368]">Your class notes, exactly where they belong.</p>

          <button
            type="button"
            onClick={onGoogle}
            disabled={!isReady || !HAS_REAL_AUTH}
            className="mt-8 w-full inline-flex items-center justify-center gap-3 h-12 rounded-full
                       bg-[#1A73E8] text-white font-medium hover:bg-[#1765c1]
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <GoogleG />
            Sign in with Google Classroom
          </button>

          {!HAS_REAL_AUTH && (
            <p className="mt-4 text-xs text-[#5F6368] leading-relaxed">
              Set <code className="font-mono bg-[#F1F3F4] px-1 py-0.5 rounded">VITE_GOOGLE_CLIENT_ID</code> in a
              <code className="font-mono bg-[#F1F3F4] px-1 py-0.5 rounded ml-1">.env</code> file
              with your Google OAuth client ID to enable sign-in.
            </p>
          )}
        </div>
      </main>
      <footer className="py-6 text-center text-xs text-[#5F6368]">
        <a href="#" className="hover:text-[#202124]">Privacy</a>
        <span className="mx-3">·</span>
        <a href="#" className="hover:text-[#202124]">Terms</a>
      </footer>
    </div>
  )
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="w-5 h-5 bg-white rounded-full p-[2px]">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 7 29.3 5 24 5c-7.5 0-13.9 4.2-17.7 9.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.1C29.2 35.2 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.9 39.7 16.4 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2 3.8-3.8 5.1l6.2 5.1C40.9 35.7 44 30.3 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  )
}
