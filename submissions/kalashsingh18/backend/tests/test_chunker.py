from app.utils.chunker import chunk_text, extract_text_from_plain


def test_extract_text_from_plain():
    text_data = b"Hello world! This is a test document."
    pages = extract_text_from_plain(text_data)
    assert len(pages) == 1
    assert pages[0]["page_number"] == 1
    assert pages[0]["text"] == "Hello world! This is a test document."


def test_chunk_text_small_document():
    pages = [{"page_number": 1, "text": "Short document."}]
    chunks = chunk_text(pages, chunk_size=500, chunk_overlap=100)
    assert len(chunks) == 1
    assert chunks[0]["content"] == "Short document."
    assert chunks[0]["page_number"] == 1
    assert chunks[0]["chunk_index"] == 0


def test_chunk_text_sliding_window_overlap():
    long_text = "Word " * 200  # 1000 characters
    pages = [{"page_number": 1, "text": long_text}]
    chunks = chunk_text(pages, chunk_size=300, chunk_overlap=50)
    
    assert len(chunks) > 1
    for i, c in enumerate(chunks):
        assert c["chunk_index"] == i
        assert c["page_number"] == 1
        assert len(c["content"]) <= 350
