from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from config import settings
from models.user import UserResponse
from database import get_database
from jose import jwt, JWTError
from bson import ObjectId

security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)

async def get_optional_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional)) -> Optional[UserResponse]:
    if not credentials or not credentials.credentials:
        return None
    try:
        return await get_current_user(credentials)
    except Exception:
        return None

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UserResponse:
    """
    Reads Authorization header, extracts JWT token,
    decodes and validates it, returns the user object.
    Raises 401 if missing or invalid.
    """
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id: str = payload.get("sub")
        jti: str = payload.get("jti")
        token_type: str = payload.get("type")
        if user_id is None or token_type != "access":
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    db = get_database()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection is unavailable. Check your Wi-Fi or use a Mobile Hotspot.",
        )
        
    if jti:
        denied = await db.denied_tokens.find_one({"jti": jti})
        if denied:
            raise credentials_exception

    try:
        user_dict = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception as e:
        raise credentials_exception

    if user_dict is None:
        raise credentials_exception
        
    # Map MongoDB _id to string id
    user_dict["id"] = str(user_dict.pop("_id"))
    
    # Fallback defaults for pre-existing accounts & non-doctors
    if "verification_status" not in user_dict or not user_dict["verification_status"]:
        user_dict["verification_status"] = "VERIFIED"
    if "hospital_status" not in user_dict or not user_dict["hospital_status"]:
        user_dict["hospital_status"] = "APPROVED"
    if "account_status" not in user_dict or not user_dict["account_status"]:
        user_dict["account_status"] = "ACTIVE"
    if "approved_hospital_id" not in user_dict or not user_dict["approved_hospital_id"]:
        user_dict["approved_hospital_id"] = user_dict.get("hospital")

    # Fallback for seeded data missing created_at
    if "created_at" not in user_dict:
        from datetime import datetime
        user_dict["created_at"] = datetime.utcnow()
        
    return UserResponse(**user_dict)

def require_role(*roles: str):
    """
    Dependency that calls get_current_user(), checks if user's role is in the allowed roles list,
    and for doctors enforces full verification, hospital affiliation, and account status.
    Raises HTTP 403 if not permitted.
    """
    async def role_checker(current_user: UserResponse = Depends(get_current_user)):
        role_val = str(current_user.role.value if hasattr(current_user.role, 'value') else current_user.role).lower()
        allowed_roles = [str(r).lower() for r in roles]
        if role_val not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted. Required role: {', '.join(roles)}"
            )
        
        # 4-Tier Security Check for Doctor Role
        if role_val == "doctor":
            if (
                current_user.verification_status != "VERIFIED" or
                current_user.hospital_status != "APPROVED" or
                current_user.account_status != "ACTIVE"
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't currently have access to this clinical feature."
                )
        return current_user
    return role_checker

def require_verified_doctor():
    """Explicit dependency for verified, hospital-approved, active doctors."""
    return require_role("doctor")

