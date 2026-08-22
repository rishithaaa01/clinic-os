import json
import logging
import httpx
from typing import Dict, Any, Optional
from config import settings

logger = logging.getLogger(__name__)

REQUIRED_FIELDS = [
    "chief_complaint",
    "symptoms",
    "clinical_observations",
    "possible_conditions",
    "medicines_mentioned",
    "plan",
    "follow_up",
    "risk_indicators",
    "clinical_insights"
]

class OllamaService:
    def __init__(self):
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.ollama_model
        self.timeout = settings.ollama_timeout
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(trust_env=False, timeout=float(self.timeout))
        return self._client

    async def check_health(self) -> Dict[str, Any]:
        """
        Direct health test for Ollama reachability, installed model, and memory.
        """
        client = self._get_client()
        url = f"{self.base_url}/api/tags"
        try:
            r = await client.get(url)
            if r.status_code == 200:
                models = [m.get("name") for m in r.json().get("models", [])]
                installed = any(self.model in m or m.startswith(self.model) for m in models)
                return {
                    "reachable": True,
                    "model": self.model,
                    "installed": installed,
                    "available_models": models
                }
            return {"reachable": False, "error": f"HTTP {r.status_code}"}
        except Exception as e:
            return {"reachable": False, "error": str(e)}

    async def generate_completion(self, prompt: str, system_prompt: str = "") -> Optional[str]:
        """
        Sends a request to Ollama generate endpoint using persistent connection and native JSON formatting.
        """
        url = f"{self.base_url}/api/generate"
        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": system_prompt,
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.1,
                "num_ctx": 2048,
                "num_predict": 256
            }
        }
        
        try:
            client = self._get_client()
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                data = response.json()
                return data.get("response", "").strip()
            else:
                logger.error(f"Ollama API error ({response.status_code}): {response.text}")
                return None
        except httpx.TimeoutException:
            logger.warning(f"Ollama request timed out after {self.timeout}s")
            return None
        except Exception as e:
            logger.error(f"Failed to connect to Ollama at {url}: {e}")
            return None

    def _validate_and_sanitize_json(self, raw_response: str) -> Optional[Dict[str, Any]]:
        """
        Extracts JSON from response and verifies structure.
        """
        if not raw_response:
            return None

        # Clean JSON markdown fences if present
        clean_text = raw_response.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        if clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()

        try:
            parsed = json.loads(clean_text)
            if not isinstance(parsed, dict):
                return None

            # Ensure all required fields exist with correct types
            sanitized = {
                "chief_complaint": str(parsed.get("chief_complaint") or "Not recorded")[:1000],
                "symptoms": [str(s)[:100] for s in parsed.get("symptoms", []) if s] if isinstance(parsed.get("symptoms"), list) else [],
                "clinical_observations": str(parsed.get("clinical_observations") or "Not recorded")[:2000],
                "possible_conditions": [str(c)[:100] for c in parsed.get("possible_conditions", []) if c] if isinstance(parsed.get("possible_conditions"), list) else [],
                "medicines_mentioned": [str(m)[:100] for m in parsed.get("medicines_mentioned", []) if m] if isinstance(parsed.get("medicines_mentioned"), list) else [],
                "plan": str(parsed.get("plan") or "Not recorded")[:2000],
                "follow_up": str(parsed.get("follow_up") or "Not recorded")[:500],
                "risk_indicators": str(parsed.get("risk_indicators") or "Routine")[:200],
                "clinical_insights": str(parsed.get("clinical_insights") or "AI-assisted note: Clinical verification required.")[:2000]
            }
            return sanitized
        except Exception as e:
            logger.warning(f"Ollama JSON parse error: {e}")
            return None

    async def structure_clinical_text(self, text: str) -> Dict[str, Any]:
        """
        Structures transcribed clinical voice notes using Ollama (llama3.2:3b).
        Performs strict validation and controlled fallback on timeout/error.
        """
        fallback_data = {
            "chief_complaint": text[:200] if text else "Not recorded",
            "symptoms": [],
            "clinical_observations": text[:1000] if text else "Not recorded",
            "possible_conditions": [],
            "medicines_mentioned": [],
            "plan": "Review transcription for clinical detail.",
            "follow_up": "Follow up as clinically indicated.",
            "risk_indicators": "Routine",
            "clinical_insights": "AI analysis taking longer than expected. Clinical note has been saved successfully.",
            "raw_transcription": text[:5000] if text else "",
            "ollama_status": "unavailable"
        }

        if not text or not text.strip():
            fallback_data["ollama_status"] = "empty_input"
            return fallback_data

        system_prompt = (
            "You are a medical speech structure assistant. Extract clinical elements into valid JSON strictly matching this schema:\n"
            "{\n"
            '  "chief_complaint": "brief description",\n'
            '  "symptoms": ["symptom1", "symptom2"],\n'
            '  "clinical_observations": "examination or observation details",\n'
            '  "possible_conditions": ["condition1", "condition2"],\n'
            '  "medicines_mentioned": ["med1", "med2"],\n'
            '  "plan": "suggested plan or instructions",\n'
            '  "follow_up": "follow-up advice",\n'
            '  "risk_indicators": "Routine | Needs Attention | Urgent Review",\n'
            '  "clinical_insights": "clinical summary"\n'
            "}\n"
            "Do NOT issue a definitive diagnosis. Respond ONLY with valid JSON."
        )

        prompt = f"Transcribed Clinical Text:\n\"{text}\"\n\nRespond ONLY with JSON:"

        # Try 1
        raw_res = await self.generate_completion(prompt, system_prompt)
        sanitized = self._validate_and_sanitize_json(raw_res)
        if sanitized:
            sanitized["raw_transcription"] = text[:5000]
            sanitized["ollama_status"] = "available"
            return sanitized

        # Fallback if Ollama times out or fails parsing
        logger.warning("Ollama structuring unavailable or timed out. Returning controlled partial fallback.")
        return fallback_data

    async def analyze_clinical_note(self, text: str, disease_prediction: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Analyzes field clinical notes / symptoms for ASHA triage.
        """
        structured = await self.structure_clinical_text(text)
        
        risk_level = "Routine"
        if disease_prediction and isinstance(disease_prediction, dict):
            prob = disease_prediction.get("confidence", 0.0)
            if prob > 0.75:
                risk_level = "Urgent Review"
            elif prob > 0.5:
                risk_level = "Needs Attention"

        risk_ind = str(structured.get("risk_indicators", "Routine")).lower()
        if "high" in risk_ind or "urgent" in risk_ind or "red" in risk_ind:
            risk_level = "Urgent Review"
        elif "watch" in risk_ind or "moderate" in risk_ind:
            if risk_level != "Urgent Review":
                risk_level = "Needs Attention"

        if disease_prediction and isinstance(disease_prediction, dict) and disease_prediction.get("predicted_disease"):
            pred_name = disease_prediction["predicted_disease"]
            insights = f"AI-assisted prediction associated with {pred_name}. {structured.get('clinical_insights', 'Symptom evaluation completed.')}"
        else:
            insights = structured.get("clinical_insights", "Symptom evaluation completed via clinical triage.")

        return {
            "risk_level": risk_level,
            "clinical_insights": insights,
            "structured": structured
        }

ollama_service = OllamaService()

