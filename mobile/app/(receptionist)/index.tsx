import React, { useEffect, useState } from 'react';
import { 
  View, Text, ScrollView, TouchableOpacity, TextInput, 
  RefreshControl, ActivityIndicator, Alert 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { Building2, Clock, Check, XCircle, LogOut, Search, RefreshCw, UserCheck } from 'lucide-react-native';
import { useRouter } from 'expo-router';

export default function ReceptionistDashboardScreen() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();

  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const res = await api.get('/appointments/receptionist/today');
      setAppointments(res.data || []);
    } catch (err: any) {
      console.log('Error fetching receptionist appointments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, []);

  const handleCheckIn = async (id: string) => {
    try {
      setActionId(id);
      const res = await api.post(`/appointments/${id}/check-in`);
      Alert.alert('Checked In 🟢', res.data?.message || 'Physical check-in confirmed! Patient is now in Doctor OPD Queue.');
      fetchAppointments();
    } catch (err: any) {
      Alert.alert('Check-In Error', err?.response?.data?.detail || 'Failed to check in patient.');
    } finally {
      setActionId(null);
    }
  };

  const handleNoShow = async (id: string) => {
    Alert.alert(
      'Confirm No-Show',
      'Are you sure you want to mark this appointment as NO_SHOW?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Mark NO_SHOW', 
          style: 'destructive',
          onPress: async () => {
            try {
              setActionId(id);
              await api.post(`/appointments/${id}/no-show`);
              Alert.alert('Marked NO_SHOW', 'Appointment marked as NO_SHOW.');
              fetchAppointments();
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.detail || 'Failed to mark NO_SHOW.');
            } finally {
              setActionId(null);
            }
          }
        }
      ]
    );
  };

  const filteredAppointments = appointments.filter((a: any) =>
    (a.patient_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.specialty || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.doctor_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        className="flex-1 px-4 pt-6"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchAppointments} />}
      >
        {/* Header */}
        <View className="flex-row justify-between items-center mb-5">
          <View className="flex-1 mr-2">
            <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Hospital Reception Desk</Text>
            <Text className="text-slate-800 text-2xl font-bold mt-0.5">Today's OPD Desk</Text>
            <Text className="text-teal-600 font-semibold text-xs mt-0.5">{user?.hospital || 'General Hospital'}</Text>
          </View>
          <TouchableOpacity 
            className="p-3 bg-red-50 border border-red-200 rounded-2xl flex-row items-center"
            onPress={() => {
              logout();
              router.replace('/(auth)/login');
            }}
          >
            <LogOut size={16} color="#dc2626" />
          </TouchableOpacity>
        </View>

        {/* Search Input */}
        <View className="bg-white rounded-2xl p-3 mb-4 border border-slate-200 flex-row items-center shadow-sm">
          <Search size={18} color="#64748b" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search patient name, doctor or specialty..."
            value={searchTerm}
            onChangeText={setSearchTerm}
            className="flex-1 text-slate-800 text-xs font-medium"
          />
        </View>

        {/* Appointments Summary Bar */}
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-slate-800 font-bold text-base">Appointments Today ({filteredAppointments.length})</Text>
          <TouchableOpacity onPress={fetchAppointments} className="flex-row items-center">
            <RefreshCw size={14} color="#0d9488" style={{ marginRight: 4 }} />
            <Text className="text-teal-600 text-xs font-bold">Refresh</Text>
          </TouchableOpacity>
        </View>

        {/* Appointments List */}
        {loading && appointments.length === 0 ? (
          <View className="py-12 items-center justify-center">
            <ActivityIndicator size="large" color="#0d9488" />
            <Text className="text-slate-400 text-xs mt-2">Loading today's schedule...</Text>
          </View>
        ) : filteredAppointments.length === 0 ? (
          <View className="bg-white rounded-3xl p-8 items-center justify-center border border-slate-100 mt-2">
            <Building2 size={40} color="#cbd5e1" />
            <Text className="text-slate-700 font-bold text-base mt-3">No appointments found</Text>
            <Text className="text-slate-400 text-xs text-center mt-1">
              Today's OPD bookings for your hospital will appear here.
            </Text>
          </View>
        ) : (
          filteredAppointments.map((appt: any) => {
            const st = (appt.status || 'BOOKED').toUpperCase();
            const isCheckedIn = ['CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED'].includes(st);
            const apptId = appt.id || appt.appointment_id;

            return (
              <View key={apptId} className="bg-white rounded-3xl p-4 mb-4 border border-slate-100 shadow-sm">
                <View className="flex-row justify-between items-start mb-2">
                  <View className="flex-1 mr-2">
                    <Text className="text-slate-800 font-bold text-lg">{appt.patient_name}</Text>
                    {appt.arrival_notified && !isCheckedIn && (
                      <View className="bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full mt-1 self-start">
                        <Text className="text-amber-800 text-[10px] font-extrabold">📍 Patient Indicated Arrival</Text>
                      </View>
                    )}
                  </View>
                  <View className={`px-2.5 py-1 rounded-full ${
                    isCheckedIn ? 'bg-blue-100' :
                    st === 'NO_SHOW' || st === 'CANCELLED' ? 'bg-red-100' :
                    'bg-amber-100'
                  }`}>
                    <Text className={`text-[10px] font-bold ${
                      isCheckedIn ? 'text-blue-800' :
                      st === 'NO_SHOW' || st === 'CANCELLED' ? 'text-red-800' :
                      'text-amber-800'
                    }`}>
                      {st}
                    </Text>
                  </View>
                </View>

                {/* Details */}
                <View className="bg-slate-50 rounded-2xl p-3 mb-3 border border-slate-100 space-y-1">
                  <View className="flex-row items-center">
                    <Clock size={14} color="#0d9488" />
                    <Text className="text-slate-700 font-bold text-xs ml-1.5">
                      {appt.requested_date} at {appt.requested_time_slot || appt.time_slot}
                    </Text>
                  </View>
                  <Text className="text-slate-600 text-xs font-semibold mt-1">
                    Doctor: {appt.doctor_name || 'Duty Specialist'} ({appt.specialty || 'General Medicine'})
                  </Text>
                </View>

                {/* Action Buttons */}
                {!isCheckedIn && st !== 'NO_SHOW' && st !== 'CANCELLED' ? (
                  <View className="flex-row gap-2 mt-1">
                    <TouchableOpacity
                      className="flex-1 bg-emerald-600 py-2.5 rounded-xl items-center justify-center flex-row"
                      onPress={() => handleCheckIn(apptId)}
                      disabled={actionId === apptId}
                    >
                      {actionId === apptId ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <Check size={14} color="white" />
                          <Text className="text-white text-xs font-bold ml-1">Confirm Check-In</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      className="bg-red-50 border border-red-200 py-2.5 px-3 rounded-xl items-center justify-center"
                      onPress={() => handleNoShow(apptId)}
                      disabled={actionId === apptId}
                    >
                      <Text className="text-red-600 text-xs font-bold">No Show</Text>
                    </TouchableOpacity>
                  </View>
                ) : isCheckedIn ? (
                  <View className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 items-center">
                    <Text className="text-emerald-800 font-bold text-xs">✓ Physical Arrival Confirmed — In Doctor Queue</Text>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
