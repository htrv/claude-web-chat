import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import ChatPage from "./pages/ChatPage";
import AdminPage from "./pages/AdminPage";
import QueuePage from "./pages/QueuePage";
import { ChatProvider } from "./lib/ChatContext";
import { ErrorBoundary } from "./ErrorBoundary";

function isLoggedIn() {
  return !!localStorage.getItem("token");
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <ChatProvider>
              <Routes>
                <Route path="/" element={<ChatPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/queue" element={<QueuePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ChatProvider>
          </PrivateRoute>
        }
      />
    </Routes>
    </ErrorBoundary>
  );
}
