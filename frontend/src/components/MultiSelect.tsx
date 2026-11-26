/** Lista desplegable con casillas para elegir varias opciones a la vez. */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

interface Props {
  label: string;
  opciones: string[];
  seleccion: string[];
  onChange: (sel: string[]) => void;
  /** accesos rápidos, p. ej. «Solo en tránsito» */
  atajos?: { label: string; valores: string[] }[];
}

export function MultiSelect({ label, opciones, seleccion, onChange, atajos = [] }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const set = new Set(seleccion);

  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [open]);

  const toggle = (o: string) => onChange(opciones.filter((x) => (x === o ? !set.has(x) : set.has(x))));
  const resumen = seleccion.length === 0 ? "Ninguno"
    : seleccion.length === opciones.length ? "Todos"
    : seleccion.length === 1 ? seleccion[0]
    : `${seleccion.length} seleccionados`;

  return (
    <div className="field multiselect" ref={ref}>
      <span>{label}</span>
      <button type="button" className="select ms-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ms-value">{resumen}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="ms-panel" role="listbox" aria-multiselectable="true" aria-label={label}>
          {atajos.length > 0 && (
            <div className="ms-quick">
              {atajos.map((a) => <button type="button" key={a.label} onClick={() => onChange(a.valores)}>{a.label}</button>)}
            </div>
          )}
          {opciones.map((o) => (
            <label key={o} className={`ms-option ${set.has(o) ? "on" : ""}`} role="option" aria-selected={set.has(o)}>
              <input type="checkbox" checked={set.has(o)} onChange={() => toggle(o)} />
              <span className="ms-box">{set.has(o) && <Check size={12} strokeWidth={3} />}</span>
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
