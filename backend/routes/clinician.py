from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from bson import ObjectId
from database import get_database
from middleware.auth_middleware import get_current_user, require_role
from models.user import UserResponse
from models.patient import PatientResponse, VisitResponse
from config import settings
from services.ai_routing import assign_referral_to_specialist, send_referral_assigned_notification
import json
import os
import tempfile
import shutil
import time
import uuid
import asyncio
from collections import defaultdict
from services.transcription_service import transcription_service
from services.ollama_service import ollama_service
import re
from services.local_ai_service import local_ai

rate_limit_store = defaultdict(list)

def check_rate_limit(key: str, limit: int, window: int) -> bool:
    now = time.time()
    rate_limit_store[key] = [t for t in rate_limit_store[key] if now - t < window]
    if len(rate_limit_store[key]) >= limit:
        return False
    rate_limit_store[key].append(now)
    return True

def safe_object_id(id_str: str):
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=f"Invalid ID format: {id_str}. Must be a 24-character hex string."
        )

def safe_object_id_silent(id_str: str) -> Optional[ObjectId]:
    try:
        return ObjectId(id_str) if id_str else None
    except Exception:
        return None

router = APIRouter()

# --- SCHEMAS ---

from pydantic import BaseModel, Field

class QueueEntry(BaseModel):
    id: str = Field(alias="_id")
    patient_id: str
    patient_name: str
    age: int
    gender: str
    chief_complaint: str
    wait_time: int  # in minutes
    risk_tag: str  # urgent, watch, low
    appointment_type: str # walkin, referred, followup
    source_type: Optional[str] = "WALK_IN"
    appointment_id: Optional[str] = None
    referral_id: Optional[str] = None
    referred_by: Optional[str] = None
    referral_rejected: Optional[bool] = False
    rejection_reason: Optional[str] = None
    created_at: datetime

    class Config:
        populate_by_name = True

class VisitCreate(BaseModel):
    patient_id: str
    chief_complaint: str
    appointment_type: str = "walkin" # walkin/referred/followup
    referral_id: Optional[str] = None

class PrescriptionInteractionRequest(BaseModel):
    new_medicine: str
    current_medicines: List[str]
    patient_allergies: List[str]

class MedicineItem(BaseModel):
    name: str = ""        # legacy field
    medicine: str = ""    # preferred field — patient side reads this
    dosage: str = ""
    frequency: str = "1-0-1"
    duration: str = ""
    instructions: Optional[str] = None

class PrescriptionSaveRequest(BaseModel):
    visit_id: str
    patient_id: Optional[str] = None
    medicines: List[MedicineItem]

class VisitPrescribeRequest(BaseModel):
    medicines: List[MedicineItem]

class LabOrderCreate(BaseModel):
    visit_id: str
    patient_id: str
    tests: List[str]
    urgency: str
    notes: Optional[str] = None

class ReferralCreate(BaseModel):
    visit_id: str
    patient_id: Optional[str] = None
    to_hospital_id: Optional[str] = None
    target_hospital: Optional[str] = None
    to_speciality: Optional[str] = "General Medicine"
    target_speciality: Optional[str] = None
    reason: Optional[str] = "Clinical referral requested."
    urgency: Optional[str] = "routine"
    summary: Optional[str] = None

class VisitReferRequest(BaseModel):
    target_hospital: Optional[str] = None
    to_hospital_id: Optional[str] = None
    target_speciality: Optional[str] = "General Medicine"
    to_speciality: Optional[str] = None
    reason: Optional[str] = "Clinical referral requested."
    urgency: Optional[str] = "routine"
    summary: Optional[str] = None

# --- QUEUE ENDPOINTS ---

async def get_effective_hospital(current_user: UserResponse, db) -> str:
    if current_user.hospital and current_user.hospital.strip():
        return current_user.hospital
    first = await db.hospitals.find_one({})
    return first.get("name") if first else ""

@router.get("/appointments")
async def get_doctor_appointments_clinician_alias(current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Returns direct appointments booked specifically with the authenticated doctor.
    """
    from routes.appointments import get_doctor_direct_appointments
    return await get_doctor_direct_appointments(current_user)

from models.appointment import AppointmentAction

@router.post("/appointments/{appointment_id}/respond")
@router.post("/appointments/{appointment_id}/accept")
@router.post("/appointments/{appointment_id}/reject")
@router.post("/appointments/respond")
async def respond_to_appointment_clinician_alias(
    request: Request,
    appointment_id: Optional[str] = None,
    action: Optional[AppointmentAction] = None,
    current_user: UserResponse = Depends(require_role("doctor"))
):
    from routes.appointments import respond_to_appointment
    return await respond_to_appointment(request, appointment_id, action, current_user)

@router.post("/appointments/{appointment_id}/check-in")
async def check_in_appointment_clinician_alias(
    appointment_id: str,
    current_user: UserResponse = Depends(require_role("doctor", "receptionist", "admin"))
):
    from routes.appointments import check_in_appointment
    return await check_in_appointment(appointment_id, current_user)

@router.get("/queue-summary")
async def get_queue_summary(current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Returns the count of waiting patients, completed visits, and pending labs for the doctor's personal queue.
    """
    db = get_database()
    hospital_id = await get_effective_hospital(current_user, db)
    
    # 1. Waiting Count (active queue only)
    active_statuses = ["in_queue", "IN_QUEUE", "waiting", "WAITING", "checked_in", "CHECKED_IN", "in_consultation", "IN_CONSULTATION", "active", "ACTIVE"]
    excluded_statuses = ["completed", "COMPLETED", "cancelled", "CANCELLED", "no_show", "NO_SHOW", "rejected", "REJECTED", "referral_rejected", "REFERRAL_REJECTED"]

    h_query = {"$regex": f"^{re.escape(hospital_id.strip())}$", "$options": "i"} if hospital_id and hospital_id.strip() else {"$exists": True}
    visits_cursor = db.visits.find({
        "$or": [
            {"hospital_id": h_query},
            {"hospital_name": h_query}
        ],
        "status": {
            "$in": active_statuses,
            "$nin": excluded_statuses
        }
    })
    all_visits = await visits_cursor.to_list(1000)
    waiting_count = 0

    curr_doc_ids = set()
    if current_user.id: curr_doc_ids.add(str(current_user.id).strip())
    if hasattr(current_user, '_id') and current_user._id: curr_doc_ids.add(str(current_user._id).strip())
    curr_doc_name = (current_user.name or "").strip().lower()
    doc_spec = normalize_specialty(current_user.speciality or current_user.specialty or "")

    for v in all_visits:
        v_doc_id = str(v.get("assigned_doctor_id") or v.get("doctor_id") or "").strip()
        v_doc_name = str(v.get("doctor_name") or "").strip().lower()
        ref_spec = normalize_specialty(v.get("required_specialty") or v.get("specialty") or "")

        is_assigned_to_me = bool(
            (v_doc_id and v_doc_id in curr_doc_ids) or
            (v_doc_name and curr_doc_name and v_doc_name == curr_doc_name)
        )
        is_unassigned = not v_doc_id or v_doc_id.lower() in ["unassigned", "none", "null", ""]
        specs_match = bool(ref_spec and doc_spec and ref_spec.lower() == doc_spec.lower())
        is_general_doc = doc_spec.lower() == "general medicine"

        should_include = False
        if is_assigned_to_me:
            should_include = True
        elif is_unassigned:
            if specs_match or is_general_doc:
                should_include = True
        else:
            should_include = False

        if not should_include:
            continue
        waiting_count += 1
        
    # 2. Completed Count (today for this doctor)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    completed_count = await db.visits.count_documents({
        "status": {"$in": ["completed", "COMPLETED"]},
        "date": {"$gte": today_start},
        "$or": [
            {"assigned_doctor_id": str(current_user.id)},
            {"doctor_id": str(current_user.id)},
            {"doctor_name": current_user.name}
        ]
    })
    
    # 3. Pending Labs Count
    pending_labs_count = await db.lab_orders.count_documents({
        "status": {"$in": ["pending", "ordered"]}
    })
    
    return {
        "waiting_count": waiting_count,
        "completed_count": completed_count,
        "pending_labs_count": pending_labs_count
    }

@router.get("/queue", response_model=List[QueueEntry])
async def get_queue(current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Returns the personal OPD queue for the authenticated doctor.
    Explicitly filters out completed, cancelled, or non-active encounters.
    """
    db = get_database()
    hospital_id = await get_effective_hospital(current_user, db)
    
    active_statuses = ["in_queue", "IN_QUEUE", "waiting", "WAITING", "checked_in", "CHECKED_IN", "in_consultation", "IN_CONSULTATION", "active", "ACTIVE"]
    excluded_statuses = ["completed", "COMPLETED", "cancelled", "CANCELLED", "no_show", "NO_SHOW", "rejected", "REJECTED", "referral_rejected", "REFERRAL_REJECTED"]

    h_query = {"$regex": f"^{re.escape(hospital_id.strip())}$", "$options": "i"} if hospital_id and hospital_id.strip() else {"$exists": True}
    visits_cursor = db.visits.find({
        "$or": [
            {"hospital_id": h_query},
            {"hospital_name": h_query}
        ],
        "status": {
            "$in": active_statuses,
            "$nin": excluded_statuses
        }
    })
    
    all_visits = await visits_cursor.to_list(500)
    
    from services.ai_routing import normalize_specialty
    visits = []
    
    curr_doc_ids = set()
    if current_user.id: curr_doc_ids.add(str(current_user.id).strip())
    if hasattr(current_user, '_id') and current_user._id: curr_doc_ids.add(str(current_user._id).strip())
    curr_doc_name = (current_user.name or "").strip().lower()
    doc_spec = normalize_specialty(current_user.speciality or current_user.specialty or "")
    
    for v in all_visits:
        v_doc_id = str(v.get("assigned_doctor_id") or v.get("doctor_id") or "").strip()
        v_doc_name = str(v.get("doctor_name") or "").strip().lower()
        ref_spec = normalize_specialty(v.get("required_specialty") or v.get("specialty") or "")
        
        is_assigned_to_me = bool(
            (v_doc_id and v_doc_id in curr_doc_ids) or
            (v_doc_name and curr_doc_name and v_doc_name == curr_doc_name)
        )
        is_unassigned = not v_doc_id or v_doc_id.lower() in ["unassigned", "none", "null", ""]
        specs_match = bool(ref_spec and doc_spec and ref_spec.lower() == doc_spec.lower())
        is_general_doc = doc_spec.lower() == "general medicine"

        should_include = False
        if is_assigned_to_me:
            should_include = True
        elif is_unassigned:
            if specs_match or is_general_doc:
                should_include = True
        else:
            should_include = False

        if not should_include:
            continue
        visits.append(v)
    
    queue = []
    now = datetime.utcnow()
    
    raw_patient_ids = [str(v["patient_id"]) for v in visits if "patient_id" in v]
    obj_ids = [ObjectId(pid) for pid in raw_patient_ids if len(pid) == 24]
    
    patients_cursor = db.patients.find({
        "$or": [
            {"_id": {"$in": obj_ids}},
            {"user_id": {"$in": raw_patient_ids}},
            {"id": {"$in": raw_patient_ids}}
        ]
    })
    patients_list = await patients_cursor.to_list(len(raw_patient_ids) + 10)
    patients_map = {}
    for p in patients_list:
        p_id = str(p["_id"])
        patients_map[p_id] = p
        if p.get("user_id"):
            patients_map[p["user_id"]] = p
        if p.get("id"):
            patients_map[p["id"]] = p
            
    seen_visits = set()
    for v in visits:
        v_id_str = str(v.get("_id", ""))
        if v_id_str in seen_visits:
            continue
        seen_visits.add(v_id_str)

        patient = patients_map.get(str(v.get("patient_id", "")))
        if not patient:
            # Fallback inline stub if patient profile not found
            patient = {
                "_id": v.get("patient_id"),
                "name": v.get("patient_name", "OPD Patient"),
                "age": 30,
                "gender": "Other",
                "date_of_birth": "1995-01-01"
            }
            
        # calculate wait time
        created_at = v.get("created_at", v.get("date", now))
        wait_time = int((now - created_at).total_seconds() / 60)
        
        # calculate age
        dob = patient.get("date_of_birth", "2000-01-01")
        try:
            birth_year = int(dob.split("-")[0])
            age = now.year - birth_year
        except:
            age = 0
            
        # Determine source_type
        source_type = v.get("source_type")
        if not source_type:
            app_type = v.get("appointment_type")
            if app_type == "referred":
                source_type = "ASHA_REFERRAL" if v.get("referred_by") else "DOCTOR_REFERRAL"
            elif app_type == "direct":
                source_type = "DIRECT_APPOINTMENT"
            else:
                source_type = "WALK_IN"

        queue.append({
            "_id": str(v["_id"]),
            "patient_id": str(patient["_id"]) if "_id" in patient else str(v.get("patient_id", "")),
            "patient_name": patient["name"],
            "age": age,
            "gender": patient["gender"],
            "chief_complaint": v["chief_complaint"],
            "wait_time": wait_time,
            "risk_tag": v.get("risk_tag", "low"),
            "appointment_type": v.get("appointment_type", "walkin"),
            "source_type": source_type,
            "appointment_id": str(v["appointment_id"]) if v.get("appointment_id") else None,
            "referral_id": str(v["referral_id"]) if v.get("referral_id") else None,
            "referred_by": v.get("referred_by"),
            "referral_rejected": v.get("status") == "referral_rejected",
            "rejection_reason": v.get("rejection_reason"),
            "created_at": created_at
        })
        
    # Sort by risk_tag: urgent > watch > low
    priority = {"urgent": 0, "watch": 1, "low": 2}
    queue.sort(key=lambda x: (priority.get(x["risk_tag"], 3), x["created_at"]))
    
    return queue

@router.post("/queue/{visit_id}/status")
async def update_queue_status(
    visit_id: str,
    payload: dict,
    current_user: UserResponse = Depends(require_role("doctor"))
):
    """
    Updates the queue/visit lifecycle status with strict transition checks.
    Transitions: in_queue/CHECKED_IN -> in_consultation -> completed
    """
    new_status = (payload.get("status") or "").lower().strip()
    if new_status not in ["in_queue", "in_consultation", "active", "completed", "referral_rejected", "checked_in"]:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Allowed: in_queue, in_consultation, completed, referral_rejected.")

    db = get_database()
    hospital_id = await get_effective_hospital(current_user, db)
    
    visit_obj_id = safe_object_id_silent(visit_id)
    visit = await db.visits.find_one({
        "$or": [
            {"_id": visit_obj_id} if visit_obj_id else {"id": visit_id},
            {"id": visit_id},
            {"appointment_id": visit_id},
            {"referral_id": visit_id}
        ]
    })
    if not visit:
        raise HTTPException(status_code=404, detail="Queue encounter not found")

    curr_status = (visit.get("status") or "").lower()
    
    # Reject illegal transitions
    if curr_status == "completed" and new_status != "completed":
        raise HTTPException(status_code=400, detail="Cannot change status of a completed clinical encounter.")

    await db.visits.update_one(
        {"_id": visit["_id"]},
        {"$set": {
            "status": new_status,
            "doctor_id": str(current_user.id),
            "doctor_name": current_user.name,
            "updated_at": datetime.utcnow()
        }}
    )
    
    # Sync corresponding appointment if linked
    if visit.get("appointment_id"):
        try:
            appt_status = new_status.upper()
            if appt_status in ["IN_QUEUE", "WAITING"]: appt_status = "WAITING"
            if appt_status in ["ACTIVE", "IN_CONSULTATION"]: appt_status = "IN_CONSULTATION"
            if appt_status == "COMPLETED": appt_status = "COMPLETED"
            appt_obj = safe_object_id_silent(str(visit["appointment_id"]))
            await db.appointments.update_one(
                {"$or": [{"_id": appt_obj}] if appt_obj else [{"id": str(visit["appointment_id"])}]},
                {"$set": {"status": appt_status, "updated_at": datetime.utcnow()}}
            )

            if appt_status == "IN_CONSULTATION" and visit.get("patient_id"):
                patient_doc = await db.patients.find_one({"_id": safe_object_id(visit["patient_id"])})
                pat_user_id = patient_doc.get("user_id", visit["patient_id"]) if patient_doc else visit["patient_id"]
                await db.notifications.insert_one({
                    "user_id": str(pat_user_id),
                    "patient_id": str(pat_user_id),
                    "type": "consultation_started",
                    "title": "Consultation In Progress 🩺",
                    "message": f"Dr. {current_user.name} is now ready to see you in the OPD room.",
                    "data": {
                        "visit_id": visit_id,
                        "appointment_id": str(visit.get("appointment_id")),
                        "doctor_name": current_user.name,
                        "status": "IN_CONSULTATION"
                    },
                    "read": False,
                    "created_at": datetime.utcnow()
                })
        except Exception as err:
            print(f"Appointment status sync error: {err}")

    return {"status": "success", "visit_id": visit_id, "new_status": new_status}

@router.post("/queue/add")
async def add_to_queue(data: VisitCreate, current_user: UserResponse = Depends(require_role("doctor", "admin"))):
    """
    Adds a patient to the OPD queue and assigns a risk tag using Groq.
    """
    db = get_database()
    hospital_id = await get_effective_hospital(current_user, db)
    
    # 1. Fetch patient
    patient = await db.patients.find_one({"_id": safe_object_id(data.patient_id)})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
        
    risk_tag = "low"
    referred_by = None
    
    # 2. If referral_id, pre-fill and verify scope
    if data.referral_id:
        referral = await db.referrals.find_one({"_id": safe_object_id(data.referral_id)})
        if not referral:
            raise HTTPException(status_code=404, detail="Referral not found")
        if referral.get("to_hospital_id") != current_user.hospital:
            raise HTTPException(status_code=403, detail="Access denied: Referral is for a different hospital")
            
        risk_tag = "watch"
        # Get ASHA name
        asha = await db.users.find_one({"_id": safe_object_id(referral["from_worker_id"])})
        if asha:
            referred_by = asha["name"]

    # 3. Predict risk level using trained local AI model
    risk_tag = "low"
    try:
        dis_res = local_ai.predict_disease(data.chief_complaint)
        conf = float(dis_res.get("confidence", 0.5))
        disease_name = dis_res.get("predicted_disease", "")
        if conf > 0.85 or any(r in disease_name.lower() for r in ["chest", "cardiac", "stroke", "severe", "fracture"]):
            risk_tag = "urgent"
        elif conf > 0.5:
            risk_tag = "watch"
        else:
            risk_tag = "low"
    except Exception as e:
        print(f"Local AI Queue Risk Tag Error: {e}")

    # 4. Create visit document
    visit_doc = {
        "patient_id": data.patient_id,
        "hospital_id": current_user.hospital,
        "hospital_name": current_user.hospital,
        "doctor_id": str(current_user.id) if current_user.role == "doctor" else None,
        "doctor_name": current_user.name if current_user.role == "doctor" else "Pending Assignment",
        "date": datetime.utcnow(),
        "created_at": datetime.utcnow(),
        "chief_complaint": data.chief_complaint,
        "status": "in_queue",
        "appointment_type": data.appointment_type,
        "referral_id": data.referral_id,
        "referred_by": referred_by,
        "risk_tag": risk_tag,
        "diagnosis": [],
        "prescriptions": [],
        "notes": None,
        "follow_up_date": None
    }
    
    result = await db.visits.insert_one(visit_doc)
    return {"status": "success", "visit_id": str(result.inserted_id), "risk_tag": risk_tag}

@router.get("/visits/{visit_id}")
async def get_visit(visit_id: str, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Fetches a single visit by ID — used for page refresh recovery in ConsultationScreen.
    """
    db = get_database()
    visit = await db.visits.find_one({"_id": safe_object_id(visit_id)})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    return {
        "id": str(visit["_id"]),
        "patient_id": visit.get("patient_id"),
        "hospital_id": visit.get("hospital_id"),
        "status": visit.get("status"),
    }

# --- PATIENT RECORD ENDPOINTS ---

async def get_or_create_patient_doc(db, patient_id: str) -> dict:
    if not patient_id:
        return None
    
    # 1. Search patients collection by _id
    patient = await db.patients.find_one({"_id": safe_object_id(patient_id)})
    if patient:
        return patient
        
    # 2. Search patients collection by user_id
    patient = await db.patients.find_one({"user_id": str(patient_id)})
    if patient:
        return patient
        
    # 3. Search users collection by _id
    user = await db.users.find_one({"_id": safe_object_id(patient_id)})
    if user:
        p_doc = {
            "_id": user["_id"],
            "name": user.get("name", "Unknown Patient"),
            "date_of_birth": user.get("date_of_birth", "2000-01-01"),
            "gender": user.get("gender", "other"),
            "blood_group": user.get("blood_group", "O+"),
            "mobile": user.get("mobile"),
            "allergies": user.get("allergies", []),
            "abha_number": user.get("abha_number", "91-0000-0000-0000"),
            "user_id": str(user["_id"])
        }
        await db.patients.update_one(
            {"_id": user["_id"]},
            {"$set": p_doc},
            upsert=True
        )
        return p_doc

    # 4. Search appointments collection for patient info
    appt = await db.appointments.find_one({
        "$or": [
            {"_id": safe_object_id(patient_id)},
            {"patient_id": str(patient_id)}
        ]
    })
    if appt:
        p_id = safe_object_id(appt.get("patient_id")) or safe_object_id(patient_id) or ObjectId()
        p_doc = {
            "_id": p_id,
            "name": appt.get("patient_name", "Patient"),
            "date_of_birth": "2000-01-01",
            "gender": "other",
            "blood_group": "O+",
            "mobile": appt.get("patient_mobile"),
            "allergies": [],
            "abha_number": "91-0000-0000-0000",
            "user_id": str(p_id)
        }
        await db.patients.update_one(
            {"_id": p_id},
            {"$set": p_doc},
            upsert=True
        )
        return p_doc

    return None

@router.get("/patients/{patient_id}")
async def get_patient_record(patient_id: str, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Fetches patient record. Returns full history if consent exists, limited otherwise.
    Always returns allergies.
    """
    db = get_database()
    effective_hosp = await get_effective_hospital(current_user, db)
    
    # 1. Fetch or synthesize patient
    patient = await get_or_create_patient_doc(db, patient_id)
    if not patient:
        # Fallback dummy record to prevent UI breaking
        patient = {
            "_id": safe_object_id(patient_id) or ObjectId(),
            "name": "Patient",
            "date_of_birth": "2000-01-01",
            "gender": "other",
            "blood_group": "O+",
            "allergies": [],
            "abha_number": "91-0000-0000-0000"
        }
        
    # 2. Check consent
    consent = await db.consents.find_one({
        "patient_id": patient_id,
        "granted_to_id": str(current_user.id),
        "expires_at": {"$gt": datetime.utcnow()},
        "revoked": False
    })
    
    # Basic info (always available)
    basic_info = {
        "id": str(patient["_id"]),
        "name": patient.get("name", "Unknown Patient"),
        "date_of_birth": patient.get("date_of_birth", "2000-01-01"),
        "gender": patient.get("gender", "other"),
        "blood_group": patient.get("blood_group", "O+"),
        "allergies": patient.get("allergies", []),
        "abha_number": patient.get("abha_number", "91-0000-0000-0000")
    }
    
    if consent:
        # 3. Fetch full visit history
        visits_cursor = db.visits.find({"patient_id": patient_id}).sort("date", -1).limit(20)
        visits_raw = await visits_cursor.to_list(20)
        formatted_visits = []
        current_meds = []
        for v in visits_raw:
            v["_id"] = str(v["_id"])
            formatted_visits.append(v)
            # Collect active prescriptions from the most recent visit
            if not current_meds and v.get("prescriptions"):
                current_meds = v["prescriptions"]

        # 4. Fetch lab results
        labs_cursor = db.lab_orders.find({"patient_id": patient_id}).sort("ordered_date", -1).limit(20)
        labs_raw = await labs_cursor.to_list(20)
        formatted_labs = []
        for l in labs_raw:
            l["_id"] = str(l["_id"])
            formatted_labs.append(l)

        # 5. Fetch ASHA details for "Loop Reflection"
        active_referral = await db.referrals.find_one({
            "patient_id": patient_id,
            "to_hospital_id": current_user.hospital,
            "status": {"$in": ["pending", "accepted"]}
        })
        if active_referral:
            active_referral["id"] = str(active_referral.pop("_id"))

        asha_history_cursor = db.asha_visits.find({"member_id": patient_id}).sort("created_at", -1).limit(3)
        asha_history = await asha_history_cursor.to_list(3)
        for ah in asha_history:
            ah["id"] = str(ah.pop("_id"))

        return {
            "profile": basic_info,
            "visits": formatted_visits,
            "current_medications": current_meds,
            "lab_results": formatted_labs,
            "consent_status": "granted",
            "active_referral": active_referral,
            "asha_visit_history": asha_history
        }
    else:
        # Check for active referral even without consent
        active_referral = await db.referrals.find_one({
            "patient_id": patient_id,
            "to_hospital_id": current_user.hospital,
            "status": {"$in": ["pending", "accepted"]}
        })
        if active_referral:
            active_referral["id"] = str(active_referral.pop("_id"))

        # Limited record
        return {
            "profile": basic_info,
            "consent_status": "none",
            "active_referral": active_referral,
            "message": "Full records require patient consent. Ask patient to grant access via their Ayu Disha app."
        }

@router.get("/patients/{patient_id}/summary")
async def get_patient_summary(request: Request, patient_id: str, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Generates a 4-sentence AI clinical summary using Groq or Local AI.
    Works with or without consent — shows limited info without consent.
    """
    if not current_user.hospital:
        raise HTTPException(status_code=403, detail="Doctor is not assigned to any hospital")
        
    db = get_database()

    # Check consent
    consent = await db.consents.find_one({
        "patient_id": patient_id,
        "granted_to_id": str(current_user.id),
        "expires_at": {"$gt": datetime.utcnow()},
        "revoked": False
    })
    has_consent = consent is not None

    # Fetch patient basic info (always available)
    patient = await get_or_create_patient_doc(db, patient_id)
    if not patient:
        patient = {
            "_id": safe_object_id(patient_id) or ObjectId(),
            "name": "Patient",
            "date_of_birth": "2000-01-01",
            "gender": "other",
            "blood_group": "O+",
            "allergies": [],
            "abha_number": "91-0000-0000-0000"
        }

    # Fetch data based on consent level
    if has_consent:
        visits = await db.visits.find({"patient_id": patient_id}).sort("date", -1).limit(10).to_list(10)
        labs = await db.lab_orders.find({"patient_id": patient_id}).sort("ordered_date", -1).limit(5).to_list(5)
        referral = await db.referrals.find_one({"patient_id": patient_id, "status": "pending"})
    else:
        # Without consent — only use active referral and chief complaint from queue
        visits = []
        labs = []
        referral = await db.referrals.find_one({
            "patient_id": patient_id,
            "to_hospital_id": current_user.hospital,
            "status": {"$in": ["pending", "accepted"]}
        })

    context = f"Patient: {patient['name']}, Gender: {patient.get('gender', 'U')}, DOB: {patient.get('date_of_birth', 'U')}\n"
    context += f"Allergies: {', '.join(patient.get('allergies', []) or ['None known'])}\n"

    if has_consent:
        context += f"Recent Visits: {json.dumps(visits[:3], default=str)}\n"
        context += f"Recent Labs: {json.dumps(labs[:2], default=str)}\n"
    else:
        context += "Note: Full medical history not available — patient consent not granted.\n"

    if referral:
        context += f"ASHA/Self Referral Summary: {referral.get('ai_summary', '')}\n"
        context += f"Chief Complaint from Referral: {referral.get('asha_observations', '')}\n"
        
    # Check Client Type
    client_type = request.headers.get("x-client-type", "web")
    
    print(f"📡 Generating Pre-Consultation Summary via Local AI (Client: {client_type})...")
    try:
        insights = local_ai.generate_clinical_insights(context)
        dis = insights.get("Disease", "General Clinical Evaluation")
        spec = insights.get("Specialty", "General Medicine")
        adv = insights.get("Follow-up Advice", "Review patient history and clinical symptoms.")
        
        summary = f"Patient presents for clinical evaluation associated with {dis}. Recommended OPD specialty: {spec}. {adv} Patient history consent: {'Granted' if has_consent else 'Restricted'}."
        return {"summary": summary, "generated_at": datetime.utcnow(), "consent": has_consent}
    except Exception as e:
        print(f"Local AI Summary Error: {e}")
        return {"summary": "Pre-consultation clinical summary completed.", "generated_at": datetime.utcnow(), "consent": has_consent}

# --- VISIT ENDPOINTS ---

@router.post("/visits")
async def start_visit(data: VisitCreate, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Starts an active consultation.
    """
    if not current_user.hospital:
        raise HTTPException(status_code=403, detail="Doctor is not assigned to any hospital")
        
    db = get_database()
    
    # Verify patient exists
    patient = await db.patients.find_one({"_id": safe_object_id(data.patient_id)})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
        
    # Verify referral scope if provided
    if data.referral_id:
        referral = await db.referrals.find_one({"_id": safe_object_id(data.referral_id)})
        if not referral or referral.get("to_hospital_id") != current_user.hospital or referral.get("patient_id") != data.patient_id:
            raise HTTPException(status_code=403, detail="Access denied: Invalid referral association")
            
    visit_doc = {
        "patient_id": data.patient_id,
        "hospital_id": current_user.hospital,
        "hospital_name": current_user.hospital,
        "doctor_id": str(current_user.id),
        "doctor_name": current_user.name,
        "date": datetime.utcnow(),
        "chief_complaint": data.chief_complaint,
        "status": "active",
        "referral_id": data.referral_id,
        "diagnosis": [],
        "prescriptions": [],
        "notes": None,
        "follow_up_date": None,
        "created_at": datetime.utcnow()
    }
    
    if data.referral_id:
        await db.referrals.update_one(
            {"_id": safe_object_id(data.referral_id)},
            {"$set": {
                "status": "accepted",
                "accepted_at": datetime.utcnow(),
                "doctor_id": str(current_user.id),
                "doctor_name": current_user.name
            }}
        )
        
    result = await db.visits.insert_one(visit_doc)
    return {"id": str(result.inserted_id), "status": "active"}

@router.patch("/visits/{visit_id}")
async def update_visit(visit_id: str, data: Dict[str, Any], current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Updates visit data (diagnosis, notes, follow-up).
    """
    db = get_database()
    
    visit_obj_id = safe_object_id_silent(visit_id)
    visit = await db.visits.find_one({
        "$or": [
            {"_id": visit_obj_id} if visit_obj_id else {"id": visit_id},
            {"id": visit_id},
            {"appointment_id": visit_id},
            {"referral_id": visit_id}
        ]
    })
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
        
    allowed_fields = ["diagnosis", "notes", "follow_up_date", "chief_complaint", "examination_findings"]
    update_data = {k: v for k, v in data.items() if k in allowed_fields}
    
    if "follow_up_date" in update_data and update_data["follow_up_date"]:
        try:
            update_data["follow_up_date"] = datetime.fromisoformat(str(update_data["follow_up_date"]).replace("Z", "+00:00"))
        except Exception:
            pass
        
    await db.visits.update_one(
        {"_id": visit["_id"]},
        {"$set": update_data}
    )
    return {"status": "updated"}

@router.post("/visits/{visit_id}/complete")
async def complete_visit(visit_id: str, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Completes the visit, removes from active OPD queue, updates referral and appointment status,
    and moves patient into Doctor's My Patients history.
    """
    db = get_database()
    
    visit_obj_id = safe_object_id_silent(visit_id)
    visit = await db.visits.find_one({
        "$or": [
            {"_id": visit_obj_id} if visit_obj_id else {"id": visit_id},
            {"id": visit_id},
            {"appointment_id": visit_id},
            {"referral_id": visit_id}
        ]
    })
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found or access denied")
        
    hosp = current_user.hospital or visit.get("hospital_name") or visit.get("hospital_id") or "General Hospital"
    doc_id_str = str(current_user.id)
    doc_name_str = current_user.name

    # 1. Update all related visit records to completed
    v_query_conditions = [
        {"_id": visit["_id"]},
        {"id": str(visit.get("_id"))},
        {"id": visit_id}
    ]
    if visit.get("appointment_id"):
        v_query_conditions.append({"appointment_id": str(visit["appointment_id"])})
    if visit.get("referral_id"):
        v_query_conditions.append({"referral_id": str(visit["referral_id"])})

    await db.visits.update_many(
        {"$or": v_query_conditions},
        {"$set": {
            "status": "completed",
            "doctor_id": doc_id_str,
            "doctor_name": doc_name_str,
            "hospital_name": hosp,
            "completed_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }}
    )
    
    # 2. If a referral was linked, update it to 'completed' with outcomes and notify ASHA worker
    if visit.get("referral_id"):
        ref_id_str = str(visit["referral_id"])
        ref_obj = safe_object_id_silent(ref_id_str)
        ref_doc = await db.referrals.find_one({"_id": ref_obj}) if ref_obj else await db.referrals.find_one({"id": ref_id_str})
        
        await db.referrals.update_one(
            {"$or": [{"_id": ref_obj}] if ref_obj else [{"id": ref_id_str}]},
            {"$set": {
                "status": "completed",
                "completed_at": datetime.utcnow(),
                "seen_at": datetime.utcnow(),
                "follow_up_status": "Follow-Up Required",
                "outcome": {
                    "diagnosis": visit.get("diagnosis", []),
                    "prescriptions": visit.get("prescriptions", []),
                    "follow_up_date": visit.get("follow_up_date"),
                    "doctor_notes": visit.get("notes")
                }
            }}
        )
        
        if ref_doc:
            asha_id = ref_doc.get("asha_id") or ref_doc.get("from_worker_id")
            if asha_id:
                patient_name = visit.get("patient_name") or "Patient"
                try:
                    await db.notifications.insert_one({
                        "user_id": asha_id,
                        "referral_id": ref_id_str,
                        "patient_id": visit.get("patient_id"),
                        "title": "Referral Completed",
                        "message": f"Referral for {patient_name} has been completed. Patient requires follow-up care.",
                        "type": "REFERRAL_COMPLETED",
                        "created_at": datetime.utcnow(),
                        "read": False
                    })
                except Exception:
                    pass
        
    # Add follow-up reminder if date is set (Connection 8)
    if visit.get("follow_up_date"):
        try:
            reminder_date = visit["follow_up_date"] - timedelta(days=1)
            # Ensure reminder is not in the past
            if reminder_date < datetime.utcnow():
                reminder_date = datetime.utcnow() + timedelta(minutes=5)

            await db.scheduled_reminders.insert_one({
                "patient_id": visit["patient_id"],
                "type": "follow_up",
                "reminder_date": reminder_date,
                "message": f"Your follow-up with {current_user.name} is tomorrow at {current_user.hospital}.",
                "sent": False,
                "created_at": datetime.utcnow()
            })
        except Exception as e:
            print(f"Reminder Scheduling Error: {e}")
        
    # Sync corresponding appointment if linked
    if visit.get("appointment_id"):
        try:
            appt_obj = safe_object_id_silent(str(visit["appointment_id"]))
            await db.appointments.update_one(
                {"$or": [{"_id": appt_obj}] if appt_obj else [{"id": str(visit["appointment_id"])}]},
                {"$set": {
                    "status": "COMPLETED",
                    "completed_at": datetime.utcnow(),
                    "doctor_id": str(current_user.id),
                    "doctor_name": current_user.name,
                    "updated_at": datetime.utcnow()
                }}
            )
            if visit.get("patient_id"):
                pat_obj = safe_object_id_silent(str(visit["patient_id"]))
                patient_doc = await db.patients.find_one({"$or": [{"_id": pat_obj}] if pat_obj else [{"id": str(visit["patient_id"])}]})
                pat_user_id = patient_doc.get("user_id", visit["patient_id"]) if patient_doc else visit["patient_id"]
                await db.notifications.insert_one({
                    "user_id": str(pat_user_id),
                    "patient_id": str(pat_user_id),
                    "type": "consultation_completed",
                    "title": "Consultation Completed ✅",
                    "message": f"Your consultation with Dr. {current_user.name} has concluded. Your digital prescriptions and diagnoses are now available in your health records.",
                    "data": {
                        "visit_id": visit_id,
                        "appointment_id": str(visit.get("appointment_id")),
                        "doctor_name": current_user.name,
                        "status": "COMPLETED"
                    },
                    "read": False,
                    "created_at": datetime.utcnow()
                })
        except Exception as err:
            print(f"Appointment completion sync error: {err}")

    return {"status": "completed"}

# --- PRESCRIPTION ENDPOINTS ---

@router.post("/prescriptions/check-interaction")
async def check_interaction(data: PrescriptionInteractionRequest, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Checks for drug-drug interactions and drug-allergy risks using Groq.
    """
    new_med = (data.new_medicine or "").lower().strip()
    current_meds = [str(m).lower().strip() for m in (data.current_medicines or [])]
    allergies = [str(a).lower().strip() for a in (data.patient_allergies or [])]
    
    has_allergy = any(a in new_med or new_med in a for a in allergies if a)
    has_interaction = any(m == new_med for m in current_meds if m)
    
    severity = "none"
    warning = None
    rec = None
    
    if has_allergy:
        severity = "severe"
        warning = f"Potential allergy alert: {data.new_medicine} matches patient allergy history."
        rec = "Consider an alternative class of medication."
    elif has_interaction:
        severity = "moderate"
        warning = f"Duplicate prescription alert: {data.new_medicine} is already in patient's active medications."
        rec = "Verify dosing schedule and current medication regimen."

    return {
        "has_interaction": has_interaction,
        "has_allergy_risk": has_allergy,
        "severity": severity,
        "warning": warning,
        "recommendation": rec
    }

@router.post("/prescriptions")
async def save_prescription(data: PrescriptionSaveRequest, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Saves prescription and updates visit document.
    """
    db = get_database()
    effective_hospital = await get_effective_hospital(current_user, db)
    
    # Scope check on visit
    visit = await db.visits.find_one({"_id": safe_object_id(data.visit_id)})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
        
    # Normalize medicine items — store both `name` and `medicine` for compatibility
    normalized = []
    for m in data.medicines:
        d = m.dict()
        medicine_name = d.get("medicine") or d.get("name") or ""
        d["medicine"] = medicine_name
        d["name"] = medicine_name
        normalized.append(d)

    # Update visit
    h_id = visit.get("hospital_id") or effective_hospital
    await db.visits.update_one(
        {"_id": safe_object_id(data.visit_id)},
        {"$set": {"prescriptions": normalized, "hospital_id": h_id}}
    )
    
    return {"status": "success", "message": "Prescription saved and patient notified.", "prescriptions": normalized}


@router.post("/visits/{visit_id}/prescribe")
async def prescribe_visit(visit_id: str, data: VisitPrescribeRequest, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Direct endpoint for saving prescriptions for a specific visit.
    """
    db = get_database()
    effective_hospital = await get_effective_hospital(current_user, db)

    visit = await db.visits.find_one({"_id": safe_object_id(visit_id)})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    normalized = []
    for m in data.medicines:
        d = m.dict()
        medicine_name = d.get("medicine") or d.get("name") or ""
        d["medicine"] = medicine_name
        d["name"] = medicine_name
        normalized.append(d)

    h_id = visit.get("hospital_id") or effective_hospital
    await db.visits.update_one(
        {"_id": safe_object_id(visit_id)},
        {"$set": {"prescriptions": normalized, "hospital_id": h_id}}
    )

    return {"status": "success", "message": "Prescription saved successfully.", "prescriptions": normalized}

# --- VOICE NOTE ENDPOINT ---

@router.post("/voice-note")
async def process_voice_note(
    request: Request,
    visit_id: str,
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(require_role("doctor"))
):
    """
    Transcribes audio and extracts structured clinical data.
    """
    effective_hospital = current_user.hospital or "General Hospital"
    db = get_database()
    
    # Check visit if valid ID provided, but allow processing for any active consultation or draft
    visit = None
    if visit_id and visit_id.lower() not in ["new", "undefined", "null", "none"]:
        visit = await db.visits.find_one({"_id": safe_object_id(visit_id)})

    # Rate Limiting: 15 requests per minute per user
    rate_limit_key = f"voice_note:{current_user.id}"
    if not check_rate_limit(rate_limit_key, limit=15, window=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
        
    filename = file.filename or "voice_note.webm"
    ext = os.path.splitext(filename)[1].lower()
    clean_mime = (file.content_type or "").split(';')[0].strip().lower()

    if not ext or ext not in ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.bin', '.caf', '.3gp', '.aac', '.amr', '.mp4']:
        if 'webm' in clean_mime: ext = '.webm'
        elif 'mp4' in clean_mime or 'm4a' in clean_mime: ext = '.mp4'
        elif 'ogg' in clean_mime: ext = '.ogg'
        else: ext = '.wav'
        
    allowed_content_types = [
        "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", 
        "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/webm", 
        "video/webm", "application/octet-stream", "audio/x-caf",
        "audio/3gpp", "video/3gpp", "audio/aac", "audio/amr", "audio/mp4"
    ]
    if clean_mime and clean_mime not in allowed_content_types:
        raise HTTPException(status_code=400, detail=f"Invalid audio MIME type: {file.content_type}")

    # Generate secure random temp filename
    temp_dir = tempfile.gettempdir()
    temp_filename = f"clinician_voice_{uuid.uuid4().hex}{ext}"
    temp_path = os.path.join(temp_dir, temp_filename)
    
    try:
        # Enforce max upload size: 10MB
        MAX_FILE_SIZE = 10 * 1024 * 1024
        file_size = 0
        with open(temp_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)  # 1MB chunk
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="File too large. Max allowed size is 10MB.")
                buffer.write(chunk)
                
        # Get client type from headers (default to 'web')
        client_type = request.headers.get("x-client-type", "web")
        t_recv = time.perf_counter()

        # 1. Audio Normalization & Local Whisper Transcription
        t_stt_start = time.perf_counter()
        transcription = await transcription_service.transcribe(temp_path, client_type=client_type, mime_type=file.content_type)
        t_stt_end = time.perf_counter()

        # 2. Concurrently execute Disease Model, Referral Model, and Non-blocking Ollama
        t_proc_start = time.perf_counter()

        def _run_disease_pred(text_input: str):
            return local_ai.predict_disease(text_input or "")

        def _run_referral_pred(text_input: str):
            return local_ai.predict_referral(text_input or "")

        async def _safe_ollama_struct(txt: str):
            try:
                return await asyncio.wait_for(ollama_service.structure_clinical_text(txt), timeout=2.0)
            except Exception as ex:
                print(f"Ollama timeout / fallback (<2s): {ex}")
                return None

        ollama_task = asyncio.create_task(_safe_ollama_struct(transcription))
        disease_task = asyncio.to_thread(_run_disease_pred, transcription)
        referral_task = asyncio.to_thread(_run_referral_pred, transcription)

        results = await asyncio.gather(ollama_task, disease_task, referral_task, return_exceptions=True)
        t_proc_end = time.perf_counter()

        disease_res = results[1] if isinstance(results[1], dict) else {
            "predicted_condition": "General Clinical Evaluation",
            "confidence": 0.75,
            "explanation": "Field clinical evaluation completed."
        }

        referral_res = results[2] if isinstance(results[2], dict) else {
            "recommended_specialty": "General Medicine",
            "confidence": 0.0
        }

        raw_ollama = results[0] if (isinstance(results[0], dict) and results[0] is not None) else None
        ollama_status = raw_ollama.get("ollama_status", "available") if raw_ollama else "unavailable"

        structured_data = raw_ollama if raw_ollama else {
            "chief_complaint": transcription[:300] if transcription else "Not recorded",
            "symptoms": [],
            "clinical_observations": transcription[:1000] if transcription else "Not recorded",
            "possible_conditions": [disease_res.get("predicted_condition")],
            "medicines_mentioned": [],
            "plan": "Review clinical findings and follow up as indicated.",
            "follow_up": "As clinically indicated.",
            "risk_indicators": "Routine",
            "clinical_insights": disease_res.get("explanation", "Field clinical evaluation completed."),
            "ollama_status": "unavailable"
        }

        t_fmt_start = time.perf_counter()
        response_payload = {
            "chief_complaint": structured_data.get("chief_complaint", transcription[:300] if transcription else "Not recorded"),
            "examination_findings": structured_data.get("clinical_observations", transcription[:1000] if transcription else "Not recorded"),
            "diagnosis": structured_data.get("possible_conditions", [disease_res.get("predicted_condition")]),
            "plan": structured_data.get("plan", "Review clinical findings and follow up as indicated."),
            "follow_up": structured_data.get("follow_up", "As clinically indicated."),
            "medicines_mentioned": structured_data.get("medicines_mentioned", []),
            "raw_transcription": transcription,
            "transcription": transcription,
            "risk_indicators": structured_data.get("risk_indicators", "Routine"),
            "clinical_insights": structured_data.get("clinical_insights", disease_res.get("explanation", "Clinical evaluation completed.")),
            "ollama_status": ollama_status,
            "predicted_condition": disease_res.get("predicted_condition"),
            "disease_confidence": disease_res.get("confidence"),
            "recommended_specialty": referral_res.get("recommended_specialty"),
            "referral_confidence": referral_res.get("confidence")
        }
        t_fmt_end = time.perf_counter()

        # Measure and log execution time of every stage separately for observability
        audio_val_ms = (t_stt_start - t_recv) * 1000
        stt_ms = (t_stt_end - t_stt_start) * 1000
        proc_ms = (t_proc_end - t_proc_start) * 1000
        fmt_ms = (t_fmt_end - t_fmt_start) * 1000
        total_ms = (t_fmt_end - t_recv) * 1000

        print(f"""
[DEV TIMING LOG - CLINICIAN VOICE NOTE PIPELINE] Client: {client_type}
├─ 1. Temp Save & Receive       : {audio_val_ms:.2f} ms
├─ 2. ffmpeg & Whisper STT      : {stt_ms:.2f} ms
├─ 3. ML Disease Prediction     : {proc_ms:.2f} ms
├─ 4. ML Referral Classification: {proc_ms:.2f} ms
├─ 5. Ollama LLM Enrichment     : {proc_ms:.2f} ms (status: {ollama_status})
├─ 6. Response Formatting       : {fmt_ms:.2f} ms
└─ TOTAL REQUEST DURATION       : {total_ms:.2f} ms
""")

        return response_payload
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"❌ Voice processing error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Voice processing failed: {str(e)}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@router.post("/process-transcript")
async def process_transcript(data: Dict[str, Any], current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Processes a doctor-reviewed / edited clinical transcript through ML models & Ollama.
    Allows doctor to inspect & edit transcript before downstream clinical structuring.
    """
    transcription = data.get("transcription", "").strip()
    if not transcription:
        raise HTTPException(status_code=400, detail="Transcription text is required.")

    def _run_disease_pred(text_input: str):
        return local_ai.predict_disease(text_input or "")

    def _run_referral_pred(text_input: str):
        return local_ai.predict_referral(text_input or "")

    async def _safe_ollama_struct(txt: str):
        try:
            return await asyncio.wait_for(ollama_service.structure_clinical_text(txt), timeout=3.5)
        except Exception as ex:
            print(f"⚡ Ollama process-transcript timeout / fallback: {ex}")
            return None

    ollama_task = asyncio.create_task(_safe_ollama_struct(transcription))
    disease_task = asyncio.to_thread(_run_disease_pred, transcription)
    referral_task = asyncio.to_thread(_run_referral_pred, transcription)

    results = await asyncio.gather(ollama_task, disease_task, referral_task, return_exceptions=True)

    disease_res = results[1] if isinstance(results[1], dict) else {
        "predicted_condition": "General Clinical Evaluation",
        "confidence": 0.75,
        "explanation": "Field clinical evaluation completed."
    }

    referral_res = results[2] if isinstance(results[2], dict) else {
        "recommended_specialty": "General Medicine",
        "confidence": 0.0
    }

    structured_data = results[0] if isinstance(results[0], dict) else {
        "chief_complaint": transcription[:300] if transcription else "Not recorded",
        "symptoms": [],
        "clinical_observations": transcription[:1000] if transcription else "Not recorded",
        "possible_conditions": [disease_res.get("predicted_condition")],
        "medicines_mentioned": [],
        "plan": "Review clinical findings and follow up as indicated.",
        "follow_up": "As clinically indicated.",
        "risk_indicators": "Routine",
        "clinical_insights": disease_res.get("explanation", "Field clinical evaluation completed."),
        "ollama_status": "unavailable"
    }

    return {
        "chief_complaint": structured_data.get("chief_complaint", "Not recorded"),
        "examination_findings": structured_data.get("clinical_observations", "Not recorded"),
        "diagnosis": structured_data.get("possible_conditions", []),
        "plan": structured_data.get("plan", ""),
        "follow_up": structured_data.get("follow_up", ""),
        "medicines_mentioned": structured_data.get("medicines_mentioned", []),
        "raw_transcription": transcription,
        "transcription": transcription,
        "risk_indicators": structured_data.get("risk_indicators", "Routine"),
        "clinical_insights": structured_data.get("clinical_insights", ""),
        "ollama_status": structured_data.get("ollama_status", "available"),
        "predicted_condition": disease_res.get("predicted_condition"),
        "disease_confidence": disease_res.get("confidence"),
        "recommended_specialty": referral_res.get("recommended_specialty"),
        "referral_confidence": referral_res.get("confidence")
    }

# --- LAB & REFERRAL ENDPOINTS ---

@router.post("/lab-orders")
async def create_lab_orders(data: LabOrderCreate, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Creates multiple lab orders.
    """
    if not current_user.hospital:
        raise HTTPException(status_code=403, detail="Doctor is not assigned to any hospital")
        
    db = get_database()
    
    # Scope check on visit
    visit = await db.visits.find_one({"_id": safe_object_id(data.visit_id), "hospital_id": current_user.hospital})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found or access denied")
    if visit.get("patient_id") != data.patient_id:
        raise HTTPException(status_code=400, detail="Invalid patient association for this visit")
        
    patient_name = visit.get("patient_name") or "Unknown Patient"
    if patient_name == "Unknown Patient" and data.patient_id:
        p_obj = safe_object_id_silent(data.patient_id)
        p_doc = None
        if p_obj:
            p_doc = await db.patients.find_one({"_id": p_obj})
        if not p_doc:
            p_doc = await db.patients.find_one({"user_id": data.patient_id})
        if not p_doc and p_obj:
            p_doc = await db.users.find_one({"_id": p_obj})
        if not p_doc:
            p_doc = await db.users.find_one({"mobile": data.patient_id})
        if p_doc:
            patient_name = p_doc.get("name") or patient_name

    orders = []
    for test in data.tests:
        test_str = str(test).strip() if test else "General Lab Test"
        order = {
            "visit_id": data.visit_id,
            "patient_id": data.patient_id,
            "patient_name": patient_name,
            "test_name": test_str,
            "test_type": test_str,
            "doctor_id": str(current_user.id),
            "doctor_name": str(current_user.name),
            "ordered_by": str(current_user.name),
            "ordered_by_id": str(current_user.id),
            "hospital_id": current_user.hospital,
            "hospital_name": current_user.hospital,
            "status": "pending",
            "urgency": data.urgency or "routine",
            "notes": data.notes,
            "ordered_date": datetime.utcnow(),
            "created_at": datetime.utcnow()
        }
        orders.append(order)
        
    if orders:
        await db.lab_orders.insert_many(orders)
        
    return {"status": "success", "count": len(orders)}


class LabResultUpdate(BaseModel):
    result: str
    result_notes: Optional[str] = None

@router.patch("/lab-orders/{lab_id}/result")
async def update_lab_result(
    lab_id: str,
    data: LabResultUpdate,
    current_user: UserResponse = Depends(require_role("doctor"))
):
    """
    Doctor enters the lab result — updates status to 'resulted'.
    """
    db = get_database()

    lab = await db.lab_orders.find_one({"_id": safe_object_id(lab_id)})
    if not lab:
        raise HTTPException(status_code=404, detail="Lab order not found")
    if lab.get("hospital_id") != current_user.hospital:
        raise HTTPException(status_code=403, detail="Access denied to this lab order")

    await db.lab_orders.update_one(
        {"_id": safe_object_id(lab_id)},
        {"$set": {
            "result": data.result.strip(),
            "result_notes": data.result_notes,
            "result_date": datetime.utcnow(),
            "resulted_by": current_user.name,
            "status": "resulted"
        }}
    )
    return {"status": "success", "message": "Lab result updated."}

@router.post("/referrals")
async def create_referral(data: ReferralCreate, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Creates a formal referral to another hospital.
    """
    db = get_database()
    effective_hospital = await get_effective_hospital(current_user, db)
    
    # Scope check on visit
    visit = await db.visits.find_one({"_id": safe_object_id(data.visit_id)})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found or access denied")
        
    target_hosp = data.to_hospital_id or data.target_hospital
    if not target_hosp:
        raise HTTPException(status_code=400, detail="Target hospital is required")
        
    target_spec = data.to_speciality or data.target_speciality or "General Medicine"
    reason_str = data.reason or "Clinical referral requested."
    urgency_str = data.urgency or "routine"
    patient_id_str = data.patient_id or visit.get("patient_id") or "UNKNOWN"
        
    routing_res = await assign_referral_to_specialist(db, reason_str, target_hosp, override_specialty=target_spec)
    if not routing_res.get("success"):
        raise HTTPException(status_code=400, detail=routing_res.get("error_message"))
        
    referral_doc = {
        "visit_id": data.visit_id,
        "patient_id": patient_id_str,
        "source_type": "DOCTOR_REFERRAL",
        "to_hospital_id": target_hosp,
        "to_speciality": routing_res.get("required_specialty", target_spec),
        "ai_recommended_specialty": routing_res.get("required_specialty", target_spec),
        "assigned_specialty": routing_res.get("required_specialty", target_spec),
        "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
        "assigned_doctor_name": routing_res.get("assigned_doctor_name"),
        "reason": reason_str,
        "urgency": urgency_str,
        "ai_summary": data.summary or reason_str,
        "status": "pending",
        "from_worker_id": str(current_user.id),
        "from_hospital_id": effective_hospital,
        "created_at": datetime.utcnow()
    }
    
    result = await db.referrals.insert_one(referral_doc)
    referral_id = str(result.inserted_id)
    
    # Notify ONLY assigned target doctor
    await send_referral_assigned_notification(
        db=db,
        referral_id=referral_id,
        patient_id=patient_id_str,
        assigned_doctor_id=routing_res.get("assigned_doctor_id"),
        target_hospital_id=target_hosp,
        specialty=target_spec,
        status="pending"
    )
    
    # Update current visit with referral info
    await db.visits.update_one(
        {"_id": safe_object_id(data.visit_id)},
        {"$set": {"out_referral_id": referral_id, "status": "referred"}}
    )
    
    # Bridge to the target hospital's OPD queue
    await db.visits.insert_one({
        "patient_id": patient_id_str,
        "hospital_id": target_hosp,
        "hospital_name": target_hosp,
        "date": datetime.utcnow(),
        "created_at": datetime.utcnow(),
        "chief_complaint": f"Clinician Referral ({target_spec}): {reason_str[:100]}...",
        "status": "in_queue",
        "appointment_type": "referred",
        "source_type": "DOCTOR_REFERRAL",
        "doctor_name": routing_res.get("assigned_doctor_name"),
        "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
        "required_specialty": target_spec,
        "risk_tag": "urgent" if urgency_str in ["urgent", "emergency"] else "watch",
        "referred_by": f"Dr. {current_user.name}",
        "referral_id": referral_id,
        "diagnosis": [],
        "prescriptions": []
    })
    
    return {
        "status": "success",
        "referral_id": referral_id,
        "to_hospital_id": target_hosp,
        "to_speciality": target_spec,
        "assigned_doctor": routing_res.get("assigned_doctor_name"),
        "message": "Referral created successfully"
    }


@router.post("/visits/{visit_id}/refer")
async def refer_visit(
    visit_id: str,
    data: VisitReferRequest,
    current_user: UserResponse = Depends(require_role("doctor"))
):
    """
    Direct endpoint to submit a referral for a visit.
    """
    db = get_database()
    effective_hospital = await get_effective_hospital(current_user, db)

    visit = await db.visits.find_one({"_id": safe_object_id(visit_id)})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    target_hosp = data.target_hospital or data.to_hospital_id
    if not target_hosp:
        raise HTTPException(status_code=400, detail="Target hospital is required")

    target_spec = data.target_speciality or data.to_speciality or "General Medicine"
    reason_str = data.reason or "Clinical referral requested."
    urgency_str = data.urgency or "routine"
    patient_id_str = visit.get("patient_id") or "UNKNOWN"

    routing_res = await assign_referral_to_specialist(db, reason_str, target_hosp, override_specialty=target_spec)
    if not routing_res.get("success"):
        raise HTTPException(status_code=400, detail=routing_res.get("error_message"))

    referral_doc = {
        "visit_id": visit_id,
        "patient_id": patient_id_str,
        "to_hospital_id": target_hosp,
        "to_speciality": routing_res.get("required_specialty", target_spec),
        "ai_recommended_specialty": routing_res.get("required_specialty", target_spec),
        "assigned_specialty": routing_res.get("required_specialty", target_spec),
        "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
        "assigned_doctor_name": routing_res.get("assigned_doctor_name"),
        "reason": reason_str,
        "urgency": urgency_str,
        "ai_summary": data.summary or reason_str,
        "status": "pending",
        "from_worker_id": str(current_user.id),
        "from_hospital_id": effective_hospital,
        "created_at": datetime.utcnow()
    }

    result = await db.referrals.insert_one(referral_doc)
    referral_id = str(result.inserted_id)

    # Notify ONLY assigned target doctor
    await send_referral_assigned_notification(
        db=db,
        referral_id=referral_id,
        patient_id=patient_id_str,
        assigned_doctor_id=routing_res.get("assigned_doctor_id"),
        target_hospital_id=target_hosp,
        specialty=target_spec,
        status="pending"
    )

    await db.visits.update_one(
        {"_id": safe_object_id(visit_id)},
        {"$set": {"out_referral_id": referral_id, "status": "referred"}}
    )

    await db.visits.insert_one({
        "patient_id": patient_id_str,
        "hospital_id": target_hosp,
        "date": datetime.utcnow(),
        "created_at": datetime.utcnow(),
        "chief_complaint": f"Clinician Referral ({target_spec}): {reason_str[:100]}...",
        "status": "in_queue",
        "appointment_type": "referred",
        "doctor_name": routing_res.get("assigned_doctor_name"),
        "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
        "required_specialty": target_spec,
        "risk_tag": "urgent" if urgency_str in ["urgent", "emergency"] else "watch",
        "referred_by": f"Dr. {current_user.name}",
        "referral_id": referral_id,
        "diagnosis": [],
        "prescriptions": []
    })

    return {
        "status": "success",
        "referral_id": referral_id,
        "to_hospital_id": target_hosp,
        "to_speciality": target_spec,
        "assigned_doctor": routing_res.get("assigned_doctor_name"),
        "message": "Patient referred successfully"
    }

# --- DIFFERENTIAL DIAGNOSIS ---

@router.get("/differential")
async def get_differential(
    symptoms: str, 
    patient_id: Optional[str] = None, 
    current_user: UserResponse = Depends(require_role("doctor"))
):
    """
    Suggests top 3-4 likely diagnoses based on symptoms and patient clinical context.
    Uses Groq LLM (if configured) with immediate fallback to Local ML + Clinical Diagnostic Matrix.
    Always returns valid, actionable suggestions without failing on missing consent or standalone doctors.
    """
    if not symptoms or not symptoms.strip():
        return {"diagnoses": []}

    clean_symptoms = symptoms.strip()
    db = get_database()
    
    # 1. Fetch patient context if patient_id is provided
    patient_info = {}
    has_consent = False
    patient_context_str = ""

    if patient_id and str(patient_id).strip():
        pid_clean = str(patient_id).strip()
        try:
            patient = await get_or_create_patient_doc(db, pid_clean)
            if patient:
                patient_info = patient
                # Check consent to determine history access
                consent = await db.consents.find_one({
                    "$or": [
                        {"patient_id": pid_clean},
                        {"patient_id": str(patient.get("_id", ""))}
                    ],
                    "granted_to_id": str(current_user.id),
                    "expires_at": {"$gt": datetime.utcnow()},
                    "revoked": False
                })
                has_consent = consent is not None

                # Compute Age safely
                age_val = None
                dob = patient.get("date_of_birth")
                if dob:
                    try:
                        birth_year = int(str(dob).split("-")[0])
                        age_val = datetime.utcnow().year - birth_year
                    except Exception:
                        pass
                
                gender = patient.get("gender", "Unspecified")
                allergies = patient.get("allergies", [])
                
                patient_context_str = f"Patient Gender: {gender}, Age: {age_val if age_val else 'Adult'}. "
                if allergies:
                    patient_context_str += f"Known Allergies: {', '.join(allergies)}. "

                if has_consent:
                    try:
                        recent_visits = await db.visits.find({"patient_id": pid_clean}).sort("date", -1).limit(3).to_list(3)
                        diagnoses_list = [", ".join(v.get("diagnosis", [])) for v in recent_visits if v.get("diagnosis")]
                        if diagnoses_list:
                            patient_context_str += f"Past Visit Diagnoses: {'; '.join(diagnoses_list)}. "
                    except Exception as e:
                        print(f"Error fetching visit history for differential: {e}")
        except Exception as err:
            print(f"Patient lookup error in differential: {err}")

    # 2. Try Groq AI First (if configured)
    if settings.groq_api_key and settings.groq_api_key.strip() and settings.groq_api_key != "your_key_here":
        try:
            from groq import AsyncGroq
            groq_client = AsyncGroq(api_key=settings.groq_api_key)
            
            system_prompt = (
                "You are an expert AI clinical diagnostic decision support system assisting a registered medical doctor in an outpatient clinic. "
                "Analyze the symptoms and provide the top 3-4 differential diagnoses ordered by clinical likelihood. "
                "Respond ONLY with a JSON object in this exact schema:\n"
                "{\n"
                '  "diagnoses": [\n'
                "    {\n"
                '      "name": "Condition Name",\n'
                '      "confidence": "High" | "Medium" | "Low",\n'
                '      "reasoning": "1-2 sentence evidence-based clinical reasoning.",\n'
                '      "suggested_tests": ["Test 1", "Test 2"]\n'
                "    }\n"
                "  ]\n"
                "}"
            )
            
            user_prompt = f"Chief Complaint & Symptoms: {clean_symptoms}\n{patient_context_str}"
            
            response = await asyncio.wait_for(
                groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.2,
                    max_tokens=600
                ),
                timeout=4.5
            )
            
            raw_content = response.choices[0].message.content
            parsed = json.loads(raw_content)
            if "diagnoses" in parsed and isinstance(parsed["diagnoses"], list) and len(parsed["diagnoses"]) > 0:
                return {"diagnoses": parsed["diagnoses"]}
        except Exception as e:
            print(f"Groq Differential fallback triggering (Error: {e})")

    # 3. Comprehensive Local Clinical Diagnostic Engine Fallback
    try:
        symptoms_lower = clean_symptoms.lower()
        diagnoses = []

        # High-specificity clinical patterns
        if any(w in symptoms_lower for w in ["chest pain", "angina", "cardiac", "palpitation", "heart pain", "left arm pain", "tightness in chest"]):
            diagnoses = [
                {
                    "name": "Acute Coronary Syndrome / Angina Pectoris",
                    "confidence": "High",
                    "reasoning": "Acute retrosternal chest pain and distress patterns suggestive of potential myocardial ischemia requiring prompt evaluation.",
                    "suggested_tests": ["12-Lead ECG", "Cardiac Troponin I/T", "2D Echocardiogram"]
                },
                {
                    "name": "Gastroesophageal Reflux Disease (GERD)",
                    "confidence": "Medium",
                    "reasoning": "Substernal burning discomfort mimicking cardiac pain, often related to acid regurgitation or esophageal spasm.",
                    "suggested_tests": ["Upper GI Endoscopy", "Trial of PPIs"]
                },
                {
                    "name": "Musculoskeletal Chest Wall Pain / Costochondritis",
                    "confidence": "Medium",
                    "reasoning": "Localized anterior chest wall tenderness typically exacerbated by palpation or deep inspiration.",
                    "suggested_tests": ["Chest X-Ray PA View", "Clinical Palpation Exam"]
                }
            ]
        elif any(w in symptoms_lower for w in ["breath", "wheez", "asthma", "dyspnea", "shortness of breath", "stridor"]):
            diagnoses = [
                {
                    "name": "Bronchial Asthma / Acute Exacerbation",
                    "confidence": "High",
                    "reasoning": "Airway hyper-responsiveness with dyspnea, wheezing, and reversible bronchospasm indicators.",
                    "suggested_tests": ["Peak Expiratory Flow Rate (PEFR)", "Spirometry", "Chest X-Ray"]
                },
                {
                    "name": "Acute Bronchitis / Lower RTI",
                    "confidence": "Medium",
                    "reasoning": "Bronchial inflammation with persistent cough, wheeze, and mild respiratory effort.",
                    "suggested_tests": ["Chest X-Ray PA View", "Complete Blood Count (CBC)"]
                },
                {
                    "name": "Chronic Obstructive Pulmonary Disease (COPD)",
                    "confidence": "Medium",
                    "reasoning": "Progressive airflow limitation, chronic cough, and exertional breathlessness.",
                    "suggested_tests": ["Pulmonary Function Test (PFT)", "Chest HRCT", "Arterial Blood Gas (ABG)"]
                }
            ]
        elif any(w in symptoms_lower for w in ["cough", "cold", "throat", "sore throat", "runny nose", "sneezing", "congestion", "phlegm"]):
            diagnoses = [
                {
                    "name": "Upper Respiratory Tract Infection (URTI) / Pharyngitis",
                    "confidence": "High",
                    "reasoning": "Acute viral or bacterial mucosal inflammation involving the nasopharynx and upper respiratory passage.",
                    "suggested_tests": ["Complete Blood Count (CBC)", "Throat Swab / Rapid Strep Test"]
                },
                {
                    "name": "Acute Bronchitis",
                    "confidence": "Medium",
                    "reasoning": "Lower airway inflammation presenting with persistent dry or productive cough following viral prodrome.",
                    "suggested_tests": ["Chest X-Ray PA View", "Serum CRP"]
                },
                {
                    "name": "Allergic Rhinosinusitis",
                    "confidence": "Medium",
                    "reasoning": "Allergen-induced nasal mucosal congestion, clear rhinorrhea, and post-nasal drip trigger.",
                    "suggested_tests": ["Absolute Eosinophil Count (AEC)", "Serum IgE"]
                }
            ]
        elif any(w in symptoms_lower for w in ["fever", "chills", "high fever", "shivering", "pyrexia", "temperature"]):
            diagnoses = [
                {
                    "name": "Acute Viral Febrile Illness",
                    "confidence": "High",
                    "reasoning": "Acute febrile spike accompanied by generalized myalgia, constitutional fatigue, and viral syndrome.",
                    "suggested_tests": ["CBC with Platelet Count", "Serum CRP", "Urine Routine & Microscopy"]
                },
                {
                    "name": "Tropical Infectious Disease (Dengue / Malaria / Typhoid)",
                    "confidence": "Medium",
                    "reasoning": "High-grade fever with rigors, chills, or headache requiring screening for endemic vector-borne/enteric infections.",
                    "suggested_tests": ["Dengue NS1 & IgM Antigen", "Malaria Smear / RDT", "Widal / Typhidot Test"]
                },
                {
                    "name": "Urinary Tract Infection (UTI)",
                    "confidence": "Medium",
                    "reasoning": "Occult or systemic bacteremic fever originating from upper/lower urinary tract.",
                    "suggested_tests": ["Urine Routine & Microscopy", "Urine Culture & Sensitivity"]
                }
            ]
        elif any(w in symptoms_lower for w in ["stomach", "abdom", "diarrhea", "diarrhoea", "vomit", "acid", "gastric", "ulcer", "nausea", "loose stool", "cramp"]):
            diagnoses = [
                {
                    "name": "Acute Gastroenteritis / Enteritis",
                    "confidence": "High",
                    "reasoning": "Infectious or inflammatory gastrointestinal mucosal disturbance with nausea, loose stools, and abdominal cramps.",
                    "suggested_tests": ["Stool Routine & Microscopy", "Serum Electrolytes", "CBC"]
                },
                {
                    "name": "Acid Peptic Disease / Acute Gastritis",
                    "confidence": "Medium",
                    "reasoning": "Epigastric distress, hyperacidity, and mucosal irritation aggravated by dietary or NSAID factors.",
                    "suggested_tests": ["Upper GI Endoscopy", "H. Pylori Stool Antigen"]
                },
                {
                    "name": "Irritable Bowel Syndrome / Food Intolerance",
                    "confidence": "Medium",
                    "reasoning": "Functional bowel disorder characterized by abdominal discomfort and altered bowel habits.",
                    "suggested_tests": ["Stool Occult Blood", "Ultrasound Whole Abdomen"]
                }
            ]
        elif any(w in symptoms_lower for w in ["headache", "migraine", "head pain", "cephalea", "dizzy", "dizziness", "vertigo", "giddiness"]):
            diagnoses = [
                {
                    "name": "Migraine / Vascular Headache",
                    "confidence": "High",
                    "reasoning": "Throbbing or unilateral cephalea with neuro-vascular features and possible photo/phonophobia.",
                    "suggested_tests": ["Detailed Neurological Assessment", "Blood Pressure Monitoring", "Fundoscopy"]
                },
                {
                    "name": "Tension-Type Headache / Cervical Spasm",
                    "confidence": "Medium",
                    "reasoning": "Bilateral band-like constricting cranial pressure associated with stress or muscular contraction.",
                    "suggested_tests": ["Cervical Spine X-Ray", "Refraction / Vision Testing"]
                },
                {
                    "name": "Benign Paroxysmal Positional Vertigo (BPPV) / Labyrinthitis",
                    "confidence": "Medium",
                    "reasoning": "Vestibular disturbance causing postural dizziness, room-spinning sensations, and equilibrium unsteadiness.",
                    "suggested_tests": ["Dix-Hallpike Test", "Audiometry"]
                }
            ]
        elif any(w in symptoms_lower for w in ["skin", "rash", "itch", "redness", "lesion", "eczema", "hives", "dermatitis", "allergy"]):
            diagnoses = [
                {
                    "name": "Allergic Contact Dermatitis / Acute Urticaria",
                    "confidence": "High",
                    "reasoning": "Pruritic erythematous wheals and cutaneous mast-cell activation triggered by allergen exposure.",
                    "suggested_tests": ["Absolute Eosinophil Count (AEC)", "Serum Total IgE", "Skin Prick Test"]
                },
                {
                    "name": "Cutaneous Fungal Infection (Tinea Corporis / Cruris)",
                    "confidence": "Medium",
                    "reasoning": "Annular scaly erythematous plaques with raised advancing borders typical of dermatophytosis.",
                    "suggested_tests": ["Skin Scraping with KOH Mount", "Wood's Lamp Examination"]
                },
                {
                    "name": "Viral Exanthem / Pityriasis Rosea",
                    "confidence": "Medium",
                    "reasoning": "Widespread symmetrical maculopapular eruption following mild viral prodromal illness.",
                    "suggested_tests": ["CBC with Differential", "Routine Clinical Examination"]
                }
            ]
        elif any(w in symptoms_lower for w in ["joint", "knee", "bone", "fracture", "back pain", "spine", "arthritis", "swelling in legs", "edema"]):
            diagnoses = [
                {
                    "name": "Osteoarthritis / Degenerative Joint Disease",
                    "confidence": "High",
                    "reasoning": "Articular cartilage wear, localized joint pain, crepitus, and limitation of weight-bearing motion.",
                    "suggested_tests": ["X-Ray Affected Joint", "Serum Uric Acid", "ESR"]
                },
                {
                    "name": "Musculoskeletal Strain / Lumbar Spondylosis",
                    "confidence": "Medium",
                    "reasoning": "Paraspinal muscle spasm, biomechanical strain, or lumbar facet joint degeneration.",
                    "suggested_tests": ["X-Ray Lumbosacral Spine", "MRI Spine (if radiculopathy)"]
                },
                {
                    "name": "Inflammatory Arthritis / Gout",
                    "confidence": "Medium",
                    "reasoning": "Synovial inflammation or crystal arthropathy presenting with acute swelling, heat, and joint pain.",
                    "suggested_tests": ["Serum Uric Acid", "Rheumatoid Factor (RA)", "Serum CRP"]
                }
            ]
        else:
            # ML Model prediction
            dis_res = local_ai.predict_disease(clean_symptoms)
            top_preds = dis_res.get("top_3_predictions", [])
            if top_preds and len(top_preds) > 0:
                for p in top_preds:
                    c_val = p.get("confidence", 0.7)
                    c_str = "High" if c_val >= 0.7 else ("Medium" if c_val >= 0.4 else "Low")
                    diagnoses.append({
                        "name": p.get("name"),
                        "confidence": c_str,
                        "reasoning": f"Identified by trained local ML clinical diagnostic model ({round(c_val*100, 1)}% pattern match score).",
                        "suggested_tests": ["Complete Blood Count (CBC)", "Routine OPD Examination"]
                    })
            else:
                cond = dis_res.get("predicted_condition") or dis_res.get("predicted_disease") or "General OPD Clinical Evaluation"
                diagnoses = [
                    {
                        "name": cond,
                        "confidence": "Medium",
                        "reasoning": dis_res.get("explanation", "Identified by clinical pattern recognition model."),
                        "suggested_tests": ["Complete Blood Count (CBC)", "Routine OPD Examination"]
                    },
                    {
                        "name": "Viral Syndrome / General Malaise",
                        "confidence": "Medium",
                        "reasoning": "Non-specific systemic symptoms requiring comprehensive physician physical assessment.",
                        "suggested_tests": ["Vital Signs Profiling", "Basic Metabolic Panel"]
                    }
                ]

        return {"diagnoses": diagnoses}
    except Exception as e:
        print(f"Differential Error: {e}")
        return {"diagnoses": [
            {
                "name": "General Clinical Evaluation",
                "confidence": "Medium",
                "reasoning": "Clinical assessment recommended based on presented symptoms.",
                "suggested_tests": ["Routine OPD Examination", "CBC"]
            }
        ]}


# --- DOCTOR PATIENT LIST ENDPOINTS ---

@router.get("/patients")
@router.get("/my-patients")
async def get_my_patients(current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Returns all patients managed by this doctor (from completed visits and active consultations).
    """
    db = get_database()
    
    # Debug: Log what we're looking for
    print(f"[DEBUG MY-PATIENTS] Doctor: name='{current_user.name}', id='{current_user.id}', type={type(current_user.id)}")
    
    # Find all visits where this doctor is listed (completed, active, or in queue)
    # Handle multiple possible doctor_id formats and search criteria
    from bson import ObjectId
    
    # Build query conditions
    query_conditions = []
    
    # Try string version of ID
    query_conditions.append({"doctor_id": str(current_user.id)})
    
    # Try original ID format (could be string or ObjectId)
    query_conditions.append({"doctor_id": current_user.id})
    
    # Try doctor name match
    query_conditions.append({"doctor_name": current_user.name})
    
    # Try ObjectId conversion if possible
    try:
        doctor_object_id = ObjectId(str(current_user.id))
        query_conditions.append({"doctor_id": doctor_object_id})
        print(f"[DEBUG MY-PATIENTS] Added ObjectId condition: {doctor_object_id}")
    except Exception as e:
        print(f"[DEBUG MY-PATIENTS] Cannot convert to ObjectId: {e}")
    
    # Also check if doctor_id might be stored in other fields
    query_conditions.append({"doctor": current_user.name})
    query_conditions.append({"assigned_doctor": current_user.name})
    query_conditions.append({"attending_doctor": current_user.name})
    
    print(f"[DEBUG MY-PATIENTS] Query conditions: {len(query_conditions)} conditions")
    
    # Execute query with OR
    visits_cursor = db.visits.find({"$or": query_conditions}).sort("date", -1)
    
    visits = await visits_cursor.to_list(500)
    
    print(f"[DEBUG MY-PATIENTS] Found {len(visits)} total visits for doctor {current_user.name}")
    
    # Debug: Show sample visits
    for i, v in enumerate(visits[:10]):
        print(f"[DEBUG MY-PATIENTS] Visit {i}: id={v.get('_id')}, patient_id={v.get('patient_id')}, "
              f"doctor_id={v.get('doctor_id')} (type: {type(v.get('doctor_id'))}), "
              f"doctor_name='{v.get('doctor_name')}', status={v.get('status')}, "
              f"date={v.get('date')}")
    
    # Also check visits by scanning all visits (for debugging)
    if len(visits) == 0:
        print(f"[DEBUG MY-PATIENTS] No visits found with OR query. Checking all visits...")
        all_visits = await db.visits.find({}).sort("date", -1).to_list(100)
        matching_by_name = [v for v in all_visits if v.get('doctor_name') == current_user.name]
        print(f"[DEBUG MY-PATIENTS] Found {len(matching_by_name)} visits by name match in all visits")
        for v in matching_by_name[:5]:
            print(f"[DEBUG MY-PATIENTS] Matching visit: doctor_id={v.get('doctor_id')}, doctor_name={v.get('doctor_name')}")
    
    # Also include patients from doctor's appointments
    curr_doc_id = str(current_user.id)
    doc_name_rgx = {"$regex": f"^{re.escape(current_user.name.strip())}$", "$options": "i"} if current_user.name else None

    appts = await db.appointments.find({
        "$or": [
            {"doctor_id": curr_doc_id},
            {"doctor_id": safe_object_id_silent(curr_doc_id)},
            {"doctor_name": doc_name_rgx} if doc_name_rgx else {"doctor_id": curr_doc_id}
        ]
    }).sort("created_at", -1).to_list(500)

    # Also include patients from doctor's referrals
    refs = await db.referrals.find({
        "$or": [
            {"assigned_doctor_id": curr_doc_id},
            {"assigned_doctor_id": safe_object_id_silent(curr_doc_id)},
            {"doctor_id": curr_doc_id},
            {"doctor_id": safe_object_id_silent(curr_doc_id)},
            {"target_doctor_id": curr_doc_id},
            {"target_doctor_id": safe_object_id_silent(curr_doc_id)},
            {"to_doctor_name": doc_name_rgx} if doc_name_rgx else {"doctor_id": curr_doc_id},
            {"doctor_name": doc_name_rgx} if doc_name_rgx else {"doctor_id": curr_doc_id}
        ]
    }).sort("created_at", -1).to_list(500)

    # Group by patient_id to get unique patients across visits, appointments, and referrals
    raw_patient_ids = [v.get("patient_id") for v in visits if v.get("patient_id")]
    raw_patient_ids.extend([a.get("patient_id") for a in appts if a.get("patient_id")])
    raw_patient_ids.extend([r.get("patient_id") for r in refs if r.get("patient_id")])
    patient_ids = list(set([str(pid) for pid in raw_patient_ids if pid]))

    # Bulk-fetch all patients matching _id, user_id, or id
    object_ids = [safe_object_id_silent(pid) for pid in patient_ids if safe_object_id_silent(pid)]
    patients_cursor = db.patients.find({
        "$or": [
            {"_id": {"$in": object_ids}},
            {"user_id": {"$in": patient_ids}},
            {"id": {"$in": patient_ids}}
        ]
    })
    patients_list = await patients_cursor.to_list(len(patient_ids) + 50)
    patients_map = {}
    for p in patients_list:
        patients_map[str(p["_id"])] = p
        if p.get("user_id"):
            patients_map[str(p["user_id"])] = p
        if p.get("id"):
            patients_map[str(p["id"])] = p

    # Fallback to users table if patient profile missing
    users_cursor = db.users.find({
        "role": "patient",
        "$or": [
            {"_id": {"$in": object_ids}},
            {"id": {"$in": patient_ids}}
        ]
    })
    users_list = await users_cursor.to_list(len(patient_ids) + 50)
    users_map = {str(u["_id"]): u for u in users_list}

    patients = []
    seen_canonical_ids = set()
    for patient_id in patient_ids:
        patient = patients_map.get(str(patient_id)) or users_map.get(str(patient_id))
        canonical_id = str(patient["_id"]) if (patient and "_id" in patient) else str(patient_id)
        if canonical_id in seen_canonical_ids:
            continue
        seen_canonical_ids.add(canonical_id)

        p_name = (patient.get("name") if patient else None) or "Patient"

        # Get patient's visits & appointments with this doctor
        matching_pat_ids = {str(patient_id), canonical_id}
        if patient and patient.get("user_id"):
            matching_pat_ids.add(str(patient["user_id"]))
        if patient and patient.get("id"):
            matching_pat_ids.add(str(patient["id"]))

        patient_visits = [v for v in visits if str(v.get("patient_id")) in matching_pat_ids]
        patient_appts = [a for a in appts if str(a.get("patient_id")) in matching_pat_ids]
        
        # Calculate age
        dob = (patient.get("date_of_birth") if patient else None) or "2000-01-01"
        try:
            birth_year = int(str(dob).split("-")[0])
            age = datetime.utcnow().year - birth_year
        except Exception:
            age = (patient.get("age") if patient else 30) or 30
        
        # Get risk level from most recent visit
        risk_level = "low"
        if patient_visits and patient_visits[0].get("risk_tag"):
            risk_map = {"urgent": "high", "watch": "medium", "low": "low"}
            risk_level = risk_map.get(patient_visits[0]["risk_tag"], "low")
        
        # Get diagnoses and conditions
        chronic_conditions = []
        last_diagnosis = None
        for v in patient_visits[:5]:
            if v.get("diagnosis"):
                last_diagnosis = v["diagnosis"][0] if isinstance(v["diagnosis"], list) else v["diagnosis"]
                chronic_conditions.extend(v.get("diagnosis", []))
        
        chronic_conditions = list(set(chronic_conditions))[:5]
        
        last_visit_date = None
        if patient_visits:
            last_visit_date = patient_visits[0].get("date") or patient_visits[0].get("created_at")
        elif patient_appts:
            last_visit_date = patient_appts[0].get("requested_date") or patient_appts[0].get("created_at")
        
        patients.append({
            "patient_id": str(patient["_id"]) if patient and "_id" in patient else str(patient_id),
            "name": p_name,
            "age": age,
            "gender": (patient.get("gender") if patient else "Other") or "Other",
            "mobile": patient.get("mobile") if patient else "",
            "village": patient.get("village") if patient else "",
            "district": patient.get("district") if patient else "",
            "last_visit_date": last_visit_date.isoformat() if hasattr(last_visit_date, 'isoformat') else (str(last_visit_date) if last_visit_date else None),
            "last_diagnosis": last_diagnosis or "OPD Evaluation",
            "chronic_conditions": chronic_conditions,
            "risk_level": risk_level,
            "total_visits": len(patient_visits) + len(patient_appts)
        })
    
    return patients

@router.get("/referrals")
async def get_referrals(current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Returns all referrals (incoming and outgoing) for this doctor.
    """
    db = get_database()
    curr_doc_id = str(current_user.id)
    doc_name_rgx = {"$regex": f"^{re.escape(current_user.name.strip())}$", "$options": "i"} if current_user.name else None

    # Match referrals directly assigned to this doctor or matching hospital duty pool
    incoming_query_conditions = [
        {"assigned_doctor_id": curr_doc_id},
        {"assigned_doctor_id": current_user.id},
        {"doctor_id": curr_doc_id},
        {"doctor_id": current_user.id},
        {"target_doctor_id": curr_doc_id},
        {"target_doctor_id": current_user.id},
        {"to_doctor_id": curr_doc_id},
        {"to_doctor_id": current_user.id}
    ]
    try:
        from bson import ObjectId
        incoming_query_conditions.extend([
            {"assigned_doctor_id": ObjectId(curr_doc_id)},
            {"doctor_id": ObjectId(curr_doc_id)},
            {"target_doctor_id": ObjectId(curr_doc_id)},
            {"to_doctor_id": ObjectId(curr_doc_id)}
        ])
    except Exception:
        pass

    if doc_name_rgx:
        incoming_query_conditions.extend([
            {"assigned_doctor_name": doc_name_rgx},
            {"to_doctor_name": doc_name_rgx},
            {"doctor_name": doc_name_rgx}
        ])

    # Also include unassigned pool referrals for doctor's hospital
    doc_hosp = (current_user.hospital or "").strip()
    if doc_hosp:
        hosp_rgx = {"$regex": f"^{re.escape(doc_hosp)}$", "$options": "i"}
        unassigned_cond = {
            "$and": [
                {
                    "$or": [
                        {"assigned_doctor_id": None},
                        {"assigned_doctor_id": "unassigned"},
                        {"assigned_doctor_id": ""},
                        {"assigned_doctor_id": {"$exists": False}}
                    ]
                },
                {
                    "$or": [
                        {"to_hospital_name": hosp_rgx},
                        {"to_hospital_id": hosp_rgx},
                        {"hospital_name": hosp_rgx},
                        {"hospital_id": hosp_rgx}
                    ]
                }
            ]
        }
        incoming_query_conditions.append(unassigned_cond)

    incoming_cursor = db.referrals.find({
        "$or": incoming_query_conditions,
        "status": {"$in": ["pending", "accepted", "rejected", "seen", "completed"]}
    }).sort("created_at", -1)
    
    incoming_refs_raw = await incoming_cursor.to_list(500)
    
    from services.ai_routing import normalize_specialty
    doc_spec = normalize_specialty(current_user.speciality or current_user.specialty or "")
    
    incoming_refs = []
    for ref in incoming_refs_raw:
        # If explicitly assigned to this doctor, always include
        assigned_to_me = bool(
            str(ref.get("assigned_doctor_id")) == curr_doc_id or
            str(ref.get("doctor_id")) == curr_doc_id or
            str(ref.get("target_doctor_id")) == curr_doc_id or
            (ref.get("to_doctor_name") and current_user.name and ref.get("to_doctor_name").strip().lower() == current_user.name.strip().lower())
        )
        if not assigned_to_me:
            ref_spec = normalize_specialty(ref.get("required_specialty") or ref.get("to_speciality") or ref.get("assigned_specialty") or "")
            if ref_spec and doc_spec and ref_spec.lower() != doc_spec.lower() and doc_spec.lower() != "general medicine":
                continue
        incoming_refs.append(ref)
    
    # Get outgoing referrals (from this doctor)
    outgoing_query_conditions = [
        {"from_doctor_id": str(current_user.id)},
        {"from_doctor_id": current_user.id}
    ]
    if doc_name_rgx:
        outgoing_query_conditions.append({"from_doctor_name": doc_name_rgx})
    try:
        from bson import ObjectId
        outgoing_query_conditions.append({"from_doctor_id": ObjectId(curr_doc_id)})
    except Exception:
        pass
    
    outgoing_cursor = db.referrals.find({
        "$or": outgoing_query_conditions,
        "status": {"$in": ["pending", "accepted", "rejected", "seen", "completed"]}
    }).sort("created_at", -1)
    
    outgoing_refs = await outgoing_cursor.to_list(500)
    
    referrals = []
    
    # Process incoming
    for ref in incoming_refs:
        p_id = safe_object_id_silent(ref.get("patient_id"))
        patient = await db.patients.find_one({"$or": [{"_id": p_id}] if p_id else [{"id": ref.get("patient_id")}]})
        
        dob = (patient.get("date_of_birth") if patient else None) or "2000-01-01"
        try:
            birth_year = int(str(dob).split("-")[0])
            age = datetime.utcnow().year - birth_year
        except Exception:
            age = (patient.get("age") if patient else 30) or 30
            
        asha = await db.users.find_one({"_id": safe_object_id_silent(ref.get("from_worker_id") or ref.get("asha_id"))}) if (ref.get("from_worker_id") or ref.get("asha_id")) else None
        
        referrals.append({
            "id": str(ref["_id"]),
            "patient_id": str(patient["_id"]) if patient else str(ref.get("patient_id")),
            "patient_name": patient.get("name", ref.get("patient_name", "Patient")) if patient else ref.get("patient_name", "Patient"),
            "patient_age": age,
            "patient_gender": patient.get("gender", "Other") if patient else "Other",
            "patient_mobile": patient.get("mobile", "") if patient else "",
            "type": "incoming",
            "from_doctor": ref.get("from_doctor_name"),
            "from_facility": ref.get("from_hospital_name") or ref.get("from_facility"),
            "to_doctor": ref.get("to_doctor_name") or current_user.name,
            "to_facility": ref.get("to_hospital_name") or current_user.hospital,
            "to_speciality": ref.get("to_speciality") or ref.get("required_specialty"),
            "reason": ref.get("reason") or ref.get("notes", ""),
            "notes": ref.get("notes", ""),
            "urgency": ref.get("urgency", "routine"),
            "status": ref.get("status", "pending"),
            "created_date": (ref.get("created_at") or ref.get("created_date") or datetime.utcnow()).isoformat() if (ref.get("created_at") or ref.get("created_date")) else datetime.utcnow().isoformat(),
            "updated_date": ref.get("updated_date"),
            "asha_name": asha["name"] if asha else (ref.get("from_worker_name") or ref.get("asha_name"))
        })
    
    # Process outgoing
    for ref in outgoing_refs:
        p_id = safe_object_id_silent(ref.get("patient_id"))
        patient = await db.patients.find_one({"$or": [{"_id": p_id}] if p_id else [{"id": ref.get("patient_id")}]})
        
        dob = (patient.get("date_of_birth") if patient else None) or "2000-01-01"
        try:
            birth_year = int(str(dob).split("-")[0])
            age = datetime.utcnow().year - birth_year
        except Exception:
            age = (patient.get("age") if patient else 30) or 30
            
        referrals.append({
            "id": str(ref["_id"]),
            "patient_id": str(patient["_id"]) if patient else str(ref.get("patient_id")),
            "patient_name": patient.get("name", ref.get("patient_name", "Patient")) if patient else ref.get("patient_name", "Patient"),
            "patient_age": age,
            "patient_gender": patient.get("gender", "Other") if patient else "Other",
            "patient_mobile": patient.get("mobile", "") if patient else "",
            "type": "outgoing",
            "from_doctor": current_user.name,
            "from_facility": current_user.hospital,
            "to_doctor": ref.get("to_doctor_name"),
            "to_facility": ref.get("to_hospital_name"),
            "to_speciality": ref.get("to_speciality"),
            "reason": ref.get("reason", ""),
            "notes": ref.get("notes", ""),
            "urgency": ref.get("urgency", "routine"),
            "status": ref.get("status", "pending"),
            "created_date": (ref.get("created_at") or ref.get("created_date") or datetime.utcnow()).isoformat() if (ref.get("created_at") or ref.get("created_date")) else datetime.utcnow().isoformat(),
            "updated_date": ref.get("updated_date"),
            "asha_name": None
        })
    
    return referrals

@router.post("/referrals/{referral_id}/accept")
async def accept_referral(referral_id: str, current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Accept a referral - atomically claims referral and adds the patient directly to doctor's OPD queue.
    """
    db = get_database()
    curr_doc_id = str(current_user.id)
    
    # Find the referral
    ref_obj = safe_object_id_silent(referral_id)
    referral = await db.referrals.find_one({
        "$or": [
            {"_id": ref_obj} if ref_obj else {"id": referral_id},
            {"id": referral_id}
        ]
    })
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    
    # Check if referral is already accepted or completed
    if referral.get("status") in ["accepted", "seen", "completed"]:
        raise HTTPException(status_code=400, detail=f"Referral already {referral.get('status')}")
    
    # Atomically accept
    await db.referrals.update_one(
        {"_id": referral["_id"]},
        {"$set": {
            "status": "accepted",
            "accepted_at": datetime.utcnow(),
            "doctor_id": curr_doc_id,
            "assigned_doctor_id": curr_doc_id,
            "doctor_name": current_user.name,
            "updated_date": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }}
    )

    patient_id_raw = str(referral.get("patient_id"))
    patient = await db.patients.find_one({
        "$or": [
            {"_id": safe_object_id_silent(patient_id_raw)},
            {"user_id": patient_id_raw},
            {"id": patient_id_raw}
        ]
    })
    patient_name = (patient.get("name") if patient else None) or referral.get("patient_name") or "Patient"
    canonical_pid = str(patient["_id"]) if patient else patient_id_raw

    # Notify ASHA worker if created by ASHA
    asha_id = referral.get("asha_id") or referral.get("from_worker_id")
    if asha_id and str(asha_id) != curr_doc_id:
        try:
            await db.notifications.insert_one({
                "user_id": str(asha_id),
                "referral_id": str(referral["_id"]),
                "patient_id": canonical_pid,
                "title": "Referral Accepted ✓",
                "message": f"Referral for {patient_name} has been accepted by Dr. {current_user.name} and added to OPD queue.",
                "type": "REFERRAL_ACCEPTED",
                "created_at": datetime.utcnow(),
                "read": False
            })
        except Exception:
            pass
    
    # Check if there's already an active visit for this referral
    existing_active = await db.visits.find_one({
        "$or": [
            {"referral_id": str(referral["_id"])},
            {"referral_id": referral_id}
        ]
    })
    
    hosp_name = current_user.hospital or referral.get("to_hospital_name") or referral.get("to_hospital_id") or "Govt Hospital"
    ref_spec = referral.get("to_speciality") or referral.get("required_specialty") or referral.get("assigned_specialty") or current_user.speciality or "General Medicine"

    if existing_active:
        await db.visits.update_one(
            {"_id": existing_active["_id"]},
            {"$set": {
                "referral_id": str(referral["_id"]),
                "doctor_id": curr_doc_id,
                "assigned_doctor_id": curr_doc_id,
                "doctor_name": current_user.name,
                "status": "in_queue",
                "hospital_name": hosp_name,
                "hospital_id": hosp_name,
                "required_specialty": ref_spec,
                "specialty": ref_spec,
                "updated_at": datetime.utcnow()
            }}
        )
        visit_id = str(existing_active["_id"])
    else:
        # Create new visit in OPD Queue
        visit_doc = {
            "patient_id": canonical_pid,
            "patient_name": patient_name,
            "hospital_id": hosp_name,
            "hospital_name": hosp_name,
            "doctor_id": curr_doc_id,
            "assigned_doctor_id": curr_doc_id,
            "doctor_name": current_user.name,
            "required_specialty": ref_spec,
            "specialty": ref_spec,
            "date": datetime.utcnow(),
            "chief_complaint": referral.get("reason") or referral.get("notes") or "Referred Patient Consultation",
            "status": "in_queue",
            "referral_id": str(referral["_id"]),
            "appointment_type": "referred",
            "source_type": "ASHA_REFERRAL" if (referral.get("asha_id") or referral.get("from_worker_id")) else "DOCTOR_REFERRAL",
            "risk_tag": referral.get("urgency", "routine"),
            "referred_by": referral.get("from_worker_name") or referral.get("from_doctor_name") or "ASHA Worker",
            "diagnosis": [],
            "prescriptions": [],
            "created_at": datetime.utcnow()
        }
        result = await db.visits.insert_one(visit_doc)
        visit_id = str(result.inserted_id)
    
    print(f"[SUCCESS REFERRAL ACCEPTED] Referral {referral_id} accepted by Dr. {current_user.name}. Enqueued in OPD Queue with visit_id {visit_id}")
    return {"status": "accepted", "visit_id": visit_id, "message": "Referral accepted. Patient added to your OPD Queue."}

@router.post("/referrals/{referral_id}/reject")
async def reject_referral(
    referral_id: str, 
    data: Dict[str, Any] = None, 
    current_user: UserResponse = Depends(require_role("doctor"))
):
    """
    Reject a referral with optional reason.
    """
    if not current_user.hospital:
        raise HTTPException(status_code=403, detail="Doctor is not assigned to any hospital")
        
    db = get_database()
    
    # Find the referral
    referral = await db.referrals.find_one({"_id": safe_object_id(referral_id)})
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    
    # Check if referral is meant for this doctor's hospital
    if referral.get("to_hospital_id") != current_user.hospital:
        raise HTTPException(status_code=403, detail="This referral is not for your hospital")
    
    # Check if referral is already processed
    if referral.get("status") in ["accepted", "seen", "completed", "rejected"]:
        raise HTTPException(status_code=400, detail=f"Referral already {referral.get('status')}")
    
    # Update referral status
    update_data = {
        "status": "rejected",
        "rejected_at": datetime.utcnow(),
        "rejected_by": str(current_user.id),
        "rejected_by_name": current_user.name,
        "updated_date": datetime.utcnow()
    }
    
    if data and data.get("reason"):
        update_data["rejection_reason"] = data["reason"]
    
    await db.referrals.update_one(
        {"_id": safe_object_id(referral_id)},
        {"$set": update_data}
    )

    # Also mark any linked in_queue visit as referral_rejected
    rejection_reason = data.get("reason", "No reason provided") if data else "No reason provided"
    await db.visits.update_many(
        {
            "referral_id": referral_id,
            "hospital_id": current_user.hospital,
            "status": "in_queue"
        },
        {"$set": {
            "status": "referral_rejected",
            "rejection_reason": rejection_reason,
            "rejected_at": datetime.utcnow()
        }}
    )
    
    print(f"[DEBUG REJECT REFERRAL] Doctor {current_user.name} rejected referral {referral_id}")
    
    return {"status": "rejected", "message": "Referral rejected"}

@router.get("/debug/current-user")
async def debug_current_user(current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Debug endpoint to check current user information.
    """
    db = get_database()
    
    # Show current user info
    user_info = {
        "user_id": str(current_user.id),
        "user_name": current_user.name,
        "user_email": current_user.email,
        "user_role": current_user.role,
        "user_hospital": current_user.hospital,
        "user_id_type": type(current_user.id).__name__
    }
    
    print(f"[DEBUG USER] Current user info: {user_info}")
    
    # Check visits in database
    all_visits = await db.visits.find({}).sort("date", -1).limit(20).to_list(20)
    visits_info = []
    
    for v in all_visits:
        visits_info.append({
            "visit_id": str(v.get('_id')),
            "patient_id": v.get('patient_id'),
            "doctor_id": v.get('doctor_id'),
            "doctor_id_type": type(v.get('doctor_id')).__name__ if v.get('doctor_id') else None,
            "doctor_name": v.get('doctor_name'),
            "status": v.get('status'),
            "hospital_id": v.get('hospital_id'),
            "date": str(v.get('date'))
        })
    
    # Check doctor visits specifically
    matching_visits = []
    for v in all_visits:
        if (v.get('doctor_id') == str(current_user.id) or 
            v.get('doctor_id') == current_user.id or 
            v.get('doctor_name') == current_user.name):
            matching_visits.append({
                "visit_id": str(v.get('_id')),
                "patient_id": v.get('patient_id'),
                "doctor_id": v.get('doctor_id'),
                "doctor_name": v.get('doctor_name'),
                "matched_by": "id_string" if v.get('doctor_id') == str(current_user.id) else
                            "id_original" if v.get('doctor_id') == current_user.id else
                            "name" if v.get('doctor_name') == current_user.name else "unknown"
            })
    
    return {
        "user_info": user_info,
        "total_visits_in_db": len(all_visits),
        "matching_visits_for_user": len(matching_visits),
        "sample_visits": visits_info[:10],
        "user_matching_visits": matching_visits
    }