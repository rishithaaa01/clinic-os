import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import patientApi from '../../services/patientApi';
import { useAuthStore } from '../../store/authStore';

export default function ReceptionistDashboard() {
  const { user, logout } = useAuthStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [walkInForm, setWalkInForm] = useState({
    name: '',
    mobile: '',
    gender: 'female',
    age: 30,
    hospital_name: user?.hospital || 'General Hospital',
    specialty: 'General Medicine',
    chief_complaint: 'Routine Walk-in Consultation',
    time_slot: '09:00 AM'
  });
  const [actionLoading, setActionLoading] = useState(null);

  // Today's appointments query
  const { data: appointments = [], isLoading, refetch } = useQuery({
    queryKey: ['receptionistAppointments', user?.hospital],
    queryFn: () => patientApi.getReceptionistAppointments({ hospital_name: user?.hospital }),
  });

  const filteredAppts = appointments.filter(a =>
    a.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.patient_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.specialty?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCheckIn = async (apptId) => {
    setActionLoading(apptId);
    try {
      await patientApi.checkInAppointment(apptId);
      alert('Physical check-in confirmed! Patient is now in Doctor OPD Queue.');
      refetch();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to check in patient.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleNoShow = async (apptId) => {
    if (!window.confirm('Mark this appointment as NO_SHOW? Patient will be removed from active queue.')) return;
    setActionLoading(apptId);
    try {
      await patientApi.markNoShow(apptId);
      alert('Appointment marked as NO_SHOW.');
      refetch();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to mark NO_SHOW.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleWalkInSubmit = async (e) => {
    e.preventDefault();
    setActionLoading('walkin');
    try {
      await patientApi.registerWalkIn({
        ...walkInForm,
        hospital_name: user?.hospital || walkInForm.hospital_name
      });
      alert('Walk-in patient registered and checked in successfully!');
      setShowWalkInModal(false);
      setWalkInForm({
        name: '',
        mobile: '',
        gender: 'female',
        age: 30,
        hospital_name: user?.hospital || 'General Hospital',
        specialty: 'General Medicine',
        chief_complaint: 'Routine Walk-in Consultation',
        time_slot: '09:00 AM'
      });
      refetch();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to register walk-in patient.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto flex items-center justify-between bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Hospital Receptionist Desk</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Hospital: <span className="font-semibold text-teal-700">{user?.hospital || 'General Hospital'}</span> • Logged in as {user?.name}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowWalkInModal(true)}
            className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-sm transition"
          >
            + Register Walk-In Patient
          </button>
          <button
            onClick={logout}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto">
        {/* Search & Counter Strip */}
        <div className="flex items-center justify-between mb-4 gap-4">
          <input
            type="text"
            placeholder="Search today's appointments by patient name or specialty..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 p-3 text-xs bg-white rounded-xl border border-slate-200 shadow-sm"
          />
          <div className="bg-white px-4 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 shadow-sm">
            Total Today: <span className="text-teal-600 font-extrabold">{appointments.length}</span>
          </div>
        </div>

        {/* Appointments Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-slate-400 text-xs italic">Loading today's OPD appointments...</div>
          ) : filteredAppts.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs font-medium">
              No appointments found for today.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-500 uppercase tracking-wider font-bold text-[10px]">
                <tr>
                  <th className="p-4">Time</th>
                  <th className="p-4">Patient Name</th>
                  <th className="p-4">Specialty / Doctor</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {filteredAppts.map((a) => {
                  const st = (a.status || '').toUpperCase();
                  const isCheckedIn = st === 'CHECKED_IN' || st === 'WAITING' || st === 'IN_CONSULTATION' || st === 'COMPLETED';

                  return (
                    <tr key={a.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-4 font-bold text-slate-800">{a.requested_time_slot || a.time_slot}</td>
                      <td className="p-4 font-bold text-teal-800">
                        <div>{a.patient_name}</div>
                        {a.arrival_notified && st !== 'CHECKED_IN' && st !== 'COMPLETED' && (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                            📍 Patient Indicated Arrival
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className="font-semibold block">{a.specialty || 'General Medicine'}</span>
                        <span className="text-[11px] text-slate-400">{a.doctor_name || 'Duty Specialist'}</span>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700">
                          {a.source_type || 'DIRECT'}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          st === 'CHECKED_IN' || st === 'WAITING' ? 'bg-blue-100 text-blue-800' :
                          st === 'IN_CONSULTATION' ? 'bg-purple-100 text-purple-800' :
                          st === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                          st === 'NO_SHOW' ? 'bg-red-100 text-red-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        {!isCheckedIn && st !== 'NO_SHOW' && st !== 'CANCELLED' ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleCheckIn(a.id)}
                              disabled={actionLoading === a.id}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-sm transition"
                            >
                              {actionLoading === a.id ? 'Checking in...' : 'Confirm Check-In'}
                            </button>
                            <button
                              onClick={() => handleNoShow(a.id)}
                              disabled={actionLoading === a.id}
                              className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg font-bold text-xs border border-red-200 transition"
                            >
                              No Show
                            </button>
                          </div>
                        ) : isCheckedIn ? (
                          <span className="text-emerald-600 font-bold text-[11px]">✓ In OPD Queue</span>
                        ) : (
                          <span className="text-slate-400 font-bold text-[11px]">{a.status}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Walk-in Registration Modal */}
      {showWalkInModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Register Walk-In Patient</h3>
            <p className="text-xs text-slate-500 mb-4">Add direct walk-in patient and check them into today's doctor queue.</p>
            <form onSubmit={handleWalkInSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">Patient Full Name</label>
                <input
                  type="text"
                  required
                  value={walkInForm.name}
                  onChange={(e) => setWalkInForm({ ...walkInForm, name: e.target.value })}
                  placeholder="Full Name"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold block mb-1">Mobile Number</label>
                  <input
                    type="text"
                    required
                    value={walkInForm.mobile}
                    onChange={(e) => setWalkInForm({ ...walkInForm, mobile: e.target.value })}
                    placeholder="10-digit mobile"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Age</label>
                  <input
                    type="number"
                    required
                    value={walkInForm.age}
                    onChange={(e) => setWalkInForm({ ...walkInForm, age: parseInt(e.target.value) || 30 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="font-semibold block mb-1">Specialty</label>
                <input
                  type="text"
                  value={walkInForm.specialty}
                  onChange={(e) => setWalkInForm({ ...walkInForm, specialty: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Chief Complaint</label>
                <input
                  type="text"
                  required
                  value={walkInForm.chief_complaint}
                  onChange={(e) => setWalkInForm({ ...walkInForm, chief_complaint: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowWalkInModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === 'walkin'}
                  className="flex-1 py-2.5 bg-teal-600 text-white font-bold rounded-xl"
                >
                  {actionLoading === 'walkin' ? 'Registering...' : 'Confirm & Check In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
