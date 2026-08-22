import os
import uuid
import tempfile
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from typing import Optional
from bson import ObjectId
from database import get_database
from middleware.auth_middleware import get_current_user, require_role
from models.user import UserResponse
from config import settings

router = APIRouter()

# ─── Cloudinary Setup ─────────────────────────────────────────────────────────

def get_cloudinary():
    """Lazy-load cloudinary only if configured."""
    if not all([settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret]):
        return None
    try:
        import cloudinary
        import cloudinary.uploader
        cloudinary.config(
            cloud_name=settings.cloudinary_cloud_name,
            api_key=settings.cloudinary_api_key,
            api_secret=settings.cloudinary_api_secret,
            secure=True
        )
        return cloudinary
    except ImportError:
        return None


def safe_object_id(id_str: str):
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid ID format: {id_str}")


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def extract_pdf_text(pdf_path: str) -> str:
    """Extract text from PDF using pdfplumber."""
    try:
        import pdfplumber
        text_parts = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text.strip())
        return "\n".join(text_parts) if text_parts else ""
    except Exception as e:
        print(f"PDF extraction error: {e}")
        return ""


import re
import asyncio

def fast_lab_ocr_parser(raw_text: str, test_name: str, patient_name: str) -> dict:
    """Instant regex-based clinical lab OCR parameter extractor."""
    key_values = []
    is_abnormal = False

    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    
    param_patterns = [
        (r"(protein|albumin)\s*[:=\-]?\s*([a-zA-Z0-9\+\-\.\/ ]+)", "Protein / Albumin"),
        (r"(sugar|glucose)\s*[:=\-]?\s*([a-zA-Z0-9\+\-\.\/ ]+)", "Sugar / Glucose"),
        (r"(pus\s*cells?|wbc|leukocytes?)\s*[:=\-]?\s*([a-zA-Z0-9\+\-\.\/ ]+)", "Pus Cells / WBC"),
        (r"(rbc|red\s*blood\s*cells?)\s*[:=\-]?\s*([a-zA-Z0-9\+\-\.\/ ]+)", "RBC"),
        (r"(epithelial\s*cells?)\s*[:=\-]?\s*([a-zA-Z0-9\+\-\.\/ ]+)", "Epithelial Cells"),
        (r"(hemoglobin|hb)\s*[:=\-]?\s*([0-9\.]+\s*(?:g/dl|g%|g/l)?)", "Hemoglobin"),
        (r"(creatinine)\s*[:=\-]?\s*([0-9\.]+\s*(?:mg/dl)?)", "Creatinine"),
        (r"(urea)\s*[:=\-]?\s*([0-9\.]+\s*(?:mg/dl)?)", "Serum Urea"),
        (r"(ph)\s*[:=\-]?\s*([0-9\.]+)", "pH"),
        (r"(specific\s*gravity)\s*[:=\-]?\s*([0-9\.]+)", "Specific Gravity"),
        (r"(color|colour)\s*[:=\-]?\s*([a-zA-Z]+)", "Color"),
        (r"(appearance|clarity)\s*[:=\-]?\s*([a-zA-Z]+)", "Appearance")
    ]

    found_params = set()
    for pattern, name in param_patterns:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match and name not in found_params:
            val = match.group(2).strip()
            val = val.split('\t')[0].split('  ')[0]
            val_lower = val.lower()
            status = "normal"
            if any(k in val_lower for k in ["+", "present", "high", "abnormal", "positive", "many", "numerous", "heavy"]):
                status = "high"
                is_abnormal = True
            elif "low" in val_lower or "decreased" in val_lower:
                status = "low"
                is_abnormal = True

            key_values.append({
                "parameter": name,
                "value": val[:40],
                "reference_range": "Normal / Nil",
                "status": status
            })
            found_params.add(name)

    HEADER_IGNORE_KEYS = [
        "patient", "name", "age", "sex", "gender", "ref", "doctor", "dr",
        "date", "hospital", "lab", "reg", "uhid", "barcode", "sample",
        "location", "collection", "received", "reported", "client", "address",
        "mrn", "id", "phone", "mobile", "status", "test name"
    ]

    if not key_values:
        for line in lines:
            if ":" in line and len(line) < 70:
                parts = line.split(":", 1)
                key_part = parts[0].strip().lower()
                # Skip patient header metadata
                if any(hdr in key_part for hdr in HEADER_IGNORE_KEYS):
                    continue
                val_part = parts[1].strip()
                if val_part:
                    key_values.append({
                        "parameter": parts[0].strip()[:30],
                        "value": val_part[:30],
                        "reference_range": "As reported",
                        "status": "normal"
                    })

    # Ensure patient name is NEVER included in parameters list
    key_values = [
        kv for kv in key_values
        if not any(hdr in kv["parameter"].lower() for hdr in ["patient", "name", "age", "sex", "doctor", "dr"])
    ]

    summary = f"Lab report parsed for {test_name}. {len(key_values)} clinical parameters extracted."
    if is_abnormal:
        abnormal_names = [k['parameter'] for k in key_values if k['status'] != 'normal']
        summary += f" ⚠️ Abnormal findings detected in: {', '.join(abnormal_names)}."

    recommendation = "Clinical correlation advised." if is_abnormal else "Parameters within expected limits."

    return {
        "summary": summary,
        "key_values": key_values[:15],
        "is_abnormal": is_abnormal,
        "recommendation": recommendation
    }


async def ai_summarize_report(raw_text: str, test_name: str, patient_name: str, client_type: str = "web") -> dict:
    """Use fast OCR parser with fast LLM fallback to extract values and summarize lab report."""
    if not raw_text.strip():
        return {
            "summary": "Report uploaded. Manual review required.",
            "key_values": [],
            "is_abnormal": False,
            "recommendation": "Please review the uploaded PDF report."
        }

    # Generate instant regex OCR parse first
    fallback_res = fast_lab_ocr_parser(raw_text, test_name, patient_name)

    # Fast OCR extraction for both Web and Mobile
    print(f"⚡ [LAB OCR] Client: {client_type} | Running fast OCR extraction...")
    try:
        from services.ollama_service import ollama_service
        prompt = f"""You are a clinical laboratory AI assistant.
Analyze this lab report text for patient: {patient_name}
Test: {test_name}

Lab Report Text:
{raw_text[:2000]}

IMPORTANT: Extract ONLY actual medical test parameters (e.g. Hemoglobin, Protein, Glucose, WBC, RBC, Serum Creatinine). Do NOT include patient header metadata like "Patient Name", "Age", "Sex", "Referred By", "Date", or "Lab ID" as key_values.

Respond ONLY in this exact JSON format:
{{
  "summary": "2-3 sentence clinical summary of findings for a doctor",
  "key_values": [
    {{"parameter": "parameter name", "value": "result value with unit", "reference_range": "normal range", "status": "normal/high/low/critical"}}
  ],
  "is_abnormal": false,
  "recommendation": "One sentence clinical recommendation"
}}"""
        raw_res = await asyncio.wait_for(
            ollama_service.generate_completion(prompt, "Output strictly valid JSON."),
            timeout=float(getattr(settings, 'ollama_timeout', 3.0))
        )
        clean_res = (raw_res or "").strip()
        if clean_res.startswith("```json"): clean_res = clean_res[7:]
        if clean_res.startswith("```"): clean_res = clean_res[3:]
        res_dict = json.loads(clean_res.strip())
        raw_kv = res_dict.get("key_values", fallback_res["key_values"])
        if isinstance(raw_kv, list):
            filtered_kv = [
                kv for kv in raw_kv
                if isinstance(kv, dict) and not any(hdr in str(kv.get("parameter", "")).lower() for hdr in ["patient", "name", "age", "sex", "gender", "doctor", "dr", "ref", "date", "hospital", "lab no", "reg no"])
            ]
        else:
            filtered_kv = fallback_res["key_values"]

        return {
            "summary": str(res_dict.get("summary", fallback_res["summary"]))[:1000],
            "key_values": filtered_kv[:20],
            "is_abnormal": bool(res_dict.get("is_abnormal", fallback_res["is_abnormal"])),
            "recommendation": str(res_dict.get("recommendation", fallback_res["recommendation"]))[:500]
        }
    except Exception as e:
        print(f"Ollama timeout/fallback -> using Fast OCR parser ({e})")
        return fallback_res


async def upload_pdf_to_cloudinary(file_path: str, lab_order_id: str) -> Optional[str]:
    """Upload PDF to Cloudinary and return the secure URL."""
    cloudinary = get_cloudinary()
    if not cloudinary:
        print("[CLOUDINARY DIAGNOSTIC] Cloudinary not configured — skipping PDF upload")
        return None

    try:
        pid = f"lab_{lab_order_id}_{uuid.uuid4().hex[:8]}.pdf"
        result = cloudinary.uploader.upload(
            file_path,
            resource_type="raw",
            folder="ayu_disha/lab_reports",
            public_id=pid,
            access_mode="public"
        )
        sec_url = result.get("secure_url")
        print(f"[CLOUDINARY UPLOAD DIAGNOSTIC]\n"
              f"  lab_order_id: {lab_order_id}\n"
              f"  public_id: {result.get('public_id')}\n"
              f"  resource_type: {result.get('resource_type')}\n"
              f"  format: {result.get('format')}\n"
              f"  bytes: {result.get('bytes')}\n"
              f"  secure_url: {sec_url}")
        return sec_url
    except Exception as e:
        print(f"[CLOUDINARY DIAGNOSTIC] Raw upload attempt failed ({e}), trying fallback...")
        try:
            result = cloudinary.uploader.upload(
                file_path,
                resource_type="auto",
                folder="ayu_disha/lab_reports",
                public_id=f"lab_{lab_order_id}_{uuid.uuid4().hex[:8]}",
                access_mode="public"
            )
            sec_url = result.get("secure_url")
            print(f"[CLOUDINARY FALLBACK SUCCESS] secure_url: {sec_url}")
            return sec_url
        except Exception as e2:
            print(f"[CLOUDINARY ERROR] Cloudinary upload error: {e2}")
            return None


async def get_lab_tech_hospital(current_user: UserResponse, db) -> str:
    if current_user.hospital and current_user.hospital.strip():
        return current_user.hospital
    first = await db.hospitals.find_one({})
    h_name = first.get("name") if first else "General Hospital"
    try:
        await db.users.update_one(
            {"_id": safe_object_id(str(current_user.id))},
            {"$set": {"hospital": h_name}}
        )
    except Exception:
        pass
    return h_name

# ─── Lab Endpoints ────────────────────────────────────────────────────────────

from pydantic import BaseModel

class LabOrderCreateRequest(BaseModel):
    patient_id: str
    test_name: str
    test_type: Optional[str] = None
    indication: Optional[str] = None
    visit_id: Optional[str] = None

@router.post("/orders")
async def create_lab_order(
    order_in: LabOrderCreateRequest,
    current_user: UserResponse = Depends(require_role("doctor"))
):
    """
    Doctor creates a lab order for a patient during consultation.
    Persists lab_order with lab_order_id, patient_id, doctor_id, hospital_id, test_name, indication, status='pending'.
    """
    db = get_database()
    if not current_user.hospital:
        raise HTTPException(status_code=403, detail="Doctor is not assigned to any hospital")

    patient = await db.patients.find_one({"_id": safe_object_id(order_in.patient_id)})
    if not patient:
        patient = await db.patients.find_one({"user_id": order_in.patient_id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    patient_id_str = str(patient["_id"])
    patient_name = patient.get("name", "Patient")

    order_doc = {
        "patient_id": patient_id_str,
        "patient_name": patient_name,
        "visit_id": order_in.visit_id,
        "doctor_id": str(current_user.id),
        "ordered_by": current_user.name,
        "doctor_name": current_user.name,
        "hospital_id": current_user.hospital,
        "hospital_name": current_user.hospital,
        "test_name": order_in.test_name,
        "test_type": order_in.test_type or order_in.test_name,
        "indication": order_in.indication or "Clinical assessment",
        "status": "pending",
        "ordered_date": datetime.utcnow(),
        "created_at": datetime.utcnow()
    }

    res = await db.lab_orders.insert_one(order_doc)
    order_id = str(res.inserted_id)

    # Attach to visit if visit_id provided
    if order_in.visit_id:
        try:
            await db.visits.update_one(
                {"_id": ObjectId(order_in.visit_id)},
                {"$push": {"lab_orders": {"order_id": order_id, "test_name": order_in.test_name, "status": "pending"}}}
            )
        except Exception:
            pass

    order_doc["_id"] = order_id
    order_doc["id"] = order_id
    return order_doc

def safe_object_id_silent(id_str: str) -> Optional[ObjectId]:
    try:
        return ObjectId(id_str) if id_str else None
    except Exception:
        return None

async def resolve_order_names(o: dict, db) -> dict:
    o["_id"] = str(o["_id"])
    
    # 1. Resolve test_name
    test_name = o.get("test_name") or o.get("test_type") or o.get("test") or o.get("name") or "General Lab Test"
    o["test_name"] = str(test_name).strip()
    
    # 2. Resolve patient_name
    patient_name = o.get("patient_name") or "Unknown Patient"
    if patient_name == "Unknown Patient" and o.get("patient_id"):
        pid = str(o["patient_id"])
        p_obj = safe_object_id_silent(pid)
        p_doc = None
        if p_obj:
            p_doc = await db.patients.find_one({"_id": p_obj})
        if not p_doc:
            p_doc = await db.patients.find_one({"user_id": pid})
        if not p_doc and p_obj:
            p_doc = await db.users.find_one({"_id": p_obj})
        if not p_doc:
            p_doc = await db.users.find_one({"mobile": pid})
        if p_doc:
            patient_name = p_doc.get("name") or patient_name
            
    o["patient_name"] = patient_name
    return o

@router.get("/pending-orders")
async def get_pending_orders(current_user: UserResponse = Depends(require_role("lab"))):
    """
    Returns all pending lab orders for this lab technician's hospital.
    """
    db = get_database()
    hospital_name = await get_lab_tech_hospital(current_user, db)

    orders = await db.lab_orders.find({
        "hospital_id": hospital_name,
        "status": {"$in": ["pending", "ordered"]}
    }).sort("ordered_date", 1).to_list(200)

    results = []
    for o in orders:
        enriched = await resolve_order_names(o, db)
        results.append(enriched)

    return results


@router.get("/completed-orders")
async def get_completed_orders(current_user: UserResponse = Depends(require_role("lab"))):
    """Returns recently resulted lab orders for this lab's hospital."""
    db = get_database()
    hospital_name = await get_lab_tech_hospital(current_user, db)

    orders = await db.lab_orders.find({
        "hospital_id": hospital_name,
        "status": "resulted"
    }).sort("result_date", -1).limit(50).to_list(50)

    results = []
    for o in orders:
        enriched = await resolve_order_names(o, db)
        results.append(enriched)

    return results


@router.post("/upload-result/{lab_order_id}")
async def upload_lab_result(
    request: Request,
    lab_order_id: str,
    result_text: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: UserResponse = Depends(require_role("lab"))
):
    """
    Lab technician uploads result:
    - result_text: typed result value (e.g. "HbA1c: 7.2%")
    - file: optional PDF report
    - Extracts PDF text → AI summary → stores everything → notifies doctor & patient
    """
    db = get_database()
    hospital_name = await get_lab_tech_hospital(current_user, db)

    # Verify lab order exists and belongs to this hospital
    lab_order = await db.lab_orders.find_one({"_id": safe_object_id(lab_order_id)})
    if not lab_order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    if lab_order.get("hospital_id") and lab_order.get("hospital_id") != hospital_name:
        raise HTTPException(status_code=403, detail="Access denied to this lab order")

    # Multipart file logging for audit
    if file and file.filename:
        print(f"📄 [LAB PDF UPLOAD] filename='{file.filename}', MIME='{file.content_type}', lab_order_id='{lab_order_id}'")

    # Get patient name for AI context
    patient_name = "Unknown Patient"
    try:
        if lab_order.get("patient_id") and len(str(lab_order["patient_id"])) == 24:
            patient = await db.patients.find_one({"_id": ObjectId(lab_order["patient_id"])})
            if patient:
                patient_name = patient.get("name", "Unknown Patient")
    except Exception:
        pass

    pdf_url = None
    pdf_text = ""
    temp_path = None

    # Handle PDF upload
    if file and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in [".pdf"]:
            raise HTTPException(status_code=400, detail="Only PDF files are accepted for lab reports")

        # Save to temp file
        temp_dir = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, f"lab_{uuid.uuid4().hex}.pdf")

        try:
            MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
            file_size = 0
            with open(temp_path, "wb") as f:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    file_size += len(chunk)
                    if file_size > MAX_FILE_SIZE:
                        raise HTTPException(status_code=413, detail="File too large. Max 20MB.")
                    f.write(chunk)

            # Extract text from PDF
            pdf_text = await extract_pdf_text(temp_path)
            print(f"Extracted {len(pdf_text)} chars from PDF")

            # Upload to Cloudinary (or fallback to local uploads)
            pdf_url = await upload_pdf_to_cloudinary(temp_path, lab_order_id)
            if not pdf_url:
                try:
                    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "lab_reports")
                    os.makedirs(uploads_dir, exist_ok=True)
                    local_filename = f"lab_{lab_order_id}_{uuid.uuid4().hex[:8]}.pdf"
                    local_filepath = os.path.join(uploads_dir, local_filename)
                    import shutil
                    shutil.copy2(temp_path, local_filepath)
                    pdf_url = f"/uploads/lab_reports/{local_filename}"
                    print(f"Stored PDF locally at: {pdf_url}")
                except Exception as local_err:
                    print(f"Failed to store PDF locally: {local_err}")

        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    # Build combined text for AI (PDF text + manual result)
    combined_text = ""
    if pdf_text:
        combined_text = pdf_text
    elif result_text:
        combined_text = result_text

    client_type = request.headers.get("x-client-type", "web")
    
    # AI summary
    ai_result = await ai_summarize_report(
        combined_text or result_text,
        lab_order.get("test_name", "Lab Test"),
        patient_name,
        client_type
    )

    # Update the lab order
    update_data = {
        "result": (result_text or "").strip() or "PDF Report Uploaded",
        "result_notes": notes,
        "result_date": datetime.utcnow(),
        "resulted_by": current_user.name,
        "resulted_by_id": str(current_user.id),
        "status": "resulted",
        # PDF
        "pdf_url": pdf_url,
        "pdf_text_extracted": pdf_text[:5000] if pdf_text else None,
        # AI
        "ai_summary": ai_result["summary"],
        "ai_key_values": ai_result["key_values"],
        "ai_is_abnormal": ai_result["is_abnormal"],
        "ai_recommendation": ai_result["recommendation"],
    }

    await db.lab_orders.update_one(
        {"_id": safe_object_id(lab_order_id)},
        {"$set": update_data}
    )

    # Create notification records for doctor and patient
    now = datetime.utcnow()
    test_name = lab_order.get("test_name", "Lab Test")
    is_abnormal = ai_result["is_abnormal"]

    # Notify doctor
    doctor_id = lab_order.get("doctor_id") or lab_order.get("ordered_by_id")
    if doctor_id:
        await db.notifications.insert_one({
            "user_id": doctor_id,
            "type": "lab_result",
            "title": f"Lab Result: {test_name}",
            "message": f"Result for {patient_name} — {test_name} is now available.{' ⚠️ Abnormal values detected.' if is_abnormal else ''}",
            "lab_order_id": lab_order_id,
            "patient_id": lab_order.get("patient_id"),
            "is_abnormal": is_abnormal,
            "pdf_url": pdf_url,
            "read": False,
            "created_at": now
        })

    # Notify patient (via user_id lookup from patient record)
    try:
        patient_record = await db.patients.find_one({"_id": ObjectId(lab_order["patient_id"])})
        if patient_record and patient_record.get("user_id"):
            await db.notifications.insert_one({
                "user_id": patient_record["user_id"],
                "type": "lab_result",
                "title": f"Your {test_name} result is ready",
                "message": f"Your lab report from {current_user.hospital} is now available.{' Please consult your doctor — some values need attention.' if is_abnormal else ''}",
                "lab_order_id": lab_order_id,
                "is_abnormal": is_abnormal,
                "pdf_url": pdf_url,
                "read": False,
                "created_at": now
            })
    except Exception as e:
        print(f"Patient notification error: {e}")

    return {
        "status": "success",
        "lab_order_id": lab_order_id,
        "pdf_url": pdf_url,
        "ai_summary": ai_result["summary"],
        "ai_is_abnormal": ai_result["is_abnormal"],
        "ai_key_values": ai_result["key_values"],
        "message": f"Result uploaded successfully. {'⚠️ Abnormal values detected — doctor notified.' if is_abnormal else 'Doctor and patient notified.'}"
    }

@router.post("/orders/{lab_order_id}/summarize")
async def summarize_lab_order(request: Request, lab_order_id: str, current_user: UserResponse = Depends(get_current_user)):
    """
    Triggers AI OCR text extraction and clinical summarization on an uploaded lab report.
    """
    db = get_database()
    lab_order = await db.lab_orders.find_one({"_id": safe_object_id(lab_order_id)})
    if not lab_order:
        raise HTTPException(status_code=404, detail="Lab order not found")

    text_to_process = lab_order.get("pdf_text_extracted") or lab_order.get("result") or ""
    if not text_to_process:
        raise HTTPException(status_code=400, detail="No report text or PDF content found to summarize.")

    patient_name = "Patient"
    try:
        p = await db.patients.find_one({"_id": ObjectId(lab_order["patient_id"])})
        if p: patient_name = p.get("name", "Patient")
    except Exception:
        pass

    client_type = request.headers.get("x-client-type", "web")
    ai_result = await ai_summarize_report(
        text_to_process,
        lab_order.get("test_name", "Lab Test"),
        patient_name,
        client_type
    )

    await db.lab_orders.update_one(
        {"_id": safe_object_id(lab_order_id)},
        {"$set": {
            "ai_summary": ai_result["summary"],
            "ai_key_values": ai_result["key_values"],
            "ai_is_abnormal": ai_result["is_abnormal"],
            "ai_recommendation": ai_result["recommendation"]
        }}
    )

    return {
        "status": "success",
        "ai_summary": ai_result["summary"],
        "ai_key_values": ai_result["key_values"],
        "ai_is_abnormal": ai_result["is_abnormal"],
        "ai_recommendation": ai_result["recommendation"]
    }

@router.get("/notifications")
async def get_lab_notifications(current_user: UserResponse = Depends(get_current_user)):
    """Returns unread lab result notifications for the current user (doctor or patient)."""
    db = get_database()
    notifications = await db.notifications.find({
        "user_id": str(current_user.id),
        "type": "lab_result"
    }).sort("created_at", -1).limit(20).to_list(20)

    results = []
    for n in notifications:
        n["_id"] = str(n["_id"])
        results.append(n)

    return results


@router.get("/results/{lab_order_id}")
async def get_lab_result(lab_order_id: str, current_user: UserResponse = Depends(get_current_user)):
    """
    Get a lab result with strict access control.
    Only accessible to:
    1. The patient (owner of the report)
    2. The doctor that the patient is assigned to
    3. Lab technician who uploaded it (for their hospital only)
    """
    db = get_database()
    
    lab_order = await db.lab_orders.find_one({"_id": safe_object_id(lab_order_id)})
    if not lab_order:
        raise HTTPException(status_code=404, detail="Lab result not found")
    
    patient_id = lab_order.get("patient_id")
    patient = await db.patients.find_one({"_id": ObjectId(patient_id)}) if patient_id else None
    
    # Check access permissions
    has_access = False
    access_reason = None
    
    # 1. Check if current user is the patient
    if patient and patient.get("user_id") == str(current_user.id):
        has_access = True
        access_reason = "patient"
    
    # 2. Check if current user is the assigned doctor
    if current_user.role == "doctor" and patient:
        # Get patient's assigned doctor from visits or consultations
        recent_visit = await db.visits.find_one({
            "patient_id": patient_id,
            "doctor_id": str(current_user.id),
            "status": {"$in": ["active", "completed"]}
        }).sort("date", -1)
        
        if recent_visit:
            has_access = True
            access_reason = "assigned_doctor"
    
    # 3. Check if current user is the lab tech who uploaded it (same hospital)
    if current_user.role == "lab":
        if lab_order.get("hospital_id") == current_user.hospital:
            has_access = True
            access_reason = "lab_tech_same_hospital"
    
    if not has_access:
        raise HTTPException(
            status_code=403, 
            detail="Access denied: You do not have permission to view this lab result. Only the patient and their assigned doctor can access this report."
        )
    
    # Return sanitized result
    return {
        "id": str(lab_order["_id"]),
        "patient_id": patient_id,
        "patient_name": patient.get("name") if patient else "Unknown",
        "test_name": lab_order.get("test_name"),
        "result": lab_order.get("result"),
        "result_notes": lab_order.get("result_notes"),
        "result_date": lab_order.get("result_date"),
        "resulted_by": lab_order.get("resulted_by"),
        "pdf_url": lab_order.get("pdf_url"),
        "ai_summary": lab_order.get("ai_summary"),
        "ai_key_values": lab_order.get("ai_key_values"),
        "ai_is_abnormal": lab_order.get("ai_is_abnormal"),
        "ai_recommendation": lab_order.get("ai_recommendation"),
        "status": lab_order.get("status"),
        "access_reason": access_reason  # For debugging
    }


@router.get("/results")
async def get_my_lab_results(current_user: UserResponse = Depends(get_current_user)):
    """
    Get all lab results accessible to current user.
    For patients: their own results
    For doctors: results of their assigned patients
    For lab techs: results uploaded by their hospital
    """
    db = get_database()
    
    if current_user.role == "patient":
        # Get patient record
        patient = await db.patients.find_one({"user_id": str(current_user.id)})
        patient_name = patient.get("name", current_user.name) if patient else current_user.name
        patient_id_str = str(patient["_id"]) if patient else str(current_user.id)
        
        # Get all lab orders (pending, ordered, resulted) for this patient
        results = await db.lab_orders.find({
            "$or": [
                {"patient_id": patient_id_str},
                {"user_id": current_user.id}
            ]
        }).sort("created_at", -1).to_list(100)
        
        formatted = []
        for r in results:
            r_id = str(r["_id"])
            formatted.append({
                "id": r_id,
                "_id": r_id,
                "patient_name": r.get("patient_name") or patient_name,
                "test_name": r.get("test_name") or "Diagnostic Test",
                "ordered_by": r.get("ordered_by") or r.get("doctor_name") or "Duty Doctor",
                "ordered_date": r.get("ordered_date") or r.get("created_at"),
                "result_date": r.get("result_date"),
                "status": r.get("status", "ordered"),
                "result": r.get("result"),
                "pdf_url": r.get("pdf_url"),
                "ai_summary": r.get("ai_summary"),
                "ai_is_abnormal": r.get("ai_is_abnormal", False),
                "ai_recommendation": r.get("ai_recommendation"),
                "ai_key_values": r.get("ai_key_values", []),
                "hospital_name": r.get("hospital_name") or "General Hospital"
            })
            
        return formatted
    
    elif current_user.role == "doctor":
        # Get all patients this doctor has visited
        visits = await db.visits.find({
            "doctor_id": str(current_user.id),
            "status": {"$in": ["active", "completed"]}
        }).to_list(1000)
        
        patient_ids = list(set([v.get("patient_id") for v in visits if v.get("patient_id")]))
        
        if not patient_ids:
            return []
        
        # Get lab orders for these patients
        results = await db.lab_orders.find({
            "patient_id": {"$in": patient_ids},
            "status": "resulted"
        }).sort("result_date", -1).to_list(100)
        
        # Return results with patient names
        response = []
        for r in results:
            patient = await db.patients.find_one({"_id": ObjectId(r.get("patient_id"))})
            response.append({
                "id": str(r["_id"]),
                "patient_name": patient.get("name") if patient else "Unknown",
                "test_name": r.get("test_name"),
                "result_date": r.get("result_date"),
                "ai_summary": r.get("ai_summary"),
                "ai_is_abnormal": r.get("ai_is_abnormal"),
                "status": r.get("status")
            })
        
        return response
    
    elif current_user.role == "lab":
        # Get all lab orders for this lab's hospital
        results = await db.lab_orders.find({
            "hospital_id": current_user.hospital,
            "status": "resulted"
        }).sort("result_date", -1).to_list(100)
        
        response = []
        for r in results:
            patient = await db.patients.find_one({"_id": ObjectId(r.get("patient_id"))})
            response.append({
                "id": str(r["_id"]),
                "patient_name": patient.get("name") if patient else "Unknown",
                "test_name": r.get("test_name"),
                "result_date": r.get("result_date"),
                "status": r.get("status")
            })
        
        return response
    
    return []


@router.get("/orders/{lab_id}/pdf")
async def get_lab_order_pdf(lab_id: str):
    """
    Direct endpoint to view or stream the PDF for a lab order.
    Supports both Cloudinary URLs (including existing uploaded PDFs) and local filesystem paths.
    Streams valid PDF bytes directly with Content-Type: application/pdf.
    """
    db = get_database()
    lab_order = await db.lab_orders.find_one({"$or": [{"_id": safe_object_id_silent(lab_id)}, {"_id": lab_id}, {"id": lab_id}]})
    if not lab_order:
        raise HTTPException(status_code=404, detail="Lab order not found")

    pdf_url = lab_order.get("pdf_url")
    if not pdf_url:
        raise HTTPException(status_code=404, detail="No PDF report attached to this lab order")

    import re
    clean_url = re.sub(r"^['\"]|['\"]$", '', str(pdf_url)).strip()

    if clean_url.startswith("http://") or clean_url.startswith("https://"):
        try:
            cloudinary = get_cloudinary()
            if cloudinary and "cloudinary.com" in clean_url:
                import requests, cloudinary.utils
                from urllib.parse import urlparse

                parsed = urlparse(clean_url)
                path_parts = [p for p in parsed.path.split('/') if p]
                res_type = 'raw' if '/raw/' in clean_url else 'image'

                upload_idx = -1
                for i, part in enumerate(path_parts):
                    if part in ['upload', 'authenticated', 'private']:
                        upload_idx = i
                        break

                if upload_idx != -1 and upload_idx + 1 < len(path_parts):
                    rel_parts = path_parts[upload_idx + 1:]
                    if rel_parts[0].startswith('v') and rel_parts[0][1:].isdigit():
                        rel_parts = rel_parts[1:]
                    raw_public_id = '/'.join(rel_parts)

                    if res_type == 'image' and raw_public_id.lower().endswith('.pdf'):
                        public_id_clean = raw_public_id[:-4]
                        fmt = 'pdf'
                    else:
                        public_id_clean = raw_public_id
                        fmt = 'pdf' if not raw_public_id.lower().endswith('.pdf') else ''

                    auth_dl_url = cloudinary.utils.private_download_url(
                        public_id_clean,
                        fmt,
                        resource_type=res_type,
                        type='upload'
                    )
                    r_dl = requests.get(auth_dl_url, timeout=10)
                    if r_dl.status_code == 200 and len(r_dl.content) > 0:
                        return Response(
                            content=r_dl.content,
                            media_type="application/pdf",
                            headers={
                                "Content-Disposition": f"inline; filename=lab_report_{lab_id}.pdf",
                                "Content-Type": "application/pdf"
                            }
                        )

            # Direct HTTP fetch fallback
            import requests
            resp = requests.get(clean_url, timeout=10)
            if resp.status_code == 200:
                return Response(
                    content=resp.content,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f"inline; filename=lab_report_{lab_id}.pdf",
                        "Content-Type": "application/pdf"
                    }
                )
        except Exception as e:
            print(f"[PDF STREAM ERROR] Could not stream remote PDF: {e}")

    # Local file fallback
    local_path_clean = clean_url.lstrip("/")
    local_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), local_path_clean)
    if os.path.exists(local_path):
        filename = os.path.basename(local_path)
        return FileResponse(
            local_path, 
            media_type="application/pdf", 
            headers={"Content-Disposition": f"inline; filename={filename}"}
        )
    else:
        raise HTTPException(status_code=404, detail="Lab report PDF file not found on server")


@router.patch("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, current_user: UserResponse = Depends(get_current_user)):
    """Marks a notification as read."""
    db = get_database()
    await db.notifications.update_one(
        {"_id": safe_object_id(notif_id), "user_id": str(current_user.id)},
        {"$set": {"read": True}}
    )
    return {"status": "success"}
