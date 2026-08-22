from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, time

class TimeSlot(BaseModel):
    day_of_week: str  # Monday, Tuesday, etc.
    start_time: str   # "09:00"
    end_time: str     # "10:00"
    is_available: bool = True

class DoctorAvailability(BaseModel):
    doctor_id: str
    slots: List[TimeSlot]

class SymptomAnalysisRequest(BaseModel):
    symptoms: str
    duration: Optional[str] = None
    severity: Optional[str] = None
    medical_history: Optional[str] = None

class SymptomAnalysisResponse(BaseModel):
    analysis: str
    recommended_specialities: List[str]
    urgency_level: str  # low, medium, high
    recommended_doctors: List[dict]

class AppointmentRequest(BaseModel):
    doctor_id: str
    hospital_id: str
    requested_date: str  # ISO date string
    requested_time_slot: str  # "09:00-10:00"
    symptoms: str
    reason: str
    urgency: Optional[str] = "routine"

from enum import Enum

class AppointmentStatus(str, Enum):
    REQUESTED = "REQUESTED"
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    CONFIRMED = "CONFIRMED"
    ARRIVAL_NOTIFIED = "ARRIVAL_NOTIFIED"
    CHECKED_IN = "CHECKED_IN"
    WAITING = "WAITING"
    IN_CONSULTATION = "IN_CONSULTATION"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    NO_SHOW = "NO_SHOW"
    BOOKED = "BOOKED"

class SourceType(str, Enum):
    DIRECT_APPOINTMENT = "DIRECT_APPOINTMENT"
    WALK_IN = "WALK_IN"
    ASHA_REFERRAL = "ASHA_REFERRAL"
    DOCTOR_REFERRAL = "DOCTOR_REFERRAL"
    AUTO_REFERRAL = "AUTO_REFERRAL"
    SELF_REFERRAL = "SELF_REFERRAL"

class DirectBookingRequest(BaseModel):
    hospital_name: str
    specialty: Optional[str] = "General Medicine"
    doctor_id: Optional[str] = None
    appointment_date: str
    time_slot: str
    chief_complaint: Optional[str] = "Routine OPD Consultation"
    source_type: Optional[SourceType] = SourceType.DIRECT_APPOINTMENT
    symptom_assessment_id: Optional[str] = None

class AppointmentResponse(BaseModel):
    id: str
    patient_id: str
    patient_name: str
    doctor_id: Optional[str] = None
    doctor_name: Optional[str] = "Duty Doctor"
    hospital_name: str
    requested_date: str
    requested_time_slot: str
    specialty: Optional[str] = "General Medicine"
    symptoms: Optional[str] = ""
    reason: Optional[str] = ""
    source_type: str = "DIRECT_APPOINTMENT"
    status: str
    created_at: datetime
    response_message: Optional[str] = None
    responded_at: Optional[datetime] = None

    class Config:
        populate_by_name = True

class AppointmentAction(BaseModel):
    appointment_id: Optional[str] = None
    action: Optional[str] = "accept"
    message: Optional[str] = None
    reason: Optional[str] = None
    status: Optional[str] = None

class NormalizedQueueEntry(BaseModel):
    patient_id: str
    patient_name: str
    age: int
    gender: str
    chief_complaint: str
    source_type: str  # DIRECT_APPOINTMENT, WALK_IN, ASHA_REFERRAL, DOCTOR_REFERRAL
    appointment_id: Optional[str] = None
    referral_id: Optional[str] = None
    encounter_id: Optional[str] = None
    doctor_id: Optional[str] = None
    doctor_name: Optional[str] = None
    hospital_id: Optional[str] = None
    hospital_name: Optional[str] = None
    specialty: str = "General Medicine"
    scheduled_time: Optional[str] = None
    wait_time: int = 0  # in minutes
    risk_tag: str = "low"  # urgent, watch, low
    status: str  # CHECKED_IN, WAITING, IN_CONSULTATION, COMPLETED
    created_at: datetime

class DoctorScheduleCreate(BaseModel):
    doctor_id: str
    hospital_name: str
    working_days: Optional[List[str]] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    start_time: Optional[str] = "09:00 AM"
    end_time: Optional[str] = "05:00 PM"
    slot_duration: Optional[int] = 30  # minutes
    appointment_capacity: Optional[int] = 1
    blocked_dates: Optional[List[str]] = []
    is_active: Optional[bool] = True

class WalkInRegistrationRequest(BaseModel):
    name: str
    mobile: str
    gender: Optional[str] = "other"
    age: Optional[int] = 30
    hospital_name: str
    specialty: Optional[str] = "General Medicine"
    doctor_id: Optional[str] = None
    chief_complaint: Optional[str] = "Walk-in OPD Consultation"
    time_slot: Optional[str] = "09:00 AM"

    class Config:
        populate_by_name = True
