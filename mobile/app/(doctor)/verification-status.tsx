import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { ShieldCheck, Clock, AlertTriangle, CheckCircle2, XCircle, RefreshCcw, Building2, Stethoscope, LogOut } from 'lucide-react-native';

export default function DoctorVerificationStatusScreen() {
  const { user, updateUser, logout } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.get('/auth/me');
      if (res.data) {
        await updateUser(res.data);
        Alert.alert('Updated', 'Your account status has been refreshed.');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to refresh status.');
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
    <SafeAreaView className="flex-1 bg-[#F7F3EE]">
      {/* Top Bar */}
      <View className="px-5 py-4 bg-[#1B6CA8] flex-row items-center justify-between shadow-sm">
        <View className="flex-row items-center">
          <View className="bg-white/10 p-2 rounded-xl mr-3">
            <Stethoscope size={22} color="white" />
          </View>
          <View>
            <Text className="text-base font-bold text-white">Doctor Account Verification</Text>
            <Text className="text-[10px] text-blue-100">Medical Credentials & Hospital Access</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout} className="p-2 bg-white/10 rounded-xl flex-row items-center">
          <LogOut size={16} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 p-5" showsVerticalScrollIndicator={false}>
        {/* Main Status Banner */}
        {isRejected ? (
          <View className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-5 flex-row items-start">
            <View className="p-2.5 bg-red-100 rounded-xl mr-3">
              <XCircle size={22} color="#dc2626" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-red-800">Verification Could Not Be Completed</Text>
              <Text className="text-xs text-red-700 mt-1 leading-5">
                Your verification could not be completed. Please review your details or contact the hospital administrator.
              </Text>
              {rejectionReason ? (
                <View className="mt-3 bg-white/90 border border-red-200 rounded-xl p-3">
                  <Text className="text-[9px] font-bold text-red-500 uppercase">Reason provided</Text>
                  <Text className="text-xs text-gray-800 font-semibold mt-0.5">{rejectionReason}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : isHospitalPending ? (
          <View className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-5 flex-row items-start">
            <View className="p-2.5 bg-blue-100 rounded-xl mr-3">
              <Clock size={22} color="#1B6CA8" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-blue-900">Hospital Affiliation Approval Pending</Text>
              <Text className="text-xs text-blue-800 mt-1 leading-5">
                Your medical registration has been verified. Hospital affiliation approval is pending with your hospital administrator.
              </Text>
            </View>
          </View>
        ) : (
          <View className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-5 flex-row items-start">
            <View className="p-2.5 bg-amber-100 rounded-xl mr-3">
              <Clock size={22} color="#b45309" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-amber-900">Medical Registration Verification Pending</Text>
              <Text className="text-xs text-amber-800 mt-1 leading-5">
                Your doctor account is currently under verification. You will receive access once your medical registration has been verified.
              </Text>
            </View>
          </View>
        )}

        {/* Credentials Details Card */}
        <View className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-4">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Medical Credentials</Text>
            <View className={`px-2.5 py-1 rounded-full ${
              vStatus === 'VERIFIED' ? 'bg-green-100' :
              vStatus === 'REJECTED' || vStatus === 'FAILED' ? 'bg-red-100' : 'bg-amber-100'
            }`}>
              <Text className={`text-[10px] font-extrabold uppercase ${
                vStatus === 'VERIFIED' ? 'text-green-700' :
                vStatus === 'REJECTED' || vStatus === 'FAILED' ? 'text-red-700' : 'text-amber-700'
              }`}>{vStatus}</Text>
            </View>
          </View>
          <Text className="text-base font-bold text-gray-800">{user?.name || 'Dr. Practitioner'}</Text>
          <Text className="text-xs text-gray-500 mt-1">Reg No: <Text className="font-semibold text-gray-700">{user?.medical_registration_number || 'Under Review'}</Text></Text>
          <Text className="text-xs text-gray-500 mt-0.5">Council: <Text className="font-semibold text-gray-700">{user?.medical_council || 'State Medical Council'}</Text></Text>
        </View>

        {/* Hospital Affiliation Card */}
        <View className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-6">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hospital Affiliation</Text>
            <View className={`px-2.5 py-1 rounded-full ${
              hStatus === 'APPROVED' ? 'bg-green-100' :
              hStatus === 'REJECTED' ? 'bg-red-100' : 'bg-amber-100'
            }`}>
              <Text className={`text-[10px] font-extrabold uppercase ${
                hStatus === 'APPROVED' ? 'text-green-700' :
                hStatus === 'REJECTED' ? 'text-red-700' : 'text-amber-700'
              }`}>{hStatus}</Text>
            </View>
          </View>
          <View className="flex-row items-center mb-1">
            <Building2 size={16} color="#1B6CA8" className="mr-2" />
            <Text className="text-sm font-bold text-gray-800">{user?.requested_hospital_id || user?.hospital || 'General Hospital'}</Text>
          </View>
          <Text className="text-xs text-gray-500">Speciality: <Text className="font-semibold text-gray-700">{user?.speciality || 'General Medicine'}</Text></Text>
        </View>

        {/* Refresh Action Button */}
        <TouchableOpacity
          onPress={handleRefresh}
          disabled={refreshing}
          className={`py-4 rounded-xl items-center flex-row justify-center bg-[#1B6CA8] ${refreshing ? 'opacity-50' : ''}`}
        >
          {refreshing ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <>
              <RefreshCcw size={16} color="white" className="mr-2" />
              <Text className="text-white font-bold text-sm">Check Approval Status</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
