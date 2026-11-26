import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pydantic import BaseModel

from .auth import login_password
from .config import Settings, get_settings
from .routers import dashboard
from .services.repository import DataUnavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

if settings.environment == "production" and settings.auth_mode == "demo":
    # Nunca publicar datos reales sin login
    raise RuntimeError("AUTH_MODE=demo no está permitido con ENVIRONMENT=production. Use password o entra.")

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/api/docs" if settings.environment == "development" else None,
    openapi_url="/api/openapi.json" if settings.environment == "development" else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(dashboard.router)


@app.exception_handler(DataUnavailable)
def data_unavailable(_: Request, exc: DataUnavailable):
    return JSONResponse(status_code=503, content={"detail": f"No fue posible leer el Excel: {exc}"})


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login", tags=["auth"])
def login(body: LoginIn, s: Settings = Depends(get_settings)):
    if s.auth_mode != "password":
        return JSONResponse(status_code=404, content={"detail": "Login por contraseña no habilitado"})
    return login_password(body.username, body.password, s)


@app.get("/api/health", tags=["sistema"])
def health():
    return {"status": "ok", "auth_mode": settings.auth_mode, "data_source": settings.data_source}
