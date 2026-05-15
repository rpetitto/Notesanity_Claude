import { Routes, Route, Navigate } from 'react-router-dom'
import SignIn from './pages/SignIn'
import Notebooks from './pages/Notebooks'
import Notebook from './pages/Notebook'
import StudentRoster from './pages/StudentRoster'
import Settings from './pages/Settings'
import { RequireAuth } from './lib/auth'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SignIn />} />
      <Route element={<RequireAuth />}>
        <Route path="/notebooks" element={<Notebooks />} />
        <Route path="/notebooks/:classId" element={<Notebook />} />
        <Route path="/notebooks/:classId/students" element={<StudentRoster />} />
        <Route path="/notebooks/:classId/students/:studentId" element={<Notebook browseMode />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
