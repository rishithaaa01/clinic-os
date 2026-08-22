import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { Activity, Users, FileText, Share2, LogOut, ArrowRight, UserCheck, Calendar } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { useFocusEffect } from '@react-navigation/native';

export default function DoctorDashboard() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();

  const [stats, setStats] = useState({ waiting: 0, completed: 0, pendingLabs: 0, referralsCount: 0, appointmentsCount: 0 });
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [queueRes, refRes, apptRes] = await Promise.allSettled([
        api.get('/clinician/queue-summary'),
        api.get('/clinician/referrals'),
        api.get('/clinician/appointments')
      ]);

      const queueData = queueRes.status === 'fulfilled' ? queueRes.value.data : {};
      const refData = refRes.status === 'fulfilled' ? refRes.value.data : [];
      const apptData = apptRes.status === 'fulfilled' ? apptRes.value.data : [];

      const incoming = Array.isArray(refData) ? refData.filter((r: any) => r.type === 'incoming') : [];
      setReferrals(incoming);

      setStats({
        waiting: queueData.waiting_count || 0,
        completed: queueData.completed_count || 0,
        pendingLabs: queueData.pending_labs_count || 0,
        referralsCount: incoming.length,
        appointmentsCount: Array.isArray(apptData) ? apptData.length : 0
      });
    } catch (err) {
      console.log('Error fetching doctor dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchDashboardData();
    }, [])
  );

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'ASHA_REFERRAL':
        return { label: '👩‍⚕️ ASHA Referral', bg: 'bg-purple-100', text: 'text-purple-700' };
      case 'PATIENT_SELF_LOG':
        return { label: '👤 Patient Self-Log', bg: 'bg-indigo-100', text: 'text-indigo-700' };
      case 'DOCTOR_REFERRAL':
        return { label: '🩺 Doctor Specialist', bg: 'bg-amber-100', text: 'text-amber-700' };
      default:
        return { label: '🏥 Field Referral', bg: 'bg-teal-100', text: 'text-teal-700' };
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView 
        className="flex-1 px-4 pt-6"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchDashboardData} />}
      >
        <View className="flex-row justify-between items-center mb-6">
          <View>
            <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Hospital Clinical Portal</Text>
            <Text className="text-slate-800 text-2xl font-bold mt-1">Dr. {user?.name}</Text>
            <Text className="text-teal-600 font-semibold text-xs mt-0.5">{user?.hospital || 'General Hospital'}</Text>
          </View>
          <View className="w-12 h-12 bg-teal-100 rounded-full items-center justify-center border border-teal-200">
            <Text className="text-teal-700 font-bold text-lg">{user?.name?.charAt(0) || 'D'}</Text>
          </View>
        </View>

        {/* Dashboard Stat Cards */}
        <View className="flex-row flex-wrap justify-between">
          <TouchableOpacity 
            className="bg-white p-4 rounded-3xl w-[48%] shadow-sm border border-slate-100 mb-4"
            onPress={() => router.push('/(doctor)/appointments')}
          >
            <View className="w-10 h-10 bg-teal-100 rounded-2xl items-center justify-center mb-3">
              <Calendar size={20} color="#0d9488" />
            </View>
            <Text className="text-3xl font-bold text-slate-800">{stats.appointmentsCount}</Text>
            <Text className="text-slate-500 font-medium text-xs mt-1">Direct Appointments</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            className="bg-white p-4 rounded-3xl w-[48%] shadow-sm border border-slate-100 mb-4"
            onPress={() => router.push('/(doctor)/queue')}
          >
            <View className="w-10 h-10 bg-orange-100 rounded-2xl items-center justify-center mb-3">
              <Users size={20} color="#ea580c" />
            </View>
            <Text className="text-3xl font-bold text-slate-800">{stats.waiting}</Text>
            <Text className="text-slate-500 font-medium text-xs mt-1">Waiting Queue</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            className="bg-white p-4 rounded-3xl w-[48%] shadow-sm border border-slate-100 mb-4"
            onPress={() => router.push('/(doctor)/queue')}
          >
            <View className="w-10 h-10 bg-indigo-100 rounded-2xl items-center justify-center mb-3">
              <Share2 size={20} color="#4f46e5" />
            </View>
            <Text className="text-3xl font-bold text-slate-800">{stats.referralsCount}</Text>
            <Text className="text-slate-500 font-medium text-xs mt-1">Incoming Referrals</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            className="bg-white p-4 rounded-3xl w-[48%] shadow-sm border border-slate-100 mb-4"
            onPress={() => router.push('/(doctor)/patients')}
          >
            <View className="w-10 h-10 bg-teal-100 rounded-2xl items-center justify-center mb-3">
              <Activity size={20} color="#0d9488" />
            </View>
            <Text className="text-3xl font-bold text-slate-800">{stats.completed}</Text>
            <Text className="text-slate-500 font-medium text-xs mt-1">Completed Today</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            className="bg-white p-4 rounded-3xl w-[48%] shadow-sm border border-slate-100 mb-4"
            onPress={() => router.push('/(doctor)/queue')}
          >
            <View className="w-10 h-10 bg-purple-100 rounded-2xl items-center justify-center mb-3">
              <FileText size={20} color="#9333ea" />
            </View>
            <Text className="text-3xl font-bold text-slate-800">{stats.pendingLabs}</Text>
            <Text className="text-slate-500 font-medium text-xs mt-1">Pending Labs</Text>
          </TouchableOpacity>
        </View>

        {/* Incoming Referrals Section */}
        <View className="mt-4 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-slate-800 text-lg font-bold">Incoming Referrals (ASHA & Self-Logs)</Text>
            <TouchableOpacity onPress={() => router.push('/(doctor)/queue')}>
              <Text className="text-teal-600 font-semibold text-xs">View Queue →</Text>
            </TouchableOpacity>
          </View>

          {referrals.length === 0 ? (
            <View className="bg-white rounded-2xl p-4 border border-slate-100 items-center justify-center py-6">
              <Text className="text-slate-400 text-xs">No pending incoming referrals at this time.</Text>
            </View>
          ) : (
            referrals.slice(0, 3).map((ref: any) => {
              const badge = getSourceBadge(ref.source_type);
              return (
                <View key={ref.id} className="bg-white rounded-2xl p-4 mb-3 border border-slate-100 shadow-sm">
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-slate-800 font-bold text-base">{ref.patient_name}</Text>
                    <View className={`px-2.5 py-0.5 rounded-full ${badge.bg}`}>
                      <Text className={`text-[10px] font-bold ${badge.text}`}>{badge.label}</Text>
                    </View>
                  </View>

                  <Text className="text-slate-500 text-xs mb-1">
                    Referred by: <Text className="font-semibold text-slate-700">{ref.referred_by || 'ASHA Worker'}</Text>
                  </Text>
                  
                  {ref.reason !== '' && (
                    <Text className="text-slate-600 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-1 mb-2">
                      📋 {ref.reason}
                    </Text>
                  )}

                  <TouchableOpacity
                    className="bg-teal-600 rounded-xl py-2 px-3 flex-row items-center justify-center mt-1"
                    onPress={() => router.push('/(doctor)/queue')}
                  >
                    <UserCheck size={14} color="#ffffff" />
                    <Text className="text-white text-xs font-bold ml-1.5">Open in Patient Queue</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        {/* Quick Actions */}
        <View className="mb-10">
          <Text className="text-slate-800 text-lg font-bold mb-3">Quick Actions</Text>
          <View className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm">
            <TouchableOpacity 
              className="flex-row items-center p-4 border-b border-slate-50 active:bg-slate-50"
              onPress={() => router.push('/(doctor)/queue')}
            >
              <View className="w-9 h-9 bg-slate-100 rounded-xl items-center justify-center mr-3">
                <Users size={18} color="#475569" />
              </View>
              <Text className="text-slate-700 font-semibold text-sm flex-1">View Active Patient Queue</Text>
              <ArrowRight size={16} color="#94a3b8" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              className="flex-row items-center p-4 active:bg-slate-50"
              onPress={() => {
                logout();
                router.replace('/(auth)/login');
              }}
            >
              <View className="w-9 h-9 bg-red-50 rounded-xl items-center justify-center mr-3">
                <LogOut size={18} color="#dc2626" />
              </View>
              <Text className="text-red-600 font-semibold text-sm flex-1">Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
