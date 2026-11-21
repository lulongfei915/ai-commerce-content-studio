from app.shared.config import Settings


def test_settings_have_safe_local_defaults() -> None:
    settings = Settings(_env_file=None)

    assert settings.api_prefix == "/api/v1"
    assert settings.storage_bucket == "studio-private"
