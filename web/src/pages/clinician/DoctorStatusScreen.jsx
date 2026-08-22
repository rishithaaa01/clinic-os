import React, { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { ShieldAlert, Clock, CheckCircle2, XCircle, RefreshCcw, Building2, Stethoscope, LogOut } from 'lucide-react';

export default function DoctorStatusScreen() {
  const { user, updateUser, logout } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      const res = await api.get('/auth/me');
      if (res.data) {
        updateUser(res.data);
        toast.success("Account status updated!");
      }
    } catch (err) {
      toast.error("Failed to check status. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const vStatus = user?.verification_status || 'PENDING';
  const hStatus = user?.hospital_status || 'PENDING';
  const aStatus = user?.account_status || 'PENDING';
  const rejectionReason = user?.rejection_reason;

  const isRejected = vStatus === 'REJECTED' || hStatus === 'REJECTED' || aStatus === 'REJECTED' || vStatus === 'FAILED';
  const isHospitalPending = vStatus === 'VERIFIED' && hStatus === 'PENDING';

  return (
    <div className="min-h-screen bg-[#F7F3EE] flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-3xl border border-gray-200 shadow-xl max-w-2xl w-full overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#1B6CA8] px-8 py-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 rounded-2xl">
              <Stethoscope size={28} />
            </div>
            <div>
              <h2 className="text-xl font-bold font-mukta">Doctor Account Verification</h2>
              <p className="text-xs text-blue-100 mt-0.5">Professional Medical Credentials & Hospital Affiliation</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white flex items-center gap-1.5 text-xs font-semibold"
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          {/* Main Status Message Banner */}
          {isRejected ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-start gap-4">
              <div className="p-3 bg-red-100 text-red-600 rounded-xl shrink-0">
                <XCircle size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-red-800">Verification Could Not Be Completed</h3>
                <p className="text-xs text-red-700 mt-1 leading-relaxed">
                  Your verification could not be completed. Please review your details or contact the hospital administrator.
                </p>
                {rejectionReason && (
                  <div className="mt-3 bg-white/80 border border-red-200 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Reason provided</p>
                    <p className="text-xs text-gray-800 font-medium mt-0.5">{rejectionReason}</p>
                  </div>
                )}
              </div>
            </div>
          ) : isHospitalPending ? (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 flex items-start gap-4">
              <div className="p-3 bg-blue-100 text-[#1B6CA8] rounded-xl shrink-0">
                <Clock size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-blue-900">Hospital Affiliation Approval Pending</h3>
                <p className="text-xs text-blue-800 mt-1 leading-relaxed">
                  Your medical registration has been verified. Hospital affiliation approval is pending with your hospital administrator.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex items-start gap-4">
              <div className="p-3 bg-amber-100 text-amber-700 rounded-xl shrink-0">
                <Clock size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-amber-900">Medical Registration Verification Pending</h3>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  Your doctor account is currently under verification. You will receive access once your medical registration has been verified.
                </p>
              </div>
            </div>
          )}

          {/* Details Breakdown Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50">
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Medical Credentials</span>
                <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase ${
                  vStatus === 'VERIFIED' ? 'bg-green-100 text-green-700' :
                  vStatus === 'REJECTED' || vStatus === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {vStatus}
                </span>
              </div>
              <p className="text-sm font-bold text-gray-800 mt-2">{user?.name || 'Doctor'}</p>
              <p className="text-xs text-gray-500 mt-0.5">Reg No: <span className="font-semibold text-gray-700">{user?.medical_registration_number || 'Under Review'}</span></p>
              <p className="text-xs text-gray-500">Council: <span className="font-semibold text-gray-700">{user?.medical_council || 'State Medical Council'}</span></p>
            </div>

            <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50">
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Hospital Affiliation</span>
                <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase ${
                  hStatus === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  hStatus === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {hStatus}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Building2 size={16} className="text-[#1B6CA8]" />
                <p className="text-sm font-bold text-gray-800">{user?.requested_hospital_id || user?.hospital || 'General Hospital'}</p>
              </div>
              <p className="text-xs text-gray-500 mt-1">Specialty: <span className="font-semibold text-gray-700">{user?.speciality || 'General Medicine'}</span></p>
            </div>
          </div>

          {/* Action Footer */}
          <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-500 text-center sm:text-left">
              Contact your hospital administrator if you require urgent activation.
            </p>
            <button
              onClick={handleRefreshStatus}
              disabled={refreshing}
              className="w-full sm:w-auto px-6 py-3 bg-[#1B6CA8] hover:bg-[#154360] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-50"
            >
              <RefreshCcw size={14} className={refreshing ? 'animate-spin' : ''} />
              <span>{refreshing ? 'Checking...' : 'Check Approval Status'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
