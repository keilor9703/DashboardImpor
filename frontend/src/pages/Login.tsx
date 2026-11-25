import { useState } from "react";
import { Lock, Ship } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function Login() {
  const { login, mode } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await login();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="brand-logo"><Ship size={20} /></div>
          <b style={{ fontSize: 15 }}>ComEx Analytics</b>
        </div>
        <h2>Su operación de comercio exterior, en un solo tablero.</h2>
        <p>Indicadores de importación y exportación, tiempos de nacionalización, tributos y alertas operativas, conectados a su información en SharePoint.</p>
        <div className="login-stats">
          <div><b>KPIs</b><span>en tiempo real</span></div>
          <div><b>SLA</b><span>por aduana</span></div>
          <div><b>Alertas</b><span>operativas</span></div>
        </div>
      </div>
      <div className="login-form">
        <div className="login-box">
          {mode === "demo" && <span className="demo-tag">Modo demostración</span>}
          <h1>Iniciar sesión</h1>
          <p>Ingrese con su cuenta corporativa de Microsoft 365.</p>
          <button className="ms-btn" onClick={go} disabled={busy}>
            <MicrosoftLogo />
            {busy ? "Conectando…" : mode === "demo" ? "Entrar en modo demo" : "Continuar con Microsoft"}
          </button>
          {err && <p className="error-box" style={{ padding: "12px 0" }}>{err}</p>}
          <div className="login-note">
            <Lock size={14} style={{ flex: "none", marginTop: 2 }} />
            <span>
              {mode === "demo"
                ? "Microsoft Entra ID aún no está configurado. Defina VITE_AZURE_CLIENT_ID para activar el inicio de sesión corporativo."
                : "El acceso está restringido a usuarios autorizados de la organización. No almacenamos su contraseña."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
