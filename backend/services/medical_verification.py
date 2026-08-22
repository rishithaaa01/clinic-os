from enum import Enum
from typing import Dict, Any, Optional

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

class MedicalCredentialVerificationService:
    """
    Abstract Service for verifying doctor medical credentials.
    Supports DEMO/SANDBOX mode for testing and PRODUCTION mode for manual/official provider verification.
    """
    def __init__(self, mode: str = "DEMO"):
        self.mode = mode

    async def verify_credentials(
        self,
        medical_registration_number: str,
        medical_council: str,
        name: str,
        qualification: Optional[str] = None,
        specialty: Optional[str] = None
    ) -> Dict[str, Any]:
        reg_num = (medical_registration_number or "").strip().upper()
        council = (medical_council or "").strip()

        if not reg_num or not council:
            return {
                "status": VerificationStatus.FAILED,
                "verified": False,
                "message": "Medical registration number and council are required.",
                "verification_provider": "Manual Verification Checklist"
            }

        if self.mode.upper() == "DEMO":
            # Sandbox deterministic test verifier
            if reg_num.startswith("FAIL") or reg_num.startswith("INVALID"):
                return {
                    "status": VerificationStatus.FAILED,
                    "verified": False,
                    "message": "Registration number could not be verified in the medical council database.",
                    "verification_provider": "Sandbox Verifier (Demo Mode)"
                }
            elif reg_num.startswith("MANUAL"):
                return {
                    "status": VerificationStatus.PENDING,
                    "verified": False,
                    "message": "Registration requires manual verification by hospital compliance officer.",
                    "verification_provider": "Manual Verification Queue"
                }
            else:
                return {
                    "status": VerificationStatus.VERIFIED,
                    "verified": True,
                    "message": f"Medical registration number '{reg_num}' verified with {council}.",
                    "verification_provider": "Sandbox Verifier (Demo Mode)"
                }
        else:
            # Production Mode: Default to manual queue until official API is connected
            return {
                "status": VerificationStatus.PENDING,
                "verified": False,
                "message": "Credentials submitted for manual verification by medical council compliance.",
                "verification_provider": "Manual Credential Verification Queue"
            }

verification_service = MedicalCredentialVerificationService(mode="DEMO")
