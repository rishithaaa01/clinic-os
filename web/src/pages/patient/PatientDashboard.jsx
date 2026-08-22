import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import patientApi from '../../services/patientApi';
import Navbar from '../../components/Navbar';
import { FileText, Pill, FlaskConical, ShieldCheck, Sparkles, RefreshCw, AlertCircle, Calendar, Activity, Mic } from 'lucide-react';
import VoiceSymptomLogger from './components/VoiceSymptomLogger';

export default function PatientDashboard() {
  const { user } = useAuthStore();
  const [showSymptomLogger, setShowSymptomLogger] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['patientProfile'],
    queryFn: patientApi.getMyProfile,
  });

  const { data: visits, isLoading: visitsLoading } = useQuery({
    queryKey: ['patientVisits'],
    queryFn: patientApi.getMyVisits,
  });

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['healthSummary'],
    queryFn: patientApi.getHealthSummary,
    retry: false,
  });

  const recentVisit = visits?.[0];
  const upcomingFollowUp = recentVisit?.follow_up_date && new Date(recentVisit.follow_up_date) > new Date()
    ? recentVisit
    : null;

  const { data: hospitals = [], isLoading: hospitalsLoading, isError: hospitalsError } = useQuery({
    queryKey: ['liveHospitals'],
    queryFn: patientApi.getHospitals,
  });

  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingForm, setBookingForm] = useState({
    hospital_name: '',
    specialty: '',
    doctor_id: '',
    appointment_date: new Date().toISOString().split('T')[0],
    time_slot: '09:00 AM',
    chief_complaint: 'Routine OPD Consultation'
  });

  // Set default selected hospital once live hospitals load
  useEffect(() => {
    if (hospitals.length > 0 && !bookingForm.hospital_name) {
      setBookingForm((prev) => ({ ...prev, hospital_name: hospitals[0].name }));
    }
  }, [hospitals]);

  // Fetch real specialties for selected hospital
  const { data: specialties = [], isLoading: specialtiesLoading } = useQuery({
    queryKey: ['specialties', bookingForm.hospital_name],
    queryFn: () => patientApi.getSpecialties(bookingForm.hospital_name),
    enabled: !!bookingForm.hospital_name,
  });

  useEffect(() => {
    if (specialties.length > 0 && !specialties.includes(bookingForm.specialty)) {
      setBookingForm((prev) => ({ ...prev, specialty: specialties[0] }));
    } else if (specialties.length === 0) {
      setBookingForm((prev) => ({ ...prev, specialty: '' }));
    }
  }, [specialties]);

  // Fetch real verified active doctors for hospital & specialty
  const { data: doctors = [], isLoading: doctorsLoading } = useQuery({
    queryKey: ['availableDoctors', bookingForm.hospital_name, bookingForm.specialty],
    queryFn: () => patientApi.getAvailableDoctors({ hospital: bookingForm.hospital_name, speciality: bookingForm.specialty }),
    enabled: !!bookingForm.hospital_name,
  });

  // Check exact specialist availability and alternative recommendations
  const { data: specialistCheck = { specialist_available: true, recommended_hospitals: [] } } = useQuery({
    queryKey: ['checkSpecialist', bookingForm.hospital_name, bookingForm.specialty, bookingForm.chief_complaint],
    queryFn: () => patientApi.checkSpecialist({
      hospital_name: bookingForm.hospital_name,
      specialty: bookingForm.specialty,
      complaint: bookingForm.chief_complaint
    }),
    enabled: !!bookingForm.hospital_name,
  });

  // Fetch real available slots
  const { data: slotsData = { slots: [] }, isLoading: slotsLoading, refetch: refetchSlots } = useQuery({
    queryKey: ['availableSlots', bookingForm.hospital_name, bookingForm.appointment_date, bookingForm.doctor_id, bookingForm.specialty],
    queryFn: () => patientApi.getAvailableSlots({
      hospital_name: bookingForm.hospital_name,
      date: bookingForm.appointment_date,
      doctor_id: bookingForm.doctor_id,
      specialty: bookingForm.specialty
    }),
    enabled: !!bookingForm.hospital_name && !!bookingForm.appointment_date,
    refetchInterval: 3000,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (showBookingModal) {
      refetchSlots();
    }
  }, [showBookingModal]);

  useEffect(() => {
    if (slotsData?.slots?.length > 0) {
      const currentSelected = slotsData.slots.find(s => s.time === bookingForm.time_slot);
      if (!currentSelected || !currentSelected.available) {
        const firstAvail = slotsData.slots.find(s => s.available && s.reason !== 'PASSED');
        if (firstAvail) {
          setBookingForm(prev => ({ ...prev, time_slot: firstAvail.time }));
        }
      }
    }
  }, [slotsData]);

  const [bookingLoading, setBookingLoading] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(null);

  const { data: appointments = [], refetch: refetchAppointments } = useQuery({
    queryKey: ['patientAppointments'],
    queryFn: async () => {
      const raw = await patientApi.getMyAppointments();
      const list = Array.isArray(raw) ? raw : [];
      const seen = new Set();
      return list.filter((a) => {
        const id = a.id || a.appointment_id || a._id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },
  });

  const handleBookAppointment = async (e) => {
    e.preventDefault();
    const currentSlotObj = slotsData?.slots?.find(s => s.time === bookingForm.time_slot);
    if (currentSlotObj && !currentSlotObj.available) {
      toast.error(`The time slot '${bookingForm.time_slot}' is already booked or full. Please choose another open time slot.`);
      return;
    }
    setBookingLoading(true);
    try {
      const res = await patientApi.bookAppointment(bookingForm);
      toast.success(res.message || 'Appointment booked successfully!');
      setShowBookingModal(false);
      refetchAppointments();
      refetchSlots();
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'Failed to book appointment.';
      toast.error(errorMsg);
      refetchSlots();
    } finally {
      setBookingLoading(false);
    }
  };

  const handleNotifyArrival = async (apptId) => {
    setCheckInLoading(apptId);
    try {
      const res = await patientApi.notifyArrival(apptId);
      toast.success(res.message || 'Arrival notified to reception!');
      refetchAppointments();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to notify arrival.');
    } finally {
      setCheckInLoading(null);
    }
  };

  const quickLinks = [
    { id: 'book_appt', label: 'Book Appointment', icon: Calendar, color: 'bg-emerald-50 text-emerald-600 border-emerald-100', action: () => setShowBookingModal(true) },
    { id: 'log_symptoms', label: 'Log Symptoms', icon: Activity, color: 'bg-red-50 text-red-600 border-red-100', action: () => setShowSymptomLogger(true) },
    { to: '/patient/records', label: 'My Records', icon: FileText, color: 'bg-blue-50 text-blue-600 border-blue-100' },
    { to: '/patient/medicines', label: 'Medicines', icon: Pill, color: 'bg-purple-50 text-purple-600 border-purple-100' },
    { to: '/patient/tests', label: 'Lab Tests', icon: FlaskConical, color: 'bg-orange-50 text-orange-600 border-orange-100' },
  ];

  return (
    <div className="min-h-screen bg-[#F7F3EE] w-full max-w-full overflow-x-hidden">
      <Navbar />
      <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 pb-safe">

        {/* Welcome */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">
            Welcome back, {profileLoading ? '...' : profile?.name || user?.name} 👋
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">Here's your health summary for today.</p>
        </div>

        {/* Health Card */}
        {!profileLoading && profile && (
          <div className="bg-gradient-to-r from-[#1B6CA8] to-[#1557A0] text-white rounded-2xl p-4 sm:p-6 mb-6 shadow-lg">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-white/70 text-xs font-medium uppercase tracking-wider">Patient</p>
                <h2 className="text-xl sm:text-2xl font-bold mt-1">{profile.name}</h2>
                {profile.abha_number && (
                  <p className="text-white/80 text-xs sm:text-sm mt-1">ABHA: {profile.abha_number}</p>
                )}
              </div>
              <div className="text-right">
                {profile.blood_group && (
                  <span className="bg-red-500 text-white px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold">{profile.blood_group}</span>
                )}
              </div>
            </div>
            {profile.allergies?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5 sm:gap-2">
                <span className="text-white/70 text-xs">Allergies:</span>
                {profile.allergies.map((a) => (
                  <span key={a} className="bg-white/20 text-white text-[11px] sm:text-xs px-2 py-0.5 rounded-full">{a}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {profileLoading && <div className="h-36 bg-gray-200 animate-pulse rounded-2xl mb-6" />}

        {/* Upcoming Follow-up Banner */}
        {upcomingFollowUp && (
          <div className="bg-amber-50 border-l-4 border-amber-400 rounded-xl p-3.5 sm:p-4 mb-6 flex items-start space-x-3">
            <Calendar className="text-amber-500 mt-0.5 shrink-0" size={18} />
            <div>
              <p className="font-semibold text-amber-800 text-sm">Follow-up Due</p>
              <p className="text-amber-700 text-xs sm:text-sm">{new Date(upcomingFollowUp.follow_up_date).toLocaleDateString('en-IN', { dateStyle: 'long' })} at {upcomingFollowUp.hospital_name}</p>
            </div>
          </div>
        )}

        {/* AI Summary */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="flex items-center space-x-2">
              <Sparkles size={18} className="text-[#1B6CA8]" />
              <h3 className="font-bold text-gray-800 text-sm sm:text-base">Your Health Today</h3>
            </div>
            <button onClick={() => refetchSummary()} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <RefreshCw size={16} className="text-gray-400" />
            </button>
          </div>
          {summaryLoading ? (
            <div className="space-y-2">
              <div className="h-4 bg-gray-100 animate-pulse rounded w-full" />
              <div className="h-4 bg-gray-100 animate-pulse rounded w-5/6" />
              <div className="h-4 bg-gray-100 animate-pulse rounded w-4/6" />
            </div>
          ) : (
            <p className="text-gray-600 leading-relaxed text-xs sm:text-sm">
              {summary?.summary || 'No health summary available yet. Your AI health summary will appear here after your medical records are updated.'}
            </p>
          )}
        </div>

        {/* Voice AI Assessment & Auto-Referral Hero Banner */}
        <div className="bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-950 text-white rounded-3xl p-5 sm:p-6 mb-6 shadow-md border border-emerald-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-44 h-44 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex-1 space-y-1.5 z-10">
            <div className="inline-flex items-center gap-1.5 bg-emerald-800/80 border border-emerald-600/50 px-3 py-1 rounded-full">
              <Sparkles size={12} className="text-emerald-300" />
              <span className="text-emerald-200 text-[10px] font-extrabold uppercase tracking-wider">Voice-First AI Triage</span>
            </div>
            <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
              🎙️ Speak Symptoms & Auto-Refer
            </h2>
            <p className="text-emerald-100/80 text-xs sm:text-sm max-w-2xl leading-relaxed">
              Speak your symptoms naturally. AI assesses clinical risk, detects the exact department, and automatically routes your case to a doctor.
            </p>
          </div>
          <button
            onClick={() => setShowSymptomLogger(true)}
            className="w-full sm:w-auto shrink-0 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-black px-5 py-3 rounded-2xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer z-10"
          >
            <Mic size={16} className="text-emerald-950" />
            <span>Speak Symptoms Now →</span>
          </button>
        </div>

        {/* Quick Links Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 mb-6">
          {quickLinks.map(({ to, id, label, icon: Icon, color, action }) => {
            const inner = (
              <>
                <div className={`p-2.5 sm:p-3 rounded-xl ${color}`}>
                  <Icon size={20} />
                </div>
                <span className="text-xs sm:text-sm font-semibold text-gray-700 group-hover:text-[#1B6CA8] transition-colors">{label}</span>
              </>
            );

            return to ? (
              <Link
                key={to}
                to={to}
                className="flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border bg-white hover:shadow-md transition-all space-y-2.5 sm:space-y-3 group min-h-[76px]"
              >
                {inner}
              </Link>
            ) : (
              <button
                key={id}
                onClick={action}
                className="flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border bg-white hover:shadow-md transition-all space-y-2.5 sm:space-y-3 group w-full h-full min-h-[76px]"
              >
                {inner}
              </button>
            );
          })}
        </div>

        {/* My Appointments & Referrals Section */}
        {appointments.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 text-sm sm:text-base flex items-center gap-2">
                <Calendar size={18} className="text-emerald-600" />
                Scheduled Appointments & Care Access
              </h3>
            </div>
            <div className="space-y-3">
              {appointments.map((appt) => {
                const st = (appt.status || '').toUpperCase();
                return (
                  <div key={appt.id} className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-gray-800 text-sm">{appt.hospital_name}</span>
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {appt.specialty || 'General Medicine'}
                        </span>
                        <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {appt.source_type || 'DIRECT_APPOINTMENT'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 font-medium">Assigned Specialist: {appt.doctor_name || 'Duty Specialist'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Requested Date: {appt.requested_date} ({appt.requested_time_slot})</p>
                    </div>
                    <div>
                      {st === 'REQUESTED' || st === 'PENDING' ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-200 block text-center">
                            ⏳ Request Sent — Awaiting Doctor Confirmation
                          </span>
                          <span className="text-[10px] text-gray-500 italic">Please wait for Dr. {appt.doctor_name || 'Specialist'} to accept</span>
                        </div>
                      ) : st === 'CONFIRMED' || st === 'ACCEPTED' ? (
                        !appt.arrival_notified ? (
                          <button
                            onClick={() => handleNotifyArrival(appt.id)}
                            disabled={checkInLoading === appt.id}
                            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"
                          >
                            {checkInLoading === appt.id ? 'Notifying...' : "📍 I've Arrived at Hospital"}
                          </button>
                        ) : (
                          <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-100 text-amber-800 border border-amber-200 block text-center">
                            📍 Arrival Notified — Report to Reception Desk
                          </span>
                        )
                      ) : st === 'ARRIVAL_NOTIFIED' ? (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-100 text-amber-800 border border-amber-200 block text-center">
                          📍 Arrival Notified — Report to Reception Desk
                        </span>
                      ) : st === 'CHECKED_IN' || st === 'WAITING' ? (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-blue-100 text-blue-800 border border-blue-200 block text-center">
                          ✓ Checked In — Waiting for Doctor Consultation
                        </span>
                      ) : st === 'IN_CONSULTATION' ? (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-purple-100 text-purple-800 border border-purple-200 block text-center">
                          🩺 In Consultation Now
                        </span>
                      ) : st === 'REJECTED' ? (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-red-100 text-red-800 border border-red-200 block text-center">
                          ❌ Request Declined — Please Rebook
                        </span>
                      ) : st === 'COMPLETED' ? (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-200 block text-center">
                          ✅ Consultation Completed
                        </span>
                      ) : (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-gray-200 text-gray-700 block text-center">
                          {appt.status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Visit */}
        {recentVisit && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">Last Visit</h3>
              <Link to="/patient/records" className="text-sm text-[#1B6CA8] hover:underline font-medium">View all →</Link>
            </div>
            <div>
              <p className="font-semibold text-gray-800">{recentVisit.hospital_name}</p>
              <p className="text-gray-500 text-sm">{recentVisit.doctor_name}</p>
              <p className="text-gray-400 text-xs mt-1">
                {new Date(recentVisit.date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
              </p>
              {recentVisit.diagnosis?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {recentVisit.diagnosis.map((d, i) => (
                    <span key={i} className="bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">{d}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {visitsLoading && <div className="h-36 bg-gray-200 animate-pulse rounded-2xl" />}
      </div>

      {/* Direct Booking Modal */}
      {showBookingModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Book Direct OPD Appointment</h3>
            <p className="text-xs text-gray-500 mb-4">Schedule a direct OPD consultation slot with an active verified doctor.</p>
            <form onSubmit={handleBookAppointment} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Select Hospital</label>
                <select
                  value={bookingForm.hospital_name}
                  onChange={(e) => {
                    const selectedName = e.target.value;
                    setBookingForm({
                      ...bookingForm,
                      hospital_name: selectedName
                    });
                  }}
                  className="w-full text-xs font-medium p-2.5 rounded-xl border border-gray-200 bg-gray-50"
                  disabled={hospitalsLoading || hospitals.length === 0}
                >
                  {hospitalsLoading ? (
                    <option value="" disabled>Loading hospitals...</option>
                  ) : hospitalsError ? (
                    <option value="" disabled>We couldn't load the available hospitals. Please try again.</option>
                  ) : hospitals.length === 0 ? (
                    <option value="" disabled>No hospitals are currently available for appointment booking.</option>
                  ) : (
                    hospitals.map((h) => (
                      <option key={h.id || h.name} value={h.name}>
                        {h.name} {h.district ? `(${h.district})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Specialist Availability Warning Banner & Alternative Hospital Recommendations */}
              {!specialistCheck.specialist_available && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 my-2">
                  <div className="flex items-center gap-2 text-amber-800 text-xs font-bold mb-1">
                    <span>⚠️ Specialist Not Available at {bookingForm.hospital_name}</span>
                  </div>
                  <p className="text-xs text-amber-700 mb-2">
                    {specialistCheck.message || `No ${bookingForm.specialty} specialist is currently available at ${bookingForm.hospital_name}.`}
                  </p>

                  {specialistCheck.recommended_hospitals && specialistCheck.recommended_hospitals.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-amber-900 mb-1.5 uppercase tracking-wider">Suggested Alternative Hospitals:</p>
                      <div className="space-y-1.5">
                        {specialistCheck.recommended_hospitals.map(alt => (
                          <div key={alt.hospital_name} className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-amber-200 shadow-xs">
                            <div>
                              <p className="text-xs font-bold text-gray-800">{alt.hospital_name}</p>
                              <p className="text-[11px] text-gray-500">{alt.available_doctor_name} ({alt.specialty}) • {alt.district || 'Chennai'}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setBookingForm(prev => ({ ...prev, hospital_name: alt.hospital_name }))}
                              className="bg-[#1B6CA8] hover:bg-[#155A8A] text-white text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                            >
                              Select Hospital
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Required Specialty</label>
                <select
                  value={bookingForm.specialty}
                  onChange={(e) => setBookingForm({ ...bookingForm, specialty: e.target.value })}
                  className="w-full text-xs font-medium p-2.5 rounded-xl border border-gray-200 bg-gray-50"
                  disabled={specialtiesLoading || specialties.length === 0}
                >
                  {specialtiesLoading ? (
                    <option value="" disabled>Loading specialties...</option>
                  ) : specialties.length === 0 ? (
                    <option value="" disabled>No specialties are currently available at this hospital.</option>
                  ) : (
                    specialties.map(s => <option key={s} value={s}>{s}</option>)
                  )}
                </select>
              </div>

              {doctors.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Select Doctor (Optional)</label>
                  <select
                    value={bookingForm.doctor_id}
                    onChange={(e) => setBookingForm({ ...bookingForm, doctor_id: e.target.value })}
                    className="w-full text-xs font-medium p-2.5 rounded-xl border border-gray-200 bg-gray-50"
                  >
                    <option value="">Any Available Verified Specialist</option>
                    {doctors.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.qualification || d.speciality})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Date</label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={bookingForm.appointment_date}
                    onChange={(e) => setBookingForm({ ...bookingForm, appointment_date: e.target.value })}
                    className="w-full text-xs font-medium p-2.5 rounded-xl border border-gray-200 bg-gray-50"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Time Slot</label>
                  <select
                    value={bookingForm.time_slot}
                    onChange={(e) => setBookingForm({ ...bookingForm, time_slot: e.target.value })}
                    className="w-full text-xs font-medium p-2.5 rounded-xl border border-gray-200 bg-gray-50"
                    disabled={slotsLoading || !slotsData.slots?.length}
                  >
                    {slotsLoading ? (
                      <option value="" disabled>Loading appointment slots...</option>
                    ) : !slotsData.slots || slotsData.slots.filter(s => s.reason !== 'PASSED').length === 0 ? (
                      <option value="" disabled>No more appointment slots available for this date.</option>
                    ) : (
                      slotsData.slots.filter(s => s.reason !== 'PASSED').map(s => (
                        <option key={s.time} value={s.time} disabled={!s.available}>
                          {s.time} {!s.available ? '🔒 (Already Booked)' : '✓ (Available)'}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Chief Complaint / Reason</label>
                <input
                  type="text"
                  value={bookingForm.chief_complaint}
                  onChange={(e) => setBookingForm({ ...bookingForm, chief_complaint: e.target.value })}
                  placeholder="e.g. Fever and cough for 2 days"
                  className="w-full text-xs font-medium p-2.5 rounded-xl border border-gray-200 bg-gray-50"
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBookingModal(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold py-2.5 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bookingLoading}
                  className="flex-1 bg-[#1B6CA8] hover:bg-[#1557A0] text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm"
                >
                  {bookingLoading ? 'Booking...' : 'Confirm Appointment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSymptomLogger && (
        <VoiceSymptomLogger
          onClose={() => setShowSymptomLogger(false)}
          onLogSuccess={(data) => {
            refetchSummary();
          }}
          onBookAppointment={(info) => {
            setBookingForm(prev => ({
              ...prev,
              hospital_name: info.hospital_name || prev.hospital_name,
              specialty: info.specialty || prev.specialty,
              chief_complaint: info.chief_complaint || prev.chief_complaint,
              symptom_assessment_id: info.symptom_assessment_id
            }));
            setShowBookingModal(true);
          }}
        />
      )}
    </div>
  );
}
