import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../src/services/api';
import { Building, Stethoscope, CheckCircle2, Clock, X, MessageSquarePlus } from 'lucide-react-native';

export default function AshaReferrals() {
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRef, setSelectedRef] = useState<any>(null);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  
  // Follow-up Form
  const [contacted, setContacted] = useState(true);
  const [attended, setAttended] = useState(true);
  const [observation, setObservation] = useState('');
  const [newSymptoms, setNewSymptoms] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchReferrals = async () => {
    try {
      setLoading(true);
      const res = await api.get('/asha/referrals');
      setReferrals(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.log('Error fetching ASHA referrals', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReferrals();
  }, []);

  const handleRecordFollowUp = async () => {
    if (!selectedRef) return;
    if (!observation.trim()) {
      Alert.alert('Validation Error', 'Please enter your community follow-up observations.');
      return;
    }
    try {
      setSubmitting(true);
      await api.post(`/asha/referrals/${selectedRef.id || selectedRef.referral_id}/follow-up`, {
        patient_contacted: contacted,
        attended_referral: attended,
        follow_up_observation: observation.trim(),
        new_symptoms_reported: newSymptoms.trim() || null,
        action_required: attended ? 'Routine follow-up' : 'Needs visit encouragement'
      });
      Alert.alert('Success', 'Community follow-up observation recorded successfully.');
      setShowFollowUpModal(false);
      setObservation('');
      setNewSymptoms('');
      fetchReferrals();
    } catch (err: any) {
      Alert.alert('Follow-Up Error', err.response?.data?.detail || 'We couldn’t record the follow-up right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <View className="bg-white p-5 rounded-3xl mb-4 border border-slate-100 shadow-sm shadow-slate-200/50">
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1">
          <Text className="text-slate-800 font-bold text-lg mb-1">{item.patient_name || 'Referred Member'}</Text>
          <View className="flex-row items-center gap-1 mb-1">
            <Building size={14} color="#64748b" />
            <Text className="text-slate-600 text-xs font-semibold">{item.referred_to || item.to_hospital_id || 'Hospital'}</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Stethoscope size={14} color="#0d9488" />
            <Text className="text-teal-700 font-bold text-xs">
              Specialist: Dr. {item.assigned_doctor_name || 'Assigned Specialist'} ({item.assigned_specialty || item.specialty || 'General'})
            </Text>
          </View>
        </View>
        <View className={`px-2.5 py-1 rounded-full ${item.status === 'completed' ? 'bg-green-100' : 'bg-amber-100'}`}>
          <Text className={`text-[10px] font-bold uppercase ${item.status === 'completed' ? 'text-green-700' : 'text-amber-700'}`}>
            {item.display_status || item.status || 'Referral Active'}
          </Text>
        </View>
      </View>

      {/* Progress timeline preview */}
      <View className="bg-slate-50 p-3 rounded-2xl mb-3 border border-slate-100 flex-row items-center justify-between">
        <Text className="text-slate-500 text-xs font-semibold">Status Progress</Text>
        <Text className="text-teal-700 font-bold text-xs">{item.display_status || 'Referral Pending'}</Text>
      </View>

      <View className="flex-row justify-between items-center pt-2 border-t border-slate-100">
        <Text className="text-slate-400 text-[10px]">Sent: {item.sent_date || 'Recently'}</Text>
        <TouchableOpacity
          onPress={() => {
            setSelectedRef(item);
            setShowFollowUpModal(true);
          }}
          className="bg-teal-600 px-3.5 py-2 rounded-xl flex-row items-center"
        >
          <MessageSquarePlus size={13} color="#ffffff" />
          <Text className="text-white text-xs font-bold ml-1.5">Record Follow-Up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="p-4 pt-6 flex-1">
        <Text className="text-slate-800 text-2xl font-bold mb-1">Hospital Referrals</Text>
        <Text className="text-slate-500 text-xs mb-6">Track Community Referrals & Record Follow-Up Observations</Text>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#0d9488" />
          </View>
        ) : (
          <FlatList
            data={referrals}
            renderItem={renderItem}
            keyExtractor={item => item.id || item._id || Math.random().toString()}
            refreshing={loading}
            onRefresh={fetchReferrals}
            ListEmptyComponent={
              <View className="items-center justify-center py-10">
                <Text className="text-slate-400">No active referrals created yet</Text>
              </View>
            }
          />
        )}
      </View>

      {/* Record Follow-Up Modal */}
      {showFollowUpModal && selectedRef && (
        <Modal visible={showFollowUpModal} transparent animationType="slide">
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-3xl p-6 max-h-[85%]">
              <View className="flex-row justify-between items-center mb-4">
                <View>
                  <Text className="text-xl font-bold text-slate-800">Record Follow-Up</Text>
                  <Text className="text-xs text-slate-500">Patient: {selectedRef.patient_name}</Text>
                </View>
                <TouchableOpacity onPress={() => setShowFollowUpModal(false)} className="p-1">
                  <X size={20} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-4">
                <View className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-2">
                  <Text className="text-xs text-slate-500 mb-1 font-semibold">Target Facility</Text>
                  <Text className="text-sm font-bold text-slate-800">{selectedRef.referred_to || selectedRef.to_hospital_id}</Text>
                  <Text className="text-xs text-teal-700 font-bold mt-1">Status: {selectedRef.display_status || selectedRef.status}</Text>
                </View>

                <View className="mb-3">
                  <Text className="text-xs font-bold text-slate-600 mb-2 uppercase">Contacted Patient?</Text>
                  <View className="flex-row gap-3">
                    <TouchableOpacity
                      onPress={() => setContacted(true)}
                      className={`flex-1 py-2.5 rounded-xl border flex-row justify-center items-center ${contacted ? 'bg-teal-50 border-teal-500' : 'bg-white border-slate-200'}`}
                    >
                      <Text className={`text-xs font-bold ${contacted ? 'text-teal-700' : 'text-slate-600'}`}>Yes, Contacted</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setContacted(false)}
                      className={`flex-1 py-2.5 rounded-xl border flex-row justify-center items-center ${!contacted ? 'bg-red-50 border-red-500' : 'bg-white border-slate-200'}`}
                    >
                      <Text className={`text-xs font-bold ${!contacted ? 'text-red-700' : 'text-slate-600'}`}>No</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View className="mb-3">
                  <Text className="text-xs font-bold text-slate-600 mb-2 uppercase">Attended Hospital Referral?</Text>
                  <View className="flex-row gap-3">
                    <TouchableOpacity
                      onPress={() => setAttended(true)}
                      className={`flex-1 py-2.5 rounded-xl border flex-row justify-center items-center ${attended ? 'bg-teal-50 border-teal-500' : 'bg-white border-slate-200'}`}
                    >
                      <Text className={`text-xs font-bold ${attended ? 'text-teal-700' : 'text-slate-600'}`}>Yes, Visited OPD</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setAttended(false)}
                      className={`flex-1 py-2.5 rounded-xl border flex-row justify-center items-center ${!attended ? 'bg-amber-50 border-amber-500' : 'bg-white border-slate-200'}`}
                    >
                      <Text className={`text-xs font-bold ${!attended ? 'text-amber-700' : 'text-slate-600'}`}>Not Yet</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View className="mb-3">
                  <Text className="text-xs font-bold text-slate-600 mb-1.5 uppercase">Community Observations *</Text>
                  <TextInput
                    value={observation}
                    onChangeText={setObservation}
                    placeholder="Enter post-referral community observations..."
                    multiline
                    numberOfLines={3}
                    className="border border-slate-200 rounded-2xl p-3 text-xs bg-white"
                  />
                </View>

                <View className="mb-4">
                  <Text className="text-xs font-bold text-slate-600 mb-1.5 uppercase">New Symptoms Reported (Optional)</Text>
                  <TextInput
                    value={newSymptoms}
                    onChangeText={setNewSymptoms}
                    placeholder="Any new symptoms or complaints..."
                    className="border border-slate-200 rounded-2xl p-3 text-xs bg-white"
                  />
                </View>

                <TouchableOpacity
                  onPress={handleRecordFollowUp}
                  disabled={submitting}
                  className="bg-teal-600 py-3.5 rounded-2xl items-center justify-center mb-4"
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text className="text-white font-bold text-sm">Save Community Follow-Up</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

