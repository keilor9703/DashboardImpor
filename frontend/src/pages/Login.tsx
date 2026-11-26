import { useState } from "react";
import { Lock } from "lucide-react";
import { CLIENTE, ClientLogo, DevCredit, PRODUCTO, ProductLogo } from "../components/Brand";
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await login(username, password);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <ProductLogo onDark size="lg" />
        <h2>Su operación logística de comercio exterior, en un solo tablero.</h2>
        <p>Seguimiento de embarques, lead time por proceso frente a la meta, nacionalización y alertas operativas, conectados a su información en SharePoint.</p>
        <div className="login-stats">
          <div><b>PDT</b><span>por proceso vs. meta</span></div>
          <div><b>Embarques</b><span>de punta a punta</span></div>
          <div><b>Alertas</b><span>operativas</span></div>
        </div>
        <div className="login-client">
          <span>Cliente:</span>
          <ClientLogo size="md" />
        </div>
        <div className="login-foot">{PRODUCTO.nombre} · {PRODUCTO.app} · <DevCredit /></div>
      </div>
      <div className="login-form">
        <div className="login-box">
          <div className="login-brands" aria-label={`${PRODUCTO.nombre} para ${CLIENTE.nombre}`}>
            <img src={PRODUCTO.logo} alt={PRODUCTO.nombre} className="lb-product" />
            <span className="lb-sep" aria-hidden="true" />
            <img src={CLIENTE.logo} alt={CLIENTE.nombre} className="lb-client" />
          </div>
          {mode === "demo" && <span className="demo-tag">Modo demostración</span>}
          <h1>Iniciar sesión</h1>
          {mode === "password" ? (
            <form className="login-fields" onSubmit={(e) => { e.preventDefault(); void go(); }}>
              <p>Ingrese con el usuario asignado por el administrador.</p>
              <label className="field"><span>Usuario</span>
                <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
              </label>
              <label className="field"><span>Contraseña</span>
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <button className="btn primary login-submit" type="submit" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button>
              {err && <p className="error-box" style={{ padding: "4px 0", textAlign: "left" }}>{err}</p>}
            </form>
          ) : (<>
          <p>Ingrese con su cuenta corporativa de Microsoft 365.</p>
          <button className="ms-btn" onClick={go} disabled={busy}>
            <MicrosoftLogo />
            {busy ? "Conectando…" : mode === "demo" ? "Entrar en modo demo" : "Continuar con Microsoft"}
          </button>
          {err && <p className="error-box" style={{ padding: "12px 0" }}>{err}</p>}
          </>)}
          <div className="login-note">
            <Lock size={14} style={{ flex: "none", marginTop: 2 }} />
            <span>
              {mode === "demo"
                ? "Microsoft Entra ID aún no está configurado. Defina VITE_AZURE_CLIENT_ID para activar el inicio de sesión corporativo."
                : mode === "password"
                ? "Acceso restringido. La sesión se cierra automáticamente después de 12 horas."
                : "El acceso está restringido a usuarios autorizados de la organización. No almacenamos su contraseña."}
            </span>
          </div>
          <DevCredit className="login-credit-mobile" />
        </div>
      </div>
    </div>
  );
}
