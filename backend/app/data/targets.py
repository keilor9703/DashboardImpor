"""Metas de lead time (PDT) por ruta y modo de transporte, en días.

Tomadas de la hoja «In Transit PDT» del Excel. Las rutas que no aparecen allí
usan una meta *referencial* por modo de transporte (pendiente de validar con el
cliente). Para cambiar una meta, solo se edita este archivo.
"""

# Etapas del proceso logístico: (clave, nombre, hito inicial, hito final)
ETAPAS = [
    ("orden", "Gestión de la orden", "po_fecha", "pickup"),
    ("inland", "Transporte a puerto de origen", "pickup", "atd"),
    ("transito", "Tránsito internacional", "atd", "ata"),
    ("nacionalizacion", "Nacionalización", "ata", "despacho"),
    ("local", "Transporte local en destino", "despacho", "entrega_wh"),
    ("sap", "Ingreso a SAP", "entrega_wh", "sap"),
]
ETAPA_KEYS = [e[0] for e in ETAPAS]


def _t(orden, inland, transito, nac, local, sap):
    return dict(zip(ETAPA_KEYS, (orden, inland, transito, nac, local, sap)))


# (país origen, país destino, modo) -> metas por etapa
METAS_RUTA: dict[tuple[str, str, str], dict[str, float]] = {
    ("CO", "EC", "SEA"): _t(2, 7, 2, 2, 2, 1),     # total 16
    ("CO", "EC", "ROAD"): _t(2, 0, 3, 3, 2, 1),    # total 11
    ("BE", "EC", "SEA"): _t(90, 15, 30, 2, 2, 1),  # total 140
    ("BE", "EC", "AIR"): _t(90, 15, 4, 4, 1, 1),   # total 115
    ("BR", "EC", "SEA"): _t(4, 12, 20, 2, 3, 1),   # total 40
    ("BR", "EC", "AIR"): _t(5, 3, 1, 4, 1, 1),     # total 15
    ("US", "EC", "SEA"): _t(45, 22, 20, 2, 2, 1),  # total 92
}

# Metas referenciales cuando la ruta no tiene meta oficial
METAS_REFERENCIALES: dict[str, dict[str, float]] = {
    "SEA": _t(5, 7, 10, 4, 2, 1),
    "ROAD": _t(2, 1, 3, 3, 2, 1),
    "AIR": _t(5, 3, 2, 3, 1, 1),
}


def metas_para(origen: str, destino: str, modo: str) -> tuple[dict[str, float] | None, bool]:
    """Devuelve (metas, es_oficial)."""
    if (origen, destino, modo) in METAS_RUTA:
        return METAS_RUTA[(origen, destino, modo)], True
    return METAS_REFERENCIALES.get(modo), False
