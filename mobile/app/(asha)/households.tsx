import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../src/services/api';
import { Home, Plus, UserPlus, Phone, MapPin, ChevronRight, X, User } from 'lucide-react-native';

export default function AshaHouseholds() {
  const [households, setHouseholds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Household Modal State
  const [showHhModal, setShowHhModal] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [headName, setHeadName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [village, setVillage] = useState('');
  const [savingHh, setSavingHh] = useState(false);

  // Member Modal State
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [selectedHhId, setSelectedHhId] = useState<string | null>(null);
  const [memberName, setMemberName] = useState('');
  const [memberAge, setMemberAge] = useState('');
  const [memberGender, setMemberGender] = useState('female');
  const [memberRelation, setMemberRelation] = useState('Spouse');
  const [memberHistory, setMemberHistory] = useState('');
  const [savingMember, setSavingMember] = useState(false);

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

  const handleCreateHousehold = async () => {
    if (!familyName || !headName) {
      return Alert.alert('Required', 'Family Name and Head Name are required.');
    }
    setSavingHh(true);
    try {
      await api.post('/asha/households', {
        family_name: familyName.trim(),
        head_name: headName.trim(),
        contact_phone: contactPhone.trim() || '0000000000',
        village: village.trim() || 'Rural Village',
        block: 'Local Block',
        district: 'Rural District',
        members: [
          {
            name: headName.trim(),
            relation: 'Head of Family',
            age: 35,
            gender: 'male'
          }
        ]
      });
      Alert.alert('Success', 'Household registered successfully!');
      setShowHhModal(false);
      setFamilyName('');
      setHeadName('');
      setContactPhone('');
      setVillage('');
      fetchHouseholds();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.detail || 'Failed to register household');
    } finally {
      setSavingHh(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedHhId || !memberName) {
      return Alert.alert('Required', 'Member name is required.');
    }
    setSavingMember(true);
    try {
      const res = await api.post(`/asha/households/${selectedHhId}/members`, {
        name: memberName.trim(),
        age: parseInt(memberAge) || 25,
        gender: memberGender,
        relation: memberRelation,
        medical_history: memberHistory
      });
      Alert.alert('Success', `Member registered! Permanent Patient ID: ${res.data.patient_id?.slice(-6).toUpperCase()}`);
      setShowMemberModal(false);
      setMemberName('');
      setMemberAge('');
      setMemberHistory('');
      fetchHouseholds();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.detail || 'Failed to add member');
    } finally {
      setSavingMember(false);
    }
  };

  const renderHousehold = ({ item }: { item: any }) => (
    <View className="bg-white p-5 rounded-3xl mb-4 border border-slate-100 shadow-sm shadow-slate-200/50">
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-1">
            <Text className="text-slate-800 font-bold text-lg">{item.family_name || 'Family'}</Text>
            <View className={`px-2 py-0.5 rounded-md ${item.risk_level === 'red' ? 'bg-red-100' : item.risk_level === 'amber' ? 'bg-amber-100' : 'bg-green-100'}`}>
              <Text className={`text-[10px] font-bold uppercase ${item.risk_level === 'red' ? 'text-red-700' : item.risk_level === 'amber' ? 'text-amber-700' : 'text-green-700'}`}>
                {item.risk_level || 'green'}
              </Text>
            </View>
          </View>
          <Text className="text-slate-500 text-xs font-semibold">Head: {item.head_name || 'N/A'} • Village: {item.village || 'Local'}</Text>
        </View>
        <TouchableOpacity 
          onPress={() => { setSelectedHhId(item.id || item._id); setShowMemberModal(true); }}
          className="bg-teal-50 px-3 py-1.5 rounded-xl border border-teal-200 flex-row items-center gap-1"
        >
          <UserPlus size={14} color="#0d9488" />
          <Text className="text-teal-700 font-bold text-xs">+ Member</Text>
        </TouchableOpacity>
      </View>

      <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Registered Members ({item.members?.length || 0})</Text>
      <View className="space-y-1.5 mb-3">
        {(item.members || []).map((m: any, idx: number) => (
          <View key={idx} className="bg-slate-50 p-2.5 rounded-xl flex-row justify-between items-center border border-slate-100">
            <View className="flex-row items-center gap-2">
              <User size={14} color="#64748b" />
              <Text className="text-slate-800 text-xs font-bold">{m.name} ({m.relation || 'Member'})</Text>
            </View>
            <Text className="text-teal-600 text-[10px] font-bold">PID: {m.patient_id ? m.patient_id.slice(-6).toUpperCase() : 'PERSISTENT'}</Text>
          </View>
        ))}
      </View>

      <Text className="text-slate-400 text-[10px]">
        HH ID: {(item.id || item._id)?.slice(-6).toUpperCase()} • Contact: {item.contact_phone || 'N/A'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="p-4 pt-6 flex-1">
        <View className="flex-row justify-between items-center mb-6">
          <View>
            <Text className="text-slate-800 text-2xl font-bold">Households</Text>
            <Text className="text-slate-500 text-xs">Community Intake & Persistent Patient Registry</Text>
          </View>
          <TouchableOpacity 
            onPress={() => setShowHhModal(true)}
            className="bg-[#0d9488] px-4 py-2.5 rounded-2xl flex-row items-center gap-1.5 shadow-md shadow-teal-900/10"
          >
            <Plus size={18} color="white" />
            <Text className="text-white font-bold text-sm">Add Household</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#0d9488" />
          </View>
        ) : (
          <FlatList
            data={households}
            renderItem={renderHousehold}
            keyExtractor={item => item.id || item._id || Math.random().toString()}
            refreshing={loading}
            onRefresh={fetchHouseholds}
            ListEmptyComponent={
              <View className="items-center justify-center py-10">
                <Text className="text-slate-400">No households registered yet</Text>
              </View>
            }
          />
        )}
      </View>

      {/* Add Household Modal */}
      <Modal visible={showHhModal} animationType="slide" transparent>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-slate-800 text-lg font-bold">Register New Household</Text>
              <TouchableOpacity onPress={() => setShowHhModal(false)}><X size={20} color="#64748b" /></TouchableOpacity>
            </View>

            <TextInput
              placeholder="Family Name (e.g. Sharma Family)"
              value={familyName}
              onChangeText={setFamilyName}
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 text-slate-800"
            />
            <TextInput
              placeholder="Head of Family Name *"
              value={headName}
              onChangeText={setHeadName}
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 text-slate-800"
            />
            <TextInput
              placeholder="Contact Phone Number"
              value={contactPhone}
              onChangeText={setContactPhone}
              keyboardType="phone-pad"
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 text-slate-800"
            />
            <TextInput
              placeholder="Village Name"
              value={village}
              onChangeText={setVillage}
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-4 text-slate-800"
            />

            <TouchableOpacity 
              onPress={handleCreateHousehold}
              disabled={savingHh}
              className="bg-[#0d9488] p-4 rounded-xl items-center"
            >
              {savingHh ? <ActivityIndicator color="white" /> : <Text className="text-white font-bold text-base">Save Household</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Member Modal */}
      <Modal visible={showMemberModal} animationType="slide" transparent>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-slate-800 text-lg font-bold">Add Family Member</Text>
              <TouchableOpacity onPress={() => setShowMemberModal(false)}><X size={20} color="#64748b" /></TouchableOpacity>
            </View>

            <TextInput
              placeholder="Full Name *"
              value={memberName}
              onChangeText={setMemberName}
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 text-slate-800"
            />
            <TextInput
              placeholder="Age (years)"
              value={memberAge}
              onChangeText={setMemberAge}
              keyboardType="number-pad"
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 text-slate-800"
            />
            <TextInput
              placeholder="Relation to Head (e.g. Spouse, Son)"
              value={memberRelation}
              onChangeText={setMemberRelation}
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 text-slate-800"
            />
            <TextInput
              placeholder="Known Medical History (optional)"
              value={memberHistory}
              onChangeText={setMemberHistory}
              className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-4 text-slate-800"
            />

            <TouchableOpacity 
              onPress={handleAddMember}
              disabled={savingMember}
              className="bg-[#0d9488] p-4 rounded-xl items-center"
            >
              {savingMember ? <ActivityIndicator color="white" /> : <Text className="text-white font-bold text-base">Create Permanent Patient Record</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
