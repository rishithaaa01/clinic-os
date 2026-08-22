import api from './api';

export const patientApi = {
  getMyProfile: () => api.get('/patients/me').then(r => r.data),
  getMyVisits: () => api.get('/patients/me/visits').then(r => r.data),
  getMyPrescriptions: () => api.get('/patients/me/prescriptions').then(r => r.data),
  getMyLabResults: () => api.get('/lab/results').then(r => r.data),
  getLabResult: (labOrderId: string) => api.get(`/lab/results/${labOrderId}`).then(r => r.data),
  getHealthSummary: () => api.get('/patients/me/health-summary').then(r => r.data),
  getMyConsents: () => api.get('/patients/me/consents').then(r => r.data),
  grantConsent: (data: any) => api.post('/patients/me/consents', data).then(r => r.data),
  revokeConsent: (id: string) => api.delete(`/patients/me/consents/${id}`).then(r => r.data),
  getHospitals: () => api.get('/auth/hospitals').then(r => r.data),
  getMyAppointments: () => api.get('/patients/me/appointments').then(r => r.data),
  bookAppointment: (data: any) => api.post('/appointments/book', data).then(r => r.data),
  checkInAppointment: (appointmentId: string) => api.post(`/appointments/${appointmentId}/check-in`).then(r => r.data),
  logSymptoms: (data: { transcript: string; preferred_hospital_id: string }) => 
    api.post('/patients/me/symptoms', data, { headers: { 'x-client-type': 'mobile' } }).then(r => r.data),
  checkSpecialist: (params?: any) => api.get('/appointments/check-specialist', { params }).then(r => r.data),
  getMedicalHistory: (patientId?: string) => patientId ? api.get(`/patients/${patientId}/medical-history`).then(r => r.data) : api.get('/patients/me/medical-history').then(r => r.data),
  createLabOrder: (data: any) => api.post('/lab/orders', data).then(r => r.data),
};

export default patientApi;
