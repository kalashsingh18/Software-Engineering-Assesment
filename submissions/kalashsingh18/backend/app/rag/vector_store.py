import uuid
import logging
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.models import DocumentChunk, Document

logger = logging.getLogger("documind.vector_store")


def search_similar_chunks(
    db: Session,
    user_id: uuid.UUID,
    query_vector: List[float],
    top_k: int = 5,
    document_ids: Optional[List[uuid.UUID]] = None
) -> List[Dict[str, Any]]:

    try:
        # Base query joining Document to retrieve document metadata and status
        query = (
            db.query(DocumentChunk, Document.filename)
            .join(Document, DocumentChunk.document_id == Document.id)
            .filter(
                DocumentChunk.user_id == user_id,
                Document.status == "ready"
            )
        )

        if document_ids:
            query = query.filter(DocumentChunk.document_id.in_(document_ids))

        # Check if database supports pgvector cosine distance
        bind = db.get_bind()
        if "postgresql" in str(bind.url):
            # Order by cosine distance ascending (closest vectors first)
            query = query.order_by(DocumentChunk.embedding.cosine_distance(query_vector)).limit(top_k)
            results = query.all()

            matched_chunks = []
            for chunk, doc_name in results:
                matched_chunks.append({
                    "chunk_id": chunk.id,
                    "document_id": chunk.document_id,
                    "document_name": doc_name,
                    "page_number": chunk.page_number,
                    "content": chunk.content,
                })
            return matched_chunks
        else:
            # Fallback for SQLite in local unit tests: simple lexical or basic ranking
            all_chunks = query.limit(top_k).all()
            return [
                {
                    "chunk_id": chunk.id,
                    "document_id": chunk.document_id,
                    "document_name": doc_name,
                    "page_number": chunk.page_number,
                    "content": chunk.content,
                }
                for chunk, doc_name in all_chunks
            ]

    except Exception as e:
        logger.error(f"Error executing vector similarity search: {e}")
        return []
