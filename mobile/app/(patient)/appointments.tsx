import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../src/services/api';
import { Calendar, Building, Stethoscope, Clock, CheckCircle2, AlertTriangle, ShieldAlert, Sparkles } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

const TIME_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '02:00 PM', '02:30 PM',
  '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
];

const SPECIALITIES = [
  'General Medicine', 'Cardiology', 'Gynecology', 'Pediatrics',
  'Orthopedics', 'Dermatology', 'ENT', 'Neurology', 'Psychiatry'
];

export default function PatientAppointments() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Pre-fill parameters if navigated from auto-referral
  const paramHospital = (params.hospital as string) || '';
  const paramSpecialty = (params.specialty as string) || '';
  const paramComplaint = (params.complaint as string) || '';

  const [hospitals, setHospitals] = useState<any[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<string>(paramHospital || '');
  const [specialty, setSpecialty] = useState<string>(paramSpecialty || 'General Medicine');
  const [complaint, setComplaint] = useState<string>(paramComplaint || '');
  
  // Date & Time Slot selection
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedSlot, setSelectedSlot] = useState<string>('09:00 AM');
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [fetchingSlots, setFetchingSlots] = useState(false);

  const [booking, setBooking] = useState(false);
  const [myAppointments, setMyAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const SYMPTOM_SPECIALTY_MAP = [
    { keywords: ['stomach', 'abdomen', 'gastric', 'vomit', 'nausea', 'diarrhea', 'ulcer', 'acid'], spec: 'Gastroenterology' },
    { keywords: ['pregnant', 'pregnancy', 'gynaec', 'period', 'menstrual', 'uterus'], spec: 'Gynecology' },
    { keywords: ['bone', 'joint', 'knee', 'fracture', 'ortho', 'leg pain', 'back pain', 'spine'], spec: 'Orthopedics' },
    { keywords: ['heart', 'chest pain', 'cardiac', 'palpitation', 'breathless', 'bp'], spec: 'Cardiology' },
    { keywords: ['ear', 'nose', 'throat', 'ent', 'sinus', 'tonsil'], spec: 'ENT' },
    { keywords: ['skin', 'rash', 'itch', 'derma', 'allergy', 'eczema'], spec: 'Dermatology' },
    { keywords: ['child', 'infant', 'baby', 'pediatric'], spec: 'Pediatrics' },
    { keywords: ['headache', 'migraine', 'seizure', 'neuro', 'stroke', 'brain'], spec: 'Neurology' },
    { keywords: ['depress', 'anxiety', 'stress', 'mental', 'psychiatry'], spec: 'Psychiatry' },
  ];

  const handleComplaintChange = (text: string) => {
    setComplaint(text);
    const t = text.toLowerCase();
    for (const item of SYMPTOM_SPECIALTY_MAP) {
      if (item.keywords.some(kw => t.includes(kw))) {
        setSpecialty(item.spec);
        break;
      }
    }
  };

  // Generate next 4 days for date selector
  const datesList = Array.from({ length: 4 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      iso: d.toISOString().split('T')[0],
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    };
  });

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [])
  );

  const [hospLoading, setHospLoading] = useState(true);
  const [hospError, setHospError] = useState(false);

  const [realSpecialties, setRealSpecialties] = useState<string[]>([]);
  const [specLoading, setSpecLoading] = useState(false);
  const [availableDocs, setAvailableDocs] = useState<any[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [realSlots, setRealSlots] = useState<any[]>([]);

  useEffect(() => {
    if (selectedHospital) {
      fetchSpecialtiesAndDoctors();
    }
  }, [selectedHospital, specialty]);

  useEffect(() => {
    if (selectedHospital && selectedDate) {
      fetchRealSlots();
      const interval = setInterval(() => {
        fetchRealSlots();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [selectedHospital, selectedDate, selectedDocId, specialty]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setHospLoading(true);
      setHospError(false);

      let hospList: any[] = [];
      try {
        const hospRes = await api.get('/hospitals');
        hospList = Array.isArray(hospRes.data) ? hospRes.data : [];
      } catch (e) {
        try {
          const hospRes2 = await api.get('/auth/hospitals');
          hospList = Array.isArray(hospRes2.data) ? hospRes2.data : [];
        } catch (_) {
          setHospError(true);
        }
      }

      setHospitals(hospList);

      if (hospList.length > 0 && !selectedHospital) {
        setSelectedHospital(hospList[0].name || hospList[0].hospital_name);
      }

      try {
        const apptRes = await api.get('/appointments/my-requests');
        const rawAppts = Array.isArray(apptRes.data) ? apptRes.data : [];
        const seen = new Set();
        const uniqueAppts = rawAppts.filter((a: any) => {
          const id = a.id || a._id || a.appointment_id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        setMyAppointments(uniqueAppts);
      } catch (_) {
        setMyAppointments([]);
      }
    } catch (e) {
      console.log('Error fetching appointment data', e);
    } finally {
      setLoading(false);
      setHospLoading(false);
    }
  };

  const [specialistCheck, setSpecialistCheck] = useState<any>({
    specialist_available: true,
    recommended_hospitals: [],
    recommended_specialty: '',
    confidence: null,
    message: ''
  });

  const fetchSpecialtiesAndDoctors = async () => {
    try {
      setSpecLoading(true);
      const [specRes, docRes, checkRes] = await Promise.allSettled([
        api.get(`/appointments/specialties?hospital_name=${encodeURIComponent(selectedHospital)}`),
        api.get(`/appointments/available-doctors?hospital=${encodeURIComponent(selectedHospital)}&speciality=${encodeURIComponent(specialty)}`),
        api.get(`/appointments/check-specialist?hospital_name=${encodeURIComponent(selectedHospital)}&specialty=${encodeURIComponent(specialty)}&complaint=${encodeURIComponent(complaint)}`)
      ]);

      const specs = specRes.status === 'fulfilled' && Array.isArray(specRes.value?.data) ? specRes.value.data : [];
      setRealSpecialties(specs);

      const docs = docRes.status === 'fulfilled' && Array.isArray(docRes.value?.data) ? docRes.value.data : [];
      setAvailableDocs(docs);

      if (checkRes.status === 'fulfilled' && checkRes.value?.data) {
        const cData = checkRes.value.data;
        setSpecialistCheck(cData);
        if (cData.recommended_specialty && (!specialty || specialty === 'General Medicine')) {
          setSpecialty(cData.recommended_specialty);
        }
      } else {
        setSpecialistCheck({ specialist_available: true, recommended_hospitals: [] });
      }
    } catch (e) {
      console.log('Error fetching specialties/doctors', e);
    } finally {
      setSpecLoading(false);
    }
  };

  const fetchRealSlots = async () => {
    try {
      setFetchingSlots(true);
      const specParam = specialty ? `&specialty=${encodeURIComponent(specialty)}` : '';
      const docParam = selectedDocId ? `&doctor_id=${selectedDocId}` : '';
      const url = `/appointments/slots?hospital_name=${encodeURIComponent(selectedHospital)}&date=${selectedDate}${docParam}${specParam}`;
      const res = await api.get(url);
      const slots = res.data?.slots || [];
      setRealSlots(slots);

      const unavailable = slots.filter((s: any) => !s.available).map((s: any) => s.time);
      setBookedSlots(unavailable);

      const firstAvail = slots.find((s: any) => s.available && s.reason !== 'PASSED');
      const currentSlotObj = slots.find((s: any) => s.time === selectedSlot);

      if (!currentSlotObj || !currentSlotObj.available) {
        if (firstAvail) setSelectedSlot(firstAvail.time);
      }
    } catch (e) {
      console.log('Error fetching real slots', e);
    } finally {
      setFetchingSlots(false);
    }
  };

  const handleBookAppointment = async () => {
    if (!selectedHospital) return Alert.alert('Error', 'Please select a hospital.');
    if (bookedSlots.includes(selectedSlot)) {
      const currentSlotObj = realSlots.find((s: any) => s.time === selectedSlot);
      const msg = currentSlotObj?.reason === 'PASSED'
        ? `The time slot '${selectedSlot}' has already passed. Please choose a future slot.`
        : `The time slot '${selectedSlot}' is already booked. Please choose an open slot.`;
      return Alert.alert('Slot Unavailable 🔒', msg);
    }

    setBooking(true);
    try {
      const res = await api.post('/appointments', {
        hospital_name: selectedHospital,
        specialty,
        doctor_id: selectedDocId || undefined,
        chief_complaint: complaint.trim() || 'Routine OPD Consultation',
        appointment_date: selectedDate,
        time_slot: selectedSlot,
        source_type: params.auto_referral ? 'AUTO_REFERRAL' : 'DIRECT_APPOINTMENT'
      });

      Alert.alert(
        'Appointment Requested! ⏳',
        `Your appointment request has been submitted for ${selectedDate} at ${selectedSlot} (${selectedHospital}). Please wait for doctor confirmation before visiting.`
      );
      setComplaint('');
      fetchData();
      fetchRealSlots();
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to request appointment.';
      Alert.alert('Request Error', msg);
    } finally {
      setBooking(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = (status || '').toUpperCase();
    switch (s) {
      case 'ONGOING':
        return { bg: 'bg-emerald-500', text: 'text-white', label: '🟢 ONGOING NOW' };
      case 'UPCOMING':
        return { bg: 'bg-blue-600', text: 'text-white', label: '🔵 UPCOMING' };
      case 'MISSED':
        return { bg: 'bg-red-500', text: 'text-white', label: '🔴 MISSED' };
      case 'COMPLETED':
        return { bg: 'bg-slate-700', text: 'text-white', label: '✅ COMPLETED' };
      default:
        return { bg: 'bg-amber-500', text: 'text-white', label: `⏳ ${s}` };
    }
  };

  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const handleNotifyArrival = async (apptId: string) => {
    try {
      setNotifyingId(apptId);
      const res = await api.post(`/appointments/${apptId}/notify-arrival`);
      Alert.alert('Arrival Notified 📍', res.data?.message || 'Your arrival notification was sent to Reception.');
      fetchData();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.detail || 'Failed to notify arrival.');
    } finally {
      setNotifyingId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView className="flex-1 px-4 pt-6" contentContainerStyle={{ paddingBottom: 50 }}>
        
        {/* Header */}
        <View className="mb-5">
          <Text className="text-slate-800 text-2xl font-bold">Book OPD Appointment</Text>
          <Text className="text-slate-500 text-xs mt-0.5">Select Hospital, Specialty, Date & Time Slot</Text>
        </View>

        {/* Auto Referral Banner if pre-filled */}
        {params.auto_referral && (
          <View className="bg-teal-600 rounded-2xl p-4 mb-5 shadow-sm border border-teal-500 flex-row items-center">
            <Sparkles size={20} color="white" className="mr-3" />
            <View className="flex-1">
              <Text className="text-white font-bold text-sm">AI Triage Auto-Referral</Text>
              <Text className="text-teal-100 text-xs mt-0.5">
                Hospital: <Text className="font-semibold text-white">{selectedHospital}</Text> • {specialty}
              </Text>
            </View>
          </View>
        )}

        {/* Booking Card */}
        <View className="bg-white p-5 rounded-3xl mb-8 border border-slate-100 shadow-sm shadow-slate-200/50">

          {/* 1. Select Hospital */}
          <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">1. Select Hospital</Text>
          {hospLoading ? (
            <View className="flex-row items-center py-2 mb-3">
              <ActivityIndicator size="small" color="#1B6CA8" style={{ marginRight: 8 }} />
              <Text className="text-slate-500 text-xs font-medium">Loading hospitals...</Text>
            </View>
          ) : hospError ? (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
              <Text className="text-red-600 text-xs font-medium">We couldn't load hospitals right now. Please try again.</Text>
            </View>
          ) : hospitals.length === 0 ? (
            <View className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
              <Text className="text-amber-800 text-xs font-medium">No hospitals are currently available.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
              {hospitals.map(h => {
                const hName = h.name || h.hospital_name;
                const isSel = selectedHospital === hName;
                return (
                  <TouchableOpacity
                    key={h.id || h._id || hName}
                    onPress={() => setSelectedHospital(hName)}
                    className={`mr-2 px-3.5 py-2.5 rounded-xl border ${isSel ? 'bg-blue-50 border-[#1B6CA8]' : 'bg-slate-50 border-slate-200'}`}
                  >
                    <Text className={`text-xs font-bold ${isSel ? 'text-[#1B6CA8]' : 'text-slate-700'}`}>{hName}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Specialist Availability & Alternative Hospital Banner */}
          {!specialistCheck.specialist_available && (
            <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
              <View className="flex-row items-center mb-1">
                <AlertTriangle size={16} color="#d97706" style={{ marginRight: 6 }} />
                <Text className="text-amber-900 font-bold text-xs">Specialist Not Available at {selectedHospital}</Text>
              </View>
              <Text className="text-amber-800 text-xs mb-3">
                {specialistCheck.message || `No ${specialty} specialist is currently available at ${selectedHospital}.`}
              </Text>

              {specialistCheck.recommended_hospitals && specialistCheck.recommended_hospitals.length > 0 && (
                <View>
                  <Text className="text-amber-900 text-[10px] font-bold uppercase tracking-wider mb-2">
                    🏥 Suggested Alternative Hospitals:
                  </Text>
                  {specialistCheck.recommended_hospitals.map((alt: any) => (
                    <View key={alt.hospital_name} className="bg-white border border-amber-200 p-3 rounded-xl mb-2 flex-row items-center justify-between shadow-xs">
                      <View className="flex-1 pr-2">
                        <Text className="text-slate-800 font-bold text-xs">{alt.hospital_name}</Text>
                        <Text className="text-slate-500 text-[11px]">
                          {alt.available_doctor_name} ({alt.specialty}) • {alt.district || 'Chennai'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedHospital(alt.hospital_name);
                          if (alt.specialty) setSpecialty(alt.specialty);
                        }}
                        className="bg-[#1B6CA8] px-3 py-1.5 rounded-lg"
                      >
                        <Text className="text-white text-xs font-bold">Select Hospital</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* 2. Select Specialty */}
          <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">2. Select Specialty</Text>
          {specLoading ? (
            <View className="flex-row items-center py-2 mb-3">
              <ActivityIndicator size="small" color="#1B6CA8" style={{ marginRight: 8 }} />
              <Text className="text-slate-500 text-xs font-medium">Loading specialties...</Text>
            </View>
          ) : realSpecialties.length === 0 ? (
            <View className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
              <Text className="text-amber-800 text-xs font-medium">No specialties are currently available at this hospital.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
              {realSpecialties.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setSpecialty(s)}
                  className={`mr-2 px-3 py-2 rounded-xl border ${specialty === s ? 'bg-[#1B6CA8] border-[#1B6CA8]' : 'bg-slate-50 border-slate-200'}`}
                >
                  <Text className={`text-xs font-bold ${specialty === s ? 'text-white' : 'text-slate-700'}`}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Optional Verified Doctor Selection */}
          {availableDocs.length > 0 && (
            <>
              <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Verified Doctor (Optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
                <TouchableOpacity
                  onPress={() => setSelectedDocId('')}
                  className={`mr-2 px-3 py-2 rounded-xl border ${!selectedDocId ? 'bg-slate-800 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                >
                  <Text className={`text-xs font-bold ${!selectedDocId ? 'text-white' : 'text-slate-700'}`}>Any Doctor</Text>
                </TouchableOpacity>
                {availableDocs.map(d => (
                  <TouchableOpacity
                    key={d.id}
                    onPress={() => setSelectedDocId(d.id)}
                    className={`mr-2 px-3 py-2 rounded-xl border ${selectedDocId === d.id ? 'bg-[#1B6CA8] border-[#1B6CA8]' : 'bg-slate-50 border-slate-200'}`}
                  >
                    <Text className={`text-xs font-bold ${selectedDocId === d.id ? 'text-white' : 'text-slate-700'}`}>{d.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* 3. Select Date */}
          <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">3. Select Date</Text>
          <View className="flex-row mb-4 gap-2">
            {datesList.map(d => (
              <TouchableOpacity
                key={d.iso}
                onPress={() => setSelectedDate(d.iso)}
                className={`flex-1 py-2.5 rounded-xl border items-center justify-center ${selectedDate === d.iso ? 'bg-teal-600 border-teal-600' : 'bg-slate-50 border-slate-200'}`}
              >
                <Text className={`text-[10px] font-bold ${selectedDate === d.iso ? 'text-white' : 'text-slate-500'}`}>{d.label}</Text>
                <Text className={`text-xs font-bold mt-0.5 ${selectedDate === d.iso ? 'text-white' : 'text-slate-800'}`}>{d.iso.slice(8)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 4. Select Time Slot (with Conflict Check) */}
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">4. Select Time Slot</Text>
            {fetchingSlots && <ActivityIndicator size="small" color="#0d9488" />}
          </View>

          {(() => {
            const displaySlots = realSlots.filter((s: any) => s.reason !== 'PASSED');
            if (displaySlots.length === 0 && !fetchingSlots) {
              return (
                <View className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                  <Text className="text-amber-800 text-xs font-medium">No more appointment slots available for this date.</Text>
                </View>
              );
            }
            return (
              <View className="flex-row flex-wrap gap-2 mb-5">
                {displaySlots.map(sObj => {
                  const slot = sObj.time;
                  const isBooked = !sObj.available;
                  const isSelected = selectedSlot === slot;

                  return (
                    <TouchableOpacity
                      key={slot}
                      disabled={isBooked}
                      onPress={() => setSelectedSlot(slot)}
                      className={`w-[31%] py-2.5 rounded-xl border items-center justify-center ${
                        isBooked
                          ? 'bg-slate-100 border-slate-200 opacity-50'
                          : isSelected
                          ? 'bg-[#1B6CA8] border-[#1B6CA8]'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <Text className={`text-xs font-bold ${isBooked ? 'text-slate-400 line-through' : isSelected ? 'text-white' : 'text-slate-700'}`}>
                        {slot}
                      </Text>
                      {isBooked && (
                        <Text className="text-[9px] font-bold uppercase mt-0.5 text-red-500">
                          Booked 🔒
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })()}

          {/* 5. Chief Complaint */}
          <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">5. Reason / Symptoms</Text>
          <TextInput
            placeholder="Describe reason for visit (e.g. chest discomfort, joint pain...)"
            value={complaint}
            onChangeText={handleComplaintChange}
            className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-5 text-slate-800 text-sm"
          />

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleBookAppointment}
            disabled={booking || bookedSlots.includes(selectedSlot)}
            className={`py-3.5 px-4 rounded-2xl items-center justify-center flex-row shadow-sm min-h-[48px] ${
              booking || bookedSlots.includes(selectedSlot) ? 'bg-slate-300' : 'bg-[#1B6CA8] active:bg-[#155b8e]'
            }`}
          >
            {booking ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <View className="flex-row items-center justify-center">
                <Calendar color="white" size={16} style={{ marginRight: 8 }} />
                <Text className="text-white font-bold text-sm text-center">
                  Request Appointment · {selectedSlot}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Existing Appointments List */}
        <Text className="text-slate-800 text-xl font-bold mb-4">My Appointments & Requests</Text>
        {myAppointments.length === 0 ? (
          <Text className="text-slate-400 text-xs italic">No active appointments booked yet.</Text>
        ) : (
          myAppointments.map((item, idx) => {
            const st = (item.status || '').toUpperCase();
            const apptId = item.id || item._id;

            return (
              <View key={apptId || idx} className="bg-white p-4 rounded-2xl mb-3 border border-slate-100 shadow-sm">
                <View className="flex-row justify-between items-center mb-2">
                  <Text className="font-bold text-slate-800 text-base flex-1 mr-2">{item.hospital_name || 'Hospital'}</Text>
                  <View className={`px-2.5 py-1 rounded-full ${
                    st === 'COMPLETED' ? 'bg-emerald-100' :
                    st === 'CHECKED_IN' || st === 'WAITING' ? 'bg-blue-100' :
                    st === 'IN_CONSULTATION' ? 'bg-purple-100' :
                    st === 'NO_SHOW' || st === 'CANCELLED' ? 'bg-red-100' :
                    'bg-amber-100'
                  }`}>
                    <Text className={`text-[10px] font-bold ${
                      st === 'COMPLETED' ? 'text-emerald-800' :
                      st === 'CHECKED_IN' || st === 'WAITING' ? 'text-blue-800' :
                      st === 'IN_CONSULTATION' ? 'text-purple-800' :
                      st === 'NO_SHOW' || st === 'CANCELLED' ? 'text-red-800' :
                      'text-amber-800'
                    }`}>
                      {st === 'CHECKED_IN' || st === 'WAITING' ? '✓ CHECKED IN' : st}
                    </Text>
                  </View>
                </View>

                <View className="flex-row items-center mb-1">
                  <Clock size={13} color="#475569" style={{ marginRight: 6 }} />
                  <Text className="text-slate-700 font-bold text-xs">
                    {item.requested_date} • {item.requested_time_slot || item.time_slot || '09:00 AM'}
                  </Text>
                </View>

                <Text className="text-teal-700 font-semibold text-xs mb-1">
                  Specialty: {item.specialty || 'General Medicine'} • Dr. {item.doctor_name || 'Assigned'}
                </Text>
                
                {item.symptoms ? (
                  <Text className="text-slate-500 text-xs mt-0.5 mb-2">Reason: {item.symptoms}</Text>
                ) : null}

                {/* Patient Actions */}
                {(st === 'REQUESTED' || st === 'PENDING') && (
                  <View className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mt-2 items-center">
                    <Text className="text-amber-900 font-bold text-[11px] text-center">
                      ⏳ Request Sent — Awaiting Doctor Confirmation
                    </Text>
                    <Text className="text-amber-700 text-[10px] mt-0.5 text-center">
                      Please wait for Dr. {item.doctor_name || 'Specialist'} to accept before traveling.
                    </Text>
                  </View>
                )}

                {(st === 'CONFIRMED' || st === 'ACCEPTED') && (
                  !item.arrival_notified ? (
                    <TouchableOpacity
                      onPress={() => handleNotifyArrival(apptId)}
                      disabled={notifyingId === apptId}
                      className="bg-indigo-600 py-2.5 px-4 rounded-xl items-center justify-center mt-2 flex-row"
                    >
                      {notifyingId === apptId ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text className="text-white text-xs font-bold">📍 I've Arrived at Hospital</Text>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <View className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mt-2 items-center">
                      <Text className="text-amber-800 font-bold text-[11px]">
                        📍 Arrival Notified — Please report to Reception Desk
                      </Text>
                    </View>
                  )
                )}

                {st === 'ARRIVAL_NOTIFIED' && (
                  <View className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mt-2 items-center">
                    <Text className="text-amber-800 font-bold text-[11px]">
                      📍 Arrival Notified — Please report to Reception Desk
                    </Text>
                  </View>
                )}

                {(st === 'CHECKED_IN' || st === 'WAITING') && (
                  <View className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 mt-2 items-center">
                    <Text className="text-blue-800 font-bold text-[11px]">
                      ✓ Checked In — Waiting for Doctor Consultation
                    </Text>
                  </View>
                )}

                {st === 'REJECTED' && (
                  <View className="bg-red-50 border border-red-200 rounded-xl p-2.5 mt-2 items-center">
                    <Text className="text-red-800 font-bold text-[11px]">
                      ❌ Request Declined — Please select another slot or doctor
                    </Text>
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
