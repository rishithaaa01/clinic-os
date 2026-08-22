import asyncio
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from database import connect_to_mongo, close_mongo_connection, get_database
import bcrypt

def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

async def seed_demo_accounts():
    await connect_to_mongo()
    db = get_database()

    hosp = await db.hospitals.find_one({})
    hosp_name = hosp.get("name") if hosp else "General Hospital"

    users_to_seed = [
        {
            "email": "asha@ayudisha.org",
            "password_hash": hash_password("asha123"),
            "password": "asha123",
            "name": "Sunita Devi (ASHA)",
            "mobile": "+919876543210",
            "role": "asha",
            "village": "Rural Village 1",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "doctor@ayudisha.org",
            "password_hash": hash_password("doctor123"),
            "password": "doctor123",
            "name": "Dr. Rajesh Kumar",
            "mobile": "+919876543211",
            "role": "doctor",
            "hospital": hosp_name,
            "approved_hospital_id": hosp_name,
            "speciality": "General Medicine",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "patient@ayudisha.org",
            "password_hash": hash_password("patient123"),
            "password": "patient123",
            "name": "Ramesh Kumar",
            "mobile": "+919876543212",
            "role": "patient",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "lab@ayudisha.org",
            "password_hash": hash_password("lab123"),
            "password": "lab123",
            "name": "Suresh Technician",
            "mobile": "+919876543213",
            "role": "lab",
            "hospital": hosp_name,
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "receptionist@ayudisha.org",
            "password_hash": hash_password("receptionist123"),
            "password": "receptionist123",
            "name": "Priya Sharma (Receptionist)",
            "mobile": "+919876543216",
            "role": "receptionist",
            "hospital": hosp_name,
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "admin@ayudisha.org",
            "password_hash": hash_password("admin123"),
            "password": "admin123",
            "name": "System Administrator",
            "mobile": "+919876543217",
            "role": "admin",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "pho@ayudisha.org",
            "password_hash": hash_password("pho123"),
            "password": "pho123",
            "name": "Dr. Vivek Mehra (PHO)",
            "mobile": "+919876543218",
            "role": "pho",
            "district": "Kanchipuram",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "cardio@ayudisha.org",
            "password_hash": hash_password("doctor123"),
            "password": "doctor123",
            "name": "Dr. Ananya Sharma (Cardiologist)",
            "mobile": "+919876543214",
            "role": "doctor",
            "hospital": "Apollo Hospital",
            "approved_hospital_id": "Apollo Hospital",
            "speciality": "Cardiology",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "pulmo@ayudisha.org",
            "password_hash": hash_password("doctor123"),
            "password": "doctor123",
            "name": "Dr. Vikram Seth (Pulmonologist)",
            "mobile": "+919876543215",
            "role": "doctor",
            "hospital": "Kanchipuram District Hospital",
            "approved_hospital_id": "Kanchipuram District Hospital",
            "speciality": "Pulmonology",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "derma@ayudisha.org",
            "password_hash": hash_password("doctor123"),
            "password": "doctor123",
            "name": "Dr. Meenakshi Sundaram (Dermatologist)",
            "mobile": "+919876543220",
            "role": "doctor",
            "hospital": "Apollo Hospital",
            "approved_hospital_id": "Apollo Hospital",
            "speciality": "Dermatology",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "neuro@ayudisha.org",
            "password_hash": hash_password("doctor123"),
            "password": "doctor123",
            "name": "Dr. Arvind Swaminathan (Neurologist)",
            "mobile": "+919876543221",
            "role": "doctor",
            "hospital": "Kauvery Hospital",
            "approved_hospital_id": "Kauvery Hospital",
            "speciality": "Neurology",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        },
        {
            "email": "ortho@ayudisha.org",
            "password_hash": hash_password("doctor123"),
            "password": "doctor123",
            "name": "Dr. Sanjay Verma (Orthopedic Surgeon)",
            "mobile": "+919876543222",
            "role": "doctor",
            "hospital": "Kanchipuram District Hospital",
            "approved_hospital_id": "Kanchipuram District Hospital",
            "speciality": "Orthopaedics",
            "is_profile_complete": True,
            "verification_status": "VERIFIED",
            "hospital_status": "APPROVED",
            "account_status": "ACTIVE",
            "created_at": datetime.utcnow()
        }
    ]

    for u in users_to_seed:
        existing = await db.users.find_one({"email": u["email"]})
        if not existing:
            await db.users.insert_one(u)
            print(f"[SEEDED] Created demo account: {u['email']} (role: {u['role']})")
        else:
            await db.users.update_one({"email": u["email"]}, {"$set": u})
            print(f"[UPDATED] Refreshed demo account: {u['email']}")

    print("\n--- ALL DEMO ACCOUNTS SEEDED SUCCESSFULLY ---")
    await close_mongo_connection()

if __name__ == "__main__":
    asyncio.run(seed_demo_accounts())
