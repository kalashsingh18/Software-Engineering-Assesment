import io
from typing import List, Dict, Any
from pypdf import PdfReader


def extract_text_from_pdf(file_bytes: bytes) -> List[Dict[str, Any]]:
    pages_data = []
    reader = PdfReader(io.BytesIO(file_bytes))
    for idx, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        pages_data.append({
            "page_number": idx + 1,
            "text": page_text.strip()
        })
    return pages_data


def extract_text_from_plain(file_bytes: bytes) -> List[Dict[str, Any]]:

    try:
        content = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content = file_bytes.decode("latin-1", errors="replace")
    
    return [{
        "page_number": 1,
        "text": content.strip()
    }]


def chunk_text(
    pages: List[Dict[str, Any]],
    chunk_size: int = 500,
    chunk_overlap: int = 100
) -> List[Dict[str, Any]]:
   
    chunks = []
    global_chunk_idx = 0

    for page_info in pages:
        page_num = page_info["page_number"]
        text = page_info["text"]

        if not text:
            continue

        if len(text) <= chunk_size:
            chunks.append({
                "chunk_index": global_chunk_idx,
                "page_number": page_num,
                "content": text
            })
            global_chunk_idx += 1
            continue

        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            
            if end < len(text):
                last_break = max(
                    text.rfind("\n", start, end),
                    text.rfind(". ", start, end),
                    text.rfind(" ", start, end)
                )
                if last_break > start + (chunk_size // 2):
                    end = last_break + 1

            chunk_str = text[start:end].strip()
            if chunk_str:
                chunks.append({
                    "chunk_index": global_chunk_idx,
                    "page_number": page_num,
                    "content": chunk_str
                })
                global_chunk_idx += 1

            start += chunk_size - chunk_overlap

    return chunks
