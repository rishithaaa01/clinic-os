import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../src/services/api';
import { useRouter } from 'expo-router';
import { FileText, ArrowRight, Activity, Clock } from 'lucide-react-native';

export default function ReferralsScreen() {
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const fetchReferrals = async () => {
    try {
      const res = await api.get('/clinician/referrals');
      setReferrals(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.log('Error fetching referrals', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReferrals();
    const interval = setInterval(() => {
      fetchReferrals();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleAcceptReferral = async (refId: string) => {
    try {
      setAcceptingId(refId);
      await api.post(`/clinician/referrals/${refId}/accept`);
      alert('Referral accepted! Patient added to your OPD Queue.');
      fetchReferrals();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Failed to accept referral';
      alert(`Error: ${detail}`);
    } finally {
      setAcceptingId(null);
    }
  };

  const getStatusColor = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'completed': return 'bg-green-100 text-green-700';
      case 'accepted': return 'bg-blue-100 text-blue-700';
      case 'rejected': return 'bg-red-100 text-red-700';
      default: return 'bg-orange-100 text-orange-700';
    }
  };

  const renderReferral = ({ item }: { item: any }) => {
    const isPending = (item.status || 'pending').toLowerCase() === 'pending';
    const isAccepted = (item.status || '').toLowerCase() === 'accepted';
    const refId = item.id || item._id;

    return (
      <View className="bg-white p-4 rounded-3xl mb-4 border border-slate-100 shadow-sm shadow-slate-200/50">
        <View className="flex-row justify-between items-start mb-3">
          <View className="flex-1">
            <Text className="text-slate-800 font-bold text-base mb-1">{item.patient_name || 'Unknown Patient'}</Text>
            <View className="flex-row items-center">
              <Text className="text-slate-500 text-xs">To: </Text>
              <Text className="text-teal-700 font-semibold text-xs">{item.to_speciality || item.referred_to_department || 'General Medicine'}</Text>
            </View>
          </View>
          <View className={`px-2.5 py-1 rounded-lg ${getStatusColor(item.status).split(' ')[0]}`}>
            <Text className={`text-[10px] font-bold uppercase ${getStatusColor(item.status).split(' ')[1]}`}>
              {item.status || 'Pending'}
            </Text>
          </View>
        </View>

        <View className="bg-slate-50 p-3 rounded-xl mb-3 border border-slate-100">
          <Text className="text-slate-600 text-xs italic" numberOfLines={2}>
            "{item.reason || item.notes || item.reason_for_referral || 'No reason provided'}"
          </Text>
        </View>

        <View className="flex-row justify-between items-center pt-2 border-t border-slate-50">
          <Text className="text-slate-400 text-[10px]">
            Ref ID: {String(refId).slice(-6).toUpperCase()}
          </Text>

          {isPending ? (
            <TouchableOpacity
              onPress={() => handleAcceptReferral(refId)}
              disabled={acceptingId === refId}
              className="bg-teal-600 px-4 py-2 rounded-xl flex-row items-center shadow-sm"
            >
              {acceptingId === refId ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-white font-bold text-xs">✓ Accept Referral</Text>
              )}
            </TouchableOpacity>
          ) : isAccepted ? (
            <TouchableOpacity 
              className="bg-blue-50 border border-blue-200 px-3.5 py-1.5 rounded-xl flex-row items-center"
              onPress={() => router.push({ pathname: '/(doctor)/queue' })}
            >
              <Text className="text-blue-700 font-bold text-xs mr-1">In OPD Queue 🩺</Text>
              <ArrowRight size={14} color="#1d4ed8" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              className="flex-row items-center"
              onPress={() => router.push({ pathname: '/(doctor)/consult', params: { encounterId: item.visit_id } })}
            >
              <Text className="text-teal-600 font-bold text-xs mr-1">View Details</Text>
              <ArrowRight size={14} color="#0d9488" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="p-4 pt-6 flex-1">
        <Text className="text-slate-800 text-2xl font-bold mb-2">Referrals</Text>
        <Text className="text-slate-500 text-sm mb-6">Patients referred to specialists</Text>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#0d9488" />
          </View>
        ) : (
          <FlatList
            data={referrals}
            keyExtractor={(item) => item._id || Math.random().toString()}
            renderItem={renderReferral}
            refreshing={loading}
            onRefresh={fetchReferrals}
            ListEmptyComponent={
              <View className="items-center justify-center py-10">
                <Text className="text-slate-400">No active referrals</Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
