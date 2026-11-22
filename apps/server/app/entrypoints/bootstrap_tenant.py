import argparse
from getpass import getpass

import pyotp
from pydantic import SecretStr, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.modules.identity.domain import Role
from app.modules.identity.models import Membership, Tenant, User
from app.modules.identity.schemas import Credentials
from app.modules.identity.service import IdentityUnavailable, hash_password, totp_cipher
from app.shared.config import get_settings
from app.shared.db import SessionLocal


def main() -> int:
    parser = argparse.ArgumentParser(description="创建公司和首位管理员")
    parser.add_argument("--slug", required=True, help="登录使用的公司标识")
    parser.add_argument("--name", required=True, help="公司显示名称")
    parser.add_argument("--email", required=True, help="首位管理员邮箱")
    parser.add_argument("--totp", action="store_true", help="为首位管理员配置动态验证码")
    args = parser.parse_args()
    name = args.name.strip()
    if not 1 <= len(name) <= 120:
        parser.error("公司名称须为 1 至 120 个字符")
    password = getpass("管理员密码：")
    if not 12 <= len(password) <= 256 or getpass("确认密码：") != password:
        parser.error("密码须为 12 至 256 个字符，两次输入须一致")
    try:
        data = Credentials(tenant_slug=args.slug, email=args.email, password=SecretStr(password))
    except ValidationError:
        parser.error("公司标识或邮箱格式无效")
    encrypted = None
    if args.totp:
        try:
            cipher = totp_cipher(get_settings())
        except IdentityUnavailable:
            parser.error("请先配置有效的 AUTH_TOTP_KEY")
        secret = getpass("验证器的 Base32 密钥：").strip().upper()
        code = getpass("当前验证码：").strip()
        try:
            if len(secret) < 32 or not pyotp.TOTP(secret).verify(code):
                parser.error("密钥或验证码无效")
        except ValueError:
            parser.error("Base32 密钥无效")
        encrypted = cipher.encrypt(secret.encode()).decode()
    with SessionLocal() as db:
        if db.scalar(select(Tenant.id).where(Tenant.slug == data.tenant_slug)):
            parser.error("公司标识已存在")
        if db.scalar(select(User.id).where(User.email == data.email)):
            parser.error("该管理员邮箱已存在")
        tenant = Tenant(slug=data.tenant_slug, name=name)
        user = User(email=data.email, password_hash=hash_password(password))
        try:
            db.add_all([tenant, user])
            db.flush()
            db.add(
                Membership(
                    tenant_id=tenant.id,
                    user_id=user.id,
                    role=Role.ADMIN,
                    download_allowed=True,
                    totp_secret_encrypted=encrypted,
                )
            )
            db.commit()
        except IntegrityError:
            parser.error("公司标识或管理员邮箱已存在")
    print("公司和首位管理员已创建。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
