import json
import logging
from typing import Optional
from config import settings

logger = logging.getLogger(__name__)

VALID_SPECIALTIES = [
    "General Medicine",
    "Gynecology",
    "Orthopedics",
    "ENT",
    "Cardiology",
    "Pulmonology",
    "Neurology",
    "Dermatology",
    "Pediatrics",
    "Ophthalmology",
    "Gastroenterology",
    "Psychiatry",
    "Oncology",
    "Urology",
    "Endocrinology"
]

async def determine_referral_speciality(symptoms_text: str, client_type: str = "web") -> str:
    """
    Uses trained ML referral model (Model B) to analyze symptoms and determine recommended specialty.
    Standardized for both Web and Mobile clients.
    """
    if not symptoms_text or not symptoms_text.strip():
        return "General Medicine"
        
    try:
        print(f"[SPECIALTY ROUTING] Client: {client_type} | Evaluating via Local AI (Random Forest)...")
        from services.local_ai_service import local_ai
        res = local_ai.predict_referral(symptoms_text)
        spec = res.get("recommended_specialty", "General Medicine")
        print(f"[SUCCESS] Trained Referral Model recommended specialty: {spec}")
        
        # Ensure it matches valid specialties
        for valid_specialty in VALID_SPECIALTIES:
            if valid_specialty.lower() == spec.lower():
                return valid_specialty
                
        return "General Medicine"
    except Exception as e:
        logger.error(f"Error in Local AI referral prediction: {e}")
        return "General Medicine"

SPECIALTY_MAP = {
    "general medicine": "General Medicine",
    "internal medicine": "General Medicine",
    "general physician": "General Medicine",
    "general medicine / internal medicine": "General Medicine",
    "general": "General Medicine",
    "gp": "General Medicine",
    
    "gynecology": "Gynecology",
    "gynaecology": "Gynecology",
    "obstetrics": "Gynecology",
    "obstetrics & gynecology": "Gynecology",
    "ob-gyn": "Gynecology",
    "obgyn": "Gynecology",
    "gynecologist": "Gynecology",
    "gynaecologist": "Gynecology",
    "obstetrician": "Gynecology",
    
    "pediatrics": "Pediatrics",
    "paediatrics": "Pediatrics",
    "child health": "Pediatrics",
    "pediatrician": "Pediatrics",
    "paediatrician": "Pediatrics",
    
    "orthopedics": "Orthopedics",
    "orthopaedics": "Orthopedics",
    "ortho": "Orthopedics",
    "orthopedist": "Orthopedics",
    "orthopaedist": "Orthopedics",
    "orthopedic surgeon": "Orthopedics",
    
    "cardiology": "Cardiology",
    "cardiac": "Cardiology",
    "cardiologist": "Cardiology",
    
    "pulmonology": "Pulmonology",
    "chest medicine": "Pulmonology",
    "respiratory medicine": "Pulmonology",
    "pulmonologist": "Pulmonology",
    
    "neurology": "Neurology",
    "neuro": "Neurology",
    "neurologist": "Neurology",
    
    "dermatology": "Dermatology",
    "skin": "Dermatology",
    "dermatologist": "Dermatology",
    
    "ent": "ENT",
    "otorhinolaryngology": "ENT",
    "ent specialist": "ENT",
    
    "ophthalmology": "Ophthalmology",
    "eye": "Ophthalmology",
    "ophthalmologist": "Ophthalmology",
    
    "gastroenterology": "Gastroenterology",
    "gastro": "Gastroenterology",
    "gastroenterologist": "Gastroenterology",
    
    "psychiatry": "Psychiatry",
    "psychiatrist": "Psychiatry",
    
    "oncology": "Oncology",
    "oncologist": "Oncology",
    
    "urology": "Urology",
    "urologist": "Urology",
    
    "endocrinology": "Endocrinology",
    "endocrinologist": "Endocrinology"
}

def normalize_specialty(spec: str) -> str:
    if not spec:
        return "General Medicine"
    clean = spec.strip().lower()
    return SPECIALTY_MAP.get(clean, spec.strip().title())

async def find_alternative_hospitals_with_specialist(db, required_specialty: str, exclude_hospital: str = "") -> list:
    norm_req = normalize_specialty(required_specialty)
    
    docs_cursor = db.users.find({
        "role": "doctor",
        "verification_status": "VERIFIED",
        "hospital_status": "APPROVED",
        "account_status": "ACTIVE"
    })
    all_docs = await docs_cursor.to_list(500)
    
    ex_clean = (exclude_hospital or "").strip().lower()
    recommendations_by_hosp = {}
    
    for doc in all_docs:
        doc_spec = doc.get("speciality") or doc.get("specialty") or ""
        if normalize_specialty(doc_spec).lower() != norm_req.lower():
            continue
            
        hosp_name = doc.get("hospital") or doc.get("approved_hospital_id") or "General Hospital"
        if hosp_name.strip().lower() == ex_clean:
            continue
            
        if hosp_name not in recommendations_by_hosp:
            recommendations_by_hosp[hosp_name] = {
                "hospital_id": hosp_name,
                "hospital_name": hosp_name,
                "specialty": norm_req,
                "available_doctor_id": str(doc["_id"]),
                "available_doctor_name": doc.get("name", "Doctor"),
                "district": doc.get("district", "Chennai"),
                "available": True
            }
            
    return list(recommendations_by_hosp.values())

async def assign_referral_to_specialist(db, symptoms_text: str, hospital_id: str, override_specialty: str = None, client_type: str = "web") -> dict:
    """
    Determines the required specialty, finds eligible active doctors in the target hospital,
    and assigns the referral to the specific doctor with the least workload.
    
    Returns a dictionary with:
        - success: bool
        - status: str ("SUCCESS" or "SPECIALIST_UNAVAILABLE")
        - required_specialty: str
        - normalized_required_specialty: str
        - assigned_doctor_id: str (if success)
        - assigned_doctor_name: str (if success)
        - recommended_hospitals: list (if not success)
        - error_message: str (if not success)
    """
    if override_specialty:
        specialty = override_specialty
    else:
        specialty = await determine_referral_speciality(symptoms_text, client_type)
    
    norm_specialty = normalize_specialty(specialty)
    
    # Resolve hospital by name or id
    hospital_query = {"$or": [{"name": hospital_id}]}
    from bson import ObjectId
    if len(hospital_id) == 24:
        try:
            hospital_query["$or"].append({"_id": ObjectId(hospital_id)})
        except Exception:
            pass
    
    hospital = await db.hospitals.find_one(hospital_query)
    target_hospital_name = hospital.get("name", hospital_id) if hospital else hospital_id
    
    h_clean = target_hospital_name.strip()
    h_rgx = {"$regex": f"^{h_clean}$", "$options": "i"}

    # Find all active verified doctors in this hospital
    doctors_cursor = db.users.find({
        "role": "doctor",
        "verification_status": "VERIFIED",
        "hospital_status": "APPROVED",
        "account_status": "ACTIVE",
        "$or": [
            {"hospital": h_rgx},
            {"approved_hospital_id": h_rgx},
            {"requested_hospital_id": h_rgx}
        ]
    })
    hosp_doctors = await doctors_cursor.to_list(100)
    
    # Strictly filter by exact normalized specialty match
    eligible_doctors = []
    for doc in hosp_doctors:
        doc_spec = doc.get("speciality") or doc.get("specialty") or ""
        if normalize_specialty(doc_spec).lower() == norm_specialty.lower():
            eligible_doctors.append(doc)
    
    if not eligible_doctors:
        # Fallback 1: Try General Medicine doctors at target hospital
        for doc in hosp_doctors:
            doc_spec = doc.get("speciality") or doc.get("specialty") or ""
            if normalize_specialty(doc_spec).lower() == "general medicine":
                eligible_doctors.append(doc)
                
    if not eligible_doctors and hosp_doctors:
        # Fallback 2: Any available doctor at target hospital
        eligible_doctors = hosp_doctors
        
    if not eligible_doctors:
        # Fallback 3: Search all verified active doctors in system if hospital has no doctors
        all_docs = await db.users.find({
            "role": "doctor",
            "verification_status": "VERIFIED",
            "account_status": "ACTIVE"
        }).to_list(20)
        eligible_doctors = all_docs

    if not eligible_doctors:
        alternatives = await find_alternative_hospitals_with_specialist(db, norm_specialty, exclude_hospital=target_hospital_name)
        return {
            "success": False,
            "status": "SPECIALIST_UNAVAILABLE",
            "required_specialty": norm_specialty,
            "normalized_required_specialty": norm_specialty,
            "target_hospital_id": target_hospital_name,
            "target_hospital_name": target_hospital_name,
            "assigned_doctor_id": None,
            "assigned_doctor_name": None,
            "error_message": f"No doctor is currently available at {target_hospital_name}.",
            "recommended_hospitals": alternatives
        }
    
    # Assign based on least workload among eligible target specialists
    best_doctor = None
    min_workload = float('inf')
    
    for doc in eligible_doctors:
        workload = await db.visits.count_documents({
            "assigned_doctor_id": str(doc["_id"]),
            "status": "in_queue"
        })
        if workload < min_workload:
            min_workload = workload
            best_doctor = doc
            
    return {
        "success": True,
        "status": "SUCCESS",
        "required_specialty": norm_specialty,
        "normalized_required_specialty": norm_specialty,
        "assigned_doctor_id": str(best_doctor["_id"]),
        "assigned_doctor_name": best_doctor.get("name", "Doctor"),
        "target_hospital_name": target_hospital_name
    }

async def send_referral_assigned_notification(
    db,
    referral_id: str,
    patient_id: str,
    assigned_doctor_id: str,
    target_hospital_id: str,
    specialty: str,
    status: str = "pending"
):
    """
    Sends referral notification ONLY to the assigned target doctor.
    Payload references: referral_id, patient_id, assigned_doctor_id, target_hospital_id, specialty, status.
    """
    if not assigned_doctor_id or assigned_doctor_id == "unassigned":
        return
    
    try:
        notif_doc = {
            "user_id": str(assigned_doctor_id),
            "assigned_doctor_id": str(assigned_doctor_id),
            "referral_id": str(referral_id),
            "patient_id": str(patient_id),
            "target_hospital_id": target_hospital_id,
            "specialty": specialty,
            "status": status,
            "title": "New Clinical Referral Assigned",
            "message": f"New patient referral ({specialty}) assigned to your OPD queue at {target_hospital_id}.",
            "type": "REFERRAL_ASSIGNED",
            "created_at": datetime.utcnow(),
            "read": False
        }
        await db.notifications.insert_one(notif_doc)
    except Exception as e:
        print(f"[REFERRAL NOTIFICATION ERROR] {e}")
