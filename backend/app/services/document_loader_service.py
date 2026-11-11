"""文档解析服务 - 支持多编码兼容、Markdown 章节感知切分与长度二次切分"""

from __future__ import annotations

from typing import Optional

import structlog
from langchain_core.documents import Document

from app.core.config import get_settings

logger = structlog.get_logger()

SUPPORTED_FILE_TYPES = {"pdf", "docx", "md", "txt"}
TEXT_ENCODINGS = ("utf-8-sig", "utf-8", "gb18030")


def _read_text_with_fallback(file_path: str) -> str:
    """依次尝试 UTF-8-SIG / UTF-8 / GB18030 解码文本，兼容 Windows 中文笔记。"""
    with open(file_path, "rb") as f:
        raw = f.read()

    if not raw.strip():
        return ""

    for encoding in TEXT_ENCODINGS:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue

    raise ValueError("文档文本编码不受支持，请转换为 UTF-8 或 GBK/GB18030 后重新上传")


def _split_markdown_by_headers(raw_text: str) -> list[Document]:
    """优先按 Markdown 一/二/三级标题拆分章节，并在子章节前置父级路径上下文。"""
    from langchain_text_splitters import MarkdownHeaderTextSplitter

    splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=[
            ("#", "h1"),
            ("##", "h2"),
            ("###", "h3"),
        ],
        strip_headers=False,
    )
    sections = splitter.split_text(raw_text)
    if not sections:
        return [Document(page_content=raw_text, metadata={})]

    enriched: list[Document] = []
    for doc in sections:
        headers = [doc.metadata[k] for k in ("h1", "h2", "h3") if k in doc.metadata and doc.metadata[k]]
        content = doc.page_content.strip()
        if not content:
            continue
        if len(headers) > 1:
            path_line = " > ".join(headers[:-1])
            content = f"【所属章节：{path_line}】\n{content}"
        enriched.append(Document(page_content=content, metadata=dict(doc.metadata)))
    return enriched or [Document(page_content=raw_text, metadata={})]


def _load_documents(file_path: str, file_type: str) -> list[Document]:
    """按文件类型分发加载，并返回基础语义单元列表。"""
    file_type = file_type.lower().lstrip(".")

    if file_type == "pdf":
        from langchain_community.document_loaders import PyPDFLoader

        docs = PyPDFLoader(file_path).load()
        if not docs or not any(d.page_content.strip() for d in docs):
            raise ValueError("PDF 未提取到有效文字内容（暂不支持纯图片扫描版 PDF）")
        return docs

    if file_type == "docx":
        from langchain_community.document_loaders import Docx2txtLoader

        docs = Docx2txtLoader(file_path).load()
        if not docs or not any(d.page_content.strip() for d in docs):
            raise ValueError("Word 文档内容为空或未提取到有效文字")
        return docs

    if file_type == "md":
        text = _read_text_with_fallback(file_path)
        if not text.strip():
            raise ValueError("Markdown 文档内容为空")
        return _split_markdown_by_headers(text)

    if file_type == "txt":
        text = _read_text_with_fallback(file_path)
        if not text.strip():
            raise ValueError("文本文档内容为空")
        return [Document(page_content=text, metadata={})]

    raise ValueError(f"不支持的文件格式: {file_type}")


def load_and_split(
    file_path: str,
    file_type: str,
    chunk_size: Optional[int] = None,
    chunk_overlap: Optional[int] = None,
) -> list[Document]:
    """加载文档并分块，返回分块后的 Document 列表。"""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    settings = get_settings()
    chunk_size = chunk_size or settings.kb_chunk_size
    chunk_overlap = chunk_overlap or settings.kb_chunk_overlap

    docs = _load_documents(file_path, file_type)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
    splits = [doc for doc in splitter.split_documents(docs) if doc.page_content.strip()]

    logger.info(
        "document_loaded_and_split",
        file_type=file_type,
        raw_doc_count=len(docs),
        chunk_count=len(splits),
    )
    return splits
