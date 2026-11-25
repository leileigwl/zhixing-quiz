"""邮箱验证码（OTP）登录：发码、限流、校验与签发 JWT。

存储：Redis（多 Worker 共享）优先；Redis 不可用时开发/测试环境回落进程内存，
production 下拒绝服务（多 Worker 下内存状态不共享，无法保证单次使用与次数限制）。
验证码只以 HMAC-SHA256(JWT_SECRET, email:code) 形式落存储，不保存明文。
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
import unicodedata
from dataclasses import dataclass
from typing import Optional, Protocol

import structlog

from app.core.config import Settings, get_settings
from app.core.exceptions import RateLimitError, ServiceUnavailableError, VerificationCodeError
from app.core.rate_limit import check_rate_limit_async
from app.core.redis_client import get_redis
from app.models.user import LoginResponse
from app.repositories import user_repository
from app.services import mail_service, user_service

logger = structlog.get_logger()

MAX_EMAIL_LENGTH = 254
# 不限邮箱服务商：QQ / 163 / Gmail / Outlook / 企业邮箱 / 学校邮箱 / 中文域名（转 punycode）均可。
# 与前端 frontend/src/services/emailLogin.ts 的规则保持一致。
_LOCAL_RE = re.compile(r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~\-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~\-]+)*$")
_LABEL_RE = re.compile(r"^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?$")
_TLD_RE = re.compile(r"^([a-z]{2,63}|xn--[a-z0-9\-]{1,59})$")
_CODE_RE = re.compile(r"^\d{6}$")

GENERIC_SENT_MESSAGE = "如果邮箱地址有效，验证码将很快送达，请查收（含垃圾邮件箱）"
MSG_INVALID_EMAIL = "请输入正确的邮箱地址"
MSG_INVALID_CODE = "验证码错误或已过期"
MSG_TOO_MANY_ATTEMPTS = "验证码错误次数过多，请重新获取"
MSG_DAILY_LIMIT = "该邮箱今日获取验证码次数已达上限，请明天再试"
MSG_IP_LIMIT = "操作过于频繁，请稍后再试"


def _now() -> float:
    """可在测试中 patch 的时钟（内存存储的过期判断）。"""
    return time.monotonic()


# ---------------------------------------------------------------------------
# 规范化与哈希
# ---------------------------------------------------------------------------


def normalize_email(raw: str) -> str:
    """NFKC（全角转半角）+ 句号「。｡」→「.」+ 去空格 + 小写；中文域名转 punycode。

    格式非法时抛出 VerificationCodeError(4011)。
    """
    invalid = VerificationCodeError(MSG_INVALID_EMAIL, VerificationCodeError.INVALID_EMAIL)
    email = unicodedata.normalize("NFKC", raw or "").replace("\u3002", ".").replace("\uff61", ".")
    email = email.strip().lower()
    if not email or email.count("@") != 1:
        raise invalid
    local, domain = email.split("@", 1)
    if not local or len(local) > 64 or not _LOCAL_RE.match(local):
        raise invalid
    try:
        ascii_domain = domain.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise invalid from None
    labels = ascii_domain.split(".")
    if len(labels) < 2 or len(ascii_domain) > 253:
        raise invalid
    if not all(_LABEL_RE.match(label) for label in labels) or not _TLD_RE.match(labels[-1]):
        raise invalid
    email = f"{local}@{ascii_domain}"
    if len(email) > MAX_EMAIL_LENGTH:
        raise invalid
    return email


def email_key(email: str) -> str:
    """存储键用邮箱摘要，避免 Redis 键名直接暴露邮箱。"""
    return hashlib.sha256(email.encode("utf-8")).hexdigest()[:32]


def email_openid(email: str) -> str:
    """邮箱用户占用 users.openid（NOT NULL UNIQUE）的稳定伪 openid：em_ + sha256 前 40 位。"""
    return "em_" + hashlib.sha256(email.encode("utf-8")).hexdigest()[:40]


def hash_code(secret: str, email: str, code: str) -> str:
    return hmac.new(
        secret.encode("utf-8"), f"{email}:{code}".encode(), hashlib.sha256
    ).hexdigest()


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


# ---------------------------------------------------------------------------
# 存储抽象：Redis / 进程内存
# ---------------------------------------------------------------------------


class CodeStore(Protocol):
    async def acquire_cooldown(self, ekey: str, seconds: int) -> bool: ...
    async def release_cooldown(self, ekey: str) -> None: ...
    async def save_code(self, ekey: str, code_hash: str, ttl: int) -> None: ...
    async def take_attempt(self, ekey: str) -> Optional[tuple[str, int]]: ...
    async def delete_code(self, ekey: str) -> bool: ...


_TAKE_ATTEMPT_LUA = """
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return false end
local a = redis.call('HINCRBY', KEYS[1], 'a', 1)
return {h, a}
"""


class RedisCodeStore:
    def __init__(self, client) -> None:
        self.client = client

    @staticmethod
    def _code_key(ekey: str) -> str:
        return f"zx:otp:code:{ekey}"

    @staticmethod
    def _cd_key(ekey: str) -> str:
        return f"zx:otp:cd:{ekey}"

    async def acquire_cooldown(self, ekey: str, seconds: int) -> bool:
        return bool(await self.client.set(self._cd_key(ekey), "1", nx=True, ex=seconds))

    async def release_cooldown(self, ekey: str) -> None:
        await self.client.delete(self._cd_key(ekey))

    async def save_code(self, ekey: str, code_hash: str, ttl: int) -> None:
        key = self._code_key(ekey)
        pipe = self.client.pipeline(transaction=True)
        pipe.delete(key)
        pipe.hset(key, mapping={"h": code_hash, "a": 0})
        pipe.expire(key, ttl)
        await pipe.execute()

    async def take_attempt(self, ekey: str) -> Optional[tuple[str, int]]:
        res = await self.client.eval(_TAKE_ATTEMPT_LUA, 1, self._code_key(ekey))
        if not res:
            return None
        return str(res[0]), int(res[1])

    async def delete_code(self, ekey: str) -> bool:
        return int(await self.client.delete(self._code_key(ekey))) > 0


@dataclass
class _MemEntry:
    code_hash: str
    attempts: int
    expires_at: float


class MemoryCodeStore:
    """单进程内存实现：仅用于开发/测试（无 Redis）。"""

    def __init__(self) -> None:
        self.codes: dict[str, _MemEntry] = {}
        self.cooldowns: dict[str, float] = {}

    async def acquire_cooldown(self, ekey: str, seconds: int) -> bool:
        now = _now()
        until = self.cooldowns.get(ekey)
        if until is not None and until > now:
            return False
        self.cooldowns[ekey] = now + seconds
        return True

    async def release_cooldown(self, ekey: str) -> None:
        self.cooldowns.pop(ekey, None)

    async def save_code(self, ekey: str, code_hash: str, ttl: int) -> None:
        self.codes[ekey] = _MemEntry(code_hash=code_hash, attempts=0, expires_at=_now() + ttl)

    async def take_attempt(self, ekey: str) -> Optional[tuple[str, int]]:
        entry = self.codes.get(ekey)
        if entry is None:
            return None
        if entry.expires_at <= _now():
            self.codes.pop(ekey, None)
            return None
        entry.attempts += 1
        return entry.code_hash, entry.attempts

    async def delete_code(self, ekey: str) -> bool:
        return self.codes.pop(ekey, None) is not None

    def clear(self) -> None:
        self.codes.clear()
        self.cooldowns.clear()


_memory_store = MemoryCodeStore()


def reset_memory_store() -> None:
    """供单元测试隔离使用。"""
    _memory_store.clear()


def _get_store(settings: Settings) -> CodeStore:
    client = get_redis()
    if client is not None:
        return RedisCodeStore(client)
    if settings.app_env == "production":
        logger.error("email_code_store_unavailable", reason="redis_not_connected")
        raise ServiceUnavailableError("验证码服务暂不可用，请稍后再试")
    return _memory_store


def _ensure_mail_ready(settings: Settings) -> None:
    if settings.app_env == "production" and not settings.smtp_configured:
        raise ServiceUnavailableError("邮箱登录暂未开放，请稍后再试")


# ---------------------------------------------------------------------------
# 业务流程
# ---------------------------------------------------------------------------


async def send_login_code(raw_email: str, client_ip: str) -> dict:
    """发送登录验证码。响应与用户是否已注册无关（不泄露账号存在性）。"""
    settings = get_settings()
    email = normalize_email(raw_email)
    _ensure_mail_ready(settings)
    store = _get_store(settings)
    ekey = email_key(email)
    cooldown = settings.email_code_cooldown_seconds

    await check_rate_limit_async(
        f"otp:send:ip:{client_ip}",
        max_requests=settings.email_code_ip_hourly_limit,
        window_seconds=3600,
        message=MSG_IP_LIMIT,
    )
    if not await store.acquire_cooldown(ekey, cooldown):
        raise RateLimitError(f"验证码发送过于频繁，请 {cooldown} 秒后再试")
    try:
        await check_rate_limit_async(
            f"otp:send:day:{ekey}",
            max_requests=settings.email_code_daily_limit,
            window_seconds=86400,
            message=MSG_DAILY_LIMIT,
        )
    except RateLimitError:
        await store.release_cooldown(ekey)
        raise

    code = generate_code()
    await store.save_code(ekey, hash_code(settings.jwt_secret, email, code), settings.email_code_ttl_seconds)
    try:
        await mail_service.send_login_code(settings, email, code)
    except Exception:
        # 发信失败：作废本次验证码并释放冷却，允许用户立刻重试（当日次数仍计入）
        await store.delete_code(ekey)
        await store.release_cooldown(ekey)
        raise

    return {
        "message": GENERIC_SENT_MESSAGE,
        "cooldown_seconds": cooldown,
        "expires_in_seconds": settings.email_code_ttl_seconds,
    }


async def verify_login_code(raw_email: str, raw_code: str, client_ip: str) -> LoginResponse:
    """校验验证码（每码最多 N 次、常量时间比较、单次使用），成功后按邮箱查/建用户并签发 JWT。"""
    settings = get_settings()
    email = normalize_email(raw_email)
    code = (raw_code or "").strip()
    store = _get_store(settings)
    ekey = email_key(email)

    await check_rate_limit_async(
        f"otp:verify:ip:{client_ip}",
        max_requests=settings.email_verify_ip_limit_per_10min,
        window_seconds=600,
        message=MSG_IP_LIMIT,
    )

    if not _CODE_RE.match(code):
        raise VerificationCodeError(MSG_INVALID_CODE, VerificationCodeError.INVALID_OR_EXPIRED)

    taken = await store.take_attempt(ekey)
    if taken is None:
        raise VerificationCodeError(MSG_INVALID_CODE, VerificationCodeError.INVALID_OR_EXPIRED)
    stored_hash, attempts = taken
    max_attempts = settings.email_code_max_attempts

    if attempts > max_attempts:
        await store.delete_code(ekey)
        raise VerificationCodeError(MSG_TOO_MANY_ATTEMPTS, VerificationCodeError.TOO_MANY_ATTEMPTS)

    expected = hash_code(settings.jwt_secret, email, code)
    if not hmac.compare_digest(stored_hash, expected):
        if attempts >= max_attempts:
            await store.delete_code(ekey)
            raise VerificationCodeError(
                MSG_TOO_MANY_ATTEMPTS, VerificationCodeError.TOO_MANY_ATTEMPTS
            )
        remaining = max_attempts - attempts
        raise VerificationCodeError(
            f"验证码错误，还可尝试 {remaining} 次", VerificationCodeError.INVALID_OR_EXPIRED
        )

    # 单次使用：只有真正删除成功的那一次请求可以登录（防并发重放）
    if not await store.delete_code(ekey):
        raise VerificationCodeError(MSG_INVALID_CODE, VerificationCodeError.INVALID_OR_EXPIRED)

    user = await user_repository.find_user_by_email(email)
    if user is None:
        user = await user_repository.create_user_with_email(email_openid(email), email)
        logger.info("email_user_created", user_id=user["id"], to=mail_service.mask_email(email))

    return await user_service.issue_login_response(user)
