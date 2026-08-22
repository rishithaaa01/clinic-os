from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class MemberCreate(BaseModel):
    name: str
    age: Optional[int] = 30
    gender: Optional[str] = "male"
    relation: Optional[str] = "Member"
    patient_id: Optional[str] = None

class HouseholdCreate(BaseModel):
    family_name: str
    head_name: Optional[str] = None
    contact_phone: Optional[str] = None
    village: Optional[str] = "Rural Village"
    block: Optional[str] = "Local Block"
    district: Optional[str] = "Rural District"
    members: Optional[List[MemberCreate]] = []

class VisitCreate(BaseModel):
    household_id: str
    member_id: str
    visit_type: Optional[str] = "Home Visit Screening"
    observations: Optional[Dict[str, Any]] = {}
    voice_notes: Optional[str] = None
    risk_level: Optional[str] = "WATCH"
    ai_reasoning: Optional[str] = "Screened by ASHA worker with vitals"
    ai_recommendation: Optional[str] = "Follow up as appropriate"

class RiskClassifyRequest(BaseModel):
    observations: Any = {}
    visit_type: str = "general"
    member_age: Any = 0
    member_gender: str = "unknown"
    member_name: Optional[str] = None
    transcript: Optional[str] = None

class RiskClassifyResponse(BaseModel):
    risk_level: str
    reasoning: str
    recommendation: str
    refer_to_doctor: bool
    predicted_disease: Optional[str] = "General Assessment"
    confidence: Optional[float] = 0.85
    recommended_specialty: Optional[str] = "General Medicine"

class ReferralCreate(BaseModel):
    patient_id: Optional[str] = "unknown"
    household_id: str
    to_hospital_id: str
    visit_id: Optional[str] = "unknown"
    urgency: str
    from_worker_name: Optional[str] = None
    asha_observations: Optional[Dict[str, Any]] = None
    ai_summary: Optional[str] = "Urgent referral from ASHA worker"
    notes: Optional[str] = None
