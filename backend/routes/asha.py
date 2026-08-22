import os
import asyncio
import json
import shutil
import tempfile
import time
import uuid
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Request, status, File, UploadFile
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel
from database import get_database
from middleware.auth_middleware import get_current_user
from models.user import UserResponse
from models.asha import (
    HouseholdCreate, VisitCreate, RiskClassifyRequest, 
    RiskClassifyResponse, ReferralCreate
)
from services.transcription_service import transcription_service
from bson import ObjectId
from groq import AsyncGroq
from config import settings
from services.ai_routing import assign_referral_to_specialist, send_referral_assigned_notification
from services.ollama_service import ollama_service
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

@router.get("/households")
async def get_households(current_user: UserResponse = Depends(get_current_user)):
    try:
        db = get_database()
        user_village = (current_user.village or "").strip()
        
        query_conds = [{"created_by": current_user.id}]
        if user_village:
            query_conds.append({"village": user_village})
            
        households_cursor = db.households.find({"$or": query_conds})
        households = await households_cursor.to_list(200)
        
        def get_risk_weight(h):
            risk = (h.get("risk_level") or "green").lower()
            if risk == "red": return 0
            if risk == "amber": return 1
            return 2
            
        households.sort(key=get_risk_weight)
        
        for h in households:
            h_id_str = str(h.pop("_id"))
            h["id"] = h_id_str
            
            if "visits" in h and isinstance(h["visits"], list) and len(h["visits"]) > 0:
                h["total_visits"] = len(h["visits"])
            else:
                p_id = safe_object_id_silent(h_id_str)
                conds = [{"household_id": h_id_str}]
                if p_id:
                    conds.append({"household_id": str(p_id)})
                count = await db.asha_visits.count_documents({
                    "$or": conds,
                    "asha_id": current_user.id
                })
                h["total_visits"] = count
        
        return households
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise e

@router.post("/households")
async def register_household(household: HouseholdCreate, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    
    village_name = (current_user.village or household.village or "").strip()
    fam_name = (household.family_name or "").strip()
    
    if not fam_name:
        raise HTTPException(status_code=400, detail="Household family name is required.")
        
    # Check for duplicate household in same village / created by same ASHA
    query_conds = [
        {"family_name": {"$regex": f"^{fam_name}$", "$options": "i"}, "village": {"$regex": f"^{village_name}$", "$options": "i"}},
        {"family_name": {"$regex": f"^{fam_name}$", "$options": "i"}, "created_by": current_user.id}
    ]
    existing_hh = await db.households.find_one({"$or": query_conds})
    if existing_hh:
        raise HTTPException(status_code=409, detail="This household appears to be already registered.")
        
    household_dict = household.dict()
    household_dict["created_by"] = current_user.id
    household_dict["village"] = village_name or household_dict.get("village", "")
    household_dict["created_at"] = datetime.utcnow()
    household_dict["risk_level"] = "green"
    household_dict["open_issues"] = []
    
    # Process initial members and create persistent patient records
    formatted_members = []
    for m in household_dict.get("members", []):
        m_name = (m.get("name") or "Family Member").strip()
        try:
            m_age = int(m.get("age", 30))
        except Exception:
            m_age = 30
        m_gender = (m.get("gender") or "female").lower()
        m_relation = m.get("relation") or "Member"
        
        patient_doc = {
            "name": m_name,
            "age": m_age,
            "gender": m_gender,
            "phone": household.contact_phone or "0000000000",
            "village": household_dict["village"],
            "district": household_dict.get("district", "Chennai"),
            "registered_by_asha_id": current_user.id,
            "registered_by_asha_name": current_user.name,
            "created_at": datetime.utcnow()
        }
        p_res = await db.patients.insert_one(patient_doc)
        patient_id = str(p_res.inserted_id)
        
        formatted_members.append({
            "member_id": str(ObjectId()),
            "patient_id": patient_id,
            "name": m_name,
            "age": m_age,
            "gender": m_gender,
            "relation": m_relation
        })
        
    household_dict["members"] = formatted_members
    
    res = await db.households.insert_one(household_dict)
    hh_id = str(res.inserted_id)
    household_dict["id"] = hh_id
    
    # Update created patient records with household_id
    if formatted_members:
        patient_ids = [m["patient_id"] for m in formatted_members]
        p_objs = [safe_object_id_silent(pid) for pid in patient_ids if safe_object_id_silent(pid)]
        if p_objs:
            await db.patients.update_many(
                {"_id": {"$in": p_objs}},
                {"$set": {"household_id": hh_id}}
            )
        
    if "_id" in household_dict:
        household_dict.pop("_id")
        
    return household_dict

@router.post("/households/{household_id}/members")
async def add_household_member(
    household_id: str,
    payload: dict,
    current_user: UserResponse = Depends(get_current_user)
):
    db = get_database()
    hh_obj = safe_object_id_silent(household_id)
    query_conds = []
    if hh_obj:
        query_conds.append({"_id": hh_obj})
    query_conds.append({"id": household_id})
    
    hh = await db.households.find_one({"$or": query_conds})
    if not hh:
        raise HTTPException(status_code=404, detail="Household not found")
        
    is_creator = hh.get("created_by") == current_user.id
    h_village = (hh.get("village") or "").strip().lower()
    u_village = (current_user.village or "").strip().lower()
    is_same_village = bool(u_village and h_village and u_village == h_village)

    if not (is_creator or is_same_village) and current_user.role not in ["admin", "pho"]:
        raise HTTPException(status_code=403, detail="You don't have permission to access this household.")
        
    member_name = payload.get("name", "Unknown Member").strip()
    try:
        age = int(payload.get("age", 30))
    except Exception:
        age = 30
    gender = payload.get("gender", "female").lower()
    relation = payload.get("relation", "Family Member")
    medical_history = payload.get("medical_history", "")
    phone = payload.get("phone") or hh.get("contact_phone") or "0000000000"
    
    # Check if member with same name already exists in household
    for existing_m in hh.get("members", []):
        if (existing_m.get("name") or "").strip().lower() == member_name.lower():
            return {
                "status": "success",
                "message": "Member already registered in this household.",
                "member": existing_m,
                "patient_id": existing_m.get("patient_id")
            }

    # Create persistent patient entity
    patient_doc = {
        "name": member_name,
        "age": age,
        "gender": gender,
        "phone": phone,
        "village": hh.get("village") or current_user.village or "",
        "district": hh.get("district") or current_user.district or "",
        "household_id": str(hh["_id"]),
        "medical_history": medical_history,
        "registered_by_asha_id": current_user.id,
        "registered_by_asha_name": current_user.name,
        "created_at": datetime.utcnow()
    }
    p_res = await db.patients.insert_one(patient_doc)
    patient_id = str(p_res.inserted_id)
    
    member_obj = {
        "member_id": str(ObjectId()),
        "patient_id": patient_id,
        "name": member_name,
        "age": age,
        "gender": gender,
        "relation": relation,
        "medical_history": medical_history
    }
    
    await db.households.update_one(
        {"_id": hh["_id"]},
        {"$push": {"members": member_obj}}
    )
    
    return {
        "status": "success",
        "member": member_obj,
        "patient_id": patient_id
    }

@router.get("/households/{household_id}")
async def get_household(household_id: str, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    hh_obj = safe_object_id_silent(household_id)
    query_conds = []
    if hh_obj:
        query_conds.append({"_id": hh_obj})
    query_conds.append({"id": household_id})
    
    h = await db.households.find_one({"$or": query_conds})
    if not h:
        raise HTTPException(status_code=404, detail="Household not found")
        
    is_creator = h.get("created_by") == current_user.id
    h_village = (h.get("village") or "").strip().lower()
    u_village = (current_user.village or "").strip().lower()
    is_same_village = bool(u_village and h_village and u_village == h_village)

    if not (is_creator or is_same_village) and current_user.role not in ["admin", "pho"]:
        raise HTTPException(status_code=403, detail="You don't have permission to access this household.")

    real_id = str(h.pop("_id"))
    h["id"] = real_id
    
    try:
        visits_cursor = db.asha_visits.find({
            "$or": [
                {"household_id": real_id},
                {"household_id": household_id}
            ],
            "asha_id": current_user.id
        }).sort("created_at", -1)
        visits = await visits_cursor.to_list(length=50)
        for v in visits:
            v["id"] = str(v.pop("_id"))
            if "_id" in v: v.pop("_id")
            
        h["visit_history"] = visits
        h["total_visits"] = len(visits)
    except Exception:
        h["visit_history"] = []
        h["total_visits"] = 0

    return h

@router.post("/visits")
async def submit_visit(request: Request, visit: VisitCreate, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    
    # DEBUG LOGGING
    print(f"[VISIT DEBUG] Received visit submission from ASHA {current_user.id}")
    print(f"[VISIT DEBUG] household_id: {visit.household_id} (type: {type(visit.household_id)})")
    print(f"[VISIT DEBUG] member_id: {visit.member_id} (type: {type(visit.member_id)})")
    print(f"[VISIT DEBUG] observations: {visit.observations} (type: {type(visit.observations)})")
    print(f"[VISIT DEBUG] risk_level: {visit.risk_level}")
    
    hh_obj = safe_object_id_silent(visit.household_id)
    query_conds = []
    if hh_obj:
        query_conds.append({"_id": hh_obj})
    query_conds.append({"id": visit.household_id})
    
    hh = await db.households.find_one({"$or": query_conds})
    if not hh:
        print(f"[VISIT DEBUG] Household not found: {visit.household_id}")
        raise HTTPException(status_code=404, detail="Household not found")

    # Resolve patient_id from household members if available
    patient_id_resolved = visit.member_id
    for m in hh.get("members", []):
        if m.get("member_id") == visit.member_id or m.get("patient_id") == visit.member_id or (m.get("name") or "").lower() == (visit.member_id or "").lower():
            if m.get("patient_id"):
                patient_id_resolved = m.get("patient_id")
                break

    # Normalise risk_level — accept URGENT/urgent/red, WATCH/watch/amber, LOW/low/green
    risk_raw = (visit.risk_level or "WATCH").upper()
    if risk_raw in ["RED", "URGENT"]:
        risk = "red"
    elif risk_raw in ["AMBER", "WATCH"]:
        risk = "amber"
    else:
        risk = "green"

    visit_dict = visit.dict()
    visit_dict["asha_id"] = current_user.id
    visit_dict["household_id"] = str(hh["_id"])
    visit_dict["patient_id"] = patient_id_resolved
    visit_dict["risk_level"] = risk
    visit_dict["created_at"] = datetime.utcnow()
    
    res = await db.asha_visits.insert_one(visit_dict)
    visit_id = str(res.inserted_id)
    visit_dict["id"] = visit_id
    
    urgent = risk == "red"
    
    await db.households.update_one(
        {"_id": hh["_id"]},
        {
            "$set": {
                "last_visit_date": datetime.utcnow(),
                "risk_level": risk
            },
            "$inc": {"visit_count": 1},
            "$push": {
                "visits": {
                    "id": visit_id,
                    "member_id": visit.member_id,
                    "patient_id": patient_id_resolved,
                    "visit_type": visit.visit_type,
                    "risk_level": risk,
                    "observations": visit.observations,
                    "ai_reasoning": visit.ai_reasoning,
                    "created_at": datetime.utcnow().isoformat()
                }
            }
        }
    )
    
    if urgent:
        # Determine specialty and assign doctor
        symptoms = visit.ai_reasoning or visit.observations or "Urgent evaluation needed"
        hospital_target = "AUTO_ASSIGNED"
        
        # Use first hospital for auto assignment
        first_hospital = await db.hospitals.find_one({})
        if first_hospital:
            hospital_target = first_hospital["name"]
            
        client_type = request.headers.get("x-client-type", "web")
        routing_res = await assign_referral_to_specialist(db, symptoms, hospital_target, client_type=client_type)
        if not routing_res.get("success"):
            raise HTTPException(status_code=400, detail=routing_res.get("error_message"))
            
        ref_dict = {
            "patient_id": visit.member_id,
            "household_id": visit.household_id,
            "to_hospital_id": hospital_target,
            "visit_id": visit_id,
            "urgency": "Today",
            "from_worker_id": current_user.id,
            "from_worker_name": current_user.name,
            "asha_observations": str(visit.observations) if visit.observations else "",
            "ai_summary": visit.ai_reasoning,
            "ai_recommended_specialty": routing_res.get("required_specialty"),
            "assigned_specialty": routing_res.get("required_specialty"),
            "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
            "assigned_doctor_name": routing_res.get("assigned_doctor_name"),
            "created_at": datetime.utcnow(),
            "status": "pending",
            "asha_id": current_user.id
        }
        ref_res = await db.referrals.insert_one(ref_dict)
        ref_id_str = str(ref_res.inserted_id)

        # Send notification ONLY to target assigned doctor
        await send_referral_assigned_notification(
            db=db,
            referral_id=ref_id_str,
            patient_id=visit.member_id,
            assigned_doctor_id=routing_res.get("assigned_doctor_id"),
            target_hospital_id=hospital_target,
            specialty=routing_res.get("required_specialty"),
            status="pending"
        )

        # BRIDGE TO CLINICIAN QUEUE
        # target_hospital already determined above

        await db.visits.insert_one({
            "patient_id": visit.member_id,
            "hospital_id": hospital_target,
            "hospital_name": hospital_target,
            "doctor_name": routing_res.get("assigned_doctor_name"),
            "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
            "required_specialty": routing_res.get("required_specialty"),
            "date": datetime.utcnow(),
            "created_at": datetime.utcnow(),
            "chief_complaint": f"ASHA Referral: {visit.ai_reasoning[:100]}...",
            "status": "in_queue",
            "appointment_type": "referred",
            "risk_tag": "urgent",
            "referred_by": current_user.name,
            "referral_id": str(ref_res.inserted_id),
            "diagnosis": [],
            "prescriptions": []
        })
        
    if "_id" in visit_dict: visit_dict.pop("_id")
    return visit_dict

@router.post("/visits/classify-risk", response_model=RiskClassifyResponse)
async def classify_risk(request: Request, req: RiskClassifyRequest, current_user: UserResponse = Depends(get_current_user)):
    t_start = time.time()
    req_id = f"req_risk_{uuid.uuid4().hex[:8]}"
    client_type = request.headers.get("x-client-type", "web")
    
    obs = req.observations or {}
    symptoms_detail = ""
    bp_val, temp_val, pulse_val, spo2_val = "", "", "", ""
    if isinstance(obs, dict):
        symptoms_detail = obs.get("symptoms", "")
        bp_val = str(obs.get("bp", ""))
        temp_val = str(obs.get("temp", ""))
        pulse_val = str(obs.get("pulse", ""))
        spo2_val = str(obs.get("spo2", ""))
    else:
        symptoms_detail = str(obs)

    clean_symptoms = f"{symptoms_detail} {req.transcript or ''}".strip()
    if not clean_symptoms or len(clean_symptoms) < 2:
        raise HTTPException(
            status_code=400,
            detail="Please provide the required symptom information before running the assessment."
        )

    t_prep = time.time()
    symptoms_text = f"Patient: {req.member_name or 'Unknown'}, {req.member_age} y/o {req.member_gender}. Symptoms: {clean_symptoms}. Vitals: BP {bp_val}, Temp {temp_val}°F, Pulse {pulse_val}, SpO2 {spo2_val}%"

    # Vitals Risk Check
    vitals_urgent = False
    vitals_reasons = []
    try:
        if spo2_val and float(spo2_val) < 95.0:
            vitals_urgent = True
            vitals_reasons.append(f"Hypoxia detected (SpO2 {spo2_val}% < 95%)")
        if temp_val and float(temp_val) >= 101.0:
            vitals_urgent = True
            vitals_reasons.append(f"High fever detected ({temp_val}°F)")
    except Exception:
        pass

    # Unified Trained ML Model Fast-Path (<20ms) for Web & Mobile
    t_ml_start = time.time()
    disease_pred = local_ai.predict_disease(clean_symptoms)
    referral_pred = local_ai.predict_referral(clean_symptoms)
    t_ml_end = time.time()
    
    conf = float(disease_pred.get("confidence", 0.75))
    pred_disease = disease_pred.get("predicted_disease", "General Assessment")
    
    if vitals_urgent:
        risk_raw = "URGENT"
        reasoning = f"{', '.join(vitals_reasons)}. {disease_pred.get('explanation', '')}"
    elif conf > 0.85 or pred_disease in ["Pneumonia", "Tuberculosis", "Hypertension", "Dengue", "Typhoid", "Heart Attack", "Jaundice"]:
        risk_raw = "URGENT"
        reasoning = disease_pred.get("explanation", f"High clinical correlation detected for {pred_disease}.")
    elif conf > 0.5:
        risk_raw = "WATCH"
        reasoning = disease_pred.get("explanation", f"Moderate symptom indicator for {pred_disease}. Follow up recommended.")
    else:
        risk_raw = "LOW"
        reasoning = disease_pred.get("explanation", "Mild symptom pattern. Routine monitoring advised.")

    # Non-blocking optional Ollama background check (configurable timeout) if available
    ollama_failed = False
    t_ollama_start = time.time()
    try:
        ollama_res = await asyncio.wait_for(
            ollama_service.analyze_clinical_note(symptoms_text, disease_prediction=disease_pred),
            timeout=float(getattr(settings, 'ollama_timeout', 3.0))
        )
        if ollama_res and ollama_res.get("clinical_insights"):
            insights = ollama_res.get("clinical_insights")
            reasoning = f"{', '.join(vitals_reasons)}. {insights}" if vitals_urgent else insights
    except Exception as ollama_err:
        ollama_failed = True
        # Log developer-only diagnostic without breaking response
        print(f"⚠️ [ASHA AI DIAGNOSTIC] id={req_id} Ollama enrichment unavailable: {ollama_err}")
    t_ollama_end = time.time()

    t_total = time.time() - t_start
    prep_ms = (t_prep - t_start) * 1000
    ml_ms = (t_ml_end - t_ml_start) * 1000
    ollama_ms = (t_ollama_end - t_ollama_start) * 1000
    total_ms = t_total * 1000

    # Developer-only structured diagnostic logging
    print(
        f"📊 [ASHA AI DIAGNOSTIC] req_id={req_id} asha_id={current_user.id} client={client_type} "
        f"prep_ms={prep_ms:.1f} ml_ms={ml_ms:.1f} ollama_ms={ollama_ms:.1f} total_ms={total_ms:.1f} "
        f"risk={risk_raw} disease='{pred_disease}' ollama_failed={ollama_failed} success=True"
    )

    return RiskClassifyResponse(
        risk_level=risk_raw,
        reasoning=reasoning,
        recommendation="Monitor patient symptoms and schedule follow-up." if risk_raw != "URGENT" else "Urgent hospital evaluation & specialist referral required.",
        refer_to_doctor=risk_raw == "URGENT",
        predicted_disease=pred_disease,
        confidence=conf,
        recommended_specialty=referral_pred.get("recommended_specialty", "General Medicine")
    )

@router.post("/referrals")
async def send_referral(ref: ReferralCreate, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    
    # 1. Resolve Household & Patient
    hh = None
    hh_obj = safe_object_id_silent(ref.household_id)
    if hh_obj:
        hh = await db.households.find_one({"_id": hh_obj})
    if not hh and ref.household_id and ref.household_id != "AUTO_ASSIGNED":
        hh = await db.households.find_one({"id": ref.household_id})
        
    p_doc = None
    if ref.patient_id and ref.patient_id != "unknown":
        p_obj = safe_object_id_silent(ref.patient_id)
        if p_obj:
            p_doc = await db.patients.find_one({"_id": p_obj})
        if not p_doc:
            p_doc = await db.patients.find_one({"user_id": ref.patient_id})
        if not p_doc:
            p_doc = await db.patients.find_one({"id": ref.patient_id})
            
    if not hh and p_doc and p_doc.get("household_id"):
        hh_obj_p = safe_object_id_silent(p_doc["household_id"])
        hh = await db.households.find_one({"$or": [{"_id": hh_obj_p}] if hh_obj_p else [{"id": p_doc["household_id"]}]})
        
    if hh:
        u_village = (current_user.village or "").strip().lower()
        h_village = (hh.get("village") or "").strip().lower()
        is_creator = hh.get("created_by") == current_user.id
        is_same_village = bool(u_village and h_village and u_village == h_village)
        if not (is_creator or is_same_village) and current_user.role not in ["admin", "pho"]:
            raise HTTPException(status_code=403, detail="You don't have permission to access this household.")

    # 2. Verify Target Hospital
    hospital_check = await db.hospitals.find_one({"name": ref.to_hospital_id})
    if not hospital_check and len(ref.to_hospital_id) == 24:
        h_obj = safe_object_id_silent(ref.to_hospital_id)
        if h_obj:
            hospital_check = await db.hospitals.find_one({"_id": h_obj})
    if not hospital_check:
        raise HTTPException(status_code=400, detail="The selected hospital is not registered in the system.")

    patient_id_str = str(p_doc["_id"]) if p_doc else (ref.patient_id if ref.patient_id and ref.patient_id != "unknown" else None)
    if not patient_id_str:
        raise HTTPException(status_code=400, detail="A valid registered patient ID is required for referral creation.")

    # 3. AI ROUTING: Assign to Specialist
    symptoms = ref.notes or ref.ai_summary or "Clinical assessment requested"
    target_hosp = hospital_check.get("name") if hospital_check else ref.to_hospital_id
    
    routing_res = await assign_referral_to_specialist(db, symptoms, target_hosp, override_specialty=ref.urgency_specialty)
    
    ref_dict = ref.dict()
    ref_dict["source_type"] = "ASHA_REFERRAL"
    ref_dict["asha_id"] = current_user.id
    ref_dict["from_worker_id"] = current_user.id
    ref_dict["from_worker_name"] = current_user.name
    ref_dict["patient_id"] = patient_id_str
    ref_dict["source_village_id"] = current_user.village or ""
    ref_dict["source_household_id"] = str(hh["_id"]) if hh else ref.household_id
    ref_dict["created_at"] = datetime.utcnow()
    ref_dict["required_specialty"] = routing_res.get("required_specialty")
    ref_dict["normalized_required_specialty"] = routing_res.get("normalized_required_specialty")
    
    if not routing_res.get("success"):
        # Specialist unavailable at requested hospital!
        ref_dict["status"] = "SPECIALIST_UNAVAILABLE"
        ref_dict["assigned_doctor_id"] = None
        ref_dict["assigned_doctor_name"] = None
        ref_dict["recommended_hospitals"] = routing_res.get("recommended_hospitals", [])
        
        res = await db.referrals.insert_one(ref_dict)
        ref_id = str(res.inserted_id)
        ref_dict["id"] = ref_id
        if "_id" in ref_dict: ref_dict.pop("_id")
        
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=200,
            content={
                "status": "SPECIALIST_UNAVAILABLE",
                "referral_id": ref_id,
                "required_specialty": routing_res.get("required_specialty"),
                "target_hospital_id": target_hosp,
                "message": routing_res.get("error_message"),
                "recommended_hospitals": routing_res.get("recommended_hospitals", []),
                "referral": ref_dict
            }
        )

    # Specialist is available! Assign to doctor
    ref_dict["status"] = "pending"
    ref_dict["assigned_specialty"] = routing_res.get("required_specialty")
    ref_dict["assigned_doctor_id"] = routing_res.get("assigned_doctor_id")
    ref_dict["assigned_doctor_name"] = routing_res.get("assigned_doctor_name")
    
    res = await db.referrals.insert_one(ref_dict)
    ref_id = str(res.inserted_id)
    ref_dict["id"] = ref_id

    # Send notification ONLY to target assigned doctor
    await send_referral_assigned_notification(
        db=db,
        referral_id=ref_id,
        patient_id=patient_id_str,
        assigned_doctor_id=routing_res.get("assigned_doctor_id"),
        target_hospital_id=target_hosp,
        specialty=routing_res.get("required_specialty"),
        status="pending"
    )

    # BRIDGE TO CLINICIAN QUEUE
    await db.visits.insert_one({
        "patient_id": patient_id_str,
        "hospital_id": target_hosp,
        "hospital_name": target_hosp,
        "date": datetime.utcnow(),
        "created_at": datetime.utcnow(),
        "chief_complaint": ref.notes or ref.ai_summary or "Referred for clinical assessment",
        "status": "in_queue",
        "appointment_type": "referred",
        "source_type": "ASHA_REFERRAL",
        "doctor_name": routing_res.get("assigned_doctor_name"),
        "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
        "doctor_id": routing_res.get("assigned_doctor_id"),
        "required_specialty": routing_res.get("required_specialty"),
        "risk_tag": "urgent" if ref.urgency == "Today" else "watch",
        "referred_by": current_user.name,
        "referral_id": ref_id,
        "diagnosis": [],
        "prescriptions": []
    })
    
    if "_id" in ref_dict:
        ref_dict.pop("_id")
        
    return ref_dict

@router.post("/referrals/{referral_id}/change-destination")
async def change_referral_destination(
    referral_id: str,
    payload: dict,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Re-routes an unassigned or existing referral to a new target hospital selected from recommended options.
    """
    db = get_database()
    new_hospital = payload.get("new_hospital_id") or payload.get("to_hospital_id") or payload.get("target_hospital")
    if not new_hospital:
        raise HTTPException(status_code=400, detail="New target hospital is required.")
        
    ref_obj = safe_object_id_silent(referral_id)
    query_conds = [{"id": referral_id}]
    if ref_obj:
        query_conds.append({"_id": ref_obj})
    
    ref = await db.referrals.find_one({"$or": query_conds})
    if not ref:
        raise HTTPException(status_code=404, detail="Referral not found.")
        
    specialty = ref.get("required_specialty") or ref.get("assigned_specialty") or ref.get("urgency_specialty") or "General Medicine"
    symptoms = ref.get("notes") or ref.get("ai_summary") or "Clinical referral assessment"
    
    routing_res = await assign_referral_to_specialist(db, symptoms, new_hospital, override_specialty=specialty)
    
    if not routing_res.get("success"):
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=200,
            content={
                "status": "SPECIALIST_UNAVAILABLE",
                "referral_id": referral_id,
                "required_specialty": specialty,
                "target_hospital_id": new_hospital,
                "message": routing_res.get("error_message"),
                "recommended_hospitals": routing_res.get("recommended_hospitals", [])
            }
        )
        
    update_fields = {
        "to_hospital_id": new_hospital,
        "status": "pending",
        "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
        "assigned_doctor_name": routing_res.get("assigned_doctor_name"),
        "assigned_specialty": routing_res.get("required_specialty"),
        "updated_at": datetime.utcnow()
    }
    
    await db.referrals.update_one({"_id": ref["_id"]}, {"$set": update_fields})
    
    # Notify new target doctor ONLY
    await send_referral_assigned_notification(
        db=db,
        referral_id=str(ref["_id"]),
        patient_id=ref["patient_id"],
        assigned_doctor_id=routing_res.get("assigned_doctor_id"),
        target_hospital_id=new_hospital,
        specialty=routing_res.get("required_specialty"),
        status="pending"
    )
    
    # Clear old queue visit and add new queue visit for the assigned doctor
    await db.visits.delete_many({"referral_id": str(ref["_id"])})
    await db.visits.insert_one({
        "patient_id": ref["patient_id"],
        "hospital_id": new_hospital,
        "hospital_name": new_hospital,
        "date": datetime.utcnow(),
        "created_at": datetime.utcnow(),
        "chief_complaint": ref.get("notes") or ref.get("ai_summary") or "Referred for clinical assessment",
        "status": "in_queue",
        "appointment_type": "referred",
        "source_type": ref.get("source_type", "ASHA_REFERRAL"),
        "doctor_name": routing_res.get("assigned_doctor_name"),
        "assigned_doctor_id": routing_res.get("assigned_doctor_id"),
        "doctor_id": routing_res.get("assigned_doctor_id"),
        "required_specialty": routing_res.get("required_specialty"),
        "risk_tag": "urgent" if ref.get("urgency") == "Today" else "watch",
        "referred_by": ref.get("from_worker_name") or current_user.name,
        "referral_id": str(ref["_id"]),
        "diagnosis": [],
        "prescriptions": []
    })
    
    return {
        "status": "success",
        "message": f"Referral successfully routed to {new_hospital}.",
        "assigned_doctor_name": routing_res.get("assigned_doctor_name"),
        "target_hospital": new_hospital,
        "assigned_doctor_id": routing_res.get("assigned_doctor_id")
    }
        
@router.get("/patients/{patient_id}")
async def get_asha_safe_patient(patient_id: str, current_user: UserResponse = Depends(get_current_user)):
    """
    Returns an ASHA-safe patient/community care response.
    Contains only community observations, symptoms, vitals, visit history, and referral status.
    Excludes full doctor clinical notes, prescriptions, and lab reports.
    """
    db = get_database()
    p_obj_id = safe_object_id_silent(patient_id)
    query_conds = []
    if p_obj_id:
        query_conds.append({"_id": p_obj_id})
    query_conds.append({"user_id": patient_id})
    query_conds.append({"id": patient_id})
    
    patient = await db.patients.find_one({"$or": query_conds})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    p_id_str = str(patient["_id"])
    
    # Scope Check: ASHA can only access patients in their village or assigned household or created by them
    u_village = (current_user.village or "").strip().lower()
    p_village = (patient.get("village") or "").strip().lower()
    is_same_village = bool(u_village and p_village and u_village == p_village)
    is_creator = patient.get("registered_by_asha_id") == current_user.id
    
    has_household = False
    if patient.get("household_id"):
        hh = await db.households.find_one({"_id": safe_object_id_silent(patient["household_id"])})
        if hh:
            is_hh_creator = hh.get("created_by") == current_user.id
            h_village = (hh.get("village") or "").strip().lower()
            has_household = is_hh_creator or bool(u_village and h_village and u_village == h_village)

    has_visit = bool(await db.asha_visits.find_one({"$or": [{"member_id": p_id_str}, {"patient_id": p_id_str}], "asha_id": current_user.id}))
    has_ref = bool(await db.referrals.find_one({"patient_id": p_id_str, "asha_id": current_user.id}))

    if not (is_same_village or is_creator or has_household or has_visit or has_ref) and current_user.role not in ["admin", "pho"]:
        raise HTTPException(status_code=403, detail="You don't have permission to access this patient.")

    # ASHA Visit History
    visits_cursor = db.asha_visits.find({"$or": [{"member_id": p_id_str}, {"patient_id": p_id_str}]}).sort("created_at", -1)
    asha_visits = await visits_cursor.to_list(50)
    formatted_visits = []
    for v in asha_visits:
        v["id"] = str(v.pop("_id"))
        formatted_visits.append(v)
        
    # ASHA Referral History
    refs_cursor = db.referrals.find({"patient_id": p_id_str}).sort("created_at", -1)
    refs = await refs_cursor.to_list(50)
    formatted_refs = []
    for r in refs:
        formatted_refs.append({
            "id": str(r["_id"]),
            "to_hospital": r.get("to_hospital_id", "General Hospital"),
            "specialty": r.get("assigned_specialty") or r.get("to_speciality", "General Medicine"),
            "status": r.get("status", "pending"),
            "urgency": r.get("urgency", "routine"),
            "created_at": r.get("created_at").isoformat() if hasattr(r.get("created_at"), "isoformat") else str(r.get("created_at"))
        })

    latest_visit = formatted_visits[0] if formatted_visits else {}

    return {
        "patient_id": p_id_str,
        "name": patient.get("name", "Unknown Patient"),
        "age": patient.get("age", 30),
        "gender": patient.get("gender", "unknown"),
        "phone": patient.get("phone") or patient.get("mobile", ""),
        "village": patient.get("village", current_user.village or ""),
        "district": patient.get("district", current_user.district or ""),
        "household_id": patient.get("household_id", ""),
        "latest_symptoms": latest_visit.get("observations") or latest_visit.get("notes"),
        "latest_vitals": latest_visit.get("vitals"),
        "risk_level": latest_visit.get("risk_level", "green"),
        "asha_visits": formatted_visits,
        "referrals": formatted_refs
    }

class ASHAFollowUpCreate(BaseModel):
    patient_contacted: bool = True
    attended_referral: bool = True
    follow_up_observation: str
    new_symptoms_reported: Optional[str] = None
    action_required: Optional[str] = "Routine follow-up"

def get_display_status(status_str: str) -> str:
    st = (status_str or "pending").lower()
    if st in ["pending", "created", "routing"]:
        return "Referral Pending"
    if st in ["assigned"]:
        return "Specialist Assigned"
    if st in ["accepted"]:
        return "Accepted"
    if st in ["scheduled", "appointment_scheduled"]:
        return "Appointment Scheduled"
    if st in ["checked_in", "in_queue"]:
        return "Patient Checked In"
    if st in ["in_consultation"]:
        return "In Consultation"
    if st in ["completed", "resulted"]:
        return "Consultation Completed"
    if st in ["rejected"]:
        return "Referral Rejected"
    if st in ["cancelled"]:
        return "Referral Cancelled"
    return "Referral Active"

def build_asha_referral_timeline(ref: dict) -> list:
    st = (ref.get("status") or "pending").lower()
    created_at = ref.get("created_at")
    created_str = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at or "")
    
    steps = [
        {"title": "Referral Created", "done": True, "detail": "Referral initiated by ASHA worker", "date": created_str}
    ]
    
    doc_name = ref.get("assigned_doctor_name")
    is_assigned = bool(doc_name) or st in ["assigned", "accepted", "scheduled", "checked_in", "in_queue", "in_consultation", "completed"]
    steps.append({
        "title": "Specialist Assigned",
        "done": is_assigned,
        "detail": f"Assigned to Dr. {doc_name}" if doc_name else "Waiting for specialist assignment"
    })
    
    is_scheduled = st in ["accepted", "scheduled", "appointment_scheduled", "checked_in", "in_queue", "in_consultation", "completed"]
    steps.append({
        "title": "Appointment / Accepted",
        "done": is_scheduled,
        "detail": "Accepted by hospital specialist" if is_scheduled else "Awaiting hospital confirmation"
    })
    
    is_checked_in = st in ["checked_in", "in_queue", "in_consultation", "completed"]
    steps.append({
        "title": "Patient Checked In",
        "done": is_checked_in,
        "detail": "Patient checked in at hospital OPD" if is_checked_in else "Awaiting patient arrival"
    })
    
    is_completed = st in ["completed", "resulted"]
    steps.append({
        "title": "Consultation Completed",
        "done": is_completed,
        "detail": "Consultation completed. Community follow-up ready." if is_completed else "Consultation pending"
    })
    
    return steps

@router.get("/referrals")
async def get_referrals(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    u_village = (current_user.village or "").strip()
    
    query_conds = [{"asha_id": current_user.id}, {"from_worker_id": current_user.id}]
    if u_village:
        query_conds.append({"source_village_id": u_village})
        
    cursor = db.referrals.find({"$or": query_conds}).sort("created_at", -1)
    referrals = await cursor.to_list(length=100)
    
    results = []
    for r in referrals:
        r["id"] = str(r.pop("_id"))
        
        patient_name = "Unknown Patient"
        try:
            if r.get("patient_id"):
                pid = str(r["patient_id"])
                p_obj = safe_object_id_silent(pid)
                p_doc = None
                if p_obj:
                    p_doc = await db.patients.find_one({"_id": p_obj})
                if not p_doc:
                    p_doc = await db.patients.find_one({"user_id": pid})
                if p_doc:
                    patient_name = p_doc.get("name", "Unknown Patient")
        except Exception:
            patient_name = "Unknown Patient"
        
        r["patient_name"] = patient_name
        r["referred_to"] = r.get("to_hospital_id", "General Hospital")
        r["display_status"] = get_display_status(r.get("status"))
        r["timeline"] = build_asha_referral_timeline(r)
        
        created_at = r.get("created_at", datetime.utcnow())
        if hasattr(created_at, "strftime"):
            r["sent_date"] = created_at.strftime("%d %b, %H:%M")
        else:
            r["sent_date"] = str(created_at)
            
        results.append(r)
        
    return results

@router.get("/referrals/{referral_id}")
async def get_asha_referral_detail(referral_id: str, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    ref_obj = safe_object_id_silent(referral_id)
    query_conds = []
    if ref_obj:
        query_conds.append({"_id": ref_obj})
    query_conds.append({"id": referral_id})
    
    ref = await db.referrals.find_one({"$or": query_conds})
    if not ref:
        raise HTTPException(status_code=404, detail="Referral record not found.")

    is_owner = ref.get("asha_id") == current_user.id or ref.get("from_worker_id") == current_user.id
    u_village = (current_user.village or "").strip().lower()
    r_village = (ref.get("source_village_id") or "").strip().lower()
    is_same_village = bool(u_village and r_village and u_village == r_village)

    if not (is_owner or is_same_village) and current_user.role not in ["admin", "pho"]:
        raise HTTPException(status_code=403, detail="You don't have permission to access this referral.")

    patient_name = "Unknown Patient"
    if ref.get("patient_id"):
        pid = str(ref["patient_id"])
        p_obj = safe_object_id_silent(pid)
        p_doc = None
        if p_obj:
            p_doc = await db.patients.find_one({"_id": p_obj})
        if not p_doc:
            p_doc = await db.patients.find_one({"user_id": pid})
        if p_doc:
            patient_name = p_doc.get("name", "Unknown Patient")

    followups_cursor = db.asha_followups.find({"referral_id": str(ref["_id"])}).sort("created_at", -1)
    followups_list = await followups_cursor.to_list(50)
    for fu in followups_list:
        fu["id"] = str(fu.pop("_id"))

    timeline = build_asha_referral_timeline(ref)

    return {
        "id": str(ref["_id"]),
        "referral_id": str(ref["_id"]),
        "patient_id": ref.get("patient_id"),
        "patient_name": patient_name,
        "to_hospital_id": ref.get("to_hospital_id", "General Hospital"),
        "specialty": ref.get("assigned_specialty") or ref.get("to_speciality", "General Medicine"),
        "assigned_doctor_name": ref.get("assigned_doctor_name") or "Specialist Assigned",
        "urgency": ref.get("urgency", "routine"),
        "reason": ref.get("reason") or ref.get("referral_reason") or "Clinical assessment requested",
        "observations": ref.get("symptoms") or ref.get("observations") or ref.get("ai_summary") or "",
        "status": ref.get("status", "pending"),
        "display_status": get_display_status(ref.get("status")),
        "created_at": ref.get("created_at").isoformat() if hasattr(ref.get("created_at"), "isoformat") else str(ref.get("created_at")),
        "timeline": timeline,
        "follow_ups": followups_list
    }

@router.post("/referrals/{referral_id}/follow-up")
async def record_asha_follow_up(
    referral_id: str,
    body: ASHAFollowUpCreate,
    current_user: UserResponse = Depends(get_current_user)
):
    db = get_database()
    ref_obj = safe_object_id_silent(referral_id)
    query_conds = []
    if ref_obj:
        query_conds.append({"_id": ref_obj})
    query_conds.append({"id": referral_id})
    
    ref = await db.referrals.find_one({"$or": query_conds})
    if not ref:
        raise HTTPException(status_code=404, detail="Referral record not found.")
        
    is_owner = ref.get("asha_id") == current_user.id or ref.get("from_worker_id") == current_user.id
    u_village = (current_user.village or "").strip().lower()
    r_village = (ref.get("source_village_id") or "").strip().lower()
    is_same_village = bool(u_village and r_village and u_village == r_village)

    if not (is_owner or is_same_village) and current_user.role not in ["admin", "pho"]:
        raise HTTPException(status_code=403, detail="You don't have permission to access this referral.")

    patient_id = ref.get("patient_id")
    followup_doc = {
        "referral_id": str(ref["_id"]),
        "patient_id": patient_id,
        "asha_id": current_user.id,
        "asha_name": current_user.name,
        "patient_contacted": body.patient_contacted,
        "attended_referral": body.attended_referral,
        "follow_up_observation": body.follow_up_observation,
        "new_symptoms_reported": body.new_symptoms_reported,
        "action_required": body.action_required,
        "created_at": datetime.utcnow()
    }
    
    res = await db.asha_followups.insert_one(followup_doc)
    followup_doc["id"] = str(res.inserted_id)
    if "_id" in followup_doc: followup_doc.pop("_id")
    
    await db.referrals.update_one(
        {"_id": ref["_id"]},
        {"$set": {
            "follow_up_status": "Follow-Up Recorded",
            "last_follow_up_date": datetime.utcnow()
        }}
    )
    
    return {
        "status": "success",
        "message": "Follow-up observation recorded successfully.",
        "follow_up": followup_doc
    }

@router.get("/my-stats")
async def get_stats(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    asha_id = current_user.id
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_households = await db.households.count_documents({"created_by": asha_id})
    visits_this_month = await db.asha_visits.count_documents({
        "asha_id": asha_id,
        "created_at": {"$gte": month_start}
    })
    referrals_sent = await db.referrals.count_documents({
        "asha_id": asha_id,
        "created_at": {"$gte": month_start}
    })
    urgent_cases = await db.asha_visits.count_documents({
        "asha_id": asha_id,
        "created_at": {"$gte": month_start},
        "risk_level": {"$in": ["URGENT", "urgent", "red"]}
    })
    total_referrals = await db.referrals.count_documents({"asha_id": asha_id})
    seen_referrals = await db.referrals.count_documents({"asha_id": asha_id, "status": "seen"})
    referrals_seen_pct = round((seen_referrals / total_referrals * 100), 1) if total_referrals > 0 else 0.0

    # Households that haven't been visited in the last 14 days
    two_weeks_ago = now - timedelta(days=14)
    needs_visit = await db.households.count_documents({
        "created_by": asha_id,
        "$or": [
            {"last_visit_date": {"$lt": two_weeks_ago}},
            {"last_visit_date": {"$exists": False}}
        ]
    })

    return {
        "total_households": total_households,
        "visits_this_month": visits_this_month,
        "referrals_sent_this_month": referrals_sent,
        "urgent_cases_detected": urgent_cases,
        "referrals_seen_percentage": referrals_seen_pct,
        "households_needs_visit": needs_visit
    }

@router.get("/nearby-facilities")
async def get_nearby_facilities(lat: float = None, lng: float = None, radius_km: float = 10.0, current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    hospitals = await db.hospitals.find({}).to_list(length=100)
    
    results = []
    for h in hospitals:
        results.append({
            "id": h["name"],
            "name": h["name"],
            "type": h.get("type", "General Hospital"),
            "distance": None,
            "address": h.get("district", ""),
            "phone": h.get("phone", "")
        })
    return results
@router.post("/transcribe")
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Endpoint for ASHA workers to upload audio recordings of field visits.
    Supports both Web (MediaRecorder .webm/.wav) and Mobile (.m4a/.aac).
    """
    rate_limit_key = f"transcribe:{current_user.id}"
    if not check_rate_limit(rate_limit_key, limit=10, window=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
        
    client_type = request.headers.get("x-client-type", "web")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if not ext or ext == ".blob":
        if file.content_type and "webm" in file.content_type:
            ext = ".webm"
        elif file.content_type and "mp4" in file.content_type:
            ext = ".mp4"
        elif file.content_type and "wav" in file.content_type:
            ext = ".wav"
        elif file.content_type and "ogg" in file.content_type:
            ext = ".ogg"
        else:
            ext = ".m4a"

    if file.content_type and ("image" in file.content_type or "text" in file.content_type):
        raise HTTPException(status_code=400, detail="Invalid audio file format")

    temp_dir = tempfile.gettempdir()
    temp_filename = f"asha_voice_{uuid.uuid4().hex}{ext}"
    temp_path = os.path.join(temp_dir, temp_filename)
    
    t_start = time.perf_counter()
    try:
        t_upload_start = time.perf_counter()
        MAX_FILE_SIZE = 10 * 1024 * 1024
        file_size = 0
        with open(temp_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="File too large. Max allowed size is 10MB.")
                buffer.write(chunk)
        t_upload_end = time.perf_counter()
                
        t_stt_start = time.perf_counter()
        text = await transcription_service.transcribe(temp_path, client_type=client_type, mime_type=file.content_type)
        t_stt_end = time.perf_counter()

        upload_ms = (t_upload_end - t_upload_start) * 1000
        stt_ms = (t_stt_end - t_stt_start) * 1000
        total_ms = (time.perf_counter() - t_start) * 1000

        print(f"""
[DEV TIMING LOG - ASHA TRANSCRIBE ENDPOINT] Client: {client_type} | File Size: {file_size}B
├─ 1. Upload & Temp Save    : {upload_ms:.2f} ms
├─ 2. ffmpeg & Whisper STT  : {stt_ms:.2f} ms
└─ TOTAL REQUEST DURATION   : {total_ms:.2f} ms
""")

        return {
            "status": "success",
            "transcript": text,
            "transcription": text
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [ASHA TRANSCRIBE ERROR] user={current_user.id} err={e}")
        raise HTTPException(status_code=500, detail="Audio transcription could not be completed.")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@router.post("/sync")
async def sync_data(
    payload: dict,
    user: UserResponse = Depends(get_current_user)
):
    """
    Batch endpoint to sync offline data.
    Receives lists of households and visits.
    """
    asha_id = str(user.id)
    
    db = get_database()
    if db is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Database unavailable. Check MongoDB connection."}
        )
        
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload structure")
        
    households = payload.get("households", [])
    visits = payload.get("visits", [])
    
    if not isinstance(households, list) or not isinstance(visits, list):
        raise HTTPException(status_code=400, detail="Invalid payload structure")
    
    results = {"households": 0, "visits": 0}
    
    # Sync Households
    for hh in households:
        if not isinstance(hh, dict):
            continue
        hh_id = hh.get('id', '')
        
        if hh_id and len(hh_id) == 24:
            try:
                object_id = ObjectId(hh_id)
            except Exception:
                raise HTTPException(status_code=400, detail=f"Invalid household ID format: {hh_id}")
                
            # Ownership check on existing household
            existing_hh = await db.households.find_one({"_id": object_id})
            if existing_hh:
                if existing_hh.get("created_by") != asha_id:
                    raise HTTPException(
                        status_code=403,
                        detail=f"Access denied: Household {hh_id} does not belong to your scope"
                    )
        else:
            object_id = ObjectId()
            
        await db.households.update_one(
            {"_id": object_id},
            {"$set": {
                "family_name": hh.get('name', hh.get('family_name')),
                "name": hh.get('name'),
                "asha_id": asha_id,
                "created_by": asha_id,
                "risk_level": hh.get('risk_level', 'green'),
                "last_visit_date": hh.get('last_visit_date'),
                "village": hh.get('village', ''),
                "sync_status": "synced"
            }},
            upsert=True
        )
        results["households"] += 1

        # Sync members' visits
        for member in hh.get('members', []):
            if not isinstance(member, dict):
                continue
            for visit in member.get('visits', []):
                if not isinstance(visit, dict):
                    continue
                visit_doc = {
                    "household_id": str(object_id),
                    "asha_id": asha_id,
                    "member_name": member.get('name'),
                    "visit_type": visit.get('visit_type', 'general'),
                    "risk_level": visit.get('risk_level', 'green'),
                    "observations": visit.get('observations_json', {}),
                    "ai_reasoning": visit.get('ai_reasoning', ''),
                    "ai_recommendation": visit.get('ai_recommendation', ''),
                    "voice_notes": visit.get('voice_notes', ''),
                    "created_at": visit.get('created_at', datetime.utcnow().isoformat()),
                    "synced": True
                }
                await db.asha_visits.insert_one(visit_doc)
                results["visits"] += 1

    # Also sync top-level visits array (if sent separately)
    for v in visits:
        if not isinstance(v, dict):
            continue
            
        v_hh_id = v.get("household_id")
        if not v_hh_id:
            raise HTTPException(status_code=400, detail="Household ID is required for synced visits")
            
        try:
            v_hh_obj_id = ObjectId(v_hh_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid household ID in visit")
            
        # Scope check: referenced household must belong to this ASHA worker
        hh_check = await db.households.find_one({"_id": v_hh_obj_id})
        if not hh_check or hh_check.get("created_by") != asha_id:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: Household {v_hh_id} for visit does not belong to your scope"
            )
            
        v["asha_id"] = asha_id
        if "created_at" not in v:
            v["created_at"] = datetime.utcnow()
        await db.asha_visits.insert_one(v)
        results["visits"] += 1
        
    return {"status": "success", "synced_count": results}

# --- ASHA NOTIFICATIONS ---

@router.get("/notifications")
async def get_notifications(current_user: UserResponse = Depends(get_current_user)):
    """
    Returns all notifications for this ASHA worker (patient symptom alerts from their village).
    """
    db = get_database()
    cursor = db.notifications.find(
        {"asha_id": str(current_user.id)}
    ).sort("created_at", -1).limit(50)
    notifications = await cursor.to_list(50)

    result = []
    for n in notifications:
        n["id"] = str(n.pop("_id"))
        if "created_at" in n:
            n["created_at"] = n["created_at"].isoformat()
        result.append(n)

    return result

@router.patch("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, current_user: UserResponse = Depends(get_current_user)):
    """
    Marks a specific notification as read.
    """
    db = get_database()
    await db.notifications.update_one(
        {"_id": safe_object_id(notif_id), "asha_id": str(current_user.id)},
        {"$set": {"read": True, "read_at": datetime.utcnow()}}
    )
    return {"status": "ok"}

@router.patch("/notifications/read-all")
async def mark_all_notifications_read(current_user: UserResponse = Depends(get_current_user)):
    """
    Marks all notifications for this ASHA worker as read.
    """
    db = get_database()
    await db.notifications.update_many(
        {"asha_id": str(current_user.id), "read": False},
        {"$set": {"read": True, "read_at": datetime.utcnow()}}
    )
    return {"status": "ok"}
