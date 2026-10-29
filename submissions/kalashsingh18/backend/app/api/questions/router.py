from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.utils.security import get_current_user
from app.utils.rate_limiter import check_rate_limit
from app.services.rag_service import answer_question, get_user_query_history
from app.api.questions.schemas import (
    QuestionRequest,
    QuestionResponse,
    QueryLogResponse
)

router = APIRouter(prefix="/questions", tags=["Questions & RAG"])


@router.post("/ask", response_model=QuestionResponse)
def ask(
    data: QuestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
   
    check_rate_limit(str(current_user.id))

    return answer_question(
        db=db,
        user_id=current_user.id,
        question=data.question,
        document_ids=data.document_ids
    )


@router.post("/stream")
def stream_ask(
    data: QuestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from fastapi.responses import StreamingResponse
    from app.utils.embeddings import get_query_embedding
    from app.rag.vector_store import search_similar_chunks
    from app.rag.generator import stream_grounded_answer

    check_rate_limit(str(current_user.id))

    # Retrieve vector matches
    query_vec = get_query_embedding(data.question)
    retrieved = search_similar_chunks(
        db=db,
        user_id=current_user.id,
        query_vector=query_vec,
        top_k=3,
        document_ids=data.document_ids
    )

    # Convert chat history to plain dicts for the generator
    history = None
    if data.chat_history:
        history = [{"role": t.role, "content": t.content} for t in data.chat_history]

    return StreamingResponse(
        stream_grounded_answer(data.question, retrieved, chat_history=history),
        media_type="text/event-stream"
    )


@router.get("/history", response_model=List[QueryLogResponse])
def get_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return get_user_query_history(db, current_user.id)
