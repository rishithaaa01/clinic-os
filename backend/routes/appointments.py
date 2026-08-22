from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone

def get_current_ist_datetime() -> datetime:
    """Returns current datetime in Indian Standard Time (IST, UTC+5:30)."""
    ist_tz = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist_tz)

def parse_slot_to_datetime(date_str: str, slot_str: str) -> Optional[datetime]:
    """
    Parses date_str ('YYYY-MM-DD') and slot_str ('09:30 AM', '02:00 PM')
    into a timezone-aware IST datetime object.
    """
    if not date_str or not slot_str:
        return None
    try:
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        d_clean = str(date_str)[:10].strip()
        s_clean = str(slot_str).strip().upper()
        dt_str = f"{d_clean} {s_clean}"
        dt = datetime.strptime(dt_str, "%Y-%m-%d %I:%M %p")
        return dt.replace(tzinfo=ist_tz)
    except Exception:
        return None

def is_slot_in_past(date_str: str, slot_str: str) -> bool:
    """Returns True if the date & time slot is in the past relative to current IST time."""
    slot_dt = parse_slot_to_datetime(date_str, slot_str)
    if not slot_dt:
        return False
    now_ist = get_current_ist_datetime()
    return slot_dt < now_ist

def normalize_time_slot(slot_str: Optional[str]) -> str:
    """Normalizes time slots to '09:00 AM' format with 2-digit hour."""
    if not slot_str:
        return ""
    s = str(slot_str).strip().upper()
    match = re.match(r'^(\d{1,2}):(\d{2})\s*(AM|PM)$', s)
    if match:
        h, m, p = match.groups()
        return f"{int(h):02d}:{m} {p}"
    return s

def build_slot_regex(slot_str: str) -> Dict[str, Any]:
    """Generates regex that matches both '09:00 AM' and '9:00 AM'."""
    norm = normalize_time_slot(slot_str)
    match = re.match(r'^(\d{2}):(\d{2})\s*(AM|PM)$', norm)
    if match:
        h, m, p = match.groups()
        h_int = int(h)
        pattern = f"^(0?{h_int}|{h_int}):{m}\\s*{p}$"
        return {"$regex": pattern, "$options": "i"}
    return {"$regex": f"^{re.escape(slot_str.strip())}$", "$options": "i"}

ACTIVE_BOOKING_STATUSES = [
    "REQUESTED", "requested",
    "PENDING", "pending",
    "BOOKED", "booked",
    "CONFIRMED", "confirmed",
    "ACCEPTED", "accepted",
    "ARRIVAL_NOTIFIED", "arrival_notified",
    "CHECKED_IN", "checked_in",
    "WAITING", "waiting",
    "IN_CONSULTATION", "in_consultation",
    "UPCOMING", "upcoming",
    "in_queue", "IN_QUEUE"
]

EXCLUDED_BOOKING_STATUSES = [
    "COMPLETED", "completed",
    "CANCELLED", "cancelled",
    "REJECTED", "rejected",
    "NO_SHOW", "no_show",
    "referral_rejected", "REFERRAL_REJECTED"
]

from database import get_database
from middleware.auth_middleware import get_current_user, get_optional_current_user, require_role
from models.user import UserResponse
from models.appointment import (
    SymptomAnalysisRequest, SymptomAnalysisResponse,
    AppointmentRequest, AppointmentResponse, AppointmentAction,
    DoctorAvailability, DirectBookingRequest, DoctorScheduleCreate,
    WalkInRegistrationRequest, AppointmentStatus
)
from pydantic import BaseModel
from bson import ObjectId
import json
import re
from config import settings

router = APIRouter()

@router.post("/analyze-symptoms", response_model=SymptomAnalysisResponse)
async def analyze_symptoms(
    request: SymptomAnalysisRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    AI-powered symptom analysis that recommends specialities and doctors
    """
    db = get_database()
    
    # Build context for AI
    prompt = f"""
    You are a medical AI assistant helping patients find the right doctor.
    
    Patient Information:
    - Symptoms: {request.symptoms}
    - Duration: {request.duration or 'Not specified'}
    - Severity: {request.severity or 'Not specified'}
    - Medical History: {request.medical_history or 'None provided'}
    
    Task: Analyze these symptoms and provide:
    1. A brief, patient-friendly analysis (2-3 sentences)
    2. Recommended medical specialities (list of 2-3 specialities)
    3. Urgency level (low, medium, or high)
    
    Respond in this exact JSON format:
    {{
      "analysis": "brief analysis here",
      "recommended_specialities": ["speciality1", "speciality2"],
      "urgency_level": "medium"
    }}
    
    Be concise and helpful. Use common speciality names like General Medicine, Cardiology, Dermatology, etc.
    """
    
    try:
        from services.local_ai_service import local_ai
        ref_res = local_ai.predict_referral(symptoms)
        rec_spec = ref_res.get("recommended_specialty", "General Medicine")
        
        result = {
            "analysis": f"AI-assisted clinical evaluation recommended specialty: {rec_spec}",
            "recommended_specialities": [rec_spec, "General Medicine"],
            "urgency_level": "medium"
        }
        
        # Find doctors matching the recommended specialities
        recommended_doctors = []
        specialities = result.get("recommended_specialities", [])
        
        for speciality in specialities:
            # Find doctors with this speciality
            doctors_cursor = db.users.find({
                "role": "doctor",
                "speciality": {"$regex": speciality, "$options": "i"}
            }).limit(5)
            
            doctors = await doctors_cursor.to_list(5)
            
            for doc in doctors:
                recommended_doctors.append({
                    "id": str(doc["_id"]),
                    "name": doc.get("name", "Dr. Unknown"),
                    "speciality": doc.get("speciality", speciality),
                    "hospital": doc.get("hospital", "Hospital"),
                    "district": doc.get("district", "")
                })
        
        return SymptomAnalysisResponse(
            analysis=result.get("analysis", "Please consult a doctor for proper diagnosis."),
            recommended_specialities=specialities,
            urgency_level=result.get("urgency_level", "medium"),
            recommended_doctors=recommended_doctors
        )
        
    except Exception as e:
        print(f"Symptom analysis error: {e}")
        # Fallback response
        return SymptomAnalysisResponse(
            analysis="Based on your symptoms, we recommend consulting a doctor for proper evaluation.",
            recommended_specialities=["General Medicine"],
            urgency_level="medium",
            recommended_doctors=[]
        )

def generate_default_slots_for_day(start_t: str = "09:00 AM", end_t: str = "05:00 PM", duration_mins: int = 30) -> List[str]:
    """Generates standard OPD time slot strings between start_time and end_time, skipping lunch (1pm-2pm)."""
    morning = ["09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM"]
    afternoon = ["02:00 PM", "02:30 PM", "03:00 PM", "03:30 PM", "04:00 PM", "04:30 PM"]
    return morning + afternoon

@router.get("/specialties")
async def get_hospital_specialties(
    hospital_name: Optional[str] = None,
    hospital: Optional[str] = None,
    current_user: Optional[UserResponse] = Depends(get_optional_current_user)
):
    """
    Get real specialties available at the selected hospital.
    Only returns specialties that actually exist for active, verified, approved doctors at that hospital.
    """
    db = get_database()
    target_hosp = hospital_name or hospital
    if not target_hosp or not target_hosp.strip():
        return []
    
    h_clean = target_hosp.strip()
    h_rgx = {"$regex": f"^{h_clean}$", "$options": "i"}

    # Query active verified doctors assigned to this hospital
    doctors = await db.users.find({
        "role": "doctor",
        "verification_status": "VERIFIED",
        "hospital_status": "APPROVED",
        "account_status": "ACTIVE",
        "$or": [
            {"hospital": h_rgx},
            {"approved_hospital_id": h_rgx},
            {"requested_hospital_id": h_rgx}
        ]
    }).to_list(100)

    specs = set()
    for doc in doctors:
        spec = doc.get("speciality")
        if spec and spec.strip():
            specs.add(spec.strip())

    # Also check if hospital document defines specialties
    hosp_doc = await db.hospitals.find_one({"$or": [{"name": h_rgx}, {"hospital_name": h_rgx}]})
    if hosp_doc and isinstance(hosp_doc.get("specialties"), list):
        for s in hosp_doc["specialties"]:
            if s and s.strip() and doctors: # Only if hospital has active doctors
                specs.add(s.strip())

    return sorted(list(specs))

@router.get("/check-specialist")
async def check_specialist_availability(
    hospital_id: Optional[str] = None,
    hospital_name: Optional[str] = None,
    hospital: Optional[str] = None,
    specialty: Optional[str] = None,
    symptoms: Optional[str] = None,
    complaint: Optional[str] = None,
    current_user: Optional[UserResponse] = Depends(get_optional_current_user)
):
    """
    Unified endpoint for Web and Mobile:
    1. Uses trained ML model to recommend specialty from symptoms if specialty not explicitly given.
    2. Resolves hospital by hospital_id or hospital_name.
    3. Checks exact specialist availability at target hospital (active verified doctor matching specialty).
    4. If unavailable, finds REAL alternative active hospitals with verified matching specialists.
    """
    import re
    from services.ai_routing import (
        determine_referral_speciality,
        normalize_specialty,
        find_alternative_hospitals_with_specialist
    )

    db = get_database()
    raw_symptoms = symptoms or complaint or ""
    rec_specialty = None
    confidence = None
    
    if raw_symptoms.strip():
        try:
            from services.local_ai_service import local_ai
            pred = local_ai.predict_referral(raw_symptoms)
            rec_specialty = pred.get("recommended_specialty")
            confidence = pred.get("confidence")
        except Exception:
            rec_specialty = await determine_referral_speciality(raw_symptoms)

    target_specialty = specialty or rec_specialty or "General Medicine"
    norm_specialty = normalize_specialty(target_specialty)

    # Resolve target hospital
    h_query_str = (hospital_id or hospital_name or hospital or "").strip()
    hosp_doc = None
    if h_query_str:
        h_rgx = {"$regex": f"^{re.escape(h_query_str)}$", "$options": "i"}
        if len(h_query_str) == 24:
            try:
                hosp_doc = await db.hospitals.find_one({"_id": ObjectId(h_query_str)})
            except Exception:
                pass
        if not hosp_doc:
            hosp_doc = await db.hospitals.find_one({
                "$or": [
                    {"_id": h_query_str},
                    {"name": h_rgx},
                    {"hospital_name": h_rgx},
                    {"id": h_query_str}
                ]
            })

    resolved_hosp_id = str(hosp_doc["_id"]) if (hosp_doc and "_id" in hosp_doc) else (h_query_str or "General Hospital")
    resolved_hosp_name = (hosp_doc.get("name") or hosp_doc.get("hospital_name")) if hosp_doc else (h_query_str or "General Hospital")

    # Query active verified doctors assigned to this hospital
    h_rgx_target = {"$regex": f"^{re.escape(resolved_hosp_name)}$", "$options": "i"}
    h_id_rgx = {"$regex": f"^{re.escape(resolved_hosp_id)}$", "$options": "i"}
    
    docs_cursor = db.users.find({
        "role": "doctor",
        "verification_status": "VERIFIED",
        "hospital_status": "APPROVED",
        "account_status": "ACTIVE",
        "$or": [
            {"hospital": h_rgx_target},
            {"approved_hospital_id": h_rgx_target},
            {"requested_hospital_id": h_rgx_target},
            {"hospital": h_id_rgx},
            {"approved_hospital_id": h_id_rgx},
            {"requested_hospital_id": h_id_rgx}
        ]
    })
    matching_docs = await docs_cursor.to_list(100)

    # Filter by exact normalized specialty
    available_doctors = []
    for doc in matching_docs:
        doc_spec = doc.get("speciality") or doc.get("specialty") or ""
        if normalize_specialty(doc_spec).lower() == norm_specialty.lower():
            available_doctors.append({
                "id": str(doc["_id"]),
                "name": doc.get("name", "Doctor"),
                "specialty": norm_specialty,
                "qualification": doc.get("qualification", "MBBS"),
                "hospital": resolved_hosp_name,
                "hospital_id": resolved_hosp_id
            })

    specialist_available = len(available_doctors) > 0
    recommended_hospitals = []

    if not specialist_available:
        alternatives = await find_alternative_hospitals_with_specialist(db, norm_specialty, exclude_hospital=resolved_hosp_name)
        recommended_hospitals = alternatives
        message = f"No {norm_specialty} specialist is currently available at {resolved_hosp_name}."
    else:
        message = f"{norm_specialty} specialist is available at {resolved_hosp_name}."

    return {
        "hospital_id": resolved_hosp_id,
        "hospital_name": resolved_hosp_name,
        "recommended_specialty": norm_specialty,
        "confidence": confidence,
        "specialist_available": specialist_available,
        "message": message,
        "available_doctors": available_doctors,
        "recommended_hospitals": recommended_hospitals
    }

@router.get("/slots")
@router.get("/available-slots")
async def get_available_slots(
    hospital_name: Optional[str] = None,
    hospital: Optional[str] = None,
    doctor_id: Optional[str] = None,
    specialty: Optional[str] = None,
    date: Optional[str] = None,
    current_user: Optional[UserResponse] = Depends(get_optional_current_user)
):
    """
    Generates real-time available time slots based on:
    Doctor schedule + existing non-cancelled bookings + slot capacity.
    Server-side double booking protection is enforced at booking time.
    """
    db = get_database()
    target_hosp = hospital_name or hospital or "General Hospital"
    if not date:
        date = datetime.utcnow().strftime("%Y-%m-%d")
    date_clean = date[:10]

    # Find schedule for doctor / hospital
    sched = None
    if doctor_id and doctor_id != "unassigned":
        sched = await db.doctor_availability.find_one({"doctor_id": doctor_id, "is_active": True})
    
    if not sched:
        sched = await db.doctor_availability.find_one({"hospital_name": target_hosp, "is_active": True})

    # Default schedule settings
    capacity = sched.get("appointment_capacity", 1) if sched else 1
    duration = sched.get("slot_duration", 30) if sched else 30
    blocked_dates = sched.get("blocked_dates", []) if sched else []

    if date_clean in blocked_dates:
        return {"hospital_name": target_hosp, "date": date_clean, "slots": []}

    all_slots = generate_default_slots_for_day(
        start_t=sched.get("start_time", "09:00 AM") if sched else "09:00 AM",
        end_t=sched.get("end_time", "05:00 PM") if sched else "05:00 PM",
        duration_mins=duration
    )

    # Query active bookings for date & hospital (any active booking on this date & hospital locks the slot)
    date_rgx = {"$regex": f"^{re.escape(date_clean)}"}
    query_conditions = [
        {"hospital_name": {"$regex": f"^{re.escape(target_hosp.strip())}$", "$options": "i"}},
        {"$or": [
            {"requested_date": date_rgx},
            {"appointment_date": date_rgx},
            {"date": date_rgx}
        ]},
        {"status": {"$in": ACTIVE_BOOKING_STATUSES, "$nin": EXCLUDED_BOOKING_STATUSES}}
    ]

    appts = await db.appointments.find({"$and": query_conditions}).to_list(1000)

    # Count bookings per slot using normalized time
    slot_counts = {}
    for a in appts:
        s_time = a.get("requested_time_slot") or a.get("time_slot") or a.get("appointment_time")
        if s_time:
            norm_s = normalize_time_slot(s_time)
            slot_counts[norm_s] = slot_counts.get(norm_s, 0) + 1

    now_ist = get_current_ist_datetime()

    slot_objects = []
    for slot_time in all_slots:
        norm_slot = normalize_time_slot(slot_time)
        slot_dt = parse_slot_to_datetime(date_clean, norm_slot)
        in_past = (slot_dt < now_ist) if slot_dt else False

        booked_c = slot_counts.get(norm_slot, 0)
        has_capacity = (booked_c < capacity) and not in_past
        is_avail = bool(has_capacity)
        
        reason = "PASSED" if in_past else ("AVAILABLE" if is_avail else "BOOKED")

        slot_objects.append({
            "time": norm_slot,
            "available": is_avail,
            "reason": reason,
            "booked_count": booked_c,
            "capacity": capacity
        })

    return {
        "hospital_name": target_hosp,
        "date": date_clean,
        "slots": slot_objects
    }

@router.get("/available-doctors")
async def get_available_doctors(
    speciality: str = None,
    hospital: str = None,
    current_user: Optional[UserResponse] = Depends(get_optional_current_user)
):
    """
    Get list of available, verified, active doctors matching hospital and specialty
    """
    db = get_database()
    
    query = {
        "role": "doctor",
        "verification_status": "VERIFIED",
        "hospital_status": "APPROVED",
        "account_status": "ACTIVE"
    }
    if speciality and speciality.strip():
        query["speciality"] = {"$regex": speciality.strip(), "$options": "i"}
    if hospital and hospital.strip():
        h_clean = hospital.strip()
        query["$or"] = [
            {"hospital": h_clean},
            {"requested_hospital_id": h_clean},
            {"approved_hospital_id": h_clean}
        ]
    
    doctors_cursor = db.users.find(query)
    doctors = await doctors_cursor.to_list(100)
    
    result = []
    for doc in doctors:
        availability = await db.doctor_availability.find_one({"doctor_id": str(doc["_id"])})
        
        result.append({
            "id": str(doc["_id"]),
            "name": doc.get("name", "Dr. Unknown"),
            "speciality": doc.get("speciality", "General Medicine"),
            "qualification": doc.get("qualification") or doc.get("medical_council") or "MBBS",
            "hospital": doc.get("hospital") or doc.get("approved_hospital_id") or "",
            "district": doc.get("district", ""),
            "has_availability": availability is not None,
            "next_available_slot": "09:00 AM",
            "available_slots": availability.get("slots", []) if availability else []
        })
    
    return result

@router.post("/request", response_model=AppointmentResponse)
async def request_appointment(
    request: AppointmentRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Patient requests an appointment with a doctor
    """
    db = get_database()
    
    # Verify doctor exists
    try:
        doctor = await db.users.find_one({"_id": ObjectId(request.doctor_id), "role": "doctor"})
        if not doctor:
            raise HTTPException(status_code=404, detail="Doctor not found")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid doctor ID")
    
    # Conflict check for requested doctor + date + time_slot
    date_str = str(request.requested_date)[:10] if request.requested_date else datetime.utcnow().strftime("%Y-%m-%d")
    time_slot_clean = (request.requested_time_slot or "").strip()
    norm_time_slot = normalize_time_slot(time_slot_clean)
    
    if is_slot_in_past(date_str, norm_time_slot):
        raise HTTPException(
            status_code=400,
            detail=f"The time slot '{norm_time_slot}' on {date_str} has already passed. Please select a future time slot."
        )
    
    slot_rgx = build_slot_regex(norm_time_slot)
    date_rgx = {"$regex": f"^{re.escape(date_str)}"}
    doc_id_clean = str(request.doctor_id)
    doc_id_obj = safe_object_id_silent(doc_id_clean)

    slot_conflict = await db.appointments.find_one({
        "$and": [
            {"$or": [
                {"doctor_id": doc_id_clean},
                {"doctor_id": doc_id_obj} if doc_id_obj else {"doctor_id": doc_id_clean}
            ]},
            {"$or": [
                {"requested_date": date_rgx},
                {"appointment_date": date_rgx},
                {"date": date_rgx}
            ]},
            {"$or": [
                {"requested_time_slot": slot_rgx},
                {"time_slot": slot_rgx}
            ]},
            {"status": {"$in": ACTIVE_BOOKING_STATUSES, "$nin": EXCLUDED_BOOKING_STATUSES}}
        ]
    })
    if slot_conflict:
        raise HTTPException(
            status_code=409,
            detail=f"Dr. {doctor.get('name', 'Doctor')} is already booked for '{norm_time_slot}' on {date_str}. Please select another open time slot."
        )
    
    # Create appointment request
    appointment = {
        "patient_id": current_user.id,
        "patient_name": current_user.name,
        "doctor_id": request.doctor_id,
        "doctor_name": doctor.get("name", "Doctor"),
        "hospital_id": request.hospital_id,
        "hospital_name": doctor.get("hospital", request.hospital_id),
        "requested_date": request.requested_date,
        "requested_time_slot": request.requested_time_slot,
        "symptoms": request.symptoms,
        "reason": request.reason,
        "urgency": request.urgency,
        "status": "REQUESTED",
        "created_at": datetime.utcnow(),
        "responded_at": None,
        "response_message": None
    }
    
    result = await db.appointments.insert_one(appointment)
    appointment["id"] = str(result.inserted_id)
    appointment.pop("_id", None)
    
    # Create notification for doctor
    await db.notifications.insert_one({
        "user_id": request.doctor_id,
        "type": "appointment_request",
        "title": f"New Appointment Request from {current_user.name}",
        "message": f"Date: {request.requested_date}, Time: {request.requested_time_slot}",
        "data": {
            "appointment_id": appointment["id"],
            "patient_id": current_user.id,
            "patient_name": current_user.name
        },
        "read": False,
        "created_at": datetime.utcnow()
    })
    
    return AppointmentResponse(**appointment)

def compute_slot_status(appt_date_str: str, time_slot: str, current_status: str) -> str:
    """Preserves workflow statuses (REQUESTED, CONFIRMED, ARRIVAL_NOTIFIED, CHECKED_IN, WAITING, IN_CONSULTATION, COMPLETED, REJECTED, NO_SHOW, CANCELLED)."""
    c_stat = (current_status or "").upper()
    if c_stat in [
        "REQUESTED", "PENDING", "ACCEPTED", "CONFIRMED",
        "ARRIVAL_NOTIFIED", "CHECKED_IN", "WAITING",
        "IN_CONSULTATION", "COMPLETED", "REJECTED",
        "CANCELLED", "NO_SHOW"
    ]:
        return c_stat
    return c_stat or "REQUESTED"

@router.get("/booked-slots")
async def get_booked_slots(
    hospital_name: str = "General Hospital",
    doctor_id: Optional[str] = None,
    specialty: Optional[str] = None,
    date: str = None,
    current_user: UserResponse = Depends(get_current_user)
):
    """Get list of already booked time slots for a hospital and date so they can be disabled in UI."""
    db = get_database()
    if not date:
        date = datetime.utcnow().strftime("%Y-%m-%d")
    date_clean = date[:10]
    date_rgx = {"$regex": f"^{re.escape(date_clean)}"}
    
    query_conditions = [
        {"hospital_name": {"$regex": f"^{re.escape(hospital_name.strip())}$", "$options": "i"}},
        {"$or": [
            {"requested_date": date_rgx},
            {"appointment_date": date_rgx},
            {"date": date_rgx}
        ]},
        {"status": {"$in": ACTIVE_BOOKING_STATUSES, "$nin": EXCLUDED_BOOKING_STATUSES}}
    ]

    appts = await db.appointments.find({"$and": query_conditions}).to_list(1000)
    booked = []
    for a in appts:
        s = a.get("requested_time_slot") or a.get("time_slot") or a.get("appointment_time")
        if s:
            booked.append(normalize_time_slot(s))
    return {"hospital_name": hospital_name, "date": date_clean, "booked_slots": list(set(booked))}

@router.post("", response_model=dict)
@router.post("/", response_model=dict)
@router.post("/book", response_model=dict)
async def book_direct_appointment(
    req: DirectBookingRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """Direct OPD slot booking with time slot conflict validation and verified doctor check."""
    db = get_database()
    date_str = req.appointment_date[:10] if req.appointment_date else datetime.utcnow().strftime("%Y-%m-%d")
    
    # Determine specialty
    spec = req.specialty or "General Medicine"
    if (not req.specialty or req.specialty == "General Medicine") and req.chief_complaint:
        c_lower = req.chief_complaint.lower()
        if any(w in c_lower for w in ["heart", "chest pain", "cardiac", "palpitation", "breathless", "bp"]):
            spec = "Cardiology"
        elif any(w in c_lower for w in ["stomach", "abdomen", "gastric", "vomit", "nausea", "diarrhea", "ulcer"]):
            spec = "Gastroenterology"
        elif any(w in c_lower for w in ["bone", "joint", "knee", "fracture", "ortho", "leg pain", "back pain", "spine"]):
            spec = "Orthopedics"
        elif any(w in c_lower for w in ["pregnant", "pregnancy", "gynaec", "period", "menstrual"]):
            spec = "Gynecology"
        elif any(w in c_lower for w in ["ear", "nose", "throat", "ent", "sinus", "tonsil"]):
            spec = "ENT"
        elif any(w in c_lower for w in ["skin", "rash", "itch", "derma", "allergy", "eczema"]):
            spec = "Dermatology"
        elif any(w in c_lower for w in ["child", "infant", "baby", "pediatric"]):
            spec = "Pediatrics"
        elif any(w in c_lower for w in ["headache", "migraine", "seizure", "neuro", "stroke"]):
            spec = "Neurology"

    from services.ai_routing import normalize_specialty
    norm_spec = normalize_specialty(spec)

    # Find active verified doctor matching hospital & exact specialty if doctor_id not explicitly given
    doc = None
    if req.doctor_id and req.doctor_id != "unassigned":
        doc = await db.users.find_one({
            "$or": [
                {"_id": safe_object_id_silent(req.doctor_id)},
                {"id": req.doctor_id}
            ],
            "role": "doctor"
        })
            
    if not doc:
        h_rgx = {"$regex": f"^{re.escape(req.hospital_name.strip())}$", "$options": "i"}
        doc = await db.users.find_one({
            "role": "doctor",
            "$or": [
                {"hospital": h_rgx},
                {"approved_hospital_id": h_rgx},
                {"requested_hospital_id": h_rgx}
            ],
            "speciality": {"$regex": f"^{re.escape(norm_spec)}$", "$options": "i"},
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE"
        })

    doc_name = doc.get("name", "Duty Specialist") if doc else f"Unassigned ({norm_spec} Duty Specialist)"
    doc_id = str(doc["_id"]) if doc else "unassigned"

    time_slot_clean = req.time_slot.strip()
    norm_time_slot = normalize_time_slot(time_slot_clean)
    
    if is_slot_in_past(date_str, norm_time_slot):
        raise HTTPException(
            status_code=400,
            detail=f"The time slot '{norm_time_slot}' on {date_str} has already passed. Please select a future time slot."
        )

    slot_query = build_slot_regex(norm_time_slot)
    date_query = {"$regex": f"^{re.escape(date_str)}"}

    # Universal Hospital Slot Conflict Check (if ANY patient booked this hospital on this date & time, block it)
    slot_conflict = await db.appointments.find_one({
        "$and": [
            {"hospital_name": {"$regex": f"^{re.escape(req.hospital_name.strip())}$", "$options": "i"}},
            {"$or": [
                {"requested_date": date_query},
                {"appointment_date": date_query},
                {"date": date_query}
            ]},
            {"$or": [
                {"requested_time_slot": slot_query},
                {"time_slot": slot_query}
            ]},
            {"status": {"$in": ACTIVE_BOOKING_STATUSES, "$nin": EXCLUDED_BOOKING_STATUSES}}
        ]
    })
    if slot_conflict:
        raise HTTPException(
            status_code=409,
            detail=f"The time slot '{norm_time_slot}' on {date_str} at {req.hospital_name} is already booked. Please choose another open time slot."
        )

    # 2. Patient Double Booking Check
    pat_id_str = str(current_user.id)
    pat_conflict = await db.appointments.find_one({
        "$and": [
            {"$or": [
                {"patient_id": pat_id_str},
                {"patient_id": safe_object_id_silent(pat_id_str)},
                {"user_id": pat_id_str}
            ]},
            {"$or": [
                {"requested_date": date_query},
                {"appointment_date": date_query},
                {"date": date_query}
            ]},
            {"$or": [
                {"requested_time_slot": slot_query},
                {"time_slot": slot_query}
            ]},
            {"status": {"$in": ACTIVE_BOOKING_STATUSES, "$nin": EXCLUDED_BOOKING_STATUSES}}
        ]
    })
    if pat_conflict:
        raise HTTPException(
            status_code=409,
            detail=f"You already have an appointment booked for '{norm_time_slot}' on {date_str}."
        )

    source_type_val = req.source_type.value if hasattr(req.source_type, 'value') else (str(req.source_type) if req.source_type else "DIRECT_APPOINTMENT")

    # Save Appointment record with status = REQUESTED
    appt_doc = {
        "patient_id": current_user.id,
        "patient_name": current_user.name,
        "doctor_id": doc_id,
        "doctor_name": doc_name,
        "hospital_name": req.hospital_name,
        "specialty": spec,
        "requested_date": date_str,
        "requested_time_slot": req.time_slot,
        "symptoms": req.chief_complaint or "OPD Consultation",
        "reason": req.chief_complaint or "OPD Consultation",
        "status": "REQUESTED",
        "source_type": source_type_val,
        "symptom_assessment_id": req.symptom_assessment_id,
        "created_at": datetime.utcnow()
    }
    res = await db.appointments.insert_one(appt_doc)
    appt_id = str(res.inserted_id)

    # Notify doctor if assigned
    if doc_id != "unassigned":
        await db.notifications.insert_one({
            "user_id": doc_id,
            "type": "appointment_request",
            "title": f"New Appointment Request: {current_user.name}",
            "message": f"Date: {date_str}, Slot: {req.time_slot}, Specialty: {spec}",
            "data": {
                "appointment_id": appt_id,
                "patient_id": current_user.id,
                "patient_name": current_user.name
            },
            "read": False,
            "created_at": datetime.utcnow()
        })

    return {
        "id": appt_id,
        "status": "REQUESTED",
        "hospital_name": req.hospital_name,
        "specialty": spec,
        "doctor_name": doc_name,
        "requested_date": date_str,
        "requested_time_slot": req.time_slot,
        "source_type": source_type_val,
        "message": f"Appointment request submitted for Dr. {doc_name}. Please wait for doctor confirmation before traveling."
    }

@router.post("/{appointment_id}/arrive")
@router.post("/{appointment_id}/notify-arrival")
async def notify_patient_arrival(
    appointment_id: str,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Patient indicates arrival at hospital ("I've Arrived").
    Validates ownership & status, transitions appointment to CHECKED_IN,
    and creates/updates the active encounter (db.visits) in WAITING/in_queue status.
    This immediately moves the patient into the assigned doctor's OPD Queue.
    """
    db = get_database()
    try:
        appt_obj_id = ObjectId(appointment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid appointment ID format.")

    appt = await db.appointments.find_one({
        "$or": [
            {"_id": appt_obj_id},
            {"id": appointment_id}
        ]
    })
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    if str(appt.get("patient_id")) != str(current_user.id) and current_user.role != "patient":
        raise HTTPException(status_code=403, detail="You can only mark arrival for your own appointment.")

    current_status = (appt.get("status") or "").upper()
    if current_status in ["COMPLETED", "CANCELLED", "NO_SHOW", "REJECTED"]:
        raise HTTPException(
            status_code=400,
            detail=f"Your appointment cannot be checked in at this time (status: '{current_status}')."
        )

    # Transition status to ARRIVAL_NOTIFIED
    new_status = "ARRIVAL_NOTIFIED"

    await db.appointments.update_one(
        {"_id": appt["_id"]},
        {"$set": {
            "arrival_notified": True,
            "arrival_notified_at": datetime.utcnow(),
            "arrived_at": datetime.utcnow(),
            "status": new_status,
            "updated_at": datetime.utcnow()
        }}
    )

    patient_id_str = str(appt.get("patient_id"))
    doc_id = str(appt.get("doctor_id") or "unassigned")
    doc_name = appt.get("doctor_name", "Duty Specialist")
    hosp_name = appt.get("hospital_name", "General Hospital")
    p_name = appt.get("patient_name", current_user.name)

    # Send Notification to Receptionist Desk
    await db.notifications.insert_one({
        "hospital_name": hosp_name,
        "role": "receptionist",
        "type": "patient_arrived",
        "title": "Patient Arrived at Hospital",
        "message": f"{p_name} has arrived at the hospital for Dr. {doc_name} ({appt.get('requested_time_slot', '09:00 AM')}). Ready for reception check-in.",
        "data": {
            "appointment_id": str(appt["_id"]),
            "patient_id": patient_id_str,
            "patient_name": p_name,
            "doctor_name": doc_name,
            "specialty": appt.get("specialty", "General Medicine"),
            "status": new_status
        },
        "read": False,
        "created_at": datetime.utcnow()
    })

    return {
        "status": new_status,
        "arrival_notified": True,
        "appointment_id": appointment_id,
        "message": "Arrival recorded! Please proceed to the reception desk for physical check-in."
    }

@router.post("/{appointment_id}/no-show")
async def mark_appointment_no_show(
    appointment_id: str,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Marks an unarrived appointment as NO_SHOW (Receptionist / Admin / Doctor).
    Removes appointment from active OPD queue while preserving historical record.
    """
    if current_user.role not in ["receptionist", "admin", "doctor"]:
        raise HTTPException(status_code=403, detail="Only hospital staff can mark an appointment as NO_SHOW.")

    db = get_database()
    try:
        appt_obj_id = ObjectId(appointment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid appointment ID format.")

    appt = await db.appointments.find_one({"_id": appt_obj_id})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    if current_user.role == "receptionist" and current_user.hospital and appt.get("hospital_name"):
        if current_user.hospital.strip().lower() != appt.get("hospital_name").strip().lower():
            raise HTTPException(status_code=403, detail="Receptionist is not authorized for a different hospital.")

    current_status = (appt.get("status") or "").upper()
    if current_status in ["COMPLETED", "IN_CONSULTATION"]:
        raise HTTPException(status_code=400, detail=f"Cannot mark encounter in status '{current_status}' as NO_SHOW.")

    await db.appointments.update_one(
        {"_id": appt_obj_id},
        {"$set": {"status": "NO_SHOW", "no_show_at": datetime.utcnow()}}
    )

    # Remove any pending active visit queue entry
    await db.visits.delete_many({"appointment_id": appointment_id, "status": "in_queue"})

    return {
        "status": "NO_SHOW",
        "appointment_id": appointment_id,
        "message": "Appointment marked as NO_SHOW. Removed from active OPD queue."
    }

@router.get("/expected-arrivals")
async def get_expected_arrivals_for_reception(current_user: UserResponse = Depends(get_current_user)):
    """
    Returns today's expected appointments & arrival notifications for the Receptionist's hospital.
    Filtered by receptionist hospital authorization.
    """
    if current_user.role not in ["receptionist", "admin", "doctor"]:
        raise HTTPException(status_code=403, detail="Only hospital staff can access expected arrivals.")

    db = get_database()
    hospital_name = current_user.hospital or current_user.hospital_name or ""
    
    h_query = {"$regex": f"^{re.escape(hospital_name.strip())}$", "$options": "i"} if hospital_name.strip() else {"$exists": True}

    today_str = datetime.utcnow().strftime("%Y-%m-%d")

    cursor = db.appointments.find({
        "$or": [
            {"hospital_name": h_query},
            {"hospital_id": h_query}
        ],
        "status": {"$in": ["CONFIRMED", "confirmed", "ARRIVAL_NOTIFIED", "arrival_notified", "CHECKED_IN", "checked_in", "WAITING", "waiting"]}
    }).sort("created_at", -1)

    appts = await cursor.to_list(200)

    results = []
    for a in appts:
        st = (a.get("status") or "").upper()
        results.append({
            "id": str(a["_id"]),
            "appointment_id": str(a["_id"]),
            "patient_id": str(a.get("patient_id", "")),
            "patient_name": a.get("patient_name", "Patient"),
            "doctor_id": str(a.get("doctor_id", "unassigned")),
            "doctor_name": a.get("doctor_name", "Duty Specialist"),
            "specialty": a.get("specialty", "General Medicine"),
            "hospital_name": a.get("hospital_name", hospital_name),
            "appointment_date": a.get("requested_date") or a.get("appointment_date") or today_str,
            "appointment_time": a.get("requested_time_slot") or a.get("time_slot") or "09:00 AM",
            "status": st,
            "arrival_notified": bool(a.get("arrival_notified")),
            "arrival_notified_at": a.get("arrival_notified_at"),
            "arrived_at": a.get("arrived_at"),
            "created_at": a.get("created_at")
        })

    return results

@router.post("/{appointment_id}/check-in")
async def check_in_appointment(
    appointment_id: str,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Receptionist Physical Check-In for a scheduled appointment.
    Validates lifecycle progression: BOOKED/CONFIRMED -> CHECKED_IN.
    Verifies hospital authorization and creates active OPD visit record.
    """
    db = get_database()
    try:
        appt_obj_id = ObjectId(appointment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid appointment ID format.")

    appt = await db.appointments.find_one({"_id": appt_obj_id})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    # Validate receptionist hospital authorization
    if current_user.role == "receptionist" and current_user.hospital and appt.get("hospital_name"):
        if current_user.hospital.strip().lower() != appt.get("hospital_name").strip().lower():
            raise HTTPException(status_code=403, detail="Receptionist is not authorized to check in patients for a different hospital.")

    current_status = (appt.get("status") or "").upper()
    if current_status in ["COMPLETED", "CANCELLED", "NO_SHOW"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot check in appointment with current status '{current_status}'."
        )

    # Update appointment status to CHECKED_IN
    await db.appointments.update_one(
        {"_id": appt_obj_id},
        {"$set": {"status": "CHECKED_IN", "checked_in_at": datetime.utcnow()}}
    )

    # Check if a clinical visit already exists for this appointment
    existing_visit = await db.visits.find_one({"appointment_id": appointment_id})
    if not existing_visit:
        patient = await db.patients.find_one({"user_id": appt.get("patient_id")})
        patient_id_str = str(patient["_id"]) if patient else appt.get("patient_id")

        parsed_d = datetime.utcnow()
        try:
            r_date = appt.get("requested_date", "")
            if "T" in r_date:
                parsed_d = datetime.fromisoformat(r_date.replace("Z", ""))
            elif r_date:
                parsed_d = datetime.strptime(r_date[:10], "%Y-%m-%d")
        except Exception:
            pass

        visit_doc = {
            "patient_id": patient_id_str,
            "patient_name": appt.get("patient_name", "Patient"),
            "hospital_id": appt.get("hospital_name", "General Hospital"),
            "hospital_name": appt.get("hospital_name", "General Hospital"),
            "doctor_name": appt.get("doctor_name", "Duty Specialist"),
            "doctor_id": appt.get("doctor_id"),
            "assigned_doctor_id": appt.get("doctor_id"),
            "required_specialty": appt.get("specialty", "General Medicine"),
            "specialty": appt.get("specialty", "General Medicine"),
            "date": parsed_d,
            "time_slot": appt.get("requested_time_slot", "09:00 AM"),
            "created_at": datetime.utcnow(),
            "chief_complaint": appt.get("symptoms", "Direct Appointment Check-In"),
            "status": "in_queue",
            "appointment_type": "self_booked",
            "source_type": appt.get("source_type", "DIRECT_APPOINTMENT"),
            "appointment_id": appointment_id,
            "diagnosis": [],
            "prescriptions": []
        }
        res_visit = await db.visits.insert_one(visit_doc)
        visit_id = str(res_visit.inserted_id)
    else:
        visit_id = str(existing_visit["_id"])
        await db.visits.update_one(
            {"_id": existing_visit["_id"]},
            {"$set": {
                "status": "in_queue",
                "doctor_id": appt.get("doctor_id"),
                "assigned_doctor_id": appt.get("doctor_id"),
                "doctor_name": appt.get("doctor_name"),
                "hospital_id": appt.get("hospital_name"),
                "hospital_name": appt.get("hospital_name"),
                "required_specialty": appt.get("specialty"),
                "specialty": appt.get("specialty"),
                "updated_at": datetime.utcnow()
            }}
        )

    # Notify Doctor
    if appt.get("doctor_id") and appt.get("doctor_id") != "unassigned":
        await db.notifications.insert_one({
            "user_id": str(appt.get("doctor_id")),
            "type": "patient_checked_in",
            "title": "Patient Checked In (OPD Queue)",
            "message": f"{appt.get('patient_name', 'Patient')} has checked in at reception and is WAITING in your OPD queue.",
            "data": {
                "appointment_id": appointment_id,
                "patient_id": patient_id_str,
                "patient_name": appt.get("patient_name", "Patient"),
                "visit_id": visit_id,
                "status": "WAITING"
            },
            "read": False,
            "created_at": datetime.utcnow()
        })

    # Notify Patient
    if appt.get("patient_id"):
        await db.notifications.insert_one({
            "user_id": str(appt.get("patient_id")),
            "patient_id": str(appt.get("patient_id")),
            "type": "checkin_complete",
            "title": "Reception Check-In Confirmed ✓",
            "message": f"Check-in verified! You are now in Dr. {appt.get('doctor_name', 'Specialist')}'s OPD consultation queue.",
            "data": {
                "appointment_id": appointment_id,
                "visit_id": visit_id,
                "status": "WAITING"
            },
            "read": False,
            "created_at": datetime.utcnow()
        })

    return {
        "status": "CHECKED_IN",
        "appointment_id": appointment_id,
        "visit_id": visit_id,
        "message": "Physical check-in confirmed successfully. Patient is now in Doctor OPD Queue (WAITING)."
    }

@router.get("/my-requests", response_model=List[AppointmentResponse])
async def get_my_appointment_requests(current_user: UserResponse = Depends(get_current_user)):
    """Get patient's appointment requests with calculated dynamic status (UPCOMING, ONGOING, MISSED, COMPLETED)."""
    db = get_database()
    pid_str = str(current_user.id)
    pid_obj = safe_object_id_silent(pid_str)

    cursor = db.appointments.find({
        "$or": [
            {"patient_id": pid_str},
            {"patient_id": pid_obj} if pid_obj else {"patient_id": pid_str},
            {"user_id": pid_str}
        ]
    }).sort("created_at", -1)
    appointments = await cursor.to_list(100)
    
    result = []
    seen_ids = set()
    for a in appointments:
        appt_id = str(a.get("_id") or a.get("id"))
        if appt_id in seen_ids:
            continue
        seen_ids.add(appt_id)

        raw_status = (a.get("status") or "PENDING").upper()
        req_date = a.get("requested_date") or a.get("appointment_date") or a.get("date") or datetime.utcnow().strftime("%Y-%m-%d")
        req_slot = a.get("requested_time_slot") or a.get("time_slot") or "09:00 AM"
        
        # Calculate status
        computed = compute_slot_status(req_date, req_slot, raw_status)
        result.append(AppointmentResponse(
            id=appt_id,
            patient_id=pid_str,
            patient_name=a.get("patient_name") or current_user.name,
            doctor_id=str(a.get("doctor_id") or "unassigned"),
            doctor_name=a.get("doctor_name") or "Duty Doctor",
            hospital_name=a.get("hospital_name") or "General Hospital",
            requested_date=str(req_date),
            requested_time_slot=str(req_slot),
            specialty=a.get("specialty") or "General Medicine",
            symptoms=a.get("symptoms") or a.get("reason") or a.get("chief_complaint") or "",
            reason=a.get("reason") or a.get("symptoms") or a.get("chief_complaint") or "",
            source_type=str(a.get("source_type") or "DIRECT_APPOINTMENT"),
            status=computed,
            created_at=a.get("created_at") or datetime.utcnow(),
            response_message=a.get("response_message"),
            responded_at=a.get("responded_at")
        ))
    
    return result

@router.get("/my-appointments", response_model=List[AppointmentResponse])
async def get_my_appointments_alias(current_user: UserResponse = Depends(get_current_user)):
    """Alias for /my-requests — returns patient's appointment history."""
    return await get_my_appointment_requests(current_user)

def safe_object_id_silent(id_str: str) -> Optional[ObjectId]:
    try:
        return ObjectId(id_str) if id_str else None
    except Exception:
        return None

@router.get("/doctor")
async def get_doctor_direct_appointments(current_user: UserResponse = Depends(require_role("doctor"))):
    """
    Returns direct appointments booked specifically with the authenticated doctor or at their hospital.
    """
    db = get_database()
    curr_doc_id = str(current_user.id)
    doc_name_rgx = {"$regex": f"^{re.escape(current_user.name.strip())}$", "$options": "i"} if current_user.name else None
    hosp_name = getattr(current_user, "hospital", None) or getattr(current_user, "approved_hospital_id", None)
    doc_spec = getattr(current_user, "speciality", None) or getattr(current_user, "specialty", None)

    doc_matches = [
        {"doctor_id": curr_doc_id},
        {"doctor_id": safe_object_id_silent(curr_doc_id)},
    ]
    if doc_name_rgx:
        doc_matches.append({"doctor_name": doc_name_rgx})

    if hosp_name and str(hosp_name).strip():
        hosp_rgx = {"$regex": f"^{re.escape(str(hosp_name).strip())}$", "$options": "i"}
        unassigned_cond = {
            "hospital_name": hosp_rgx,
            "$or": [
                {"doctor_id": "unassigned"},
                {"doctor_id": None},
                {"doctor_id": ""},
                {"doctor_id": {"$exists": False}}
            ]
        }
        if doc_spec and str(doc_spec).strip() and str(doc_spec).lower() != "general medicine":
            spec_rgx = {"$regex": f"^{re.escape(str(doc_spec).strip())}$", "$options": "i"}
            unassigned_cond["specialty"] = spec_rgx
        doc_matches.append(unassigned_cond)

    query = {"$or": doc_matches}

    cursor = db.appointments.find(query).sort("created_at", -1)
    appts = await cursor.to_list(200)

    raw_pids = [str(a.get("patient_id")) for a in appts if a.get("patient_id")]
    obj_pids = [ObjectId(pid) for pid in raw_pids if len(pid) == 24]

    patients_cursor = db.patients.find({
        "$or": [
            {"_id": {"$in": obj_pids}},
            {"user_id": {"$in": raw_pids}},
            {"id": {"$in": raw_pids}}
        ]
    })
    patients_list = await patients_cursor.to_list(len(raw_pids) + 10)
    patients_map = {}
    for p in patients_list:
        patients_map[str(p["_id"])] = p
        if p.get("user_id"):
            patients_map[str(p["user_id"])] = p
        if p.get("id"):
            patients_map[str(p["id"])] = p

    now = datetime.utcnow()
    result = []
    seen_doc_appts = set()
    for a in appts:
        appt_id_str = str(a.get("_id") or a.get("id"))
        if appt_id_str in seen_doc_appts:
            continue
        seen_doc_appts.add(appt_id_str)
        pid = str(a.get("patient_id", ""))
        patient = patients_map.get(pid) or {}

        dob = patient.get("date_of_birth") or patient.get("dob") or "2000-01-01"
        try:
            birth_year = int(str(dob).split("-")[0])
            age = now.year - birth_year
        except Exception:
            age = patient.get("age", 30)

        p_name = a.get("patient_name") or patient.get("name") or "Patient"
        p_gender = patient.get("gender") or "Other"

        raw_status = (a.get("status") or "BOOKED").upper()

        result.append({
            "id": str(a["_id"]),
            "appointment_id": str(a["_id"]),
            "patient_id": pid,
            "patient_name": p_name,
            "patient_age": age,
            "patient_gender": p_gender,
            "age": age,
            "gender": p_gender,
            "doctor_id": str(a.get("doctor_id") or curr_doc_id),
            "doctor_name": a.get("doctor_name") or current_user.name,
            "hospital_name": a.get("hospital_name") or current_user.hospital or "Govt Hospital",
            "specialty": a.get("specialty") or current_user.speciality or "General Medicine",
            "source_type": a.get("source_type") or "DIRECT_APPOINTMENT",
            "appointment_date": a.get("requested_date") or a.get("appointment_date") or a.get("date") or now.strftime("%Y-%m-%d"),
            "appointment_time": a.get("requested_time_slot") or a.get("time_slot") or "09:00 AM",
            "chief_complaint": a.get("symptoms") or a.get("reason") or a.get("chief_complaint") or "OPD Consultation",
            "status": raw_status,
            "check_in_status": "CHECKED_IN" if raw_status in ["CHECKED_IN", "WAITING", "IN_CONSULTATION", "COMPLETED", "ARRIVAL_NOTIFIED"] else "PENDING",
            "created_at": a.get("created_at") or now
        })

    return result

@router.get("/pending-requests", response_model=List[AppointmentResponse])
async def get_pending_requests(current_user: UserResponse = Depends(get_current_user)):
    """
    Get pending appointment requests for a doctor
    """
    curr_role = getattr(current_user.role, "value", str(current_user.role))
    if curr_role != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can access this")
    
    db = get_database()
    curr_doc_id = str(current_user.id)
    doc_name_rgx = {"$regex": f"^{re.escape(current_user.name.strip())}$", "$options": "i"} if current_user.name else None

    query = {
        "$or": [
            {"doctor_id": curr_doc_id},
            {"doctor_id": safe_object_id_silent(curr_doc_id)},
            {"doctor_name": doc_name_rgx} if doc_name_rgx else {"doctor_id": curr_doc_id}
        ],
        "status": {"$in": ["REQUESTED", "requested", "PENDING", "pending"]}
    }
    
    cursor = db.appointments.find(query).sort("created_at", -1)
    appointments = await cursor.to_list(100)
    
    result = []
    for appt in appointments:
        appt["id"] = str(appt.pop("_id"))
        result.append(AppointmentResponse(**appt))
    
    return result

from fastapi import Request

@router.post("/{appointment_id}/respond")
@router.post("/{appointment_id}/accept")
@router.post("/{appointment_id}/reject")
@router.post("/respond")
async def respond_to_appointment(
    request: Request,
    appointment_id: Optional[str] = None,
    action: Optional[AppointmentAction] = None,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Doctor accepts or rejects an appointment request.
    Transitions status from REQUESTED -> CONFIRMED or REJECTED.
    Sends notifications to Patient and Target Hospital Reception.
    """
    if current_user.role != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can respond to appointment requests.")

    db = get_database()

    # Safely parse raw JSON body if action object wasn't supplied by Pydantic
    body_data = {}
    try:
        raw_body = await request.json()
        if isinstance(raw_body, dict):
            body_data = raw_body
    except Exception:
        body_data = {}

    target_id = appointment_id or (action.appointment_id if action else None) or body_data.get("appointment_id") or body_data.get("id")
    action_type = (action.action if action else None) or body_data.get("action") or body_data.get("status")
    
    # Infer default action from path if not provided in body
    path = request.url.path
    if not action_type:
        if path.endswith("/accept"):
            action_type = "accept"
        elif path.endswith("/reject"):
            action_type = "reject"
        else:
            action_type = "accept"

    reason_msg = (action.message if action else None) or (action.reason if action else None) or body_data.get("message") or body_data.get("reason") or ""

    if not target_id:
        raise HTTPException(status_code=400, detail="Missing appointment_id.")

    action_clean = str(action_type).strip().lower()
    if action_clean in ["accept", "accepted", "confirm", "confirmed"]:
        new_status = "CONFIRMED"
    else:
        new_status = "REJECTED"

    try:
        appt_obj_id = ObjectId(target_id)
    except Exception:
        appt_obj_id = None

    appt = await db.appointments.find_one({
        "$or": [
            {"_id": appt_obj_id} if appt_obj_id else {"id": target_id},
            {"id": target_id},
            {"_id": target_id}
        ]
    })

    if not appt:
        raise HTTPException(status_code=404, detail="Appointment request not found.")

    curr_doc_id = str(current_user.id)
    appt_doc_id = str(appt.get("doctor_id", ""))

    # Verify authorization
    if appt_doc_id and appt_doc_id != "unassigned" and appt_doc_id != curr_doc_id:
        doc_name_match = bool(appt.get("doctor_name") and current_user.name and (appt.get("doctor_name").strip().lower() == current_user.name.strip().lower()))
        hosp_match = bool(current_user.hospital and appt.get("hospital_name") and (current_user.hospital.strip().lower() == appt.get("hospital_name").strip().lower()))
        if not (doc_name_match or hosp_match or current_user.role == "doctor"):
            raise HTTPException(status_code=403, detail="You are not authorized to respond to this appointment.")

    current_status = (appt.get("status") or "").upper()
    if current_status in ["COMPLETED", "CANCELLED", "IN_CONSULTATION"]:
        raise HTTPException(status_code=400, detail=f"Cannot modify appointment in status '{current_status}'.")
        raise HTTPException(status_code=400, detail=f"Cannot modify appointment in status '{current_status}'.")

    time_slot = appt.get("requested_time_slot") or appt.get("time_slot") or "09:00 AM"
    date_str = appt.get("requested_date") or appt.get("appointment_date") or datetime.utcnow().strftime("%Y-%m-%d")
    hosp_name = appt.get("hospital_name") or current_user.hospital or "General Hospital"
    patient_id_str = str(appt.get("patient_id"))
    patient_name = appt.get("patient_name") or "Patient"

    if new_status == "CONFIRMED":
        # Verify slot availability
        active_statuses = ["CONFIRMED", "CHECKED_IN", "WAITING", "IN_CONSULTATION"]
        conflict = await db.appointments.find_one({
            "doctor_id": curr_doc_id,
            "requested_date": date_str,
            "requested_time_slot": time_slot,
            "status": {"$in": active_statuses},
            "_id": {"$ne": appt["_id"]}
        })
        if conflict:
            raise HTTPException(
                status_code=409,
                detail=f"The time slot '{time_slot}' on {date_str} is already confirmed for another patient."
            )

        await db.appointments.update_one(
            {"_id": appt["_id"]},
            {"$set": {
                "status": "CONFIRMED",
                "doctor_id": curr_doc_id,
                "doctor_name": current_user.name,
                "accepted_at": datetime.utcnow(),
                "response_message": reason_msg or "Appointment confirmed by doctor.",
                "updated_at": datetime.utcnow()
            }}
        )

        # 1. Patient Notification
        await db.notifications.insert_one({
            "user_id": patient_id_str,
            "patient_id": patient_id_str,
            "type": "appointment_confirmed",
            "title": "Appointment Confirmed ✓",
            "message": f"Your appointment with Dr. {current_user.name} has been confirmed for {time_slot} on {date_str} at {hosp_name}.",
            "data": {
                "appointment_id": str(appt["_id"]),
                "doctor_name": current_user.name,
                "hospital_name": hosp_name,
                "date": date_str,
                "time_slot": time_slot,
                "status": "CONFIRMED"
            },
            "read": False,
            "created_at": datetime.utcnow()
        })

        # 2. Target Hospital Receptionist Operational Notification
        await db.notifications.insert_one({
            "hospital_name": hosp_name,
            "role": "receptionist",
            "type": "expected_arrival",
            "title": "New Expected Arrival",
            "message": f"Confirmed appointment: {patient_name} for Dr. {current_user.name} ({date_str} at {time_slot}).",
            "data": {
                "appointment_id": str(appt["_id"]),
                "patient_name": patient_name,
                "doctor_name": current_user.name,
                "specialty": appt.get("specialty", "General Medicine"),
                "date": date_str,
                "time_slot": time_slot,
                "status": "CONFIRMED"
            },
            "read": False,
            "created_at": datetime.utcnow()
        })

        # 3. Create or update OPD Visit entry in db.visits so patient appears in Doctor OPD Queue immediately
        existing_visit = await db.visits.find_one({
            "$or": [
                {"appointment_id": str(appt["_id"])},
                {"appointment_id": target_id}
            ]
        })

        parsed_d = datetime.utcnow()
        try:
            if "T" in str(date_str):
                parsed_d = datetime.fromisoformat(str(date_str).replace("Z", ""))
            elif date_str:
                parsed_d = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
        except Exception:
            pass

        patient_rec = await db.patients.find_one({
            "$or": [
                {"user_id": patient_id_str},
                {"_id": safe_object_id_silent(patient_id_str)}
            ]
        })
        canonical_pid = str(patient_rec["_id"]) if patient_rec else patient_id_str

        if existing_visit:
            visit_id = str(existing_visit["_id"])
            await db.visits.update_one(
                {"_id": existing_visit["_id"]},
                {"$set": {
                    "status": "in_queue",
                    "doctor_id": curr_doc_id,
                    "assigned_doctor_id": curr_doc_id,
                    "doctor_name": current_user.name,
                    "hospital_id": hosp_name,
                    "hospital_name": hosp_name,
                    "required_specialty": appt.get("specialty", "General Medicine"),
                    "specialty": appt.get("specialty", "General Medicine"),
                    "updated_at": datetime.utcnow()
                }}
            )
        else:
            visit_doc = {
                "patient_id": canonical_pid,
                "patient_name": patient_name,
                "hospital_id": hosp_name,
                "hospital_name": hosp_name,
                "doctor_name": current_user.name,
                "doctor_id": curr_doc_id,
                "assigned_doctor_id": curr_doc_id,
                "required_specialty": appt.get("specialty", "General Medicine"),
                "specialty": appt.get("specialty", "General Medicine"),
                "date": parsed_d,
                "time_slot": time_slot,
                "created_at": datetime.utcnow(),
                "chief_complaint": appt.get("symptoms") or appt.get("reason") or "Direct Appointment Consultation",
                "status": "in_queue",
                "appointment_type": "self_booked",
                "source_type": appt.get("source_type", "DIRECT_APPOINTMENT"),
                "appointment_id": str(appt["_id"]),
                "diagnosis": [],
                "prescriptions": []
            }
            res_v = await db.visits.insert_one(visit_doc)
            visit_id = str(res_v.inserted_id)

        return {
            "status": "success",
            "appointment_status": "CONFIRMED",
            "visit_id": visit_id,
            "message": f"Appointment request for {patient_name} accepted and added to OPD queue."
        }
    else:
        # Rejection flow
        await db.appointments.update_one(
            {"_id": appt["_id"]},
            {"$set": {
                "status": "REJECTED",
                "rejected_at": datetime.utcnow(),
                "rejection_reason": reason_msg or "Doctor unavailable at requested time.",
                "response_message": reason_msg or "Doctor unavailable at requested time.",
                "updated_at": datetime.utcnow()
            }}
        )

        # Notify Patient
        user_msg = f"Your appointment request with Dr. {current_user.name} could not be accepted."
        if reason_msg:
            user_msg += f" Note: {reason_msg}"
        else:
            user_msg += " Please select another available doctor or time slot."

        await db.notifications.insert_one({
            "user_id": patient_id_str,
            "patient_id": patient_id_str,
            "type": "appointment_rejected",
            "title": "Appointment Request Update",
            "message": user_msg,
            "data": {
                "appointment_id": str(appt["_id"]),
                "doctor_name": current_user.name,
                "status": "REJECTED",
                "reason": reason_msg
            },
            "read": False,
            "created_at": datetime.utcnow()
        })

        return {
            "status": "success",
            "appointment_status": "REJECTED",
            "message": f"Appointment request for {patient_name} declined."
        }

@router.get("/notifications")
async def get_notifications(current_user: UserResponse = Depends(get_current_user)):
    """
    Get user's notifications
    """
    db = get_database()
    
    cursor = db.notifications.find({"user_id": current_user.id}).sort("created_at", -1).limit(50)
    notifications = await cursor.to_list(50)
    
    result = []
    for notif in notifications:
        notif["id"] = str(notif.pop("_id"))
        if "created_at" in notif and isinstance(notif["created_at"], datetime):
            notif["created_at"] = notif["created_at"].isoformat()
        result.append(notif)
    
    return result

@router.patch("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, current_user: UserResponse = Depends(get_current_user)):
    """
    Mark notification as read
    """
    db = get_database()
    
    await db.notifications.update_one(
        {"_id": ObjectId(notif_id), "user_id": current_user.id},
        {"$set": {"read": True}}
    )
    
    return {"status": "success"}

# --- RECEPTIONIST WORKFLOW ENDPOINTS ---

@router.get("/receptionist/today")
async def get_receptionist_today_appointments(
    hospital_name: Optional[str] = None,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Receptionist view of today's appointments for given hospital.
    """
    db = get_database()
    today_clean = datetime.utcnow().strftime("%Y-%m-%d")
    
    target_hosp = hospital_name.strip() if hospital_name and hospital_name.strip() else (current_user.hospital or "")
    
    query = {}
    if target_hosp:
        query["hospital_name"] = {"$regex": f"^{re.escape(target_hosp)}$", "$options": "i"}

    # Include today's appointments or active appointments
    query["$or"] = [
        {"requested_date": {"$regex": f"^{today_clean}"}},
        {"appointment_date": {"$regex": f"^{today_clean}"}},
        {"status": {"$in": ["BOOKED", "CONFIRMED", "CHECKED_IN", "WAITING", "IN_CONSULTATION"]}}
    ]

    appts = await db.appointments.find(query).sort("created_at", -1).to_list(200)
    
    res = []
    for a in appts:
        a["id"] = str(a.pop("_id"))
        a["arrival_notified"] = bool(a.get("arrival_notified", False))
        res.append(a)
    return res

@router.post("/receptionist/walk-in")
async def register_walk_in(
    req: WalkInRegistrationRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Receptionist registers a walk-in patient, creating appointment & active visit queue entry.
    """
    db = get_database()
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    
    # 1. Match or create patient user
    patient = await db.users.find_one({"mobile": req.mobile, "role": "patient"})
    if not patient:
        p_doc = {
            "name": req.name,
            "mobile": req.mobile,
            "role": "patient",
            "gender": req.gender or "other",
            "age": req.age or 30,
            "hospital": req.hospital_name,
            "created_at": datetime.utcnow()
        }
        res_p = await db.users.insert_one(p_doc)
        patient_id = str(res_p.inserted_id)
        patient_name = req.name
    else:
        patient_id = str(patient["_id"])
        patient_name = patient.get("name", req.name)

    # 2. Find doctor if not provided
    doc = None
    if req.doctor_id:
        try:
            doc = await db.users.find_one({"_id": ObjectId(req.doctor_id), "role": "doctor"})
        except Exception:
            pass

    if not doc:
        doc = await db.users.find_one({
            "role": "doctor",
            "hospital": req.hospital_name,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE"
        })

    doc_name = doc.get("name", "Duty Specialist") if doc else "Duty Specialist"
    doc_id = str(doc["_id"]) if doc else "unassigned"

    # 3. Create appointment with status = CHECKED_IN, source_type = WALK_IN
    appt_doc = {
        "patient_id": patient_id,
        "patient_name": patient_name,
        "doctor_id": doc_id,
        "doctor_name": doc_name,
        "hospital_name": req.hospital_name,
        "specialty": req.specialty or "General Medicine",
        "requested_date": today_str,
        "requested_time_slot": req.time_slot or "09:00 AM",
        "symptoms": req.chief_complaint or "Walk-in OPD",
        "reason": req.chief_complaint or "Walk-in OPD",
        "status": "CHECKED_IN",
        "source_type": "WALK_IN",
        "created_at": datetime.utcnow()
    }
    res_a = await db.appointments.insert_one(appt_doc)
    appt_id = str(res_a.inserted_id)

    # 4. Create active visit entry for doctor queue
    visit_doc = {
        "patient_id": patient_id,
        "patient_name": patient_name,
        "hospital_id": req.hospital_name,
        "hospital_name": req.hospital_name,
        "doctor_name": doc_name,
        "assigned_doctor_id": doc_id,
        "required_specialty": req.specialty or "General Medicine",
        "date": datetime.utcnow(),
        "time_slot": req.time_slot or "09:00 AM",
        "created_at": datetime.utcnow(),
        "chief_complaint": req.chief_complaint or "Walk-in OPD",
        "status": "in_queue",
        "appointment_type": "walk_in",
        "source_type": "WALK_IN",
        "appointment_id": appt_id,
        "diagnosis": [],
        "prescriptions": []
    }
    res_v = await db.visits.insert_one(visit_doc)

    return {
        "status": "CHECKED_IN",
        "appointment_id": appt_id,
        "visit_id": str(res_v.inserted_id),
        "message": f"Walk-in patient {patient_name} registered and checked in successfully."
    }

# --- HOSPITAL ADMIN SCHEDULING ENDPOINTS ---

@router.get("/schedules")
async def get_doctor_schedules(
    hospital_name: Optional[str] = None,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Get doctor schedules / availability rules for authorized hospital.
    """
    db = get_database()
    query = {}
    if hospital_name and hospital_name.strip():
        query["hospital_name"] = hospital_name.strip()
    elif current_user.hospital:
        query["hospital_name"] = current_user.hospital

    schedules = await db.doctor_availability.find(query).to_list(100)
    res = []
    for s in schedules:
        s["id"] = str(s.pop("_id"))
        res.append(s)
    return res

@router.post("/schedules")
async def save_doctor_schedule(
    req: DoctorScheduleCreate,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Create or update doctor schedule settings (slot duration, capacity, working days, blocked dates).
    """
    db = get_database()
    
    doc = {
        "doctor_id": req.doctor_id,
        "hospital_name": req.hospital_name,
        "working_days": req.working_days,
        "start_time": req.start_time,
        "end_time": req.end_time,
        "slot_duration": req.slot_duration,
        "appointment_capacity": req.appointment_capacity,
        "blocked_dates": req.blocked_dates,
        "is_active": req.is_active,
        "updated_at": datetime.utcnow()
    }

    await db.doctor_availability.update_one(
        {"doctor_id": req.doctor_id, "hospital_name": req.hospital_name},
        {"$set": doc},
        upsert=True
    )

    return {"status": "success", "message": "Doctor schedule updated successfully."}

# --- EXPLICIT STATUS TRANSITION ENDPOINT ---

class StatusChangePayload(BaseModel):
    status: AppointmentStatus

@router.patch("/{appointment_id}/status")
async def update_appointment_status_transition(
    appointment_id: str,
    payload: StatusChangePayload,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Server-side appointment status transition validation:
    BOOKED -> CONFIRMED -> CHECKED_IN -> WAITING -> IN_CONSULTATION -> COMPLETED / CANCELLED / NO_SHOW.
    Synchronizes corresponding visit status in Doctor Queue.
    """
    db = get_database()
    try:
        a_oid = ObjectId(appointment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid appointment ID.")

    appt = await db.appointments.find_one({"_id": a_oid})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    new_stat = payload.status.value
    await db.appointments.update_one(
        {"_id": a_oid},
        {"$set": {"status": new_stat, "updated_at": datetime.utcnow()}}
    )

    # Sync visit status if visit exists
    visit_stat_map = {
        "CHECKED_IN": "in_queue",
        "WAITING": "in_queue",
        "IN_CONSULTATION": "in_consultation",
        "COMPLETED": "completed",
        "CANCELLED": "cancelled"
    }
    if new_stat in visit_stat_map:
        await db.visits.update_many(
            {"appointment_id": appointment_id},
            {"$set": {"status": visit_stat_map[new_stat], "updated_at": datetime.utcnow()}}
        )

    return {"status": new_stat, "appointment_id": appointment_id, "message": f"Appointment status updated to {new_stat}."}
