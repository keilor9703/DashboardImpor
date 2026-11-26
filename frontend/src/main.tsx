import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, msalInstance, useAuth } from "./auth/AuthProvider";
import { ThemeProvider } from "./lib/theme";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Shipments } from "./pages/Shipments";
import { DataSource } from "./pages/DataSource";
import { Login } from "./pages/Login";
import "./styles/app.css";

function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="empty" style={{ paddingTop: 120 }}>Verificando sesión…</div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="embarques" element={<Shipments />} />
        <Route path="fuente" element={<DataSource />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

async function start() {
  if (msalInstance) {
    await msalInstance.initialize();
    const res = await msalInstance.handleRedirectPromise();
    const account = res?.account ?? msalInstance.getAllAccounts()[0];
    if (account) msalInstance.setActiveAccount(account);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
start();
