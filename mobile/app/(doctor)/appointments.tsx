import React, { useEffect, useState } from 'react';
import { 
  View, Text, ScrollView, TouchableOpacity, 
  RefreshControl, ActivityIndicator, Alert 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { Calendar, Clock, Building2, Sparkles, Check, RefreshCcw, User } from 'lucide-react-native';

import { useFocusEffect } from '@react-navigation/native';

export default function DoctorAppointmentsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'REQUESTS' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'ALL'>('ALL');
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const res = await api.get('/clinician/appointments');
      const raw = Array.isArray(res.data) ? res.data : [];
      const seen = new Set();
      const unique = raw.filter((a: any) => {
        const id = a.id || a.appointment_id || a._id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setAppointments(unique);
    } catch (err) {
      console.log('Error fetching doctor appointments:', err);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchAppointments();
    }, [])
  );

  const handleRespond = async (id: string, action: 'accept' | 'reject', message?: string) => {
    try {
      setCheckingInId(id);
      const res = await api.post(`/clinician/appointments/${id}/respond`, { action, message });
      const verb = action === 'accept' ? 'accepted & confirmed' : 'declined';
      Alert.alert('Appointment Request', res.data?.message || `Appointment request ${verb} successfully.`);
      fetchAppointments();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to respond to appointment request.');
    } finally {
      setCheckingInId(null);
    }
  };

  const filteredAppointments = appointments.filter((a: any) => {
    const st = (a.status || '').toUpperCase();
    if (filter === 'REQUESTS') return st === 'REQUESTED' || st === 'PENDING' || st === 'BOOKED';
    if (filter === 'CONFIRMED') return st === 'CONFIRMED' || st === 'ACCEPTED' || st === 'UPCOMING';
    if (filter === 'CHECKED_IN') return st === 'CHECKED_IN' || st === 'WAITING' || st === 'IN_CONSULTATION' || st === 'ARRIVAL_NOTIFIED';
    if (filter === 'COMPLETED') return st === 'COMPLETED';
    return true;
  });

  const pendingCount = appointments.filter((a: any) => ['REQUESTED', 'PENDING', 'BOOKED'].includes((a.status || '').toUpperCase())).length;
  const confirmedCount = appointments.filter((a: any) => ['CONFIRMED', 'ACCEPTED', 'UPCOMING'].includes((a.status || '').toUpperCase())).length;
  const checkedInCount = appointments.filter((a: any) => ['CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'ARRIVAL_NOTIFIED'].includes((a.status || '').toUpperCase())).length;

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        className="flex-1 px-4 pt-6"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchAppointments} />}
      >
        {/* Header */}
        <View className="flex-row justify-between items-center mb-5">
          <View>
            <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Clinical Appointments</Text>
            <Text className="text-slate-800 text-2xl font-bold mt-0.5">Appointment Requests</Text>
            <Text className="text-teal-600 font-semibold text-xs mt-0.5">Dr. {user?.name}</Text>
          </View>
          <TouchableOpacity 
            className="w-10 h-10 bg-teal-50 border border-teal-200 rounded-full items-center justify-center"
            onPress={fetchAppointments}
          >
            <RefreshCcw size={18} color="#0d9488" />
          </TouchableOpacity>
        </View>

        {/* Filter Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
          {[
            { key: 'REQUESTS', label: `Pending (${pendingCount})` },
            { key: 'CONFIRMED', label: `Confirmed (${confirmedCount})` },
            { key: 'CHECKED_IN', label: `Checked In (${checkedInCount})` },
            { key: 'COMPLETED', label: 'Completed' },
            { key: 'ALL', label: `All (${appointments.length})` },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setFilter(tab.key as any)}
              className={`mr-2 px-4 py-2 rounded-full border ${
                filter === tab.key 
                  ? 'bg-teal-600 border-teal-600' 
                  : 'bg-white border-slate-200'
              }`}
            >
              <Text className={`text-xs font-bold ${filter === tab.key ? 'text-white' : 'text-slate-600'}`}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Appointments List */}
        {loading && appointments.length === 0 ? (
          <View className="py-12 items-center justify-center">
            <ActivityIndicator size="large" color="#0d9488" />
            <Text className="text-slate-400 text-xs mt-2">Loading appointments...</Text>
          </View>
        ) : filteredAppointments.length === 0 ? (
          <View className="bg-white rounded-3xl p-8 items-center justify-center border border-slate-100 mt-2">
            <Calendar size={40} color="#cbd5e1" />
            <Text className="text-slate-700 font-bold text-base mt-3">No {filter.toLowerCase()} appointments</Text>
            <Text className="text-slate-400 text-xs text-center mt-1">
              Direct patient requests for your specialty & hospital will appear here.
            </Text>
          </View>
        ) : (
          filteredAppointments.map((appt: any) => {
            const st = (appt.status || 'REQUESTED').toUpperCase();
            const isPending = st === 'REQUESTED' || st === 'PENDING';
            const apptId = appt.id || appt.appointment_id;

            return (
              <View key={apptId} className="bg-white rounded-3xl p-4 mb-4 border border-slate-100 shadow-sm">
                <View className="flex-row justify-between items-start mb-2">
                  <View className="flex-1 mr-2">
                    <Text className="text-slate-800 font-bold text-lg">{appt.patient_name}</Text>
                    <Text className="text-slate-500 text-xs">
                      {appt.age || appt.patient_age || 30} Yrs • {appt.gender || appt.patient_gender || 'Other'}
                    </Text>
                  </View>
                  <View className={`px-2.5 py-1 rounded-full border ${
                    st === 'COMPLETED' ? 'bg-emerald-50 border-emerald-200' :
                    st === 'CONFIRMED' || st === 'ACCEPTED' ? 'bg-blue-50 border-blue-200' :
                    st === 'CHECKED_IN' || st === 'WAITING' ? 'bg-indigo-50 border-indigo-200' :
                    st === 'ARRIVAL_NOTIFIED' ? 'bg-amber-50 border-amber-300' :
                    st === 'REJECTED' || st === 'CANCELLED' ? 'bg-red-50 border-red-200' :
                    'bg-amber-50 border-amber-200'
                  }`}>
                    <Text className={`text-[10px] font-bold ${
                      st === 'COMPLETED' ? 'text-emerald-800' :
                      st === 'CONFIRMED' || st === 'ACCEPTED' ? 'text-blue-800' :
                      st === 'CHECKED_IN' || st === 'WAITING' ? 'text-indigo-800' :
                      st === 'ARRIVAL_NOTIFIED' ? 'text-amber-900' :
                      st === 'REJECTED' || st === 'CANCELLED' ? 'text-red-800' :
                      'text-amber-800'
                    }`}>
                      {st === 'REQUESTED' || st === 'PENDING' ? '⏳ PENDING REQUEST' :
                       st === 'CONFIRMED' || st === 'ACCEPTED' ? '✓ CONFIRMED' :
                       st === 'ARRIVAL_NOTIFIED' ? '🔔 ARRIVED' :
                       st === 'CHECKED_IN' || st === 'WAITING' ? '🟢 CHECKED IN' :
                       st === 'COMPLETED' ? '✅ COMPLETED' : st}
                    </Text>
                  </View>
                </View>

                {/* Details */}
                <View className="bg-slate-50 rounded-2xl p-3 mb-3 border border-slate-100 space-y-1">
                  <View className="flex-row items-center">
                    <Clock size={14} color="#0d9488" />
                    <Text className="text-slate-700 font-bold text-xs ml-1.5">
                      {appt.appointment_date} at {appt.appointment_time}
                    </Text>
                  </View>
                  <View className="flex-row items-center mt-1">
                    <Building2 size={14} color="#64748b" />
                    <Text className="text-slate-600 text-xs ml-1.5">{appt.hospital_name}</Text>
                  </View>
                  {appt.chief_complaint ? (
                    <Text className="text-slate-500 text-xs italic mt-1">
                      "{appt.chief_complaint}"
                    </Text>
                  ) : null}
                </View>

                {/* Actions & Status */}
                {isPending ? (
                  <View className="flex-row gap-2 mt-1">
                    <TouchableOpacity
                      onPress={() => handleRespond(apptId, 'accept')}
                      disabled={checkingInId === apptId}
                      className="flex-1 bg-teal-600 py-2.5 rounded-xl items-center justify-center flex-row"
                    >
                      {checkingInId === apptId ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text className="text-white text-xs font-bold">✓ Accept Request</Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleRespond(apptId, 'reject')}
                      disabled={checkingInId === apptId}
                      className="bg-red-50 border border-red-200 px-4 py-2.5 rounded-xl items-center justify-center"
                    >
                      <Text className="text-red-700 text-xs font-bold">Decline</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex-row items-center justify-between mt-1 flex-wrap gap-2">
                    <View className={`px-3 py-1.5 rounded-full ${
                      st === 'COMPLETED' ? 'bg-emerald-100' :
                      st === 'CONFIRMED' || st === 'ACCEPTED' ? 'bg-blue-100' :
                      st === 'CHECKED_IN' || st === 'WAITING' ? 'bg-indigo-100' :
                      st === 'ARRIVAL_NOTIFIED' ? 'bg-amber-100' :
                      st === 'REJECTED' || st === 'CANCELLED' ? 'bg-red-100' :
                      'bg-slate-100'
                    }`}>
                      <Text className={`text-xs font-bold ${
                        st === 'COMPLETED' ? 'text-emerald-700' :
                        st === 'CONFIRMED' || st === 'ACCEPTED' ? 'text-blue-700' :
                        st === 'CHECKED_IN' || st === 'WAITING' ? 'text-indigo-700' :
                        st === 'ARRIVAL_NOTIFIED' ? 'text-amber-800' :
                        st === 'REJECTED' || st === 'CANCELLED' ? 'text-red-700' :
                        'text-slate-700'
                      }`}>
                        {st === 'CONFIRMED' || st === 'ACCEPTED' ? '✓ CONFIRMED (IN OPD QUEUE)' :
                         st === 'CHECKED_IN' || st === 'WAITING' ? '✓ CHECKED IN (IN OPD QUEUE)' :
                         st === 'ARRIVAL_NOTIFIED' ? '🔔 ARRIVED (READY AT RECEPTION)' : st}
                      </Text>
                    </View>

                    {(st === 'CONFIRMED' || st === 'ACCEPTED' || st === 'CHECKED_IN' || st === 'WAITING' || st === 'ARRIVAL_NOTIFIED') && (
                      <TouchableOpacity
                        onPress={() => router.push({ pathname: '/(doctor)/queue' })}
                        className="bg-teal-600 px-3.5 py-1.5 rounded-xl flex-row items-center"
                      >
                        <Text className="text-white text-xs font-bold">Open in Queue 🩺</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
