import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import api from '../../src/services/api';
import { useFocusEffect } from '@react-navigation/native';
import { User, Clock, ChevronRight, AlertCircle, Stethoscope } from 'lucide-react-native';

export default function DoctorQueue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await api.get('/clinician/queue');
      const raw = Array.isArray(res.data) ? res.data : [];
      const seen = new Set();
      const unique = raw.filter((item: any) => {
        const id = item._id || item.id || item.patient_id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setQueue(unique as any);
    } catch (err) {
      console.log('Error fetching queue', err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchQueue();
      const interval = setInterval(() => {
        fetchQueue();
      }, 4000);
      return () => clearInterval(interval);
    }, [])
  );

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'DIRECT_APPOINTMENT':
        return { label: '📅 Direct OPD', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' };
      case 'ASHA_REFERRAL':
        return { label: '👩‍⚕️ ASHA Referral', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700' };
      case 'DOCTOR_REFERRAL':
        return { label: '🩺 Specialist', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' };
      default:
        return { label: '🏥 Walk-in', bg: 'bg-teal-50 border-teal-200', text: 'text-teal-700' };
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const badge = getSourceBadge(item.source_type);
    const isUrgent = item.risk_tag === 'urgent' || item.risk_level === 'Urgent Review';

    return (
      <TouchableOpacity 
        className={`bg-white p-4 mb-3 rounded-2xl border ${
          isUrgent ? 'border-red-200 bg-red-50/20' : 'border-slate-200/80'
        } flex-row items-center shadow-sm active:bg-slate-50 min-h-[72px]`}
        onPress={() => router.push({ pathname: '/(doctor)/consult', params: { encounterId: item._id } })}
        activeOpacity={0.7}
      >
        <View className={`w-12 h-12 rounded-2xl items-center justify-center mr-3 border ${
          isUrgent ? 'bg-red-100 border-red-200' : 'bg-slate-100 border-slate-200/60'
        }`}>
          <User size={22} color={isUrgent ? '#dc2626' : '#475569'} />
        </View>

        <View className="flex-1 mr-2">
          <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
            <Text className="text-slate-900 font-bold text-base">{item.patient_name || 'Patient'}</Text>
            <View className={`px-2 py-0.5 rounded-full border ${badge.bg}`}>
              <Text className={`text-[10px] font-extrabold uppercase ${badge.text}`}>{badge.label}</Text>
            </View>
          </View>

          <Text className="text-slate-500 text-xs font-semibold mb-1">
            {item.age ? `${item.age} yrs` : ''} {item.gender ? `• ${String(item.gender).toUpperCase()}` : ''}
          </Text>

          <Text className="text-slate-600 text-xs font-medium" numberOfLines={1}>
            📋 {item.chief_complaint || 'General Consultation'}
          </Text>
        </View>

        <View className="items-end justify-between self-stretch py-0.5">
          <View className="flex-row items-center">
            <Clock size={12} color="#64748b" style={{ marginRight: 3 }} />
            <Text className="text-slate-500 text-xs font-semibold">{item.wait_time ?? 0}m wait</Text>
          </View>
          <View className="flex-row items-center mt-2">
            <Text className="text-xs font-bold text-teal-600 mr-0.5">Consult</Text>
            <ChevronRight size={16} color="#0d9488" />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="p-4 pt-6 flex-1">
        <View className="flex-row justify-between items-center mb-5">
          <View>
            <Text className="text-slate-900 text-2xl font-extrabold tracking-tight">Active OPD Queue</Text>
            <Text className="text-slate-500 text-xs font-medium mt-0.5">Select a patient to initiate clinical encounter</Text>
          </View>
          <View className="bg-teal-100 px-3 py-1.5 rounded-full border border-teal-200">
            <Text className="text-teal-800 font-bold text-xs">{queue.length} Waiting</Text>
          </View>
        </View>
        
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#0d9488" />
          </View>
        ) : (
          <FlatList
            data={queue}
            renderItem={renderItem}
            keyExtractor={item => item._id}
            contentContainerStyle={{ paddingBottom: 30 }}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchQueue} />}
            ListEmptyComponent={
              <View className="bg-white rounded-3xl p-8 border border-slate-200/80 items-center justify-center my-6 shadow-sm">
                <Stethoscope size={48} color="#cbd5e1" className="mb-3" />
                <Text className="text-slate-700 font-bold text-base">OPD Queue Clear</Text>
                <Text className="text-slate-400 text-xs text-center mt-1">No patients currently waiting for consultation.</Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
