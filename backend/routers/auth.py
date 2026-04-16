from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from core.config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

settings = get_settings()
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"


def _cookie_opts() -> dict:
    is_secure = settings.frontend_url.startswith("https://")
    return {"httponly": True, "secure": is_secure, "samesite": "lax", "path": "/"}


class TokenExchangeRequest(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str


@router.post("/token")
async def exchange_token(req: TokenExchangeRequest, response: Response):
    """Exchange authorization code for tokens.

    Stores refresh_token in httpOnly cookie, returns access_token in body.
    """
    # Validate redirect_uri against server config to prevent open redirect
    if req.redirect_uri != settings.spotify_redirect_uri:
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            SPOTIFY_TOKEN_URL,
            data={
                "client_id": settings.spotify_client_id,
                "grant_type": "authorization_code",
                "code": req.code,
                "redirect_uri": req.redirect_uri,
                "code_verifier": req.code_verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Token exchange failed")

    data = resp.json()

    opts = _cookie_opts()
    response.set_cookie("spotify_refresh_token", data["refresh_token"], max_age=30 * 24 * 3600, **opts)

    return {
        "access_token": data["access_token"],
        "expires_in": data["expires_in"],
    }


@router.post("/refresh")
async def refresh_token(request: Request, response: Response):
    """Refresh access token using httpOnly refresh_token cookie."""
    refresh = request.cookies.get("spotify_refresh_token")
    if not refresh:
        raise HTTPException(status_code=401, detail="No refresh token")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            SPOTIFY_TOKEN_URL,
            data={
                "client_id": settings.spotify_client_id,
                "grant_type": "refresh_token",
                "refresh_token": refresh,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code != 200:
        response.delete_cookie("spotify_refresh_token", path="/")
        raise HTTPException(status_code=401, detail="Refresh failed")

    data = resp.json()

    new_refresh = data.get("refresh_token", refresh)
    opts = _cookie_opts()
    response.set_cookie("spotify_refresh_token", new_refresh, max_age=30 * 24 * 3600, **opts)

    return {
        "access_token": data["access_token"],
        "expires_in": data["expires_in"],
    }


@router.post("/logout")
async def logout(response: Response):
    """Clear refresh_token cookie."""
    response.delete_cookie("spotify_refresh_token", path="/")
    return {"status": "ok"}
