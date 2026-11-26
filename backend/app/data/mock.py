"""Datos simulados con los mismos encabezados de la hoja «Sheet1» del Excel real.

Permiten usar el tablero (demo, pruebas automáticas) sin el archivo de la empresa.
Los nombres de empresas y productos son ficticios.
"""
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

# (origen, destino, modo, ciudad origen, ciudad destino, peso, días por etapa aprox.)
RUTAS = [
    ("CO", "EC", "SEA", "Buenaventura", "Guayaquil", 0.55, (2, 6, 2, 2, 2, 1)),
    ("CO", "EC", "ROAD", "Ipiales", "Guayaquil", 0.08, (2, 0, 3, 3, 2, 1)),
    ("CO", "VZ", "SEA", "Cartagena", "Puerto Cabello", 0.17, (3, 6, 7, 5, 2, 1)),
    ("BR", "EC", "SEA", "Santos", "Guayaquil", 0.10, (4, 11, 21, 2, 3, 1)),
    ("BE", "EC", "SEA", "Amberes", "Guayaquil", 0.05, (85, 14, 30, 2, 2, 1)),
    ("US", "EC", "SEA", "Miami", "Guayaquil", 0.05, (45, 20, 18, 2, 2, 1)),
]
FRANQUICIAS = ["Baby Care", "Oral Care", "Adult Skin & Hair Care", "Self Care", "Women's Health", None]
PRODUCTOS = ["CREMA HIDRATANTE 12X400ML", "SHAMPOO SUAVE 12X200ML", "ENJUAGUE BUCAL 12X500ML", "PROTECTOR SOLAR 12X120ML",
             "TOALLAS HUMEDAS 12X80UN", "ACEITE CORPORAL 12X100ML", "JABON LIQUIDO 12X250ML", "TALCO 12X200G"]
FORWARDERS = ["Global Freight S.A.", "Andes Logistics", "Pacific Cargo"]
NAVIERAS = ["Naviera Alfa", "Naviera Beta", "Naviera Gamma", "Naviera Delta"]
ESTADOS = ["Waiting for Pick up", "Waiting for Departure", "International Transit",
           "Waiting for Customs Clearance", "Waiting for Delivery", "Sap Entry Completed"]


def generate(n_embarques: int = 70, today: date | None = None, seed: int = 11) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    hoy = datetime.combine(today or date.today(), datetime.min.time())
    pesos = np.array([r[5] for r in RUTAS]); pesos /= pesos.sum()
    rows = []
    for e in range(n_embarques):
        o, d, modo, c_o, c_d, _, base = RUTAS[rng.choice(len(RUTAS), p=pesos)]
        # duración real de cada etapa = base con variación (a veces retrasos)
        dur = [max(0.0, b * rng.uniform(0.7, 1.25) + (rng.uniform(1, 6) if rng.random() < 0.12 else 0)) for b in base]
        total = sum(dur)
        po_fecha = hoy - timedelta(days=float(rng.uniform(-total * 0.2, 150)))
        hitos = [po_fecha]
        for x in dur:
            hitos.append(hitos[-1] + timedelta(days=x))
        po_f, pickup, atd, ata, despacho, wh, sap = hitos
        etapa = sum(h <= hoy for h in hitos[1:])  # hitos cumplidos
        estado = ESTADOS[min(etapa, 5)]

        def si(h, i):
            return h if etapa >= i else None

        expo_no = f"{200 + e}{'ABCDE'[e % 5]} 2026" if o == "CO" else None
        shipment = f"{1077000000 + e * 731}"
        cont = [f"MOCK{rng.integers(1000000, 9999999)}" for _ in range(rng.integers(1, 4 if modo == "SEA" else 2))]
        po = f"30012{rng.integers(10000, 99999)}" if d == "EC" else None
        for linea in range(int(rng.integers(4, 30))):
            valor = float(np.round(rng.lognormal(8.3, 1.0), 2))
            rows.append({
                "Status": estado, "Shipment Reference": shipment, "Export Number": expo_no,
                "Franchise": FRANQUICIAS[rng.integers(0, len(FRANQUICIAS))] or 0,
                "Product Type": "FERT", "Country of departure": o, "Departure City": c_o,
                "Exporter Name": "EXPORTADORA DEMO S.A.", "Country of arrival": d, "Final Country Destination": d,
                "Final Arrival City": c_d, "Importer name": "IMPORTADORA DEMO S.A.", "Import Type": "Landed",
                "PO Number": po, "PO Generation Date": po_f if po else None,
                "PO Total Value Impo": valor if po else None, "Currency Impo": "USD" if po else None,
                "SKU Code Impo": int(rng.integers(570000, 590000)),
                "Material Description Impo": PRODUCTOS[rng.integers(0, len(PRODUCTOS))],
                "Invoice Total Value Expo": valor * (4000 if d == "EC" else 1),
                "Invoice Currency Expo": "COP" if d == "EC" else "USD",
                "Invoice Total Value Impo": valor if po and etapa >= 2 else None, "Invoice Currency Impo": "USD",
                "Invoice Quantity Expo": int(rng.integers(10, 2000)),
                "Pick Up Date & Time": si(pickup, 1), "First ETD": pickup + timedelta(days=1), "ATD": si(atd, 2),
                "First ETA Port Arrival Date": atd + timedelta(days=base[2]), "ATA Port arrival date": si(ata, 3),
                "MOT": modo, "Transport type": "TFCL", "SPOT/BID": "BID",
                "Freight Forwarder": FORWARDERS[e % len(FORWARDERS)],
                "Shipping Line": NAVIERAS[e % len(NAVIERAS)] if modo == "SEA" else "N/A",
                "Container #": cont[linea % len(cont)], "Container Type": "CONTAINER_HIGHCUBE_DRY_40FT",
                "Broker Name": "AGENCIA ADUANA DEMO" if etapa >= 3 else None,
                "Channel": ("Automático" if rng.random() < 0.85 else "Documental") if etapa >= 4 else None,
                "Customs Clearance Date & Time": si(despacho, 4), "Deliver to WH Date": si(wh, 5),
                "SAP Entry Date": si(sap, 6), "Expo Month": datetime(pickup.year, pickup.month, 1),
            })
    return pd.DataFrame(rows)
