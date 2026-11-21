from ..shared.config import get_settings


def run() -> None:
    settings = get_settings()
    print(f"scheduler configured for {settings.redis_url}")


if __name__ == "__main__":
    run()
