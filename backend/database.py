from motor.motor_asyncio import AsyncIOMotorClient
from config import settings
import logging
import asyncio

# Standard DNS resolver is used

logger = logging.getLogger(__name__)

class Database:
    client: AsyncIOMotorClient = None
    db = None

db = Database()

from fastapi import HTTPException

def get_database():
    if db.db is None:
        if db.client is not None:
            try:
                db.db = db.client[settings.database_name]
            except Exception:
                pass
        else:
            try:
                db.client = AsyncIOMotorClient(
                    settings.mongodb_uri,
                    serverSelectionTimeoutMS=20000,
                    connectTimeoutMS=20000,
                    socketTimeoutMS=20000,
                    maxIdleTimeMS=60000,
                    readPreference='primaryPreferred',
                    retryReads=True,
                    retryWrites=True
                )
                db.db = db.client[settings.database_name]
            except Exception as e:
                print(f"[DATABASE AUTO-CONNECT ERROR] {e}")
                
    if db.db is None:
        raise HTTPException(
            status_code=503,
            detail="Database connection is temporarily unavailable. Please try again."
        )
    return db.db

async def connect_to_mongo():
    logger.info("Connecting to MongoDB Atlas (Direct Mode)...")
    max_retries = 5
    retry_delay = 5 
    
    for attempt in range(1, max_retries + 1):
        try:
            print(f"[CONNECTING] Database Connection Attempt {attempt}/{max_retries}...")
            # Use the direct URI from settings with resilient connection options
            db.client = AsyncIOMotorClient(
                settings.mongodb_uri,
                serverSelectionTimeoutMS=20000, # 20s for hotspot/VPN stability
                connectTimeoutMS=20000,
                socketTimeoutMS=20000,
                maxIdleTimeMS=60000,
                readPreference='primaryPreferred',
                retryReads=True,
                retryWrites=True
            )
            
            # Ping to verify
            await db.client.admin.command('ping')
            db.db = db.client[settings.database_name]
            
            print("\n+----------------------------------------+")
            print("|          [READY] DATABASE READY!       |")
            print("|      Connected to MongoDB Atlas        |")
            print("+----------------------------------------+\n")
            
            return # Success
            
        except Exception as e:
            err_msg = str(e).encode('ascii', 'replace').decode('ascii')
            print(f"[WARNING] Attempt {attempt} failed: {err_msg}")
            if attempt < max_retries:
                await asyncio.sleep(retry_delay)
            else:
                print("\n[ERROR] ALL CONNECTION ATTEMPTS FAILED")
                print("[TIP] Turn on your VPN now to bypass the port block!")
                db.db = None

async def close_mongo_connection():
    if db.client:
        db.client.close()
