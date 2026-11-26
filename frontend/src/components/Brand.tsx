/**
 * Identidad del producto. SIACOMEX es el dueño del producto, el cliente es quien lo usa
 * y Techstack Colombia S.A.S. es el desarrollador. Para otro cliente basta con cambiar
 * CLIENTE y su logo en /public/brand.
 */
export const PRODUCTO = {
  nombre: "SIACOMEX",
  app: "Torre de control logística",
  logo: "/brand/siacomex.png",
  logoOscuro: "/brand/siacomex-dark.png", // versión con «COMEX» en blanco para fondos oscuros
};
export const CLIENTE = { nombre: "Kimberly-Clark", logo: "/brand/kimberly-clark.png" };
export const DESARROLLADOR = "Techstack Colombia S.A.S.";

type Size = "sm" | "md" | "lg";

/** Logo dentro de una placa clara: legible sobre fondos oscuros y en modo oscuro. */
export function LogoPlate({ src, alt, size = "md", className = "" }: { src: string; alt: string; size?: Size; className?: string }) {
  return (
    <span className={`logo-plate ${size} ${className}`}>
      <img src={src} alt={alt} draggable={false} />
    </span>
  );
}

/** Logo de SIACOMEX. Sobre fondo oscuro usa la versión clara, sin placa. */
export function ProductLogo({ onDark = false, size = "md", className = "" }: { onDark?: boolean; size?: Size; className?: string }) {
  const alt = `${PRODUCTO.nombre} · Agencia de Aduanas Nivel 1`;
  if (onDark) {
    return <img className={`product-logo ${size} ${className}`} src={PRODUCTO.logoOscuro} alt={alt} draggable={false} />;
  }
  return <LogoPlate src={PRODUCTO.logo} alt={alt} size={size} className={className} />;
}

export function ClientLogo(props: { size?: Size; className?: string }) {
  return <LogoPlate src={CLIENTE.logo} alt={CLIENTE.nombre} {...props} />;
}

export function DevCredit({ className = "" }: { className?: string }) {
  return <span className={`dev-credit ${className}`}>Desarrollado por <b>{DESARROLLADOR}</b></span>;
}
