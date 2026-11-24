"""邮件发送服务：通用 SMTP（163 / QQ 授权码、阿里云 DirectMail 等）+ 开发态控制台后端。

切换邮件服务商只需修改 SMTP_* 环境变量，代码不区分厂商。
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.header import Header
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

import structlog

from app.core.config import Settings
from app.core.exceptions import ServiceUnavailableError

logger = structlog.get_logger()

SENDER_DISPLAY_NAME = "知行快刷"
LOGIN_CODE_SUBJECT = "知行快刷 验证码"


def mask_email(email: str) -> str:
    """日志脱敏：ab***@163.com。"""
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}" if domain else "***"


def build_login_code_message(
    settings: Settings, to_email: str, code: str, ttl_minutes: int
) -> EmailMessage:
    """构造纯文本 + HTML 双版本的验证码邮件。"""
    from_addr = (settings.smtp_from or settings.smtp_user).strip()
    msg = EmailMessage()
    msg["Subject"] = LOGIN_CODE_SUBJECT
    msg["From"] = formataddr((str(Header(SENDER_DISPLAY_NAME, "utf-8")), from_addr))
    msg["To"] = to_email
    msg["Message-ID"] = make_msgid(domain=from_addr.partition("@")[2] or None)

    text = (
        f"你好，\n\n你的知行快刷登录验证码是：{code}\n\n"
        f"验证码 {ttl_minutes} 分钟内有效，仅可使用一次。"
        "如非本人操作，请忽略本邮件，你的账号不会有任何变化。\n\n— 知行快刷"
    )
    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><body style="margin:0;padding:24px;background:#F6F5F1;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#18191E;">
  <div style="max-width:420px;margin:0 auto;background:#FFFFFF;border-radius:20px;padding:28px 24px;">
    <div style="font-size:13px;color:#6E7280;letter-spacing:0.08em;">知行快刷</div>
    <div style="font-size:20px;font-weight:700;margin:6px 0 18px;">登录验证码</div>
    <div style="font-size:34px;font-weight:700;letter-spacing:0.32em;background:#F4D06F;border-radius:14px;padding:14px 0;text-align:center;">{code}</div>
    <p style="font-size:13px;line-height:1.7;color:#6E7280;margin:18px 0 0;">
      验证码 {ttl_minutes} 分钟内有效，仅可使用一次。<br/>如非本人操作，请忽略本邮件，你的账号不会有任何变化。
    </p>
  </div>
</body></html>"""
    msg.set_content(text, charset="utf-8")
    msg.add_alternative(html, subtype="html", charset="utf-8")
    return msg


def _send_via_smtp_blocking(settings: Settings, msg: EmailMessage) -> None:
    """阻塞式 SMTP 发送（SSL 465 直连，或 587/25 明文连接后按服务器能力 STARTTLS）。"""
    context = ssl.create_default_context()
    timeout = settings.smtp_timeout_seconds
    if settings.smtp_use_ssl:
        server: smtplib.SMTP = smtplib.SMTP_SSL(
            settings.smtp_host, settings.smtp_port, timeout=timeout, context=context
        )
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=timeout)
    try:
        if not settings.smtp_use_ssl:
            server.ehlo()
            if server.has_extn("starttls"):
                server.starttls(context=context)
                server.ehlo()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass


async def send_login_code(settings: Settings, to_email: str, code: str) -> None:
    """发送登录验证码。

    - 已配置 SMTP：在线程池中执行阻塞 smtplib，不阻塞事件循环。
    - 未配置 SMTP 且非 production：控制台后端，把验证码写入日志，便于本地/测试联调。
    - 未配置 SMTP 且 production：拒绝发送（503）。
    """
    ttl_minutes = max(1, settings.email_code_ttl_seconds // 60)
    if not settings.smtp_configured:
        if settings.app_env == "production":
            raise ServiceUnavailableError("邮箱登录暂未开放，请稍后再试")
        logger.warning(
            "email_code_console_backend",
            to=mask_email(to_email),
            code=code,
            hint="SMTP 未配置，开发/测试环境仅打印验证码，不会真实发信",
        )
        return

    msg = build_login_code_message(settings, to_email, code, ttl_minutes)
    try:
        await asyncio.to_thread(_send_via_smtp_blocking, settings, msg)
    except (smtplib.SMTPException, OSError) as exc:
        logger.error(
            "email_code_smtp_failed",
            to=mask_email(to_email),
            host=settings.smtp_host,
            error=type(exc).__name__,
        )
        raise ServiceUnavailableError("验证码发送失败，请稍后重试") from exc
    logger.info("email_code_sent", to=mask_email(to_email))
