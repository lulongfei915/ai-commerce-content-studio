from typing import Literal

ErrorCategory = Literal[
    "configuration", "invalid_request", "authentication", "rate_limited",
    "provider_unavailable", "provider_timeout", "invalid_response",
]


class ImageProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        category: ErrorCategory,
        status_code: int | None = None,
        request_id: str | None = None,
        retry_after: int | None = None,
        provider_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.status_code = status_code
        self.request_id = request_id
        self.retry_after = retry_after
        self.provider_code = provider_code
