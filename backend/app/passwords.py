"""Hash de contraseñas (PBKDF2-SHA256, librería estándar) para el modo de login «password».

Generar el hash de una contraseña:
    python -m app.passwords
y agregarlo a AUTH_USERS como  usuario:hash  (varios usuarios separados por «;»).
"""
import base64
import getpass
import hashlib
import hmac
import os

ITERACIONES = 390_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERACIONES)
    return f"pbkdf2${ITERACIONES}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, it, salt, dk = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(it))
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


def parse_users(raw: str) -> dict[str, str]:
    """«usuario:hash;usuario2:hash». Tolera espacios, saltos de línea y comillas al copiar/pegar."""
    users = {}
    limpio = raw.strip().strip("\"'")
    for item in limpio.replace("\n", ";").split(";"):
        if ":" in item:
            u, h = item.split(":", 1)
            users[u.strip().strip("\"'").lower()] = h.strip().strip("\"'")
    return users


def diagnose_users(raw: str) -> str:
    """Resumen seguro (sin contraseñas) de AUTH_USERS para los logs."""
    users = parse_users(raw)
    if not users:
        return "AUTH_USERS está vacío o sin el formato usuario:hash"
    malos = [u for u, h in users.items() if not (h.startswith("pbkdf2$") and h.count("$") == 3)]
    texto = f"AUTH_USERS: {len(users)} usuario(s): {', '.join(users)}"
    if malos:
        texto += (f". ATENCIÓN: {', '.join(malos)} no tiene(n) un hash válido (debe empezar por «pbkdf2$»). "
                  "Genere el hash con: python -m app.passwords")
    return texto


if __name__ == "__main__":
    pw = getpass.getpass("Contraseña: ")
    if pw != getpass.getpass("Repita la contraseña: "):
        raise SystemExit("Las contraseñas no coinciden")
    print(hash_password(pw))
