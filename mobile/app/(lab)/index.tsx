import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import { 
  FlaskConical, RefreshCcw, Upload, CheckCircle, 
  Clock, AlertTriangle, FileText, ChevronDown, ChevronUp, 
  User, Calendar, Sparkles, X, Zap
} from 'lucide-react-native';

import { getSafeErrorMessage } from '../../src/utils/errorTranslator';

const urgencyColor: any = {
  routine: 'bg-blue-100',
  urgent: 'bg-amber-100',
  emergency: 'bg-red-100',
};

const urgencyTextColor: any = {
  routine: 'text-blue-700',
  urgent: 'text-amber-700',
  emergency: 'text-red-700',
};

export default function LabDashboardScreen() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState('pending');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultText, setResultText] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<any>(null);

  const { data: pendingOrders = [], isLoading: pendingLoading, refetch: refetchPending } = useQuery({
    queryKey: ['labPendingOrders'],
    queryFn: () => api.get('/lab/pending-orders').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: completedOrders = [], isLoading: completedLoading } = useQuery({
    queryKey: ['labCompletedOrders'],
    queryFn: () => api.get('/lab/completed-orders').then(r => r.data),
    refetchInterval: 30000,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ labOrderId, resultText, notes, file }: any) => {
      const formData = new FormData();
      const finalResultText = resultText.trim() || (file ? 'PDF Lab Report Uploaded' : 'Lab Test Completed');
      formData.append('result_text', finalResultText);
      if (notes) formData.append('notes', notes);
      
      if (file) {
        formData.append('file', {
          uri: file.uri,
          type: file.mimeType || 'application/pdf',
          name: file.name || 'lab_report.pdf',
        } as any);
      }

      return api.post(`/lab/upload-result/${labOrderId}`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          'x-client-type': 'mobile'
        },
        timeout: 60000,
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      Alert.alert('Report Saved', data.message || 'Report uploaded successfully.');
      setUploadingId(null);
      setResultText('');
      setNotes('');
      setSelectedFile(null);
      setExpandedId(null);
      queryClient.invalidateQueries({ queryKey: ['labPendingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['labCompletedOrders'] });
    },
    onError: (err: any) => {
      Alert.alert('Upload Notice', getSafeErrorMessage(err));
      setUploadingId(null);
    },
  });

  const summarizeMutation = useMutation({
    mutationFn: async (labOrderId: string) => {
      setSummarizingId(labOrderId);
      return api.post(`/lab/orders/${labOrderId}/summarize`, {}, {
        headers: { 'x-client-type': 'mobile' }
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      Alert.alert('Report Processed', 'Report parameters extracted successfully.');
      setSummarizingId(null);
      queryClient.invalidateQueries({ queryKey: ['labCompletedOrders'] });
    },
    onError: (err: any) => {
      Alert.alert('Notice', getSafeErrorMessage(err));
      setSummarizingId(null);
    }
  });

  const handleUpload = (labOrderId: string) => {
    if (!resultText.trim() && !selectedFile) {
      Alert.alert('Action Required', 'Please enter a result value or select a PDF lab report to upload.');
      return;
    }
    setUploadingId(labOrderId);
    uploadMutation.mutate({ labOrderId, resultText, notes, file: selectedFile });
  };

  const handleFileSelect = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        if (file.name && !file.name.toLowerCase().endsWith('.pdf') && file.mimeType !== 'application/pdf') {
          Alert.alert('Invalid File', 'Only PDF files are supported for lab reports.');
          return;
        }
        if (file.size && file.size > 20 * 1024 * 1024) {
          Alert.alert('File Too Large', 'Lab report PDF must be smaller than 20MB.');
          return;
        }
        setSelectedFile(file);
      }
    } catch (err) {
      console.error('File pick error', err);
      Alert.alert('Error', 'Failed to select file.');
    }
  };

  const toggleExpand = (orderId: string) => {
    if (expandedId !== orderId) {
      setSelectedFile(null);
      setResultText('');
      setNotes('');
      setExpandedId(orderId);
    } else {
      setExpandedId(null);
    }
  };

  const urgentCount = pendingOrders.filter((o: any) => o.urgency === 'urgent' || o.urgency === 'emergency').length;

  return (
    <SafeAreaView className="flex-1 bg-[#F7F3EE]">
      {/* Header */}
      <View className="px-4 py-4 bg-white border-b border-gray-200 flex-row items-center justify-between shadow-sm">
        <View className="flex-row items-center">
          <View className="bg-teal-600 p-2.5 rounded-xl mr-3">
            <FlaskConical size={20} color="white" />
          </View>
          <View>
            <Text className="text-lg font-bold text-gray-800">Lab Technician Portal</Text>
            <Text className="text-xs text-teal-600 font-semibold">{user?.name} · {user?.hospital || 'General Hospital'}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => { refetchPending(); queryClient.invalidateQueries({ queryKey: ['labCompletedOrders'] }); }}
          className="p-2 bg-gray-100 rounded-xl active:bg-gray-200"
        >
          <RefreshCcw size={18} color="#6b7280" />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
        {/* Stats */}
        <View className="flex-row justify-between mb-5">
          <View className="bg-white rounded-2xl border border-gray-100 p-3.5 shadow-sm flex-1 mr-1.5">
            <View className="flex-row items-center mb-1.5">
              <View className="bg-amber-100 p-1.5 rounded-lg mr-1.5"><Clock size={14} color="#d97706" /></View>
              <Text className="text-[10px] font-bold text-gray-500 uppercase">Pending</Text>
            </View>
            <Text className="text-2xl font-bold text-gray-800">{pendingOrders.length}</Text>
          </View>
          
          <View className="bg-white rounded-2xl border border-gray-100 p-3.5 shadow-sm flex-1 mx-1.5">
            <View className="flex-row items-center mb-1.5">
              <View className="bg-red-100 p-1.5 rounded-lg mr-1.5"><AlertTriangle size={14} color="#dc2626" /></View>
              <Text className="text-[10px] font-bold text-gray-500 uppercase">Urgent</Text>
            </View>
            <Text className="text-2xl font-bold text-gray-800">{urgentCount}</Text>
          </View>
          
          <View className="bg-white rounded-2xl border border-gray-100 p-3.5 shadow-sm flex-1 ml-1.5">
            <View className="flex-row items-center mb-1.5">
              <View className="bg-green-100 p-1.5 rounded-lg mr-1.5"><CheckCircle size={14} color="#16a34a" /></View>
              <Text className="text-[10px] font-bold text-gray-500 uppercase">Done</Text>
            </View>
            <Text className="text-2xl font-bold text-gray-800">{completedOrders.length}</Text>
          </View>
        </View>

        {/* Tabs */}
        <View className="flex-row border-b border-gray-200 mb-4 bg-white rounded-2xl p-1 shadow-sm border">
          <TouchableOpacity
            onPress={() => setActiveTab('pending')}
            className={`flex-1 py-2.5 items-center rounded-xl ${activeTab === 'pending' ? 'bg-teal-600' : 'bg-transparent'}`}
          >
            <Text className={`font-bold text-xs ${activeTab === 'pending' ? 'text-white' : 'text-gray-600'}`}>
              Pending Orders ({pendingOrders.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('completed')}
            className={`flex-1 py-2.5 items-center rounded-xl ${activeTab === 'completed' ? 'bg-teal-600' : 'bg-transparent'}`}
          >
            <Text className={`font-bold text-xs ${activeTab === 'completed' ? 'text-white' : 'text-gray-600'}`}>
              Completed Results ({completedOrders.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Pending Orders List */}
        {activeTab === 'pending' && (
          <View className="mb-10">
            {pendingLoading ? (
              <View className="py-10 items-center justify-center">
                <ActivityIndicator size="large" color="#0d9488" />
              </View>
            ) : pendingOrders.length === 0 ? (
              <View className="bg-white rounded-2xl border border-gray-100 p-8 items-center">
                <CheckCircle size={48} color="#86efac" className="mb-3" />
                <Text className="font-bold text-gray-700 text-base">All clear — no pending orders</Text>
                <Text className="text-gray-400 text-xs mt-1 text-center">New lab orders requested by doctors will appear here automatically</Text>
              </View>
            ) : (
              pendingOrders.map((order: any) => {
                const orderId = String(order._id || order.id);
                const isExpanded = expandedId === orderId;
                const isUploading = uploadingId === orderId && uploadMutation.isPending;
                
                return (
                  <View key={orderId} className={`bg-white rounded-2xl border shadow-sm mb-3.5 overflow-hidden ${
                    order.urgency === 'emergency' ? 'border-red-300' :
                    order.urgency === 'urgent' ? 'border-amber-300' : 'border-gray-200'
                  }`}>
                    {/* Header - Tap to Expand/Collapse */}
                    <TouchableOpacity
                      onPress={() => toggleExpand(orderId)}
                      className="p-4 active:bg-slate-50"
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center flex-1 mr-2">
                          <View className="bg-teal-100 p-3 rounded-2xl mr-3">
                            <FlaskConical size={20} color="#0d9488" />
                          </View>
                          <View className="flex-1">
                            <View className="flex-row flex-wrap items-center gap-1.5 mb-1">
                              <Text className="font-bold text-slate-800 text-base">{order.test_name || order.test_type || order.name || 'General Lab Test'}</Text>
                              <View className={`px-2.5 py-0.5 rounded-full ${urgencyColor[order.urgency] || urgencyColor.routine}`}>
                                <Text className={`text-[9px] font-bold uppercase ${urgencyTextColor[order.urgency] || urgencyTextColor.routine}`}>
                                  {order.urgency}
                                </Text>
                              </View>
                            </View>
                            
                            <View className="flex-row items-center flex-wrap">
                              <Text className="text-xs text-slate-600 font-semibold mr-2">👤 {order.patient_name || 'Patient'}</Text>
                              <Text className="text-xs text-slate-400">Ordered by {order.ordered_by}</Text>
                            </View>
                          </View>
                        </View>
                        
                        <View className="items-end">
                          <View className="bg-amber-100 px-2.5 py-1 rounded-full mb-1">
                            <Text className="text-amber-700 text-[10px] font-bold">Pending</Text>
                          </View>
                          {isExpanded ? <ChevronUp size={18} color="#0d9488" /> : <ChevronDown size={18} color="#9ca3af" />}
                        </View>
                      </View>
                    </TouchableOpacity>

                    {/* Expanded Drawer: PDF Upload & Manual Entry Form */}
                    {isExpanded && (
                      <View className="border-t border-gray-100 p-4 bg-slate-50">
                        <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                          📤 Upload Report & Process Result
                        </Text>

                        {/* 1. PDF File Selector Button */}
                        <Text className="text-xs font-semibold text-slate-700 mb-1">Lab Report PDF (Optional)</Text>
                        <TouchableOpacity
                          onPress={handleFileSelect}
                          className={`border-2 border-dashed rounded-2xl p-4 items-center mb-3.5 ${
                            selectedFile ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white'
                          }`}
                        >
                          {selectedFile ? (
                            <View className="flex-row items-center justify-between w-full">
                              <View className="flex-row items-center flex-1 mr-2">
                                <FileText size={18} color="#0d9488" className="mr-2" />
                                <Text className="text-xs font-bold text-teal-800 flex-1" numberOfLines={1}>
                                  {selectedFile.name}
                                </Text>
                              </View>
                              <TouchableOpacity onPress={() => setSelectedFile(null)} className="p-1">
                                <X size={16} color="#ef4444" />
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <View className="items-center">
                              <Upload size={22} color="#0d9488" className="mb-1" />
                              <Text className="text-xs font-bold text-teal-700">Tap to Select PDF Report</Text>
                              <Text className="text-[10px] text-slate-400 mt-0.5">Automatic text extraction & AI OCR summary</Text>
                            </View>
                          )}
                        </TouchableOpacity>

                        {/* 2. Manual Result Input */}
                        <Text className="text-xs font-semibold text-slate-700 mb-1">Result Value / Key Parameter</Text>
                        <TextInput
                          value={resultText}
                          onChangeText={setResultText}
                          placeholder={selectedFile ? "Optional (auto-extracted from PDF if blank)" : "e.g. HbA1c: 7.2% — high"}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 mb-3"
                        />

                        <Text className="text-xs font-semibold text-slate-700 mb-1">Technician Notes (optional)</Text>
                        <TextInput
                          value={notes}
                          onChangeText={setNotes}
                          placeholder="Special clinical observations..."
                          multiline
                          numberOfLines={2}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 mb-3"
                          textAlignVertical="top"
                        />

                        {/* Actions */}
                        <View className="flex-row space-x-2">
                          <TouchableOpacity
                            onPress={() => { setExpandedId(null); setResultText(''); setNotes(''); setSelectedFile(null); }}
                            className="flex-1 py-2.5 border border-slate-200 rounded-xl items-center bg-white mr-1.5"
                          >
                            <Text className="text-xs font-bold text-slate-600">Cancel</Text>
                          </TouchableOpacity>
                          
                          <TouchableOpacity
                            onPress={() => handleUpload(orderId)}
                            disabled={isUploading || (!resultText.trim() && !selectedFile)}
                            className={`flex-1 py-2.5 rounded-xl items-center flex-row justify-center ml-1.5 ${
                              isUploading || (!resultText.trim() && !selectedFile) ? 'bg-teal-300' : 'bg-teal-600'
                            }`}
                          >
                            {isUploading ? (
                              <>
                                <ActivityIndicator size="small" color="white" className="mr-1.5" />
                                <Text className="text-white font-bold text-xs">Uploading & OCR...</Text>
                              </>
                            ) : (
                              <>
                                <Zap size={14} color="white" className="mr-1.5" />
                                <Text className="text-white font-bold text-xs">Submit & AI Extract</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>

                        {isUploading && (
                          <Text className="text-[11px] text-teal-700 text-center mt-2.5 font-semibold">
                            ✨ Extracting report parameters & generating AI OCR summary...
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Completed Results List */}
        {activeTab === 'completed' && (
          <View className="mb-10">
            {completedLoading ? (
              <View className="py-10 items-center justify-center">
                <ActivityIndicator size="large" color="#0d9488" />
              </View>
            ) : completedOrders.length === 0 ? (
              <View className="bg-white rounded-2xl border border-gray-100 p-10 items-center">
                <FlaskConical size={44} color="#d1d5db" className="mb-3" />
                <Text className="text-slate-400 text-xs font-medium">No completed results yet</Text>
              </View>
            ) : (
              completedOrders.map((order: any) => {
                const orderId = String(order._id || order.id);
                const isSummarizing = summarizingId === orderId && summarizeMutation.isPending;

                return (
                  <View key={orderId} className={`bg-white rounded-2xl border shadow-sm p-4 mb-4 ${
                    order.ai_is_abnormal ? 'border-red-200' : 'border-green-200'
                  }`}>
                    {/* Header */}
                    <View className="flex-row items-start justify-between mb-2">
                      <View className="flex-row items-start flex-1 mr-2">
                        <View className={`p-2.5 rounded-xl mr-3 ${order.ai_is_abnormal ? 'bg-red-100' : 'bg-green-100'}`}>
                          <FlaskConical size={18} color={order.ai_is_abnormal ? '#dc2626' : '#16a34a'} />
                        </View>
                        <View className="flex-1">
                          <View className="flex-row flex-wrap items-center gap-1.5 mb-1">
                            <Text className="font-bold text-slate-800 text-base">{order.test_name || order.test_type || order.name || 'General Lab Test'}</Text>
                            {order.ai_is_abnormal && (
                              <View className="bg-red-100 flex-row items-center px-2 py-0.5 rounded-full">
                                <AlertTriangle size={10} color="#dc2626" className="mr-1" />
                                <Text className="text-red-700 text-[9px] font-bold uppercase">Abnormal Values</Text>
                              </View>
                            )}
                          </View>
                          <Text className="text-xs text-slate-600 font-semibold">👤 {order.patient_name || 'Patient'}</Text>
                        </View>
                      </View>
                      
                      <View className="bg-green-100 px-2.5 py-1 rounded-full">
                        <Text className="text-green-700 text-[10px] font-bold">Resulted</Text>
                      </View>
                    </View>

                    {/* Result Text */}
                    <View className="bg-slate-50 rounded-xl p-3 mb-3 border border-slate-100">
                      <Text className="text-xs text-slate-500 font-semibold mb-0.5">Result Summary</Text>
                      <Text className="text-sm font-bold text-slate-800">{order.result || 'PDF Report Uploaded'}</Text>
                    </View>

                    {/* AI Re-summarize Trigger Button */}
                    <View className="flex-row items-center justify-end mb-3">
                      <TouchableOpacity
                        onPress={() => summarizeMutation.mutate(orderId)}
                        disabled={isSummarizing}
                        className="flex-row items-center bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-xl"
                      >
                        {isSummarizing ? (
                          <ActivityIndicator size="small" color="#4f46e5" className="mr-1" />
                        ) : (
                          <Sparkles size={13} color="#4f46e5" className="mr-1.5" />
                        )}
                        <Text className="text-indigo-700 text-xs font-bold">
                          {isSummarizing ? 'Summarizing...' : 'AI OCR Summarize'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* AI OCR Summary Card */}
                    {order.ai_summary ? (
                      <View className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 mb-2">
                        <View className="flex-row items-center mb-2 pb-2 border-b border-slate-800">
                          <Sparkles size={14} color="#14b8a6" className="mr-1.5" />
                          <Text className="text-teal-400 text-[10px] font-bold uppercase tracking-wider">AI OCR Report Extraction</Text>
                        </View>
                        <Text className="text-xs text-slate-200 leading-relaxed mb-2">{order.ai_summary}</Text>

                        {/* Extracted Parameters */}
                        {order.ai_key_values?.length > 0 && (
                          <View className="mt-2 pt-2 border-t border-slate-800">
                            <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Extracted Parameters</Text>
                            {order.ai_key_values.map((kv: any, i: number) => (
                              <View key={i} className="flex-row items-center justify-between py-1 border-b border-slate-800/50">
                                <Text className="text-xs text-slate-300 font-medium">{kv.parameter}</Text>
                                <View className="flex-row items-center">
                                  <Text className="text-xs font-bold text-white mr-2">{kv.value}</Text>
                                  <View className={`px-2 py-0.5 rounded-full ${
                                    kv.status === 'normal' ? 'bg-emerald-500/20' : 'bg-red-500/20'
                                  }`}>
                                    <Text className={`text-[9px] font-bold uppercase ${
                                      kv.status === 'normal' ? 'text-emerald-400' : 'text-red-400'
                                    }`}>{kv.status || 'Normal'}</Text>
                                  </View>
                                </View>
                              </View>
                            ))}
                          </View>
                        )}

                        {order.ai_recommendation && (
                          <Text className="text-xs text-teal-300 font-semibold mt-2.5">
                            💡 Recommendation: {order.ai_recommendation}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => summarizeMutation.mutate(orderId)}
                        className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 items-center flex-row justify-center"
                      >
                        <Sparkles size={14} color="#6366f1" className="mr-2" />
                        <Text className="text-indigo-600 font-semibold text-xs">Tap to run AI OCR Extraction on this report</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
