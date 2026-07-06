from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    spotify_client_id: str = ""
    spotify_client_secret: str = ""
    spotify_redirect_uri: str = "http://localhost:3000/callback"
    frontend_url: str = "http://localhost:3000"
    admin_email: str = "theo.frvl@gmail.com"

    # extra="ignore": the .env file also carries MIX_* tuning vars consumed
    # directly via os.getenv; without this, bare-metal startup crashes on them.
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
