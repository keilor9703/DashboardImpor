"""Generador de datos simulados con la misma forma que la hoja consolidada del Excel.

Sirve para construir y probar el dashboard sin acceso al SharePoint de la empresa.
Los datos son ficticios pero realistas para una operación de comercio exterior en
Colombia (DO, aduanas, TRM, arancel, IVA, tiempos de nacionalización).
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd

CLIENTES = [
    ("Andina Industrial S.A.S.", "900.123.456-1", 1.6),
    ("Agroexport del Valle S.A.", "900.234.567-2", 1.3),
    ("Tecnopartes Colombia S.A.S.", "900.345.678-3", 1.2),
    ("Químicos del Caribe Ltda.", "800.456.789-4", 1.0),
    ("Textiles Medellín S.A.S.", "900.567.890-5", 0.9),
    ("Flores de la Sabana C.I.", "860.678.901-6", 0.9),
    ("Café Origen Export S.A.S.", "900.789.012-7", 0.8),
    ("Distribuidora Pacífico S.A.", "890.890.123-8", 0.7),
    ("Electro Hogar Mayorista S.A.S.", "901.901.234-9", 0.7),
    ("Plásticos Bolívar S.A.", "800.012.345-0", 0.6),
    ("Maquinaria Pesada del Norte S.A.S.", "901.111.222-3", 0.5),
    ("Farma Insumos Andinos S.A.S.", "901.222.333-4", 0.5),
    ("Autopartes Santander Ltda.", "804.333.444-5", 0.4),
    ("Alimentos La Pradera S.A.", "860.444.555-6", 0.4),
]
ADUANAS = {
    "Cartagena": ("Marítimo", 0.30),
    "Buenaventura": ("Marítimo", 0.22),
    "Bogotá - El Dorado": ("Aéreo", 0.18),
    "Barranquilla": ("Marítimo", 0.10),
    "Santa Marta": ("Marítimo", 0.07),
    "Medellín - JMC": ("Aéreo", 0.06),
    "Cúcuta": ("Terrestre", 0.04),
    "Ipiales": ("Terrestre", 0.03),
}
PAISES_IMPO = ["China", "Estados Unidos", "México", "Alemania", "Brasil", "España", "India", "Corea del Sur"]
PESOS_IMPO = [0.34, 0.24, 0.10, 0.08, 0.08, 0.06, 0.05, 0.05]
PAISES_EXPO = ["Estados Unidos", "Ecuador", "Países Bajos", "Perú", "México", "Panamá", "España", "Chile"]
PESOS_EXPO = [0.38, 0.13, 0.12, 0.10, 0.09, 0.07, 0.06, 0.05]
CAT_IMPO = {"Maquinaria": 0.0, "Electrónica": 0.05, "Químicos": 0.05, "Autopartes": 0.10, "Textiles": 0.15, "Plásticos": 0.10, "Alimentos": 0.15}
CAT_EXPO = ["Café", "Flores", "Alimentos", "Textiles", "Químicos", "Plásticos"]
EJECUTIVOS = ["Laura Gómez", "Andrés Rojas", "Camila Herrera", "Julián Martínez", "Valentina Ríos"]


def generate(n: int = 4200, months: int = 30, seed: int = 7, today: date | None = None) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    today = today or date.today()
    start = today - timedelta(days=30 * months)
    span = (today - start).days

    # Crecimiento suave del negocio: más operaciones en meses recientes
    offsets = np.sort((rng.power(1.18, n) * span).astype(int))
    aperturas = [start + timedelta(days=int(o)) for o in offsets]

    # TRM con caminata aleatoria alrededor de 4.100 COP/USD
    trm_walk = 4100 + np.cumsum(rng.normal(0, 9, span + 1))

    cli_w = np.array([c[2] for c in CLIENTES]); cli_w /= cli_w.sum()
    adu_names = list(ADUANAS); adu_w = np.array([v[1] for v in ADUANAS.values()])

    rows = []
    for i, ap in enumerate(aperturas):
        tipo = "Importación" if rng.random() < 0.64 else "Exportación"
        cli = CLIENTES[rng.choice(len(CLIENTES), p=cli_w)]
        aduana = adu_names[rng.choice(len(adu_names), p=adu_w)]
        modalidad = ADUANAS[aduana][0]

        if tipo == "Importación":
            pais = rng.choice(PAISES_IMPO, p=PESOS_IMPO)
            categoria = rng.choice(list(CAT_IMPO))
            arancel_pct = CAT_IMPO[categoria]
        else:
            pais = rng.choice(PAISES_EXPO, p=PESOS_EXPO)
            categoria = rng.choice(CAT_EXPO)
            arancel_pct = 0.0

        fob = float(np.round(rng.lognormal(10.6, 0.9), 2))
        flete = float(np.round(fob * rng.uniform(0.04, 0.12) * (1.8 if modalidad == "Aéreo" else 1), 2))
        seguro = float(np.round(fob * 0.005, 2))
        cif = fob + flete + seguro if tipo == "Importación" else 0.0
        trm = float(np.round(trm_walk[(ap - start).days], 2))
        arancel = cif * trm * arancel_pct
        iva = (cif * trm + arancel) * 0.19 if tipo == "Importación" else 0.0

        transito = {"Marítimo": rng.integers(14, 38), "Aéreo": rng.integers(2, 6), "Terrestre": rng.integers(2, 8)}[modalidad]
        llegada = ap + timedelta(days=int(rng.integers(2, 7) + transito))
        inspeccion = rng.random() < 0.22
        base_dias = {"Marítimo": 3.2, "Aéreo": 1.6, "Terrestre": 2.0}[modalidad]
        # Algunas aduanas son más lentas; las inspecciones (aforo) agregan días
        lentitud = {"Buenaventura": 1.6, "Cartagena": 1.1, "Ipiales": 1.4}.get(aduana, 1.0)
        dias = max(0.5, rng.gamma(2.2, base_dias * lentitud / 2.2) + (rng.uniform(2, 6) if inspeccion else 0))
        if rng.random() < 0.05:  # novedades: documentos incompletos, requerimientos DIAN, etc.
            dias += rng.uniform(6, 18)
        levante = llegada + timedelta(days=round(dias))
        entrega = levante + timedelta(days=int(rng.integers(1, 4)))

        if entrega <= today:
            estado = "Entregado"
        elif levante <= today:
            estado = "Liberado"
        elif llegada <= today:
            estado = "Inspección" if inspeccion else "En aduana"
        elif ap + timedelta(days=3) <= today:
            estado = "En tránsito"
        else:
            estado = "Documentación"

        rows.append({
            "DO": f"DO-{ap.year % 100:02d}-{i + 1:05d}",
            "Fecha apertura": ap,
            "Tipo operación": tipo,
            "Cliente": cli[0],
            "NIT": cli[1],
            "País origen/destino": str(pais),
            "Aduana": aduana,
            "Modalidad transporte": modalidad,
            "Categoría": str(categoria),
            "Subpartida": f"{rng.integers(1000, 9999)}.{rng.integers(10, 99)}.{rng.integers(10, 99)}.00",
            "Valor FOB USD": fob,
            "Flete USD": flete,
            "Seguro USD": seguro,
            "Valor CIF USD": round(cif, 2),
            "TRM": trm,
            "Arancel COP": round(arancel),
            "IVA COP": round(iva),
            "Estado": estado,
            "Fecha llegada": llegada,
            "Fecha levante": levante if levante <= today else None,
            "Fecha entrega": entrega if entrega <= today else None,
            "Ejecutivo": str(rng.choice(EJECUTIVOS)),
        })
    df = pd.DataFrame(rows)
    for c in ("Fecha apertura", "Fecha llegada", "Fecha levante", "Fecha entrega"):
        df[c] = pd.to_datetime(df[c])
    return df
