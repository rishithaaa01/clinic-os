import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { Home, Users, AlertTriangle, ArrowUpRight, Activity, LogOut, ChevronRight, ShieldAlert } from 'lucide-react-native';
import { useRouter } from 'expo-router';

export default function AshaDashboard() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();

  const [households, setHouseholds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHouseholds = async () => {
    try {
      setLoading(true);
      const res = await api.get('/asha/households');
      setHouseholds(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.log('Error fetching households', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHouseholds();
  }, []);

  const redCount = households.filter(h => h.risk_level === 'red').length;
  const amberCount = households.filter(h => h.risk_level === 'amber').length;

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView 
        className="flex-1 px-4 pt-6"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchHouseholds} />}
      >
        {/* Header */}
        <View className="flex-row justify-between items-center mb-6">
          <View>
            <Text className="text-slate-500 text-[10px] font-extrabold uppercase tracking-wider">Community Health Officer</Text>
            <Text className="text-slate-900 text-2xl font-extrabold mt-0.5">ASHA {user?.name}</Text>
            <Text className="text-teal-700 text-xs font-semibold mt-0.5">{user?.village || 'Assigned Village Cluster'}</Text>
          </View>
          <TouchableOpacity 
            onPress={() => { logout(); router.replace('/(auth)/login'); }}
            className="w-11 h-11 bg-red-50 rounded-2xl items-center justify-center border border-red-100 active:bg-red-100"
          >
            <LogOut size={20} color="#dc2626" />
          </TouchableOpacity>
        </View>

        {/* Village Summary */}
        <View className="bg-white rounded-3xl p-5 mb-5 border border-slate-200/80 shadow-sm">
          <Text className="text-slate-900 text-sm font-bold uppercase tracking-wider mb-3">Village Population Metrics</Text>
          <View className="flex-row justify-between">
            <TouchableOpacity 
              onPress={() => router.push('/(asha)/households')}
              className="bg-slate-50 p-3.5 rounded-2xl w-[48%] border border-slate-200/60"
            >
              <View className="w-8 h-8 bg-teal-100 rounded-xl items-center justify-center mb-2">
                <Home size={18} color="#0d9488" />
              </View>
              <Text className="text-2xl font-extrabold text-slate-900">{households.length}</Text>
              <Text className="text-slate-500 text-xs font-semibold mt-0.5">Households</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => router.push('/(asha)/households')}
              className="bg-red-50/50 p-3.5 rounded-2xl w-[48%] border border-red-100"
            >
              <View className="w-8 h-8 bg-red-100 rounded-xl items-center justify-center mb-2">
                <AlertTriangle size={18} color="#dc2626" />
              </View>
              <Text className="text-2xl font-extrabold text-red-600">{redCount}</Text>
              <Text className="text-slate-600 text-xs font-semibold mt-0.5">Red High-Risk</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Primary Actions */}
        <Text className="text-slate-900 text-sm font-bold uppercase tracking-wider mb-3">Field Triage & Intake</Text>
        <View className="bg-white rounded-3xl border border-slate-200/80 p-2 mb-6 shadow-sm">
          <TouchableOpacity 
            onPress={() => router.push('/(asha)/screening')}
            className="flex-row items-center p-4 border-b border-slate-100 rounded-2xl active:bg-slate-50 min-h-[64px]"
          >
            <View className="w-11 h-11 bg-teal-100 rounded-2xl items-center justify-center mr-3 border border-teal-200">
              <Activity size={22} color="#0d9488" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 font-bold text-base">Start AI Triage</Text>
              <Text className="text-slate-500 text-xs mt-0.5 font-medium">Voice note & symptom risk prediction</Text>
            </View>
            <ChevronRight size={18} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => router.push('/(asha)/households')}
            className="flex-row items-center p-4 border-b border-slate-100 rounded-2xl active:bg-slate-50 min-h-[64px]"
          >
            <View className="w-11 h-11 bg-blue-100 rounded-2xl items-center justify-center mr-3 border border-blue-200">
              <Users size={22} color="#2563eb" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 font-bold text-base">Register Family / Member</Text>
              <Text className="text-slate-500 text-xs mt-0.5 font-medium">Create ABHA patient record in village register</Text>
            </View>
            <ChevronRight size={18} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => router.push('/(asha)/referrals')}
            className="flex-row items-center p-4 rounded-2xl active:bg-slate-50 min-h-[64px]"
          >
            <View className="w-11 h-11 bg-purple-100 rounded-2xl items-center justify-center mr-3 border border-purple-200">
              <ArrowUpRight size={22} color="#9333ea" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 font-bold text-base">Referral Status & Consult Notes</Text>
              <Text className="text-slate-500 text-xs mt-0.5 font-medium">Track doctor prescriptions & patient status</Text>
            </View>
            <ChevronRight size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
