import uuid
import time
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from app.models.query_log import QueryLog
from app.models.chunk import DocumentChunk
from app.models.document import Document
from app.utils.embeddings import get_query_embedding
from app.rag.generator import generate_grounded_answer, REFUSAL_MESSAGE, OUT_OF_CONTEXT_MESSAGE


def answer_question(
    db: Session,
    user_id: uuid.UUID,
    question: str,
    document_ids: Optional[List[uuid.UUID]] = None,
    chat_history: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
   
    start_time = time.time()

    query_vector = get_query_embedding(question)


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

    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        results = query.order_by(DocumentChunk.embedding.cosine_distance(query_vector)).limit(5).all()
    else:
        results = query.limit(5).all()

    retrieved_chunks = [
        {
            "chunk_id": chunk.id,
            "document_id": chunk.document_id,
            "document_name": doc_name,
            "page_number": chunk.page_number,
            "content": chunk.content
        }
        for chunk, doc_name in results
    ]

    answer, usage = generate_grounded_answer(question, retrieved_chunks, chat_history=chat_history)

    citations = []
    is_refusal = (answer.strip() in (REFUSAL_MESSAGE, OUT_OF_CONTEXT_MESSAGE))

    if not is_refusal and retrieved_chunks:
        citations = [
            {
                "document_id": str(c["document_id"]),
                "document_name": c["document_name"],
                "page_number": c["page_number"],
                "passage": c["content"][:300] + ("..." if len(c["content"]) > 300 else "")
            }
            for c in retrieved_chunks
        ]

    log = QueryLog(
        user_id=user_id,
        question=question,
        answer=answer,
        citations=citations,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        latency_ms=usage["latency_ms"],
        estimated_cost=usage["estimated_cost_usd"]
    )
    db.add(log)
    db.commit()

    return {
        "question": question,
        "answer": answer,
        "citations": citations,
        "usage": usage,
        "grounded": not is_refusal
    }


def get_user_query_history(db: Session, user_id: uuid.UUID, limit: int = 50) -> List[QueryLog]:
    return (
        db.query(QueryLog)
        .filter(QueryLog.user_id == user_id)
        .order_by(QueryLog.created_at.desc())
        .limit(limit)
        .all()
    )
