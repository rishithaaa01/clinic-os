import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import patientApi from '../../src/services/patientApi';
import { Search, ChevronDown, ChevronUp, Hospital, User, Calendar, FileText, Sparkles, Clock } from 'lucide-react-native';

export default function HealthRecordsScreen() {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['patientVisits'],
    queryFn: patientApi.getMyVisits,
  });

  const filtered = visits.filter((v: any) =>
    v.hospital_name?.toLowerCase().includes(search.toLowerCase()) ||
    v.doctor_name?.toLowerCase().includes(search.toLowerCase()) ||
    v.diagnosis?.some((d: string) => d.toLowerCase().includes(search.toLowerCase())) ||
    v.chief_complaint?.toLowerCase().includes(search.toLowerCase()) ||
    v.required_specialty?.toLowerCase().includes(search.toLowerCase()) ||
    v.referred_by?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView className="flex-1 bg-[#F7F3EE]">
      <View className="px-4 pt-6 flex-1">
        <View className="mb-4">
          <Text className="text-2xl font-bold text-gray-800">My Health Records</Text>
          <Text className="text-gray-500 text-sm mt-1">All your hospital visits, referrals & consultations</Text>
        </View>

        {/* Search */}
        <View className="flex-row items-center bg-white border border-gray-200 rounded-xl px-4 py-3 mb-6 shadow-sm">
          <Search size={18} color="#9ca3af" />
          <TextInput
            placeholder="Search hospital, doctor, specialty or diagnosis..."
            value={search}
            onChangeText={setSearch}
            className="flex-1 ml-3 text-sm text-gray-800"
          />
        </View>

        {/* Visit List */}
        {isLoading ? (
          <View className="flex-1 justify-center items-center">
            <ActivityIndicator size="large" color="#1B6CA8" />
          </View>
        ) : filtered.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20">
            <FileText size={56} color="#d1d5db" className="mb-4" />
            <Text className="text-gray-500 font-medium">No records found</Text>
            <Text className="text-gray-400 text-sm mt-1">Your hospital visits and referrals will appear here</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
            {filtered.map((visit: any) => {
              const id = visit.id || visit._id;
              const isExpanded = expandedId === id;
              const isReferral = visit.appointment_type === 'referred' || visit.referral_id || visit.referred_by;
              
              return (
                <View key={id} className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
                  <TouchableOpacity
                    onPress={() => setExpandedId(isExpanded ? null : id)}
                    className="p-5"
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 mr-3">
                        <View className="flex-row items-center mb-1">
                          <Hospital size={16} color="#1B6CA8" className="mr-2" />
                          <Text className="font-semibold text-gray-800 text-base">{visit.hospital_name}</Text>
                        </View>
                        
                        <View className="flex-row items-center flex-wrap gap-y-1 mb-2">
                          <View className="flex-row items-center mr-4">
                            <User size={13} color="#6b7280" className="mr-1" />
                            <Text className="text-sm text-gray-500">{visit.doctor_name}</Text>
                          </View>
                          <View className="flex-row items-center">
                            <Calendar size={13} color="#6b7280" className="mr-1" />
                            <Text className="text-sm text-gray-500">
                              {new Date(visit.date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                            </Text>
                          </View>
                        </View>
                        
                        {/* Referral Badges & Specialty Info */}
                        {isReferral && (
                          <View className="flex-row flex-wrap items-center gap-1.5 mb-2 mt-1">
                            <View className="bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full flex-row items-center">
                              <Sparkles size={11} color="#0d9488" style={{ marginRight: 4 }} />
                              <Text className="text-teal-800 text-[10px] font-bold uppercase">
                                Referral {visit.required_specialty ? `• ${visit.required_specialty}` : ''}
                              </Text>
                            </View>

                            {visit.referred_by && (
                              <View className="bg-purple-50 border border-purple-200 px-2 py-1 rounded-full">
                                <Text className="text-purple-700 text-[10px] font-semibold">
                                  By: {visit.referred_by}
                                </Text>
                              </View>
                            )}

                            {visit.status && (
                              <View className={`px-2 py-1 rounded-full border ${
                                visit.status === 'completed'
                                  ? 'bg-emerald-50 border-emerald-200'
                                  : 'bg-amber-50 border-amber-200'
                              }`}>
                                <Text className={`text-[10px] font-bold uppercase ${
                                  visit.status === 'completed' ? 'text-emerald-700' : 'text-amber-700'
                                }`}>
                                  {visit.status === 'in_queue' || visit.status === 'pending' ? '⏳ Queued for Doctor' : visit.status}
                                </Text>
                              </View>
                            )}
                          </View>
                        )}
                        
                        {visit.diagnosis?.length > 0 && (
                          <View className="flex-row flex-wrap gap-2 mt-2">
                            {visit.diagnosis.map((d: string, i: number) => (
                              <View key={i} className="bg-blue-50 px-2 py-1 rounded-full">
                                <Text className="text-blue-700 text-xs">{d}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                      <View className="mt-1">
                        {isExpanded ? (
                          <ChevronUp size={20} color="#9ca3af" />
                        ) : (
                          <ChevronDown size={20} color="#9ca3af" />
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View className="px-5 pb-5 pt-4 border-t border-gray-100 bg-slate-50/50">
                      {visit.chief_complaint && (
                        <View className="mb-4">
                          <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                            {isReferral ? 'Referral Reason / Complaint' : 'Chief Complaint'}
                          </Text>
                          <Text className="text-gray-700 text-sm leading-5">{visit.chief_complaint}</Text>
                        </View>
                      )}
                      
                      {visit.notes && (
                        <View className="mb-4">
                          <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Clinical Notes</Text>
                          <Text className="text-gray-700 text-sm leading-5">{visit.notes}</Text>
                        </View>
                      )}
                      
                      {visit.prescriptions?.length > 0 && (
                        <View className="mb-4">
                          <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Prescriptions</Text>
                          {visit.prescriptions.map((rx: any, i: number) => (
                            <View key={i} className="bg-purple-50 rounded-lg p-3 mb-2 border border-purple-100">
                              <Text className="font-semibold text-purple-800">{rx.medicine}</Text>
                              <Text className="text-purple-600 text-xs mt-1">
                                {rx.dosage} · {rx.frequency} · {rx.duration}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                      
                      {visit.follow_up_date && (
                        <View className="bg-amber-50 rounded-lg p-3 flex-row items-center mt-2 border border-amber-200">
                          <Calendar size={15} color="#f59e0b" className="mr-2" />
                          <Text className="text-amber-700 text-sm font-medium">
                            Follow-up: {new Date(visit.follow_up_date).toLocaleDateString('en-IN', { dateStyle: 'long' })}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            <View className="h-10" />
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
