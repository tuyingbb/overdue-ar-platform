import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { ToastProvider, Spinner } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Cases from './pages/Cases';
import MyTasks from './pages/MyTasks';
import CaseDetail from './pages/CaseDetail';
import Dashboard from './pages/Dashboard';
import FlowConfig from './pages/FlowConfig';
import Mobile from './pages/Mobile';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="w-6 h-6" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Navigate to="/cases" replace />} />
          <Route path="cases" element={<Cases />} />
          <Route path="tasks" element={<MyTasks />} />
          <Route path="case/:caseNo" element={<CaseDetail />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="flow" element={<FlowConfig />} />
          <Route path="m" element={<Mobile />} />
        </Route>
        <Route path="*" element={<Navigate to="/cases" replace />} />
      </Routes>
    </ToastProvider>
  );
}
