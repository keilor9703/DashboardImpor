import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .routers import dashboard
from .services.repository import DataUnavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

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


@app.get("/api/health", tags=["sistema"])
def health():
    return {"status": "ok", "auth_mode": settings.auth_mode, "data_source": settings.data_source}
