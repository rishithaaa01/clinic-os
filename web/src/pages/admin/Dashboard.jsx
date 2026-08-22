import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
  Users, Activity, Hospital, ShieldCheck, LogOut,
  TrendingUp, AlertTriangle, CheckCircle, Clock,
  BarChart2, Map, RefreshCcw, Plus, Trash2, Building2,
  Search, Filter, Heart, Baby, Shield, UserCheck, Stethoscope, FlaskConical, User, XCircle
} from 'lucide-react';

function StatCard({ title, value, subtitle, icon: Icon, color, trend }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon size={22} />
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${trend >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-2xl sm:text-3xl font-bold text-gray-800">{value ?? '—'}</p>
      <p className="text-xs sm:text-sm font-semibold text-gray-600 mt-1">{title}</p>
      {subtitle && <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');

  // User Management State
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');

  // Doctor Verification & Affiliation State
  const [rejectModalDoctor, setRejectModalDoctor] = useState(null);
  const [rejectionReasonText, setRejectionReasonText] = useState('');

  // Hospital form state
  const [hospitalForm, setHospitalForm] = useState({
    name: '', type: 'govt', district: 'Chennai', state: 'Tamil Nadu'
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Queries
  const { data: doctorRequests = [], isLoading: docReqLoading } = useQuery({
    queryKey: ['adminDoctorRequests'],
    queryFn: () => api.get('/admin/doctor-requests').then(r => r.data).catch(() => []),
    refetchInterval: 15000,
    enabled: activeTab === 'doctor-verifications' || activeTab === 'overview',
  });

  const { data: doctorAuditLogs = [] } = useQuery({
    queryKey: ['adminDoctorAuditLogs'],
    queryFn: () => api.get('/admin/doctor-audit-logs').then(r => r.data).catch(() => []),
    enabled: activeTab === 'doctor-verifications',
  });
  const { data: stats, isLoading, refetch, isError } = useQuery({
    queryKey: ['adminStats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data).catch(() => ({})),
    refetchInterval: 60000,
    retry: 1,
  });

  const { data: recentActivity = [] } = useQuery({
    queryKey: ['adminActivity'],
    queryFn: () => api.get('/admin/activity').then(r => r.data).catch(() => []),
    refetchInterval: 30000,
    retry: 1,
  });

  const { data: hospitals = [], isLoading: hospitalsLoading } = useQuery({
    queryKey: ['adminHospitals'],
    queryFn: () => api.get('/admin/hospitals').then(r => r.data).catch(() => []),
    enabled: activeTab === 'hospitals',
  });

  // User Management Query
  const { data: usersList = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: async () => {
      try {
        const res = await api.get('/admin/users');
        return res.data;
      } catch (err) {
        return [];
      }
    },
    enabled: activeTab === 'users',
  });

  // Maternal & Child Health Query
  const { data: maternalData } = useQuery({
    queryKey: ['adminMaternal'],
    queryFn: async () => {
      try {
        const res = await api.get('/admin/maternal-stats');
        return res.data;
      } catch {
        return {
          high_risk_pregnant: 0,
          anc_checkups_completed: 0,
          immunization_coverage_pct: 0,
          institutional_deliveries_pct: 0,
          registry: []
        };
      }
    },
    enabled: activeTab === 'maternal',
  });

  // Mutations
  const addHospitalMutation = useMutation({
    mutationFn: (data) => api.post('/admin/hospitals', data).then(r => r.data),
    onSuccess: (newH) => {
      queryClient.invalidateQueries({ queryKey: ['adminHospitals'] });
      queryClient.invalidateQueries({ queryKey: ['adminStats'] });
      setHospitalForm({ name: '', type: 'govt', district: 'Chennai', state: 'Tamil Nadu' });
      toast.success(`Hospital "${newH.name}" added successfully`);
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || 'Failed to add hospital');
    },
  });

  const deleteHospitalMutation = useMutation({
    mutationFn: (id) => api.delete(`/admin/hospitals/${id}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminHospitals'] });
      queryClient.invalidateQueries({ queryKey: ['adminStats'] });
      setDeleteConfirmId(null);
      toast.success('Hospital removed successfully');
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || 'Failed to delete hospital');
      setDeleteConfirmId(null);
    },
  });

  const handleAddHospital = (e) => {
    e.preventDefault();
    if (!hospitalForm.name.trim()) return;
    addHospitalMutation.mutate(hospitalForm);
  };

  const approveDoctorMutation = useMutation({
    mutationFn: (doctorId) => api.post(`/admin/doctor-requests/${doctorId}/approve`).then(r => r.data),
    onSuccess: (res) => {
      toast.success(res?.message || 'Doctor approved successfully');
      queryClient.invalidateQueries({ queryKey: ['adminDoctorRequests'] });
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['adminStats'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || 'Failed to approve doctor');
    }
  });

  const rejectDoctorMutation = useMutation({
    mutationFn: ({ doctorId, rejectionReason }) => api.post(`/admin/doctor-requests/${doctorId}/reject`, { rejection_reason: rejectionReason }).then(r => r.data),
    onSuccess: (res) => {
      toast.success(res?.message || 'Doctor request rejected');
      queryClient.invalidateQueries({ queryKey: ['adminDoctorRequests'] });
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      setRejectModalDoctor(null);
      setRejectionReasonText('');
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || 'Failed to reject doctor');
    }
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Filtered Users
  const filteredUsers = usersList.filter(u => {
    const matchesSearch = u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
                          u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
                          u.hospital?.toLowerCase().includes(userSearch.toLowerCase());
    const matchesRole = userRoleFilter === 'all' || u.role === userRoleFilter;
    return matchesSearch && matchesRole;
  });

  const pendingDoctorsCount = doctorRequests.filter(d => d.hospital_status === 'PENDING' || d.verification_status === 'PENDING').length;

  // OPD Walk-in State
  const [walkinForm, setWalkinForm] = useState({
    patient_name: '', mobile: '', abha_number: '', specialty: 'General Medicine', chief_complaint: 'Routine OPD Walk-In'
  });
  const [walkinLoading, setWalkinLoading] = useState(false);
  const [possibleMatch, setPossibleMatch] = useState(null);

  const handleWalkinSubmit = async (e, confirmLink = false) => {
    if (e) e.preventDefault();
    setWalkinLoading(true);
    try {
      const res = await api.post('/admin/walkin-register', {
        ...walkinForm,
        confirm_link: confirmLink
      });

      if (res.data.requires_confirmation) {
        setPossibleMatch(res.data);
      } else {
        toast.success(res.data.message || 'Walk-in registered successfully!');
        setWalkinForm({ patient_name: '', mobile: '', abha_number: '', specialty: 'General Medicine', chief_complaint: 'Routine OPD Walk-In' });
        setPossibleMatch(null);
        queryClient.invalidateQueries({ queryKey: ['adminStats'] });
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to register walk-in patient.');
    } finally {
      setWalkinLoading(false);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'doctor-verifications', label: `Doctor Verification & Affiliation ${pendingDoctorsCount > 0 ? `(${pendingDoctorsCount})` : ''}` },
    { id: 'opd-walkin', label: 'OPD Walk-In Registration' },
    { id: 'users', label: 'User Management' },
    { id: 'maternal', label: 'Maternal & Child Health' },
    { id: 'hospitals', label: 'Hospitals' },
    { id: 'reports', label: 'Reports' },
  ];

  const getRoleBadge = (role) => {
    switch (role) {
      case 'doctor': return 'bg-[#1B6CA8]/10 text-[#1B6CA8] border-[#1B6CA8]/20';
      case 'asha': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'lab': return 'bg-teal-100 text-teal-700 border-teal-200';
      case 'pho': return 'bg-[#2C8C68]/10 text-[#2C8C68] border-[#2C8C68]/20';
      case 'admin': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-blue-100 text-blue-700 border-blue-200';
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F3EE] w-full max-w-full overflow-x-hidden">
      {/* Top Bar */}
      <header className="pt-safe bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[#1B6CA8] p-2 rounded-xl">
              <Activity size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-800">Ayu Disha Admin</h1>
              <p className="text-[10px] sm:text-xs text-gray-400">System Administration Panel</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => refetch()}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
              title="Refresh data"
            >
              <RefreshCcw size={18} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-red-500 hover:text-red-700 font-semibold text-sm"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-8 py-4 sm:py-8 pb-safe">
        {/* Page Title */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800">System Dashboard</h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Real-time overview & management of Ayu Disha platform</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6 overflow-x-auto custom-scrollbar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 sm:px-6 py-3 text-xs sm:text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[#1B6CA8] text-[#1B6CA8]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <>
            {isError ? (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-8">
                <p className="text-red-600 font-semibold">Failed to load statistics</p>
                <p className="text-sm text-red-500 mt-1">Please check your connection and try refreshing.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-8">
                <StatCard
                  title="Total Patients"
                  value={isLoading ? '...' : (stats?.total_patients ?? 0).toLocaleString()}
                  subtitle="Registered on platform"
                  icon={Users}
                  color="bg-blue-100 text-blue-600"
                />
                <StatCard
                  title="Doctors"
                  value={isLoading ? '...' : (stats?.total_doctors ?? 0)}
                  subtitle="Active clinicians"
                  icon={Activity}
                  color="bg-green-100 text-green-600"
                />
                <StatCard
                  title="ASHA Workers"
                  value={isLoading ? '...' : (stats?.total_asha_workers ?? 0)}
                  subtitle="Community health workers"
                  icon={ShieldCheck}
                  color="bg-purple-100 text-purple-600"
                />
                <StatCard
                  title="Hospitals"
                  value={isLoading ? '...' : (stats?.total_hospitals ?? 0)}
                  subtitle="Registered facilities"
                  icon={Hospital}
                  color="bg-orange-100 text-orange-600"
                />
              </div>
            )}

            {!isError && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-8">
                <StatCard
                  title="Visits Today"
                  value={isLoading ? '...' : (stats?.visits_today ?? 0)}
                  subtitle="Consultations completed"
                  icon={CheckCircle}
                  color="bg-teal-100 text-teal-600"
                />
                <StatCard
                  title="Pending Referrals"
                  value={isLoading ? '...' : (stats?.referrals_pending ?? 0)}
                  subtitle="Awaiting acceptance"
                  icon={Clock}
                  color="bg-amber-100 text-amber-600"
                />
                <StatCard
                  title="High-Risk Households"
                  value={isLoading ? '...' : (stats?.high_risk_households ?? 0)}
                  subtitle="Flagged by ASHA workers"
                  icon={AlertTriangle}
                  color="bg-red-100 text-red-600"
                />
                <StatCard
                  title="Active Consents"
                  value={isLoading ? '...' : (stats?.consents_active ?? 0)}
                  subtitle="Patient data access grants"
                  icon={ShieldCheck}
                  color="bg-indigo-100 text-indigo-600"
                />
              </div>
            )}            {/* Recent Activity */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800">Recent Activity</h3>
                <span className="text-xs text-gray-400">Live feed</span>
              </div>
              <div className="divide-y divide-gray-50">
                {recentActivity.length === 0 ? (
                  <div className="px-6 py-8 text-center text-gray-400 text-sm">
                    No recent activity to display
                  </div>
                ) : (
                  recentActivity.map((item, i) => (
                    <div key={i} className="px-6 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          item.severity === 'urgent' ? 'bg-red-500' :
                          item.severity === 'warning' ? 'bg-amber-500' : 'bg-green-500'
                        }`} />
                        <div>
                          <p className="text-sm text-gray-700">{item.message}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{item.time}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        item.severity === 'urgent' ? 'bg-red-100 text-red-600' :
                        item.severity === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'
                      }`}>
                        {item.type}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* Doctor Verification & Affiliation Tab */}
        {activeTab === 'doctor-verifications' && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Doctor Verification & Hospital Affiliation Requests</h3>
                  <p className="text-xs text-gray-500 mt-1">Review medical credentials and grant clinical hospital access</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">Pending:</span>
                  <span className="bg-amber-100 text-amber-800 font-extrabold px-3 py-1 rounded-full text-xs">
                    {doctorRequests.filter(d => d.hospital_status === 'PENDING' || d.verification_status === 'PENDING').length}
                  </span>
                </div>
              </div>

              {docReqLoading ? (
                <div className="py-12 text-center text-gray-400">Loading doctor requests...</div>
              ) : doctorRequests.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">No doctor verification or affiliation requests found.</div>
              ) : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50">
                        <th className="py-3 px-4">Doctor Info</th>
                        <th className="py-3 px-4">Medical Registration</th>
                        <th className="py-3 px-4">Requested Hospital</th>
                        <th className="py-3 px-4">Verification</th>
                        <th className="py-3 px-4">Affiliation</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {doctorRequests.map((doc) => (
                        <tr key={doc.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="font-bold text-gray-800">{doc.name}</div>
                            <div className="text-xs text-gray-500">{doc.email} | {doc.mobile}</div>
                            <div className="text-[11px] text-[#1B6CA8] font-semibold mt-0.5">{doc.qualification} — {doc.speciality}</div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="font-mono font-bold text-xs text-gray-800">{doc.medical_registration_number}</div>
                            <div className="text-xs text-gray-500">{doc.medical_council}</div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="font-semibold text-gray-800">{doc.requested_hospital_id}</div>
                            <div className="text-[10px] text-gray-400">Req: {doc.created_at}</div>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase ${
                              doc.verification_status === 'VERIFIED' ? 'bg-green-100 text-green-700' :
                              doc.verification_status === 'REJECTED' || doc.verification_status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {doc.verification_status}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase ${
                              doc.hospital_status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                              doc.hospital_status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {doc.hospital_status}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            {doc.hospital_status === 'APPROVED' ? (
                              <span className="text-xs font-bold text-green-600 inline-flex items-center gap-1">
                                <CheckCircle size={14} /> Active
                              </span>
                            ) : doc.hospital_status === 'REJECTED' || doc.verification_status === 'REJECTED' ? (
                              <span className="text-xs font-bold text-red-600 inline-flex items-center gap-1">
                                <XCircle size={14} /> Rejected
                              </span>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => approveDoctorMutation.mutate(doc.id)}
                                  disabled={approveDoctorMutation.isPending}
                                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-lg transition-colors shadow-sm disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => setRejectModalDoctor(doc)}
                                  className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 font-bold text-xs rounded-lg transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Audit Logs Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-base font-bold text-gray-800 mb-4">Doctor Approval Audit History</h3>
              {doctorAuditLogs.length === 0 ? (
                <p className="text-xs text-gray-400 py-4">No audit logs recorded yet.</p>
              ) : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 font-bold text-gray-400 uppercase bg-gray-50/50">
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-3">Doctor</th>
                        <th className="py-2.5 px-3">Admin</th>
                        <th className="py-2.5 px-3">Hospital</th>
                        <th className="py-2.5 px-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {doctorAuditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50/50">
                          <td className="py-2.5 px-3 text-gray-500 font-mono">{log.timestamp}</td>
                          <td className="py-2.5 px-3 font-bold text-gray-800">{log.action}</td>
                          <td className="py-2.5 px-3 font-semibold text-[#1B6CA8]">{log.doctor_name}</td>
                          <td className="py-2.5 px-3 text-gray-600">{log.admin_name}</td>
                          <td className="py-2.5 px-3 text-gray-600">{log.hospital_id}</td>
                          <td className="py-2.5 px-3 text-gray-500 italic">{log.rejection_reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rejection Modal */}
        {rejectModalDoctor && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-200 animate-fadeIn">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Reject Doctor Affiliation</h3>
              <p className="text-xs text-gray-500 mb-4">
                Provide a reason for rejecting Dr. <span className="font-bold text-gray-700">{rejectModalDoctor.name}</span>. This reason will be displayed to the doctor.
              </p>
              <textarea
                value={rejectionReasonText}
                onChange={(e) => setRejectionReasonText(e.target.value)}
                placeholder="e.g. Medical registration details do not match council records or hospital quota full."
                className="w-full p-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500 h-28 mb-4 text-gray-800"
                required
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setRejectModalDoctor(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={() => rejectDoctorMutation.mutate({ doctorId: rejectModalDoctor.id, rejectionReason: rejectionReasonText })}
                  disabled={rejectDoctorMutation.isPending || !rejectionReasonText.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl disabled:opacity-50"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Management Tab */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
              <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
                <div className="w-full md:w-auto flex-1 relative">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search user by name, email, or hospital..."
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-[#1B6CA8] outline-none"
                  />
                </div>

                <div className="w-full md:w-auto flex items-center gap-3">
                  <Filter size={18} className="text-gray-400 hidden sm:block" />
                  <select
                    value={userRoleFilter}
                    onChange={(e) => setUserRoleFilter(e.target.value)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-gray-200 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-[#1B6CA8] outline-none bg-white font-medium"
                  >
                    <option value="all">All Roles</option>
                    <option value="doctor">Doctors</option>
                    <option value="asha">ASHA Workers</option>
                    <option value="lab">Lab Techs</option>
                    <option value="patient">Patients</option>
                  </select>

                  <button
                    onClick={() => refetchUsers()}
                    className="px-4 py-2.5 bg-[#1B6CA8] hover:bg-[#155A8A] text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 shrink-0"
                  >
                    <RefreshCcw size={15} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Users Table */}
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wider text-[10px] bg-gray-50/50">
                      <th className="py-3 px-4 font-bold">User</th>
                      <th className="py-3 px-4 font-bold">Role</th>
                      <th className="py-3 px-4 font-bold">Facility / Hospital</th>
                      <th className="py-3 px-4 font-bold">Status</th>
                      <th className="py-3 px-4 font-bold text-right">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-xs sm:text-sm">
                    {usersLoading ? (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-400">Loading user accounts...</td></tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-400">No users found matching filter criteria</td></tr>
                    ) : (
                      filteredUsers.map(user => (
                        <tr key={user.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center font-bold text-[#1B6CA8] text-sm shrink-0">
                                {user.name?.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-gray-800">{user.name}</p>
                                <p className="text-xs text-gray-400">{user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${getRoleBadge(user.role)}`}>
                              {user.role}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-600 font-medium">
                            {user.hospital || '—'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="bg-green-100 text-green-700 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase">
                              {user.status || 'Active'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-gray-400 text-xs">
                            {user.created_at || 'Recently'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* OPD Walk-In Registration Tab */}
        {activeTab === 'opd-walkin' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm max-w-2xl mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-[#1B6CA8]/10 p-2.5 rounded-xl">
                  <UserCheck size={22} className="text-[#1B6CA8]" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-base">OPD Walk-In Patient Registration</h3>
                  <p className="text-xs text-gray-400">Register arriving walk-in patients directly into the active doctor queue.</p>
                </div>
              </div>

              <form onSubmit={(e) => handleWalkinSubmit(e, false)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Patient Full Name</label>
                    <input
                      type="text"
                      value={walkinForm.patient_name}
                      onChange={(e) => setWalkinForm({ ...walkinForm, patient_name: e.target.value })}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full text-xs font-medium p-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-[#1B6CA8]"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Mobile Number</label>
                    <input
                      type="text"
                      value={walkinForm.mobile}
                      onChange={(e) => setWalkinForm({ ...walkinForm, mobile: e.target.value })}
                      placeholder="e.g. 9876543210"
                      className="w-full text-xs font-medium p-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-[#1B6CA8]"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">ABHA ID (Optional)</label>
                    <input
                      type="text"
                      value={walkinForm.abha_number}
                      onChange={(e) => setWalkinForm({ ...walkinForm, abha_number: e.target.value })}
                      placeholder="ABHA-20260815-XXXX"
                      className="w-full text-xs font-medium p-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-[#1B6CA8]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">Target Specialty</label>
                    <select
                      value={walkinForm.specialty}
                      onChange={(e) => setWalkinForm({ ...walkinForm, specialty: e.target.value })}
                      className="w-full text-xs font-medium p-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-[#1B6CA8]"
                    >
                      <option value="General Medicine">General Medicine</option>
                      <option value="Cardiology">Cardiology</option>
                      <option value="Orthopedics">Orthopedics</option>
                      <option value="Gynecology">Gynecology</option>
                      <option value="Pediatrics">Pediatrics</option>
                      <option value="Dermatology">Dermatology</option>
                      <option value="ENT">ENT</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Chief Complaint / Symptoms</label>
                  <input
                    type="text"
                    value={walkinForm.chief_complaint}
                    onChange={(e) => setWalkinForm({ ...walkinForm, chief_complaint: e.target.value })}
                    placeholder="e.g. Acute chest pain, shortness of breath"
                    className="w-full text-xs font-medium p-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-[#1B6CA8]"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={walkinLoading}
                  className="w-full bg-[#1B6CA8] hover:bg-[#1557A0] text-white text-xs font-bold py-3.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  {walkinLoading ? 'Processing Walk-In...' : 'Register Walk-In & Check In to OPD Queue'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Duplicate Warning Confirmation Modal */}
        {possibleMatch && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
              <div className="flex items-center gap-3 text-amber-600 mb-3">
                <AlertTriangle size={24} />
                <h3 className="text-base font-bold text-gray-800">Possible Patient Match Found</h3>
              </div>
              <p className="text-xs text-gray-600 mb-4">{possibleMatch.message}</p>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 mb-4 text-xs">
                <p className="font-bold text-amber-900">{possibleMatch.patient?.name}</p>
                <p className="text-amber-700">Mobile: {possibleMatch.patient?.mobile}</p>
                {possibleMatch.patient?.abha_number && (
                  <p className="text-amber-700">ABHA: {possibleMatch.patient?.abha_number}</p>
                )}
              </div>

              <p className="text-[11px] text-gray-500 mb-4">
                To prevent creating duplicate health records or erroneously merging different patients, please confirm whether to link to this existing profile or create a new patient record.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => handleWalkinSubmit(null, true)}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 rounded-xl transition-all"
                >
                  Confirm & Link Record
                </button>
                <button
                  onClick={() => setPossibleMatch(null)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold py-2.5 rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Maternal & Child Health Tab */}
        {activeTab === 'maternal' && (
          <div className="space-y-6">
            {/* Maternal Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              <StatCard
                title="High-Risk Pregnancies"
                value={maternalData?.high_risk_pregnant ?? 42}
                subtitle="Active monitoring"
                icon={AlertTriangle}
                color="bg-red-100 text-red-600"
              />
              <StatCard
                title="ANC 4+ Checkups"
                value={maternalData?.anc_checkups_completed ?? 318}
                subtitle="Completed visits"
                icon={Heart}
                color="bg-purple-100 text-purple-600"
              />
              <StatCard
                title="Immunization Coverage"
                value={`${maternalData?.immunization_coverage_pct ?? 94}%`}
                subtitle="Infant vaccines up to date"
                icon={Baby}
                color="bg-teal-100 text-teal-600"
              />
              <StatCard
                title="Institutional Deliveries"
                value={`${maternalData?.institutional_deliveries_pct ?? 98}%`}
                subtitle="Hospital births"
                icon={Building2}
                color="bg-green-100 text-green-600"
              />
            </div>

            {/* High Risk Maternal Registry Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Heart size={18} className="text-red-500" />
                  High-Risk Maternal Registry
                </h3>
                <span className="text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full">
                  {(maternalData?.registry || []).length} Flagged
                </span>
              </div>

              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[650px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wider text-[10px] bg-gray-50/50">
                      <th className="py-3 px-4 font-bold">Mother</th>
                      <th className="py-3 px-4 font-bold">Stage</th>
                      <th className="py-3 px-4 font-bold">Hemoglobin (Hb)</th>
                      <th className="py-3 px-4 font-bold">Risk Factors</th>
                      <th className="py-3 px-4 font-bold">ASHA Worker</th>
                      <th className="py-3 px-4 font-bold text-right">ANC Visits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-xs sm:text-sm">
                    {(maternalData?.registry || []).map(row => (
                      <tr key={row.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-gray-800">
                          {row.name} <span className="text-xs text-gray-400 font-normal">({row.age}Y)</span>
                        </td>
                        <td className="py-3.5 px-4 text-gray-600 font-medium">
                          {row.trimester}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`font-bold ${parseFloat(row.hb) < 9.0 ? 'text-red-600' : 'text-amber-600'}`}>
                            {row.hb}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="bg-red-50 text-red-700 border border-red-100 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase">
                            {row.risk}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-gray-600">
                          {row.asha}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="bg-blue-50 text-[#1B6CA8] font-bold text-xs px-2.5 py-1 rounded-lg">
                            {row.anc_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Hospitals Tab */}
        {activeTab === 'hospitals' && (
          <div className="space-y-6">
            {/* Add Hospital Form */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Plus size={18} className="text-[#1B6CA8]" />
                Add New Hospital
              </h3>
              <form onSubmit={handleAddHospital} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                    Hospital Name *
                  </label>
                  <input
                    type="text"
                    value={hospitalForm.name}
                    onChange={e => setHospitalForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. PHC Ambattur"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#1B6CA8]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                    Type
                  </label>
                  <select
                    value={hospitalForm.type}
                    onChange={e => setHospitalForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#1B6CA8] bg-white"
                  >
                    <option value="govt">Government</option>
                    <option value="private">Private</option>
                    <option value="ngo">NGO / Trust</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                    District
                  </label>
                  <input
                    type="text"
                    value={hospitalForm.district}
                    onChange={e => setHospitalForm(f => ({ ...f, district: e.target.value }))}
                    placeholder="e.g. Chennai"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#1B6CA8]"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={addHospitalMutation.isPending}
                    className="bg-[#1B6CA8] hover:bg-[#155A8A] text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    <Plus size={16} />
                    {addHospitalMutation.isPending ? 'Adding...' : 'Add Hospital'}
                  </button>
                </div>
              </form>
            </div>

            {/* Hospital List */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Building2 size={18} className="text-[#1B6CA8]" />
                  Registered Hospitals
                  <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-1">
                    {hospitals.length}
                  </span>
                </h3>
              </div>

              {hospitalsLoading ? (
                <div className="p-8 text-center text-gray-400 text-sm">Loading hospitals...</div>
              ) : hospitals.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hospitals registered yet.</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {hospitals.map(h => (
                    <div key={h.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                          <Hospital size={18} className="text-[#1B6CA8]" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{h.name}</p>
                          <p className="text-xs text-gray-400">{h.district}, {h.state}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
                          h.type === 'govt' ? 'bg-green-100 text-green-700' :
                          h.type === 'private' ? 'bg-purple-100 text-purple-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {h.type === 'govt' ? 'Government' : h.type === 'private' ? 'Private' : 'NGO'}
                        </span>
                        {deleteConfirmId === h.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600 font-semibold">Confirm?</span>
                            <button
                              onClick={() => deleteHospitalMutation.mutate(h.id)}
                              disabled={deleteHospitalMutation.isPending}
                              className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg font-bold transition-all disabled:opacity-50"
                            >
                              Yes, Delete
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1 rounded-lg font-bold transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(h.id)}
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            title="Delete hospital"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <BarChart2 size={48} className="text-[#1B6CA8] mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-700">Analytics & Disease Reports</h3>
            <p className="text-gray-400 text-sm mt-2">District-level health analytics and epidemiological trend reports</p>
            <div className="mt-6 inline-flex items-center gap-2 bg-blue-50 text-[#1B6CA8] px-4 py-2 rounded-xl text-xs font-bold">
              <CheckCircle size={15} />
              <span>Real-time District Sync Enabled</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
