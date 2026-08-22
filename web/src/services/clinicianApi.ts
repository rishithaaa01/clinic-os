import axios from 'axios';

const getClinicianApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return `${import.meta.env.VITE_API_URL}/clinician`;
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return `http://${host}:8000/api/clinician`;
    }
  }
  return 'https://ayu-disha.onrender.com/api/clinician';
};

const API_URL = getClinicianApiUrl();

const clinicianApi = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

// Add JWT token and client-type header to every request automatically
clinicianApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['x-client-type'] = 'web';
  return config;
});

clinicianApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      if (error.config?.url?.includes('/voice') || error.config?.url?.includes('/audio')) {
        error.message = "We're taking longer than expected to process the recording. Please try again.";
      } else {
        error.message = "The request took longer than expected to respond. Please try again.";
      }
    }
    return Promise.reject(error);
  }
);

export const api = {
  // Generic HTTP methods
  get: (url: string) => clinicianApi.get(url).then(res => res.data),
  post: (url: string, data?: any) => clinicianApi.post(url, data).then(res => res.data),
  put: (url: string, data?: any) => clinicianApi.put(url, data).then(res => res.data),
  delete: (url: string) => clinicianApi.delete(url).then(res => res.data),

  // Queue, Appointments & Patients
  getQueue: () => clinicianApi.get('/queue').then(res => res.data),
  getDoctorAppointments: () => clinicianApi.get('/appointments').then(res => res.data).catch(() => []),
  respondToAppointment: (id: string, action: string, message?: string) => clinicianApi.post(`/appointments/${id}/respond`, { action, message }).then(res => res.data),
  checkInAppointment: (id: string) => clinicianApi.post(`/appointments/${id}/check-in`).then(res => res.data),
  getMyPatients: () =>
    clinicianApi.get('/my-patients').then(res => res.data).catch(() => []),
  getPatientRecord: (id: string) => clinicianApi.get(`/patients/${id}`).then(res => res.data),
  getPatientSummary: (id: string) => clinicianApi.get(`/patients/${id}/summary`).then(res => res.data),

  // Consultations
  startVisit: (data: any) => clinicianApi.post('/visits', data).then(res => res.data),
  updateVisit: (id: string, data: any) => clinicianApi.patch(`/visits/${id}`, data).then(res => res.data),
  completeVisit: (id: string) => clinicianApi.post(`/visits/${id}/complete`).then(res => res.data),

  // Referrals
  getReferrals: () =>
    clinicianApi.get('/referrals').then(res => res.data).catch(() => []),
  acceptReferral: (id: string) => clinicianApi.post(`/referrals/${id}/accept`).then(res => res.data),
  rejectReferral: (id: string, reason: string) => clinicianApi.post(`/referrals/${id}/reject`, { reason }).then(res => res.data),
  sendReferral: (data: any) => clinicianApi.post('/referrals', data).then(res => res.data),

  // Clinical Tools
  checkInteraction: (data: any) => clinicianApi.post('/prescriptions/check-interaction', data).then(res => res.data),
  savePrescription: (data: any) => clinicianApi.post('/prescriptions', data).then(res => res.data),
  getDifferential: (symptoms: string, patientId?: string | null) =>
    clinicianApi.get('/differential', { params: { symptoms, patient_id: patientId || '' } }).then(res => res.data),

  // Voice & Lab Orders
  processVoiceNote: async (visitId: string, audioBlob: Blob) => {
    const formData = new FormData();
    const mime = audioBlob.type || 'audio/webm';
    let ext = 'webm';
    if (mime.includes('mp4')) ext = 'mp4';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('wav')) ext = 'wav';
    else if (mime.includes('m4a')) ext = 'm4a';

    formData.append('file', audioBlob, `voice_note.${ext}`);
    
    // Do NOT manually set 'Content-Type': 'multipart/form-data' header.
    // Letting browser/Axios auto-set boundary prevents Starlette multipart parser hanging & 30s timeouts.
    return clinicianApi.post(`/voice-note?visit_id=${encodeURIComponent(visitId || 'new')}`, formData, {
      timeout: 60000,
    }).then(res => res.data);
  },
  orderLabs: (data: any) => clinicianApi.post('/lab-orders', data).then(res => res.data),

  // Lab Results (doctor can only see their assigned patients' results)
  getMyLabResults: async () => {
    const base = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.')) ? `http://${window.location.hostname}:8000/api` : 'https://ayu-disha.onrender.com/api');
    const labApi = axios.create({
      baseURL: base,
      timeout: 35000,
    });
    const token = localStorage.getItem('token');
    if (token) {
      labApi.defaults.headers.common.Authorization = `Bearer ${token}`;
    }
    return labApi.get('/lab/results').then(res => res.data);
  },
};

export default api;
