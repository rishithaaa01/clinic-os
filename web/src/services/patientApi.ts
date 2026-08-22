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
  getMyAppointments: () => api.get('/patients/me/appointments').then(r => r.data),
  bookAppointment: (data: any) => api.post('/appointments/book', data).then(r => r.data),
  checkInAppointment: (appointmentId: string) => api.post(`/appointments/${appointmentId}/check-in`).then(r => r.data),
  notifyArrival: (appointmentId: string) => api.post(`/appointments/${appointmentId}/notify-arrival`).then(r => r.data),
  markNoShow: (appointmentId: string) => api.post(`/appointments/${appointmentId}/no-show`).then(r => r.data),
  getAvailableDoctors: (params?: any) => api.get('/appointments/available-doctors', { params }).then(r => r.data),
  getHospitals: () => api.get('/hospitals').then(r => r.data).catch(() => api.get('/auth/hospitals').then(r => r.data)),
  getSpecialties: (hospitalName: string) => api.get('/appointments/specialties', { params: { hospital_name: hospitalName } }).then(r => r.data),
  getAvailableSlots: (params: any) => api.get('/appointments/slots', { params }).then(r => r.data),
  getSchedules: (params?: any) => api.get('/appointments/schedules', { params }).then(r => r.data),
  saveSchedule: (data: any) => api.post('/appointments/schedules', data).then(r => r.data),
  getReceptionistAppointments: (params?: any) => api.get('/appointments/receptionist/today', { params }).then(r => r.data),
  registerWalkIn: (data: any) => api.post('/appointments/receptionist/walk-in', data).then(r => r.data),
  checkSpecialist: (params?: any) => api.get('/appointments/check-specialist', { params }).then(r => r.data),
  getMedicalHistory: (patientId?: string) => patientId ? api.get(`/patients/${patientId}/medical-history`).then(r => r.data) : api.get('/patients/me/medical-history').then(r => r.data),
  createLabOrder: (data: any) => api.post('/lab/orders', data).then(r => r.data),
};

export default patientApi;
