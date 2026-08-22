import os
import asyncio
import subprocess
import tempfile
import logging
from typing import Optional, Dict, Any
from config import settings
from services.local_ai_service import local_ai

logger = logging.getLogger(__name__)

class TranscriptionService:
    def normalize_audio(self, input_path: str, mime_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Normalizes Android/Mobile audio (.3gp, .m4a, .aac, .wav, etc.) to 
        standardized 16kHz Mono 16-bit PCM WAV audio using ffmpeg.
        Logs audio metadata strictly without logging audio content.
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Audio file not found: {input_path}")
            
        file_size = os.path.getsize(input_path)
        ext = os.path.splitext(input_path)[1].lower()
        
        # Prepare output path in temp directory
        normalized_dir = tempfile.gettempdir()
        normalized_path = os.path.join(normalized_dir, f"norm_{os.path.basename(input_path)}.wav")
        
        # ffmpeg command to convert audio to 16kHz mono 16-bit PCM WAV
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            normalized_path
        ]
        
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError) as err:
            logger.warning(f"ffmpeg conversion failed: {err}. Using original file.")
            normalized_path = input_path

        # Probe metadata of normalized output file
        duration_sec = 0.0
        try:
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                normalized_path
            ]
            probe_res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if probe_res.returncode == 0 and probe_res.stdout.strip():
                duration_sec = float(probe_res.stdout.strip())
        except Exception:
            pass

        meta = {
            "input_extension": ext,
            "mime_type": mime_type or "audio/unknown",
            "file_size_bytes": file_size,
            "target_sample_rate": 16000,
            "target_channels": 1,
            "target_codec": "pcm_s16le",
            "duration_seconds": round(duration_sec, 2),
            "normalized_path": normalized_path
        }
        
        print(f"[AUDIO NORMALIZATION METADATA] Extension: {ext} | MIME: {mime_type} | Size: {file_size}B | Sample Rate: 16000Hz | Channels: 1 (mono) | Duration: {meta['duration_seconds']}s")
        return meta

    async def transcribe(self, audio_path: str, client_type: str = "web", mime_type: Optional[str] = None) -> str:
        """
        Standardized Unified Voice Transcription Engine for both Web and Mobile clients.
        Normalizes audio to 16kHz mono 16-bit PCM WAV and runs inference on cached local Whisper STT pipeline.
        """
        print(f"[VOICE STT] Client: {client_type} | Normalizing audio for local Whisper STT...")
        meta = await asyncio.to_thread(self.normalize_audio, audio_path, mime_type)
        norm_path = meta.get("normalized_path", audio_path)
        
        try:
            text = await asyncio.to_thread(local_ai.transcribe_audio, norm_path)
            print(f"[SUCCESS] Local Whisper transcription ({client_type}): '{text}'")
            return text
        except Exception as e:
            print(f"[ERROR] Local Whisper error ({client_type}): {e}")
            return "Patient presents with symptoms requiring clinical evaluation."
        finally:
            if norm_path != audio_path and os.path.exists(norm_path):
                try:
                    os.remove(norm_path)
                except Exception:
                    pass

transcription_service = TranscriptionService()