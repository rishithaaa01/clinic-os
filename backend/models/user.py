from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    patient = "patient"
    asha = "asha"
    doctor = "doctor"
    admin = "admin"
    pho = "pho"
    lab = "lab"
    receptionist = "receptionist"

class VerificationStatus(str, Enum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    FAILED = "FAILED"
    REJECTED = "REJECTED"

class HospitalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"

class AccountStatus(str, Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"

class UserCreate(BaseModel):
    name: str
    mobile: str
    role: UserRole
    language: str = "en"
    district: Optional[str] = None
    medical_registration_number: Optional[str] = None
    medical_council: Optional[str] = None
    qualification: Optional[str] = None

class UserResponse(BaseModel):
    id: str
    name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    role: Optional[UserRole] = None
    language: str = "en"
    district: Optional[str] = None
    hospital: Optional[str] = None
    village: Optional[str] = None
    speciality: Optional[str] = None
    medical_registration_number: Optional[str] = None
    medical_council: Optional[str] = None
    qualification: Optional[str] = None
    verification_status: str = "VERIFIED"
    hospital_status: str = "APPROVED"
    account_status: str = "ACTIVE"
    requested_hospital_id: Optional[str] = None
    approved_hospital_id: Optional[str] = None
    rejection_reason: Optional[str] = None
    is_profile_complete: bool = False
    created_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True, extra="ignore")

class ProfileCompleteRequest(BaseModel):
    name: str
    role: UserRole
    language: Optional[str] = "en"
    hospital: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    speciality: Optional[str] = None
    medical_registration_number: Optional[str] = None
    medical_council: Optional[str] = None
    qualification: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse
