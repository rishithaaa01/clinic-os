from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional, Dict, Any
from services.transcription_service import transcription_service
from services.local_ai_service import local_ai
from services.ollama_service import ollama_service
from middleware.auth_middleware import get_current_user
from models.user import UserResponse
import os
import tempfile
import uuid
import time
import asyncio
from collections import defaultdict

router = APIRouter()

rate_limit_store = defaultdict(list)

def check_rate_limit(key: str, limit: int, window: int) -> bool:
    now = time.time()
    rate_limit_store[key] = [t for t in rate_limit_store[key] if now - t < window]
    if len(rate_limit_store[key]) >= limit:
        return False
    rate_limit_store[key].append(now)
    return True

class AnalyzeTranscriptRequest(BaseModel):
    transcript: str

class EnrichTranscriptRequest(BaseModel):
    transcript: str
    disease_prediction: Optional[Dict[str, Any]] = None

# ── STAGE 1: Audio Upload & Whisper Transcription ───────────────────────────
@router.post("/transcribe")
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    STAGE 1 VOICE ENDPOINT
    Uploads audio file, normalizes via ffmpeg, and transcribes via local Whisper.
    Returns transcript immediately without blocking on ML models or Ollama.
    """
    t_start = time.perf_counter()
    
    rate_limit_key = f"voice_transcribe:{current_user.id}"
    if not check_rate_limit(rate_limit_key, limit=15, window=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    ext = os.path.splitext(file.filename or "audio.bin")[1].lower() or ".bin"
    if ext not in ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.bin', '.3gp', '.aac', '.amr', '.mp4', '.caf']:
        raise HTTPException(status_code=400, detail=f"Unsupported audio format: {ext}")
        
    clean_mime = (file.content_type or "").split(';')[0].strip().lower()
    allowed_content_types = [
        "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", 
        "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/webm", 
        "video/webm", "application/octet-stream", "audio/x-caf",
        "audio/3gpp", "video/3gpp", "audio/aac", "audio/amr", "audio/mp4"
    ]
    if clean_mime and clean_mime not in allowed_content_types:
        raise HTTPException(status_code=400, detail=f"Invalid audio MIME type: {file.content_type}")

    temp_dir = tempfile.gettempdir()
    temp_filename = f"upload_{uuid.uuid4().hex}{ext}"
    temp_path = os.path.join(temp_dir, temp_filename)
    client_type = request.headers.get("x-client-type", "web")
    
    try:
        t_upload_start = time.perf_counter()
        MAX_FILE_SIZE = 15 * 1024 * 1024
        file_size = 0
        with open(temp_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="File too large. Max allowed size is 15MB.")
                buffer.write(chunk)
        t_upload_end = time.perf_counter()
        
        # Audio normalization & Whisper STT
        t_stt_start = time.perf_counter()
        transcript = await transcription_service.transcribe(temp_path, client_type=client_type, mime_type=file.content_type)
        t_stt_end = time.perf_counter()
        
        total_ms = (time.perf_counter() - t_start) * 1000
        upload_ms = (t_upload_end - t_upload_start) * 1000
        stt_ms = (t_stt_end - t_stt_start) * 1000
        
        # Developer-only timing log
        print(f"""
[DEV TIMING LOG - VOICE STAGE 1: TRANSCRIBE] Client: {client_type} | File: {file.filename} ({file_size}B)
├─ 1. Upload & Temp Save    : {upload_ms:.2f} ms
├─ 2. STT (Whisper Engine)  : {stt_ms:.2f} ms
└─ TOTAL STAGE 1 DURATION   : {total_ms:.2f} ms
""")

        return {
            "status": "success",
            "transcript": transcript,
            "raw_transcription": transcript,
            "audio_size_bytes": file_size,
            "stage": "transcription_complete"
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"❌ Stage 1 Transcribe Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Voice transcription failed: {str(e)}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


# ── STAGE 2: Deterministic Disease & Referral ML Models ──────────────────────
@router.post("/analyze")
async def analyze_transcript(
    req: AnalyzeTranscriptRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    STAGE 2 VOICE ENDPOINT
    Runs fast deterministic trained ML models for Disease Prediction and Specialty Referral.
    Executes in < 50ms without blocking on LLMs.
    """
    t_start = time.perf_counter()
    transcript = req.transcript.strip() if req.transcript else ""

    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript cannot be empty.")

    t_dis_start = time.perf_counter()
    disease_res = local_ai.predict_disease(transcript)
    t_dis_end = time.perf_counter()

    t_ref_start = time.perf_counter()
    referral_res = local_ai.predict_referral(transcript)
    t_ref_end = time.perf_counter()

    insights = local_ai.generate_clinical_insights(transcript)

    dis_ms = (t_dis_end - t_dis_start) * 1000
    ref_ms = (t_ref_end - t_ref_start) * 1000
    total_ms = (time.perf_counter() - t_start) * 1000

    print(f"""
[DEV TIMING LOG - VOICE STAGE 2: DETERMINISTIC ML ANALYZER]
├─ 1. Disease Model Prediction : {dis_ms:.2f} ms
├─ 2. Referral Model Classifier: {ref_ms:.2f} ms
└─ TOTAL STAGE 2 DURATION      : {total_ms:.2f} ms
""")

    return {
        "status": "success",
        "transcript": transcript,
        "predicted_condition": disease_res.get("predicted_condition"),
        "predicted_disease": disease_res.get("predicted_disease"),
        "disease_confidence": disease_res.get("confidence"),
        "recommended_specialty": referral_res.get("recommended_specialty"),
        "referral_confidence": referral_res.get("confidence"),
        "explanation": disease_res.get("explanation"),
        "risk_level": insights.get("Risk Level", "Routine"),
        "clinical_insights": insights.get("Follow-up Advice"),
        "suggested_tests": insights.get("Suggested Tests"),
        "stage": "analysis_complete"
    }


# ── STAGE 3: Optional Ollama LLM Enrichment ──────────────────────────────────
@router.post("/enrich")
async def enrich_transcript(
    req: EnrichTranscriptRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    STAGE 3 VOICE ENDPOINT (OPTIONAL)
    Structures clinical notes via Ollama with a strict 2.5s timeout.
    If Ollama is slow/unavailable, returns controlled fallback without throwing HTTP errors.
    """
    t_start = time.perf_counter()
    transcript = req.transcript.strip() if req.transcript else ""

    if not transcript:
        return {
            "status": "fallback",
            "ollama_status": "unavailable",
            "message": "Advanced clinical insights are temporarily unavailable."
        }

    try:
        t_ollama_start = time.perf_counter()
        structured_data = await asyncio.wait_for(
            ollama_service.structure_clinical_text(transcript),
            timeout=2.5
        )
        t_ollama_end = time.perf_counter()
        ollama_ms = (t_ollama_end - t_ollama_start) * 1000
        
        ollama_status = structured_data.get("ollama_status", "available")
        print(f"[DEV TIMING LOG - VOICE STAGE 3: OLLAMA ENRICHMENT] Duration: {ollama_ms:.2f} ms | Status: {ollama_status}")

        return {
            "status": "success",
            "ollama_status": ollama_status,
            "structured": structured_data,
            "stage": "enrichment_complete"
        }
    except Exception as ex:
        total_ms = (time.perf_counter() - t_start) * 1000
        print(f"[DEV TIMING LOG - VOICE STAGE 3: OLLAMA ENRICHMENT] Timed out or unavailable after {total_ms:.2f} ms: {ex}")
        return {
            "status": "fallback",
            "ollama_status": "unavailable",
            "message": "Advanced clinical insights are temporarily unavailable.",
            "stage": "enrichment_fallback"
        }
