import logging
import traceback
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

logger = logging.getLogger("ayu_disha_backend")
logger.setLevel(logging.INFO)

# Developer log handler
if not logger.handlers:
    ch = logging.StreamHandler()
    formatter = logging.Formatter('[DEVELOPER LOG] %(asctime)s - %(levelname)s - %(message)s')
    ch.setFormatter(formatter)
    logger.addHandler(ch)

def sanitize_user_message(err: Exception, status_code: int = 500) -> str:
    """
    Translates technical exceptions into clean, safe, human-readable English messages for end users.
    Ensures zero technical details (stack traces, DB errors, HTTP codes, internal paths) leak to UI.
    """
    err_str = str(err).lower()
    type_name = type(err).__name__.lower()
    
    if isinstance(err, HTTPException):
        if err.status_code == 401:
            return "Your session has expired. Please sign in again."
        elif err.status_code == 403:
            return "You do not have permission to perform this action."
        elif err.status_code == 404:
            return "The requested information could not be found."
        
        detail = str(err.detail)
        detail_lower = detail.lower()
        if any(tech in detail_lower for tech in ["objectid", "mongodb", "traceback", "pymongo", "groq", "ollama", "cloudinary", "whisper", "500"]):
            return "Advanced AI analysis is temporarily unavailable. Your information has been saved. Please try again."
        return detail

    if "serverselectiontimeouterror" in type_name or "autoreconnect" in type_name or "pymongoerror" in type_name or "serverselectiontimeouterror" in err_str:
        return "Database connection is temporarily unavailable. Please try again."
    elif status_code == 401 or "unauthorized" in err_str or "token" in err_str:
        return "Your session has expired. Please sign in again."
    elif status_code == 403 or "permission" in err_str or "access denied" in err_str:
        return "You do not have permission to access this information."
    elif status_code == 404 or "not found" in err_str:
        return "The requested information could not be found."
    elif "connection" in err_str or "econnrefused" in err_str or "network" in err_str:
        return "Unable to connect right now. Please check your internet connection and try again."
    elif "timeout" in err_str or "econnaborted" in err_str:
        return "The analysis is taking longer than expected. Please try again."
    elif any(ai in err_str for ai in ["ollama", "whisper", "model", "huggingface", "groq"]):
        return "Advanced AI analysis is temporarily unavailable. Your information has been saved. Please try again."
    elif "pdf" in err_str or "upload" in err_str or "file" in err_str:
        return "We couldn't upload the report. Please ensure it is a valid PDF under 20MB and try again."
    else:
        return "Something went wrong while processing your request. Please try again."

async def global_exception_handler(request: Request, exc: Exception):
    """
    Global FastAPI Exception Handler.
    Logs full technical stack traces for DEVELOPERS while returning sanitized messages for USERS.
    """
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    if isinstance(exc, HTTPException):
        status_code = exc.status_code
    elif type(exc).__name__ in ["ServerSelectionTimeoutError", "AutoReconnect", "PyMongoError", "NetworkTimeout"]:
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    # DEVELOPER LAYER: Detailed log with full traceback & request details
    print(f"[DEV ERROR] Path: {request.method} {request.url.path} | Status: {status_code}", flush=True)
    print(f"[DEV STACK TRACE]:\n{traceback.format_exc()}", flush=True)
    logger.error(f"[DEV ERROR] Path: {request.method} {request.url.path} | Status: {status_code}")
    logger.error(f"[DEV ERROR] Exception Type: {type(exc).__name__} | Message: {str(exc)}")
    logger.error(f"[DEV STACK TRACE]:\n{traceback.format_exc()}")

    # USER LAYER: Clean, safe, non-technical human message
    user_msg = sanitize_user_message(exc, status_code)

    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "message": user_msg,
            "detail": user_msg
        }
    )

async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Custom Handler for Request Validation Errors.
    Logs developer details and returns a friendly message.
    """
    logger.warning(f"⚠️ [DEV VALIDATION ERROR] Path: {request.method} {request.url.path} | Errors: {exc.errors()}")
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "message": "Please verify all form fields and try again.",
            "detail": "Please verify all form fields and try again."
        }
    )
