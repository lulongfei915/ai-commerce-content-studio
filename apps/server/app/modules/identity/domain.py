from enum import Enum


class Permission(str, Enum):
    VIEW = "view"
    MANAGE = "manage"
    CREATE = "create"
    REVIEW = "review"
    ADOPT = "adopt"
    DOWNLOAD = "download"


class Role(str, Enum):
    ADMIN = "admin"
    DESIGNER = "designer"
    REVIEWER = "reviewer"
    VIEWER = "viewer"


_GRANTS = {
    Role.ADMIN: frozenset(Permission),
    Role.DESIGNER: frozenset(
        {Permission.VIEW, Permission.CREATE, Permission.ADOPT, Permission.DOWNLOAD}
    ),
    Role.REVIEWER: frozenset({Permission.VIEW, Permission.REVIEW, Permission.DOWNLOAD}),
    Role.VIEWER: frozenset({Permission.VIEW}),
}


def permissions(role: Role, download_allowed: bool) -> frozenset[Permission]:
    return _GRANTS[role] if download_allowed else _GRANTS[role] - {Permission.DOWNLOAD}
