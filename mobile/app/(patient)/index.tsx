import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import patientApi from '../../src/services/patientApi';
import api from '../../src/services/api';
import { 
  FileText, Pill, FlaskConical, ShieldCheck, Sparkles, RefreshCw, 
  Calendar, Activity, Stethoscope, ChevronRight, Clock, Building2, User 
} from 'lucide-react-native';

export default function PatientDashboard() {
  const { user } = useAuthStore();
  const router = useRouter();

  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['patientProfile'],
    queryFn: patientApi.getMyProfile,
  });

  const { data: visits = [], isLoading: visitsLoading, refetch: refetchVisits } = useQuery({
    queryKey: ['patientVisits'],
    queryFn: patientApi.getMyVisits,
  });

  const { data: appts = [], isLoading: apptsLoading, refetch: refetchAppts } = useQuery({
    queryKey: ['patientAppts'],
    queryFn: () => api.get('/appointments/my-requests').then(r => Array.isArray(r.data) ? r.data : []).catch(() => []),
  });

  const { data: prescriptions = [], isLoading: rxLoading, refetch: refetchRx } = useQuery({
    queryKey: ['patientPrescriptions'],
    queryFn: patientApi.getMyPrescriptions,
  });

  const { data: labResults = [], isLoading: labsLoading, refetch: refetchLabs } = useQuery({
    queryKey: ['patientLabResults'],
    queryFn: patientApi.getMyLabResults,
  });

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['healthSummary'],
    queryFn: patientApi.getHealthSummary,
    retry: false,
  });

  const onRefreshAll = () => {
    refetchProfile();
    refetchVisits();
    refetchAppts();
    refetchRx();
    refetchLabs();
    refetchSummary();
  };

  const recentVisit = visits?.[0];
  const upcomingFollowUp = recentVisit?.follow_up_date && new Date(recentVisit.follow_up_date) > new Date()
    ? recentVisit
    : null;

  const upcomingAppt = appts.find((a: any) => {
    const s = (a.status || '').toUpperCase();
    return s === 'REQUESTED' || s === 'CONFIRMED' || s === 'ACCEPTED' || s === 'UPCOMING' || s === 'WAITING' || s === 'ARRIVAL_NOTIFIED';
  });

  const recentLab = labResults?.[0];
  const recentRx = prescriptions?.[0];

  const quickLinks = [
    { to: '/(patient)/symptoms', label: 'Voice Triage', icon: Stethoscope, color: 'bg-teal-50 border-teal-200', iconColor: '#0d9488' },
    { to: '/(patient)/appointments', label: 'Book OPD Slot', icon: Calendar, color: 'bg-indigo-50 border-indigo-200', iconColor: '#4f46e5' },
    { to: '/(patient)/records', label: 'Health Records', icon: FileText, color: 'bg-blue-50 border-blue-200', iconColor: '#2563eb' },
    { to: '/(patient)/medicines', label: 'Prescriptions', icon: Pill, color: 'bg-purple-50 border-purple-200', iconColor: '#9333ea' },
    { to: '/(patient)/labs', label: 'Lab Reports', icon: FlaskConical, color: 'bg-orange-50 border-orange-200', iconColor: '#ea580c' },
    { to: '/(patient)/consents', label: 'Data Consents', icon: ShieldCheck, color: 'bg-emerald-50 border-emerald-200', iconColor: '#059669' },
  ];

  const isLoading = profileLoading || visitsLoading || apptsLoading || rxLoading || labsLoading || summaryLoading;

  return (
    <SafeAreaView className="flex-1 bg-[#F7F3EE]">
      <ScrollView 
        className="flex-1 px-4 pt-6"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefreshAll} />}
      >
        {/* Welcome Header */}
        <View className="mb-4 flex-row justify-between items-center">
          <View className="flex-1 mr-2">
            <Text className="text-2xl font-black text-slate-800 tracking-tight" numberOfLines={1}>
              Welcome, {profileLoading ? '...' : profile?.name || user?.name}
            </Text>
            <Text className="text-slate-500 text-xs mt-0.5 font-medium">Universal Health Portal</Text>
          </View>
          <View className="bg-teal-100 px-2.5 py-1 rounded-full flex-row items-center border border-teal-200">
            <Activity size={11} color="#0d9488" style={{ marginRight: 4 }} />
            <Text className="text-teal-800 font-bold text-[10px] uppercase">Active Care</Text>
          </View>
        </View>

        {/* ABHA Health Card */}
        {!profileLoading && profile && (
          <View className="bg-[#1B6CA8] rounded-3xl p-5 mb-4 shadow-sm border border-blue-600/30">
            <View className="flex-row justify-between items-start">
              <View className="flex-1 mr-2">
                <Text className="text-blue-100/80 text-[10px] font-bold uppercase tracking-wider">Digital Health Pass</Text>
                <Text className="text-white text-lg font-bold mt-0.5">{profile.name}</Text>
                {profile.abha_number ? (
                  <Text className="text-blue-100 text-xs mt-0.5 font-medium">ABHA: {profile.abha_number}</Text>
                ) : (
                  <Text className="text-blue-100/70 text-xs mt-0.5">Verified Patient ID</Text>
                )}
              </View>
              {profile.blood_group && (
                <View className="bg-white/20 px-3 py-1 rounded-full border border-white/30">
                  <Text className="text-white text-xs font-bold">{profile.blood_group}</Text>
                </View>
              )}
            </View>

            {profile.allergies?.length > 0 && (
              <View className="mt-3 flex-row flex-wrap items-center">
                <Text className="text-blue-200 text-xs font-medium mr-2">Allergies:</Text>
                {profile.allergies.map((a: string) => (
                  <View key={a} className="bg-white/20 px-2 py-0.5 rounded-full mr-1.5 mb-1 border border-white/20">
                    <Text className="text-white text-[10px] font-medium">{a}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Upcoming / Active Appointment Card */}
        <View className="bg-white rounded-3xl border border-slate-200/80 p-4 mb-4 shadow-sm">
          <View className="flex-row items-center justify-between mb-2.5">
            <View className="flex-row items-center">
              <Calendar size={16} color="#4f46e5" />
              <Text className="font-bold text-slate-800 text-sm ml-1.5">Upcoming Appointment</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(patient)/appointments')} className="flex-row items-center">
              <Text className="text-xs text-indigo-600 font-bold mr-0.5">Manage</Text>
              <ChevronRight size={13} color="#4f46e5" />
            </TouchableOpacity>
          </View>

          {upcomingAppt ? (
            <View className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-3.5">
              <View className="flex-row justify-between items-start mb-1.5">
                <Text className="font-bold text-slate-800 text-sm flex-1 mr-2">{upcomingAppt.hospital_name}</Text>
                <View className="bg-indigo-100 px-2 py-0.5 rounded-full">
                  <Text className="text-indigo-800 text-[10px] font-bold uppercase">{upcomingAppt.status}</Text>
                </View>
              </View>
              <View className="flex-row items-center text-slate-600 mb-1">
                <Clock size={12} color="#6366f1" style={{ marginRight: 4 }} />
                <Text className="text-xs text-slate-700 font-medium">
                  {upcomingAppt.requested_date} at {upcomingAppt.requested_time_slot || upcomingAppt.time_slot || '09:00 AM'}
                </Text>
              </View>
              <Text className="text-xs text-slate-500 font-medium">
                Specialty: <Text className="font-semibold text-slate-700">{upcomingAppt.specialty || 'General Medicine'}</Text>
              </Text>
            </View>
          ) : (
            <View className="py-2 items-center justify-center">
              <Text className="text-slate-500 text-xs">No upcoming appointments.</Text>
              <TouchableOpacity 
                onPress={() => router.push('/(patient)/appointments')}
                className="mt-2 bg-indigo-600 px-4 py-2 rounded-xl"
              >
                <Text className="text-white font-bold text-xs">Book OPD Consultation +</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Follow-up Due Alert */}
        {upcomingFollowUp && (
          <View className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-4 flex-row items-center shadow-sm">
            <Calendar color="#d97706" size={18} style={{ marginRight: 10 }} />
            <View className="flex-1">
              <Text className="font-bold text-amber-900 text-xs uppercase tracking-wider">Scheduled Follow-Up</Text>
              <Text className="text-amber-800 text-xs mt-0.5 font-medium">
                {new Date(upcomingFollowUp.follow_up_date).toLocaleDateString('en-IN', { dateStyle: 'long' })} at {upcomingFollowUp.hospital_name}
              </Text>
            </View>
          </View>
        )}

        {/* Voice Symptom Assessment Banner - Clean & Unclustered */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => router.push('/(patient)/symptoms')}
          className="bg-emerald-900 border border-emerald-700/80 rounded-3xl p-5 mb-5 shadow-md overflow-hidden relative"
        >
          {/* Ambient Glow */}
          <View className="absolute -top-10 -right-10 w-36 h-36 bg-emerald-500/20 rounded-full" />

          {/* Top Badge & Icon */}
          <View className="flex-row items-center justify-between mb-3">
            <View className="bg-emerald-800/90 border border-emerald-600/50 px-3 py-1 rounded-full flex-row items-center">
              <Sparkles size={12} color="#6ee7b7" style={{ marginRight: 5 }} />
              <Text className="text-emerald-200 text-[10px] font-extrabold uppercase tracking-wider">
                Voice AI Triage & Care Routing
              </Text>
            </View>
            <View className="w-10 h-10 bg-emerald-800/80 rounded-2xl items-center justify-center border border-emerald-600/40">
              <Stethoscope size={20} color="#34d399" />
            </View>
          </View>

          {/* Title & Description */}
          <Text className="text-white text-lg font-black tracking-tight leading-6 mb-1.5">
            🎙️ Speak Symptoms & Auto-Refer
          </Text>
          <Text className="text-emerald-100/90 text-xs font-medium leading-5 mb-4">
            Speak naturally in your language. AI assesses severity, identifies the right specialty, and prepares your appointment referral.
          </Text>

          {/* Dedicated CTA Button with Generous Touch Target */}
          <View className="flex-row items-center justify-between bg-emerald-800/70 border border-emerald-600/50 rounded-2xl px-4 py-3">
            <View className="flex-row items-center">
              <Text className="text-white text-xs font-bold">Start Voice Assessment</Text>
            </View>
            <View className="bg-emerald-500 w-7 h-7 rounded-xl items-center justify-center">
              <ChevronRight size={16} color="#064e3b" />
            </View>
          </View>
        </TouchableOpacity>

        {/* Quick Healthcare Services Grid */}
        <Text className="text-slate-800 text-xs font-bold uppercase tracking-wider mb-2.5">Healthcare Services</Text>
        <View className="flex-row flex-wrap justify-between mb-4">
          {quickLinks.map((link) => (
            <TouchableOpacity
              key={link.to}
              onPress={() => router.push(link.to as any)}
              className="bg-white w-[48%] rounded-2xl p-3.5 mb-3 border border-slate-200/80 items-center shadow-sm active:bg-slate-50"
            >
              <View className={`${link.color} w-10 h-10 rounded-2xl items-center justify-center mb-2 border`}>
                <link.icon size={20} color={link.iconColor} />
              </View>
              <Text className="text-xs font-bold text-slate-800 text-center">{link.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Clinical Health Summary */}
        <View className="bg-white rounded-3xl border border-slate-200/80 p-4 mb-4 shadow-sm">
          <View className="flex-row items-center justify-between mb-2.5">
            <View className="flex-row items-center">
              <Sparkles size={16} color="#1B6CA8" />
              <Text className="font-bold text-slate-800 text-sm ml-1.5">Clinical Health Summary</Text>
            </View>
            <TouchableOpacity onPress={() => refetchSummary()} className="p-1 bg-slate-50 rounded-lg">
              <RefreshCw size={12} color="#64748b" />
            </TouchableOpacity>
          </View>
          {summaryLoading ? (
            <Text className="text-slate-400 text-xs italic">Loading clinical health summary...</Text>
          ) : (
            <Text className="text-slate-600 leading-5 text-xs">
              {summary?.summary || 'No recent clinical incidents recorded. Speak symptoms or book an OPD slot to update your clinical record.'}
            </Text>
          )}
        </View>

        {/* Recent Lab & Prescription Status Row */}
        <View className="flex-row justify-between mb-8">
          {/* Lab Snapshot */}
          <View className="bg-white w-[48%] rounded-2xl p-3.5 border border-slate-200/80 shadow-sm">
            <View className="flex-row items-center justify-between mb-1.5">
              <FlaskConical size={14} color="#ea580c" />
              <TouchableOpacity onPress={() => router.push('/(patient)/labs')}>
                <Text className="text-[10px] font-bold text-orange-600">View All</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-[11px] font-bold text-slate-800" numberOfLines={1}>
              {recentLab ? recentLab.test_name : 'No recent lab reports'}
            </Text>
            <Text className="text-[10px] text-slate-500 mt-0.5" numberOfLines={1}>
              {recentLab ? (recentLab.status === 'resulted' ? (recentLab.result || 'Result Ready') : 'Processing') : 'Tests ordered by doctor will appear here'}
            </Text>
          </View>

          {/* Rx Snapshot */}
          <View className="bg-white w-[48%] rounded-2xl p-3.5 border border-slate-200/80 shadow-sm">
            <View className="flex-row items-center justify-between mb-1.5">
              <Pill size={14} color="#9333ea" />
              <TouchableOpacity onPress={() => router.push('/(patient)/medicines')}>
                <Text className="text-[10px] font-bold text-purple-600">View All</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-[11px] font-bold text-slate-800" numberOfLines={1}>
              {recentRx ? (recentRx.medicine || recentRx.name) : 'No prescriptions yet'}
            </Text>
            <Text className="text-[10px] text-slate-500 mt-0.5" numberOfLines={1}>
              {recentRx ? `${recentRx.dosage || ''} ${recentRx.frequency || ''}`.trim() : 'Prescribed medicines will appear here'}
            </Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
