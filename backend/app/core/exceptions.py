"""统一业务异常定义"""


class QuizGenerationError(Exception):
    """题库生成失败"""

    def __init__(self, message: str = "题库生成失败，请稍后重试"):
        self.message = message
        super().__init__(self.message)


class ReportGenerationError(Exception):
    """报告生成失败"""

    def __init__(self, message: str = "报告生成失败，请稍后重试"):
        self.message = message
        super().__init__(self.message)


class ContentFilterError(Exception):
    """内容安全过滤异常"""

    def __init__(self, message: str = "输入内容包含不当内容，请修改后重试"):
        self.message = message
        super().__init__(self.message)


class AuthenticationError(Exception):
    """身份认证失败"""

    def __init__(self, message: str = "未登录或登录已过期"):
        self.message = message
        super().__init__(self.message)


class AuthorizationError(Exception):
    """无权访问资源"""

    def __init__(self, message: str = "无权访问该资源"):
        self.message = message
        super().__init__(self.message)


class KnowledgeBaseError(Exception):
    """知识库操作异常（格式/大小/数量校验失败、文档不存在或未就绪等）"""

    def __init__(self, message: str = "知识库操作失败"):
        self.message = message
        super().__init__(self.message)


class RateLimitError(Exception):
    """请求过于频繁触发限流"""

    def __init__(self, message: str = "操作过于频繁，请稍后再试"):
        self.message = message
        super().__init__(self.message)


class ResourceNotFoundError(Exception):
    """请求资源不存在"""

    def __init__(self, message: str = "请求的资源不存在"):
        self.message = message
        super().__init__(self.message)
