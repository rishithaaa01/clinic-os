/**
 * Centralized Error Translator for Web Frontend.
 * Converts technical errors (Axios, HTTP status codes, network timeouts, tracebacks, raw JSON)
 * into safe, clean, human-readable English messages.
 */

export function getSafeErrorMessage(error: any): string {
  if (!error) {
    return "An unexpected error occurred. Please try again.";
  }

  // Developer logging (Console only, never visible in UI)
  console.error("🔍 [DEVELOPER LOG] Captured Exception:", error);

  // 1. Network / Timeout Errors
  if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
    return "The operation is taking longer than expected. Please try again.";
  }

  if (error.message === "Network Error" || !navigator.onLine) {
    return "Unable to connect right now. Please check your internet connection and try again.";
  }

  // 2. Axios / HTTP Response Errors
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    // Check detail string if provided by backend
    let detail = typeof data === "string" ? data : (data?.detail || data?.message || "");

    if (typeof detail === "object") {
      detail = JSON.stringify(detail);
    }

    const detailLower = String(detail).toLowerCase();

    // Check if detail contains technical leaks to scrub
    const containsTechnical = [
      "objectid", "mongodb", "traceback", "pymongo", "groq", 
      "ollama", "cloudinary", "whisper", "axios", "500", 
      "404", "401", "403", "json", "python", "http:", "https:"
    ].some(tech => detailLower.includes(tech));

    if (!containsTechnical && detail && detail.length < 150) {
      return detail;
    }

    if (status === 401) {
      return "Your session has expired. Please sign in again.";
    }
    if (status === 403) {
      return "You don't have permission to access this information.";
    }
    if (status === 404) {
      return "The requested information could not be found.";
    }
    if (status >= 500) {
      return "AI service is temporarily unavailable. Your information has been saved. Please try again.";
    }
  }

  // 3. Exception string scrubbing
  const errStr = String(error.message || error).toLowerCase();

  if (errStr.includes("network") || errStr.includes("failed to fetch")) {
    return "Unable to connect right now. Please check your internet connection and try again.";
  }

  if (errStr.includes("pdf") || errStr.includes("upload") || errStr.includes("file")) {
    return "We couldn't process the uploaded report. Please select a valid PDF file under 20MB and try again.";
  }

  return "Something went wrong. Please try again.";
}
