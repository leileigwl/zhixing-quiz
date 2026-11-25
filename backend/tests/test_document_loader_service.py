"""document_loader_service 单元测试"""

from unittest.mock import patch

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


def _make_pdf(path, texts):
    """用 pypdf 生成带文字的真实 PDF（Helvetica，仅 ASCII），供解析回归测试使用。"""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
        )
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1"))
        page[NameObject("/Contents")] = writer._add_object(stream)
    with open(path, "wb") as f:
        writer.write(f)


def test_load_and_split_real_pdf_extracts_each_page(tmp_path):
    file_path = tmp_path / "sample.pdf"
    _make_pdf(file_path, ["Ebbinghaus forgetting curve page one", "Spaced repetition page two"])

    chunks = document_loader_service.load_and_split(str(file_path), "pdf")

    joined = "\n".join(c.page_content for c in chunks)
    assert "forgetting curve" in joined
    assert "Spaced repetition" in joined
    pages = sorted({c.metadata["page"] for c in chunks})
    assert pages == [0, 1]
    assert all(c.metadata["total_pages"] == 2 for c in chunks)


def test_load_pdf_blank_pages_raise_friendly_error(tmp_path):
    from pypdf import PdfWriter

    file_path = tmp_path / "blank.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    with open(file_path, "wb") as f:
        writer.write(f)

    with pytest.raises(ValueError, match="未提取到有效文字"):
        document_loader_service.load_and_split(str(file_path), "pdf")


def test_load_pdf_corrupted_file_raises_friendly_error(tmp_path):
    file_path = tmp_path / "broken.pdf"
    file_path.write_bytes(b"%PDF-1.4 fake content")

    with pytest.raises(ValueError):
        document_loader_service.load_and_split(str(file_path), "pdf")


def test_load_pdf_rejects_too_many_pages(tmp_path, monkeypatch):
    file_path = tmp_path / "many.pdf"
    _make_pdf(file_path, ["a", "b", "c"])
    monkeypatch.setattr(document_loader_service, "MAX_PDF_PAGES", 2)

    with pytest.raises(ValueError, match="页数过多"):
        document_loader_service.load_and_split(str(file_path), "pdf")


def test_load_and_split_docx_dispatches_to_docx2txt(tmp_path):
    file_path = tmp_path / "sample.docx"
    file_path.write_bytes(b"fake docx content")

    with patch("docx2txt.process", return_value="Word 文档内容 " * 100) as mock_process:
        chunks = document_loader_service.load_and_split(str(file_path), "docx")

        mock_process.assert_called_once_with(str(file_path))
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

    with patch.object(
        document_loader_service,
        "_load_pdf",
        return_value=[Document(page_content="   ", metadata={"page": 0})],
    ):
        with pytest.raises(ValueError, match="扫描版 PDF"):
            document_loader_service.load_and_split(str(file_path), "pdf")
