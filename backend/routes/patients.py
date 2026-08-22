import os
import tempfile
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from database import get_database
from middleware.auth_middleware import get_current_user
from models.user import UserResponse
from models.patient import PatientCreate, PatientResponse, ConsentCreate, ConsentResponse, VisitResponse
from bson import ObjectId
from services.ai_routing import assign_referral_to_specialist, send_referral_assigned_notification
from config import settings

from pydantic import BaseModel

router = APIRouter()

class PatientLookupRequest(BaseModel):
    name: Optional[str] = None
    mobile: Optional[str] = None
    abha_number: Optional[str] = None
    date_of_birth: Optional[str] = "2000-01-01"
    gender: Optional[str] = "other"
    district: Optional[str] = "Chennai"
    confirm_link: bool = False

@router.post("/match-or-create")
async def match_or_create_patient(
    req: PatientLookupRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Safely resolves patient identity to prevent duplicate records or silent erroneous mergers.
    1. Strong Identifier (ABHA ID) -> Automatic Exact Match
    2. Mobile/DOB/Name match -> Confirmation Required if ambiguous unless confirm_link=True
    3. No Match -> Creates a new permanent patient profile
    """
    db = get_database()
    
    # 1. ABHA exact match
    if req.abha_number and req.abha_number.strip():
        abha_clean = req.abha_number.strip()
        matched = await db.patients.find_one({"abha_number": abha_clean})
        if matched:
            matched["id"] = str(matched.pop("_id"))
            return {
                "status": "matched",
                "match_type": "EXACT_ABHA",
                "patient": matched,
                "requires_confirmation": False
            }
            
    # 2. Mobile lookup
    mobile_clean = (req.mobile or "").strip().replace(" ", "")
    if mobile_clean:
        if not mobile_clean.startswith("+"):
            mobile_clean = "+91" + mobile_clean
            
        matched_user = await db.users.find_one({"mobile": mobile_clean})
        matched_patient = None
        if matched_user:
            matched_patient = await db.patients.find_one({"user_id": str(matched_user["_id"])})
        if not matched_patient:
            matched_patient = await db.patients.find_one({"mobile": mobile_clean})
            
        if matched_patient:
            matched_patient["id"] = str(matched_patient.pop("_id"))
            if not req.confirm_link:
                return {
                    "status": "possible_match",
                    "match_type": "MOBILE_LOOKUP",
                    "patient": {
                        "id": matched_patient["id"],
                        "name": matched_patient.get("name"),
                        "mobile": matched_patient.get("mobile", mobile_clean),
                        "abha_number": matched_patient.get("abha_number"),
                        "district": matched_patient.get("district")
                    },
                    "requires_confirmation": True,
                    "message": f"A patient profile matching mobile {mobile_clean} ({matched_patient.get('name')}) already exists. Please confirm to link this record."
                }
            else:
                return {
                    "status": "matched",
                    "match_type": "CONFIRMED_MOBILE",
                    "patient": matched_patient,
                    "requires_confirmation": False
                }

    # 3. Create new permanent patient profile if no match
    new_id = str(ObjectId())
    new_patient = {
        "_id": ObjectId(new_id),
        "user_id": new_id,
        "name": (req.name or "OPD Patient").strip(),
        "mobile": mobile_clean or "+919800000000",
        "date_of_birth": req.date_of_birth or "2000-01-01",
        "gender": req.gender or "other",
        "district": req.district or "Chennai",
        "state": "Tamil Nadu",
        "language": "en",
        "abha_number": req.abha_number or f"ABHA-{datetime.utcnow().strftime('%Y%m%d')}-{new_id[:4].upper()}",
        "created_at": datetime.utcnow()
    }
    await db.patients.insert_one(new_patient)
    new_patient["id"] = new_id
    new_patient.pop("_id", None)
    
    return {
        "status": "created",
        "match_type": "NEW_PATIENT",
        "patient": new_patient,
        "requires_confirmation": False
    }

@router.post("/register", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
async def register_patient(patient_in: PatientCreate, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    
    # Check if patient profile already exists for this user
    existing_patient = await db.patients.find_one({"user_id": current_user.id})
    if existing_patient:
        raise HTTPException(status_code=400, detail="Patient profile already exists.")
        
    patient_data = patient_in.dict()
    patient_data["user_id"] = current_user.id
    patient_data["created_at"] = datetime.utcnow()
    # Mock ABHA number for now, or just leave it empty
    patient_data["abha_number"] = f"ABHA-{datetime.utcnow().strftime('%Y%m%d')}-{current_user.id[:4].upper()}"
    
    result = await db.patients.insert_one(patient_data)
    patient_data["_id"] = str(result.inserted_id)
    
    return PatientResponse(**patient_data)

@router.get("/me", response_model=PatientResponse)
async def get_patient_profile(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    patient["_id"] = str(patient["_id"])
    return PatientResponse(**patient)

@router.get("/me/visits", response_model=List[VisitResponse])
async def get_patient_visits(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    patient_id_str = str(patient["_id"])
    visits_cursor = db.visits.find({"patient_id": patient_id_str}).sort("date", -1)
    visits = await visits_cursor.to_list(length=100)

    # Fetch referrals to merge standalone referrals if any exist
    referrals_cursor = db.referrals.find({"patient_id": patient_id_str}).sort("created_at", -1)
    referrals = await referrals_cursor.to_list(length=100)

    existing_ref_ids = {str(v.get("referral_id")) for v in visits if v.get("referral_id")}
    for ref in referrals:
        ref_id_str = str(ref["_id"])
        if ref_id_str not in existing_ref_ids:
            visits.append({
                "_id": f"ref_{ref_id_str}",
                "patient_id": patient_id_str,
                "hospital_name": ref.get("target_hospital") or ref.get("hospital_name") or "General Hospital",
                "doctor_name": ref.get("assigned_doctor_name") or "Pending Assignment",
                "date": ref.get("created_at", datetime.utcnow()),
                "chief_complaint": ref.get("reason") or "Referral Request",
                "diagnosis": [],
                "prescriptions": [],
                "appointment_type": "referred",
                "referred_by": "Self (AI Triage)" if ref.get("asha_id") == "SELF" else (ref.get("referred_by") or "ASHA / Health Worker"),
                "required_specialty": ref.get("target_speciality") or ref.get("required_specialty"),
                "status": ref.get("status", "in_queue"),
                "referral_id": ref_id_str,
                "risk_tag": (ref.get("urgency") or "watch").lower()
            })

    # Sort merged visits by date descending
    visits.sort(key=lambda x: x.get("date") or datetime.min, reverse=True)
    
    results = []
    for v in visits:
        v["_id"] = str(v["_id"])
        # If hospital_name is missing, look it up from hospital_id
        if not v.get("hospital_name") and v.get("hospital_id"):
            hospital_doc = await db.hospitals.find_one({"name": v["hospital_id"]})
            if hospital_doc:
                v["hospital_name"] = hospital_doc.get("name", v["hospital_id"])
            else:
                v["hospital_name"] = v["hospital_id"]
        elif not v.get("hospital_name"):
            v["hospital_name"] = "General Hospital"

        # If doctor_name is missing or still pending, look up from doctor_id
        if (not v.get("doctor_name") or v.get("doctor_name") == "Pending Assignment") and v.get("doctor_id"):
            try:
                doctor_doc = await db.users.find_one({"_id": ObjectId(v["doctor_id"])})
                if doctor_doc:
                    v["doctor_name"] = doctor_doc.get("name", "Pending Doctor Assignment")
            except Exception:
                pass

        if not v.get("doctor_name"):
            if v.get("appointment_type") == "referred":
                v["doctor_name"] = "Pending Doctor Assignment"
            else:
                v["doctor_name"] = "Duty Doctor"

        results.append(VisitResponse(**v))
        
    return results

@router.get("/me/appointments")
async def get_patient_appointments(current_user: UserResponse = Depends(get_current_user)):
    """
    Returns patient's scheduled appointments and active referrals for Patient Dashboard.
    """
    db = get_database()
    appts_cursor = db.appointments.find({"patient_id": current_user.id}).sort("created_at", -1)
    appts = await appts_cursor.to_list(100)
    
    for a in appts:
        a["id"] = str(a.pop("_id"))
        if not a.get("status"):
            a["status"] = "BOOKED"
            
    return appts

@router.get("/me/prescriptions")
async def get_patient_prescriptions(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    visits_cursor = db.visits.find({"patient_id": str(patient["_id"])}).sort("date", -1)
    visits = await visits_cursor.to_list(length=100)
    
    prescriptions = []
    for v in visits:
        if "prescriptions" in v and v["prescriptions"]:
            for p in v["prescriptions"]:
                p_with_meta = dict(p)
                p_with_meta["prescribed_date"] = v["date"].isoformat()
                p_with_meta["prescribed_by"] = v.get("doctor_name", "Unknown Doctor")
                p_with_meta["hospital_name"] = v.get("hospital_name", "Unknown Hospital")
                prescriptions.append(p_with_meta)
                
    return prescriptions

@router.get("/me/lab-results")
async def get_patient_lab_results(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    labs_cursor = db.lab_orders.find({"patient_id": str(patient["_id"])}).sort("ordered_date", -1)
    labs = await labs_cursor.to_list(length=100)
    
    for l in labs:
        l["_id"] = str(l["_id"])
        
    return labs

@router.get("/me/health-summary")
async def get_health_summary(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    patient_id = str(patient["_id"])
    
    # Fetch data
    visits_cursor = db.visits.find({"patient_id": patient_id}).sort("date", -1).limit(5)
    visits = await visits_cursor.to_list(length=5)
    
    labs_cursor = db.lab_orders.find({"patient_id": patient_id}).sort("ordered_date", -1).limit(5)
    labs = await labs_cursor.to_list(length=5)
    
    # Format for prompt
    visit_texts = []
    for v in visits:
        visit_texts.append(f"Date: {v['date']}, Diagnosis: {v.get('diagnosis', [])}, Medicines: {[p.get('medicine') for p in v.get('prescriptions', [])]}")
    
    lab_texts = []
    for l in labs:
        lab_texts.append(f"Test: {l.get('test_name')}, Result: {l.get('result', 'Pending')}")
        
    context = f"""
    Patient Base Info: Conditions/Allergies: {patient.get('allergies', [])}
    Recent Visits:
    {chr(10).join(visit_texts)}
    
    Recent Lab Results:
    {chr(10).join(lab_texts)}
    """
    
    prompt = f"""
    You are a health assistant for an Indian patient. Summarize this patient's health in 3 simple sentences a non-doctor can understand.
    Mention their main conditions, current medicines, and one health tip. Be warm and encouraging.
    Use simple English.
    
    Patient Data:
    {context}
    """
    
    try:
        from services.local_ai_service import local_ai
        insights = local_ai.generate_clinical_insights(context)
        dis = insights.get("Disease", "General Health")
        adv = insights.get("Follow-up Advice", "Maintain healthy lifestyle habits and monitor symptoms.")
        summary = f"Health Status Overview: Clinical pattern indicates {dis}. Recommendation: {adv} Keep track of your symptoms and consult your doctor for regular checkups."
        return {"summary": summary}
    except Exception as e:
        print(f"Patient AI Summary Error: {e}")
        return {"summary": "Your health profile is up to date. Keep maintaining a balanced diet, exercise regularly, and consult your primary physician for routine checkups."}

@router.post("/me/consents", response_model=ConsentResponse)
async def create_consent(consent_in: ConsentCreate, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")

    # Resolve doctor by ObjectId, mobile number, or email
    identifier = consent_in.granted_to_id.strip()
    doctor = None

    # Try ObjectId
    if len(identifier) == 24:
        try:
            doctor = await db.users.find_one({"_id": ObjectId(identifier), "role": "doctor"})
        except Exception:
            pass

    # Try mobile number
    if not doctor:
        mobile = identifier if identifier.startswith("+") else f"+91{identifier}"
        doctor = await db.users.find_one({"mobile": mobile, "role": "doctor"})

    # Try email
    if not doctor:
        doctor = await db.users.find_one({"email": identifier.lower(), "role": "doctor"})

    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found. Please check the ID, mobile number, or email.")

    doctor_id = str(doctor["_id"])
    doctor_name = doctor.get("name", "Unknown Doctor")

    # Prevent duplicate active consent
    existing = await db.consents.find_one({
        "patient_id": str(patient["_id"]),
        "granted_to_id": doctor_id,
        "revoked": False,
        "expires_at": {"$gt": datetime.utcnow()}
    })
    if existing:
        raise HTTPException(status_code=400, detail=f"Active consent already exists for {doctor_name}. Revoke it first to re-grant.")

    consent_data = {
        "patient_id": str(patient["_id"]),
        "granted_to_id": doctor_id,
        "granted_to_name": doctor_name,
        "data_scope": consent_in.data_scope,
        "expires_days": consent_in.expires_days,
        "created_at": datetime.utcnow(),
        "expires_at": datetime.utcnow() + timedelta(days=consent_in.expires_days),
        "revoked": False,
    }

    result = await db.consents.insert_one(consent_data)
    consent_data["_id"] = str(result.inserted_id)

    return ConsentResponse(**consent_data)

@router.get("/me/consents", response_model=List[ConsentResponse])
async def get_consents(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")

    # Return ALL consents (active + revoked) so frontend can show history
    consents_cursor = db.consents.find(
        {"patient_id": str(patient["_id"])}
    ).sort("created_at", -1)

    consents = await consents_cursor.to_list(length=100)

    results = []
    for c in consents:
        c["_id"] = str(c["_id"])
        if "granted_to_id" not in c:
            c["granted_to_id"] = ""
        results.append(ConsentResponse(**c))

    return results

@router.delete("/me/consents/{consent_id}")
async def revoke_consent(consent_id: str, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    # Revoke it
    result = await db.consents.update_one(
        {"_id": ObjectId(consent_id), "patient_id": str(patient["_id"])},
        {"$set": {"revoked": True, "revoked_at": datetime.utcnow()}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Consent not found or already revoked.")
        
    return {"message": "Consent revoked successfully"}

from pydantic import BaseModel
import json

class SymptomLogRequest(BaseModel):
    transcript: str
    preferred_hospital_id: str = "Govt General Hospital Chennai"

@router.get("/me/symptoms")
async def get_patient_symptom_history(current_user: UserResponse = Depends(get_current_user)):
    """
    Returns history of symptom assessments logged by the authenticated patient.
    """
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        patient = await db.patients.find_one({"_id": safe_object_id_silent(current_user.id)})
    patient_id = str(patient["_id"]) if patient else str(current_user.id)

    assessments = await db.symptom_assessments.find({
        "$or": [
            {"patient_id": patient_id},
            {"patient_id": str(current_user.id)}
        ]
    }).sort("created_at", -1).to_list(100)

    results = []
    for a in assessments:
        results.append({
            "id": str(a["_id"]),
            "symptoms": a.get("symptoms", ""),
            "risk_level": a.get("risk_level", "WATCH"),
            "predicted_condition": a.get("predicted_condition", "General Evaluation"),
            "recommended_specialty": a.get("recommended_specialty", "General Medicine"),
            "clinical_advice": a.get("clinical_advice", ""),
            "suggested_tests": a.get("suggested_tests", ""),
            "source": a.get("source", "web"),
            "created_at": a.get("created_at", datetime.utcnow())
        })
    return results

@router.post("/me/symptoms")
async def log_symptoms(req_api: Request, req: SymptomLogRequest, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        patient = await db.patients.find_one({"_id": safe_object_id_silent(current_user.id)})
    if not patient:
        res = await db.patients.insert_one({
            "user_id": current_user.id,
            "name": current_user.name or "Patient",
            "email": current_user.email,
            "mobile": current_user.mobile,
            "created_at": datetime.utcnow()
        })
        patient = await db.patients.find_one({"_id": res.inserted_id})
        
    patient_id = str(patient["_id"])
    patient_name = patient.get("name", current_user.name or "Patient")
    patient_village = patient.get("village") or current_user.village
    
    client_type = req_api.headers.get("x-client-type", "web")
    
    result_json = {
        "risk_level": "WATCH",
        "reasoning": "Unable to reach AI for analysis.",
        "recommendation": "Please consult a doctor.",
        "refer_to_doctor": True
    }
    
    print(f"[TRIAGE] Running patient triage via LOCAL AI (Client: {client_type})...")
    disease_name = "General Health Evaluation"
    advice_text = "Maintain healthy habits and monitor symptoms."
    suggested_tests = "Routine clinical evaluation"

    try:
        from services.local_ai_service import local_ai
        insights = local_ai.generate_clinical_insights(req.transcript)
        dis_res = local_ai.predict_disease(req.transcript)
        ref_res = local_ai.predict_referral(req.transcript)
        
        disease_name = dis_res.get("predicted_condition") or insights.get("Disease") or "General Health Evaluation"
        advice_text = insights.get("Follow-up Advice") or "Maintain healthy habits and monitor symptoms."
        suggested_tests = insights.get("Suggested Tests") or "Routine clinical evaluation"

        risk_level = insights.get("Risk Level", "Moderate").upper()
        if risk_level == "MODERATE": risk_level = "WATCH"
        elif risk_level == "HIGH": risk_level = "URGENT"
        elif risk_level == "CRITICAL": risk_level = "SEVERE"
        
        result_json["risk_level"] = risk_level
        if ref_res.get("recommended_specialty"):
            target_speciality = ref_res.get("recommended_specialty")
    except Exception as e:
        print(f"Local AI Patient Triage Error: {e}")
            
    risk_level = result_json.get("risk_level", "WATCH")
    refer_to_doctor = True if risk_level in ["URGENT", "SEVERE"] else False

    # --- Symptom → Speciality mapping fallback ---
    if not target_speciality or target_speciality == "General Medicine":
        SYMPTOM_SPECIALITY_MAP = [
            (["stomach", "abdomen", "gastric", "vomit", "nausea", "acidity", "bowel", "diarrhea", "ulcer"], "Gastroenterology"),
            (["pregnant", "pregnancy", "gynaec", "period", "menstrual", "uterus", "ovary", "vaginal", "cervix", "labour", "delivery"], "Gynecology"),
            (["bone", "joint", "knee", "fracture", "ortho", "leg pain", "back pain", "spine", "shoulder", "hip", "ankle"], "Orthopedics"),
            (["heart", "chest pain", "cardiac", "palpitation", "breathless", "blood pressure", "bp"], "Cardiology"),
            (["eye", "vision", "cataract", "glaucoma", "blur"], "Ophthalmology"),
            (["ear", "nose", "throat", "ent", "tonsil", "sinus", "hearing"], "ENT"),
            (["skin", "rash", "itch", "derma", "allergy", "eczema", "psoriasis"], "Dermatology"),
            (["child", "infant", "baby", "pediatric", "toddler"], "Pediatrics"),
            (["neuro", "seizure", "headache", "migraine", "paralysis", "stroke", "nerve"], "Neurology"),
            (["kidney", "urine", "renal", "dialysis", "nephro"], "Nephrology"),
            (["lung", "breath", "asthma", "tuberculosis", "tb", "cough", "chest"], "Pulmonology"),
            (["diabetes", "thyroid", "hormone", "sugar", "endo"], "Endocrinology"),
        ]

        transcript_lower = req.transcript.lower()
        for keywords, speciality in SYMPTOM_SPECIALITY_MAP:
            if any(kw in transcript_lower for kw in keywords):
                target_speciality = speciality
                break

    # Save real Symptom Assessment document in db.symptom_assessments
    assessment_doc = {
        "patient_id": patient_id,
        "symptoms": req.transcript,
        "source": client_type,
        "risk_level": risk_level,
        "predicted_condition": disease_name,
        "recommended_specialty": target_speciality,
        "clinical_advice": advice_text,
        "suggested_tests": suggested_tests,
        "created_at": datetime.utcnow()
    }
    assessment_res = await db.symptom_assessments.insert_one(assessment_doc)
    symptom_assessment_id = str(assessment_res.inserted_id)

    result_json["symptom_assessment_id"] = symptom_assessment_id
    result_json["transcript"] = req.transcript
    result_json["symptoms_summary"] = req.transcript
    result_json["predicted_condition"] = disease_name
    result_json["target_speciality"] = target_speciality
    result_json["recommended_specialty"] = target_speciality
    result_json["reasoning"] = f"Symptoms indicate possible {disease_name}. Recommended specialty: {target_speciality}."
    result_json["recommendation"] = f"{advice_text} (Suggested Tests: {suggested_tests})"
    result_json["summary"] = f"Reported Symptoms: \"{req.transcript}\". AI Analysis recommends {target_speciality} evaluation for {disease_name}."
    result_json["refer_to_doctor"] = False  # Pure symptom assessment, patient explicitly decides to book appointment

    # Community Health Notification for ASHA if patient has high risk symptoms in their village
    try:
        if patient_village and risk_level in ["URGENT", "SEVERE"]:
            asha_workers = await db.users.find(
                {"role": "asha", "village": patient_village}
            ).to_list(10)
            if asha_workers:
                notif_docs = [{
                    "asha_id": str(asha["_id"]),
                    "patient_id": patient_id,
                    "patient_name": patient_name,
                    "patient_village": patient_village,
                    "symptoms_summary": req.transcript[:300],
                    "risk_level": risk_level,
                    "recommended_specialty": target_speciality,
                    "type": "high_risk_symptom_alert",
                    "created_at": datetime.utcnow(),
                    "read": False
                } for asha in asha_workers]
                await db.notifications.insert_many(notif_docs)
    except Exception as e:
        print(f"[ASHA NOTIFICATION ERROR] {e}")
        
    result_json["offline_saved"] = False
    return result_json


@router.post("/me/voice-symptoms")
async def voice_log_symptoms(
    request: Request,
    preferred_hospital_id: str = "General Hospital",
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Voice-first patient symptom reporting.
    Accepts audio (any format), transcribes via local Whisper,
    then runs the same triage/auto-referral pipeline as /me/symptoms.
    """
    from services.transcription_service import transcription_service
    import time

    t_start = time.perf_counter()
    ext = os.path.splitext(file.filename or "audio.bin")[1].lower() or ".bin"
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, f"pt_voice_{uuid.uuid4().hex}{ext}")

    try:
        t_upload_start = time.perf_counter()
        MAX_SIZE = 20 * 1024 * 1024  # 20 MB
        total = 0
        with open(temp_path, "wb") as buf:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SIZE:
                    raise HTTPException(status_code=413, detail="Audio file too large (max 20 MB)")
                buf.write(chunk)
        t_upload_end = time.perf_counter()

        t_stt_start = time.perf_counter()
        transcript = await transcription_service.transcribe(temp_path, client_type="mobile", mime_type=file.content_type)
        t_stt_end = time.perf_counter()
        if not transcript or not transcript.strip():
            raise HTTPException(status_code=422, detail="Could not transcribe audio. Please speak clearly and try again.")

    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

    t_triage_start = time.perf_counter()
    from pydantic import BaseModel as _BM
    class _Req(_BM):
        transcript: str
        preferred_hospital_id: str

    fake_req = _Req(transcript=transcript, preferred_hospital_id=preferred_hospital_id)
    result = await log_symptoms(request, fake_req, current_user)
    t_triage_end = time.perf_counter()

    if isinstance(result, dict):
        result["transcript"] = transcript

    upload_ms = (t_upload_end - t_upload_start) * 1000
    stt_ms = (t_stt_end - t_stt_start) * 1000
    triage_ms = (t_triage_end - t_triage_start) * 1000
    total_ms = (time.perf_counter() - t_start) * 1000

    print(f"""
[DEV TIMING LOG - PATIENT VOICE SYMPTOMS ENDPOINT]
├─ 1. Temp Save & Receive   : {upload_ms:.2f} ms
├─ 2. ffmpeg & Whisper STT  : {stt_ms:.2f} ms
├─ 3. Symptom Triage ML     : {triage_ms:.2f} ms
└─ TOTAL REQUEST DURATION   : {total_ms:.2f} ms
""")

    return result


@router.get("/me/medical-history")
async def get_my_longitudinal_medical_history(current_user: UserResponse = Depends(get_current_user)):
    """
    Returns the complete, unified longitudinal medical record for the current authenticated patient.
    Consolidates demographics, appointments, clinical encounters, doctor-confirmed diagnoses,
    prescriptions, lab orders/reports, referrals, and ASHA community history.
    """
    db = get_database()
    patient = await db.patients.find_one({"user_id": current_user.id})
    if not patient:
        patient = await db.patients.find_one({"_id": safe_object_id_silent(current_user.id)})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    patient_id_str = str(patient["_id"])
    return await build_longitudinal_record(db, patient, patient_id_str)


@router.get("/{patient_id}/medical-history")
async def get_patient_longitudinal_medical_history(patient_id: str, current_user: UserResponse = Depends(get_current_user)):
    """
    Returns the longitudinal record for a specified patient_id with strict role-based access checks.
    """
    db = get_database()
    patient = await db.patients.find_one({"_id": safe_object_id_silent(patient_id)})
    if not patient:
        patient = await db.patients.find_one({"user_id": patient_id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")

    patient_id_str = str(patient["_id"])

    # Authorization Check
    if current_user.role == "patient":
        if patient.get("user_id") != current_user.id and patient_id_str != current_user.id:
            raise HTTPException(status_code=403, detail="You don't have permission to access this information.")
    elif current_user.role == "doctor":
        # Check authorization: doctor assigned or patient at doctor's hospital or active consent or active referral
        has_visit = await db.visits.find_one({"patient_id": patient_id_str, "doctor_id": str(current_user.id)})
        has_hospital_visit = await db.visits.find_one({"patient_id": patient_id_str, "hospital_id": current_user.hospital})
        has_referral = await db.referrals.find_one({"patient_id": patient_id_str, "to_hospital_id": current_user.hospital})
        has_consent = await db.consents.find_one({
            "patient_id": patient_id_str,
            "granted_to_id": str(current_user.id),
            "expires_at": {"$gt": datetime.utcnow()},
            "revoked": False
        })
        if not (has_visit or has_hospital_visit or has_referral or has_consent):
            raise HTTPException(status_code=403, detail="You don't have permission to access this information.")
    elif current_user.role == "asha":
        raise HTTPException(status_code=403, detail="You don't have permission to access this patient.")

    return await build_longitudinal_record(db, patient, patient_id_str)


def safe_object_id_silent(id_str: str) -> Optional[ObjectId]:
    try:
        return ObjectId(id_str) if id_str and len(id_str) == 24 else None
    except Exception:
        return None


async def build_longitudinal_record(db, patient: dict, patient_id_str: str) -> dict:
    patient_copy = dict(patient)
    patient_copy["id"] = patient_id_str
    patient_copy["_id"] = patient_id_str

    # 1. Appointments
    appts_cursor = db.appointments.find({"patient_id": patient_id_str}).sort("created_at", -1)
    appts = await appts_cursor.to_list(100)
    formatted_appts = []
    for a in appts:
        a["id"] = str(a.pop("_id"))
        formatted_appts.append(a)

    # 2. Visits / Clinical Encounters
    visits_cursor = db.visits.find({"patient_id": patient_id_str}).sort("date", -1)
    visits = await visits_cursor.to_list(100)
    formatted_visits = []
    confirmed_diagnoses = []
    all_prescriptions = []

    for v in visits:
        v["id"] = str(v.pop("_id"))
        # Doctor confirmed diagnoses
        if v.get("diagnosis"):
            for d in v["diagnosis"]:
                if d and d not in confirmed_diagnoses:
                    confirmed_diagnoses.append(d)
        # Prescriptions
        if v.get("prescriptions"):
            for p in v["prescriptions"]:
                p_item = dict(p)
                p_item["encounter_id"] = v["id"]
                p_item["date"] = v.get("date", datetime.utcnow()).isoformat() if isinstance(v.get("date"), datetime) else str(v.get("date"))
                p_item["doctor_name"] = v.get("doctor_name", "Duty Doctor")
                p_item["hospital_name"] = v.get("hospital_name", "General Hospital")
                all_prescriptions.append(p_item)
        formatted_visits.append(v)

    # 3. Lab Orders & Reports
    labs_cursor = db.lab_orders.find({"patient_id": patient_id_str}).sort("ordered_date", -1)
    labs = await labs_cursor.to_list(100)
    formatted_labs = []
    for l in labs:
        l_id = str(l["_id"])
        l["id"] = l_id
        l["_id"] = l_id
        # Sanitize PDF download link
        if l.get("pdf_url"):
            l["pdf_download_url"] = f"/api/lab/orders/{l_id}/pdf"
        formatted_labs.append(l)

    # 4. Referrals
    refs_cursor = db.referrals.find({"patient_id": patient_id_str}).sort("created_at", -1)
    referrals = await refs_cursor.to_list(100)
    formatted_refs = []
    for r in referrals:
        r["id"] = str(r.pop("_id"))
        formatted_refs.append(r)

    # 5. ASHA Screening Visits
    asha_cursor = db.asha_visits.find({"patient_id": patient_id_str}).sort("created_at", -1)
    asha_visits = await asha_cursor.to_list(100)
    formatted_asha = []
    for av in asha_visits:
        av["id"] = str(av.pop("_id"))
        formatted_asha.append(av)

    return {
        "patient": patient_copy,
        "appointments": formatted_appts,
        "encounters": formatted_visits,
        "confirmed_diagnoses": confirmed_diagnoses,
        "prescriptions": all_prescriptions,
        "lab_orders": formatted_labs,
        "referrals": formatted_refs,
        "asha_history": formatted_asha,
        "summary": {
            "total_encounters": len(formatted_visits),
            "total_lab_orders": len(formatted_labs),
            "total_referrals": len(formatted_refs),
            "active_prescriptions_count": len(all_prescriptions)
        }
    }

