import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/clinicianApi';
import { useAuthStore } from '../../store/authStore';
import { 
  Calendar, Clock, User, Building2, CheckCircle2, 
  AlertCircle, RefreshCw, Sparkles, Check, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function AppointmentsScreen() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'REQUESTS' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'ALL'>('REQUESTS');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  const { data: appointments = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['doctorAppointments'],
    queryFn: async () => {
      const raw = await api.getDoctorAppointments();
      const list = Array.isArray(raw) ? raw : [];
      const seen = new Set();
      return list.filter((a: any) => {
        const id = a.id || a.appointment_id || a._id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },
    refetchInterval: 10000,
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, action, message }: { id: string; action: 'accept' | 'reject'; message?: string }) => 
      api.post(`/appointments/${id}/respond`, { action, message }),
    onSuccess: (res, variables) => {
      const verb = variables.action === 'accept' ? 'accepted & confirmed' : 'declined';
      toast.success(`Appointment request ${verb}!`);
      setRejectingId(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['doctorAppointments'] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to process request.');
    }
  });

  const checkInMutation = useMutation({
    mutationFn: (id: string) => api.checkInAppointment(id),
    onSuccess: (res) => {
      toast.success(res?.message || 'Patient checked in successfully! Added to OPD Queue.');
      queryClient.invalidateQueries({ queryKey: ['doctorAppointments'] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to check in patient.');
    }
  });

  const filteredAppointments = appointments.filter((a: any) => {
    const st = (a.status || '').toUpperCase();
    if (filter === 'REQUESTS') return st === 'REQUESTED' || st === 'PENDING';
    if (filter === 'CONFIRMED') return st === 'CONFIRMED' || st === 'ACCEPTED' || st === 'UPCOMING';
    if (filter === 'CHECKED_IN') return st === 'CHECKED_IN' || st === 'WAITING' || st === 'IN_CONSULTATION';
    if (filter === 'COMPLETED') return st === 'COMPLETED';
    return true;
  });

  const pendingRequestsCount = appointments.filter((a: any) => ['REQUESTED', 'PENDING'].includes((a.status || '').toUpperCase())).length;
  const confirmedCount = appointments.filter((a: any) => ['CONFIRMED', 'ACCEPTED', 'UPCOMING'].includes((a.status || '').toUpperCase())).length;
  const checkedInCount = appointments.filter((a: any) => ['CHECKED_IN', 'WAITING', 'IN_CONSULTATION'].includes((a.status || '').toUpperCase())).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E2DDD8] shadow-sm">
        <div>
          <div className="flex items-center gap-2.5 text-[#1B6CA8] mb-1">
            <Calendar size={24} />
            <h2 className="text-xl sm:text-2xl font-bold font-mukta text-gray-800">Direct Appointments</h2>
          </div>
          <p className="text-xs sm:text-sm text-gray-500">
            Review patient appointment requests, accept bookings, and track expected arrivals for Dr. {user?.name || 'Specialist'}.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#F7F3EE] hover:bg-[#E2DDD8] text-gray-700 text-xs font-bold rounded-xl transition-all self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-amber-50/70 p-5 rounded-2xl border border-amber-200/80 shadow-sm">
          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">Pending Requests</p>
          <p className="text-3xl font-extrabold text-amber-900">{pendingRequestsCount}</p>
        </div>
        <div className="bg-blue-50/70 p-5 rounded-2xl border border-blue-200/80 shadow-sm">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-1">Confirmed Appointments</p>
          <p className="text-3xl font-extrabold text-[#1B6CA8]">{confirmedCount}</p>
        </div>
        <div className="bg-emerald-50/70 p-5 rounded-2xl border border-emerald-200/80 shadow-sm">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-1">Checked In / Queue</p>
          <p className="text-3xl font-extrabold text-emerald-700">{checkedInCount}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[#E2DDD8] pb-3">
        {[
          { key: 'REQUESTS', label: `Pending Requests (${pendingRequestsCount})` },
          { key: 'CONFIRMED', label: `Confirmed (${confirmedCount})` },
          { key: 'CHECKED_IN', label: `Checked In / OPD Queue (${checkedInCount})` },
          { key: 'COMPLETED', label: 'Completed' },
          { key: 'ALL', label: `All History (${appointments.length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key as any)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              filter === tab.key
                ? 'bg-[#1B6CA8] text-white shadow-sm'
                : 'bg-white text-gray-600 border border-[#E2DDD8] hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Appointments List */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-24 bg-white border border-[#E2DDD8] animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : filteredAppointments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2DDD8] p-12 text-center text-gray-400 shadow-sm">
          <Calendar size={48} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-base font-bold text-gray-700">No {filter.toLowerCase()} appointments</h3>
          <p className="text-xs text-gray-400 mt-1">Direct patient appointment requests will appear here for review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAppointments.map((appt: any) => {
            const st = (appt.status || 'REQUESTED').toUpperCase();
            const isPending = st === 'REQUESTED' || st === 'PENDING';
            const apptId = appt.id || appt.appointment_id;

            return (
              <div
                key={apptId}
                className="bg-white rounded-2xl border border-[#E2DDD8] p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Info */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-gray-900">{appt.patient_name}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full font-semibold">
                        {appt.age || appt.patient_age} Yrs • {appt.gender || appt.patient_gender}
                      </span>
                      <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase bg-blue-50 text-blue-700 border border-blue-100">
                        👤 Direct Appointment Request
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
                      <div className="flex items-center gap-1">
                        <Clock size={14} className="text-[#1B6CA8]" />
                        <span className="font-semibold">{appt.appointment_date} at {appt.appointment_time}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Building2 size={14} className="text-gray-400" />
                        <span>{appt.hospital_name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Sparkles size={14} className="text-amber-500" />
                        <span>{appt.specialty}</span>
                      </div>
                    </div>

                    {appt.chief_complaint && (
                      <p className="text-xs text-gray-500 bg-gray-50 p-2.5 rounded-xl border border-gray-100 italic">
                        "Chief Complaint: {appt.chief_complaint}"
                      </p>
                    )}
                  </div>

                  {/* Actions & Status */}
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 shrink-0 self-end md:self-center">
                    {isPending ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => respondMutation.mutate({ id: apptId, action: 'accept' })}
                          disabled={respondMutation.isPending}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                        >
                          <Check size={14} />
                          <span>Accept Request</span>
                        </button>
                        <button
                          onClick={() => setRejectingId(apptId)}
                          disabled={respondMutation.isPending}
                          className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold px-3 py-2 rounded-xl transition-all"
                        >
                          Decline
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs font-bold px-3 py-1.5 rounded-xl uppercase ${
                          st === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                          st === 'CONFIRMED' || st === 'ACCEPTED' ? 'bg-blue-100 text-blue-700' :
                          st === 'CHECKED_IN' || st === 'WAITING' ? 'bg-indigo-100 text-indigo-700' :
                          st === 'IN_CONSULTATION' ? 'bg-purple-100 text-purple-700' :
                          st === 'REJECTED' || st === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {st === 'CONFIRMED' || st === 'ACCEPTED' ? '✓ Confirmed (In OPD Queue)' :
                           st === 'CHECKED_IN' || st === 'WAITING' ? '✓ Checked In (In OPD Queue)' : st}
                        </span>

                        {(st === 'CONFIRMED' || st === 'ACCEPTED' || st === 'CHECKED_IN' || st === 'WAITING') && (
                          <button
                            onClick={() => navigate(`/clinician/queue?patient_id=${appt.patient_id}`)}
                            className="bg-[#1B6CA8] hover:bg-[#155483] text-white text-xs font-bold px-3.5 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                          >
                            <span>Start Consultation 🩺</span>
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Optional Decline Reason Prompt Inline */}
                {rejectingId === apptId && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-center gap-2 bg-red-50/50 p-3 rounded-xl">
                    <input
                      type="text"
                      placeholder="Optional reason for declining (e.g. Doctor away at conference)..."
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="w-full text-xs px-3 py-2 border border-red-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400 bg-white"
                    />
                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                      <button
                        onClick={() => respondMutation.mutate({ id: apptId, action: 'reject', message: rejectReason })}
                        disabled={respondMutation.isPending}
                        className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all"
                      >
                        Confirm Decline
                      </button>
                      <button
                        onClick={() => setRejectingId(null)}
                        className="w-full sm:w-auto bg-gray-200 text-gray-700 text-xs font-bold px-3 py-2 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
