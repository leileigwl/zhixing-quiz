"""document_loader_service 单元测试"""

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.documents import Document

from app.services import document_loader_service


@pytest.fixture
def sample_text_content():
    # 生成足够长的文本，确保会被分成多个 chunk
    paragraph = "这是一段用于测试的知识库文档内容。" * 20
    return "\n\n".join([paragraph] * 5)


def test_load_and_split_txt(tmp_path, sample_text_content):
    file_path = tmp_path / "sample.txt"
    file_path.write_text(sample_text_content, encoding="utf-8")

    chunks = document_loader_service.load_and_split(str(file_path), "txt")

    assert len(chunks) > 1
    assert all(isinstance(c, Document) for c in chunks)
    assert all(c.page_content.strip() for c in chunks)


def test_load_and_split_md(tmp_path, sample_text_content):
    file_path = tmp_path / "sample.md"
    file_path.write_text(f"# 标题\n\n{sample_text_content}", encoding="utf-8")

    chunks = document_loader_service.load_and_split(str(file_path), "md")

    assert len(chunks) > 1


def test_load_and_split_respects_chunk_size(tmp_path):
    content = "字" * 5000
    file_path = tmp_path / "big.txt"
    file_path.write_text(content, encoding="utf-8")

    chunks = document_loader_service.load_and_split(
        str(file_path), "txt", chunk_size=500, chunk_overlap=50
    )

    assert len(chunks) >= 5
    for chunk in chunks:
        assert len(chunk.page_content) <= 500


def test_load_and_split_pdf_dispatches_to_pypdf_loader(tmp_path):
    file_path = tmp_path / "sample.pdf"
    file_path.write_bytes(b"%PDF-1.4 fake content")

    fake_docs = [Document(page_content="PDF 页面内容 " * 100, metadata={"page": 0})]
    mock_loader_instance = MagicMock()
    mock_loader_instance.load.return_value = fake_docs

    with patch(
        "langchain_community.document_loaders.PyPDFLoader",
        return_value=mock_loader_instance,
    ) as mock_loader_cls:
        chunks = document_loader_service.load_and_split(str(file_path), "pdf")

        mock_loader_cls.assert_called_once_with(str(file_path))
        assert len(chunks) >= 1


def test_load_and_split_docx_dispatches_to_docx2txt_loader(tmp_path):
    file_path = tmp_path / "sample.docx"
    file_path.write_bytes(b"fake docx content")

    fake_docs = [Document(page_content="Word 文档内容 " * 100, metadata={})]
    mock_loader_instance = MagicMock()
    mock_loader_instance.load.return_value = fake_docs

    with patch(
        "langchain_community.document_loaders.Docx2txtLoader",
        return_value=mock_loader_instance,
    ) as mock_loader_cls:
        chunks = document_loader_service.load_and_split(str(file_path), "docx")

        mock_loader_cls.assert_called_once_with(str(file_path))
        assert len(chunks) >= 1


def test_load_and_split_unsupported_format_raises(tmp_path):
    file_path = tmp_path / "sample.xlsx"
    file_path.write_bytes(b"fake content")

    with pytest.raises(ValueError, match="不支持的文件格式"):
        document_loader_service.load_and_split(str(file_path), "xlsx")


def test_load_and_split_gbk_encoded_txt(tmp_path):
    file_path = tmp_path / "gbk_note.txt"
    text = "计算机网络三次握手与四次挥手核心笔记。" * 10
    file_path.write_bytes(text.encode("gb18030"))

    chunks = document_loader_service.load_and_split(str(file_path), "txt")
    assert len(chunks) >= 1
    assert "三次握手" in chunks[0].page_content


def test_load_and_split_utf8_bom_md_and_headers(tmp_path):
    md_text = (
        "# 第一章 向量检索\n\n"
        "余弦相似度衡量方向一致性。\n\n"
        "## 1.1 HNSW 索引\n\n"
        "基于多层导航图的近似最近邻检索。\n\n"
        "# 第二章 事务幂等\n\n"
        "通过唯一键与事务保障不重复加分。\n"
    )
    file_path = tmp_path / "chapters.md"
    file_path.write_bytes(md_text.encode("utf-8-sig"))

    chunks = document_loader_service.load_and_split(str(file_path), "md", chunk_size=1000, chunk_overlap=50)
    assert len(chunks) >= 3
    hnsw_chunk = next(c for c in chunks if "HNSW" in c.page_content)
    assert "第一章 向量检索" in hnsw_chunk.page_content
    assert not any("第二章 事务幂等" in c.page_content for c in chunks if "余弦相似度" in c.page_content)


def test_load_and_split_empty_pdf_raises_clear_message(tmp_path):
    file_path = tmp_path / "scan.pdf"
    file_path.write_bytes(b"%PDF-1.4 scan")

    mock_loader_instance = MagicMock()
    mock_loader_instance.load.return_value = [Document(page_content="   ", metadata={"page": 0})]

    with patch(
        "langchain_community.document_loaders.PyPDFLoader",
        return_value=mock_loader_instance,
    ):
        with pytest.raises(ValueError, match="扫描版 PDF"):
            document_loader_service.load_and_split(str(file_path), "pdf")
