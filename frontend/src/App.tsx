import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import Instructions from './pages/Instructions'
import CandidateRoom from './pages/CandidateRoom'
import ProctorRoom from './pages/ProctorRoom'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/candidate/instructions" element={<Instructions />} />
      <Route path="/candidate/room" element={<CandidateRoom />} />
      <Route path="/proctor/room" element={<ProctorRoom />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
