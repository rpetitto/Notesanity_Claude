import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Roster from './pages/Roster'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/roster" element={<Roster />} />
      <Route path="/roster/:courseId" element={<Roster />} />
    </Routes>
  )
}

export default App
