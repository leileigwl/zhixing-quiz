"""知识库文档相关数据模型（V2 支持自动领域归类字段）"""

from typing import Literal, Optional

from pydantic import BaseModel


class KnowledgeUploadResponse(BaseModel):
    """上传文档后的响应"""

    doc_id: str
    file_name: str
    status: Literal["processing", "ready", "failed"]
    domain_id: Optional[int] = None
    domain_name: Optional[str] = None


class KnowledgeDocumentItem(BaseModel):
    """知识库文档列表项"""

    doc_id: str
    file_name: str
    file_type: str
    file_size: int
    status: Literal["processing", "ready", "failed"]
    chunk_count: int
    domain_id: Optional[int] = None
    domain_name: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str


class KnowledgeListResponse(BaseModel):
    """知识库文档列表响应"""

    items: list[KnowledgeDocumentItem]


class KnowledgeStatusResponse(BaseModel):
    """文档状态查询响应"""

    doc_id: str
    file_name: str
    status: Literal["processing", "ready", "failed"]
    chunk_count: int
    domain_id: Optional[int] = None
    domain_name: Optional[str] = None
    error_message: Optional[str] = None
