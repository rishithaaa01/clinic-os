import React, { useState, useEffect, useRef } from 'react';
import { 
  SafeAreaView,
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  KeyboardAvoidingView, 
  Platform, 
  Alert, 
  ScrollView 
} from 'react-native';

import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { useRouter } from 'expo-router';
import { 
  Mail, 
  Lock, 
  User as UserIcon, 
  Phone, 
  Key, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  Building2, 
  MapPin, 
  Stethoscope, 
  ArrowLeft 
} from 'lucide-react-native';

const SPECIALITIES = [
  'General Medicine', 'Gynaecology', 'Obstetrics', 'Paediatrics',
  'Orthopaedics', 'Cardiology', 'Gastroenterology', 'Dermatology',
  'Ophthalmology', 'ENT', 'Neurology', 'Psychiatry', 'Oncology'
];

const FALLBACK_HOSPITALS = [
  { id: 'h-gghc', name: 'Govt General Hospital Chennai', type: 'govt', district: 'Chennai', state: 'Tamil Nadu' },
  { id: 'h-phcv', name: 'PHC Velachery', type: 'govt', district: 'Chennai', state: 'Tamil Nadu' },
  { id: 'h-kdh', name: 'Kanchipuram District Hospital', type: 'govt', district: 'Kanchipuram', state: 'Tamil Nadu' },
  { id: 'h-apollo', name: 'Apollo Hospital', type: 'private', district: 'Chennai', state: 'Tamil Nadu' },
  { id: 'h-kauvery', name: 'Kauvery Hospital', type: 'private', district: 'Chennai', state: 'Tamil Nadu' }
];

const FALLBACK_VILLAGES = [
  { id: 'v1', name: 'Velachery' },
  { id: 'v2', name: 'Kanchipuram North' },
  { id: 'v3', name: 'Pondicherry East' },
  { id: 'v4', name: 'Kolathur' },
  { id: 'v5', name: 'Madhavaram' }
];

const ROLES = [
  { id: 'patient', label: 'Patient' },
  { id: 'asha', label: 'ASHA Worker' },
  { id: 'doctor', label: 'Doctor' },
  { id: 'lab', label: 'Lab Tech' },
  { id: 'admin', label: 'Admin' },
];

export default function LoginScreen() {
  const router = useRouter();
  const loginState = useAuthStore((state) => state.login);
  
  // Onboarding UI State Control
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [loginMethod, setLoginMethod] = useState<'password' | 'email-otp'>('password');
  const [step, setStep] = useState(1); // 1: main, 2: OTP, 3: Forgot Password, 4: Reset Password
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Password Credentials State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Passwordless / OTP State
  const [phone, setPhone] = useState('');
  const [emailOTP, setEmailOTP] = useState('');
  const [otpArray, setOtpArray] = useState(['', '', '', '', '', '']);
  const otpInputs = useRef<Array<TextInput | null>>([]);
  
  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regRole, setRegRole] = useState('patient');
  const [regHospital, setRegHospital] = useState('');
  const [regVillage, setRegVillage] = useState('');
  const [regSpeciality, setRegSpeciality] = useState('');
  const [regMedRegNum, setRegMedRegNum] = useState('');
  const [regMedCouncil, setRegMedCouncil] = useState('Tamil Nadu Medical Council');
  const [regQualification, setRegQualification] = useState('MBBS');

  // Forgot / Reset Password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Metadata with instant fallback so options are never blank
  const [hospitals, setHospitals] = useState<any[]>(FALLBACK_HOSPITALS);
  const [villages, setVillages] = useState<any[]>(FALLBACK_VILLAGES);

  useEffect(() => {
    fetchMetadata();
  }, []);

  const fetchMetadata = async () => {
    try {
      const [hospRes, villRes] = await Promise.allSettled([
        api.get('/auth/hospitals'),
        api.get('/auth/villages')
      ]);
      if (hospRes.status === 'fulfilled' && Array.isArray(hospRes.value?.data) && hospRes.value.data.length > 0) {
        setHospitals(hospRes.value.data);
      }
      if (villRes.status === 'fulfilled' && Array.isArray(villRes.value?.data) && villRes.value.data.length > 0) {
        setVillages(villRes.value.data);
      }
    } catch (e) {
      console.log("Failed to load metadata, using fallback list");
    }
  };

  const formatErrorMessage = (err: any, fallback: string) => {
    if (!err) return fallback;
    const detail = err.response?.data?.detail || err.message;
    if (!detail || typeof detail !== 'string') {
      return "We couldn't connect right now. Please check your connection and try again.";
    }
    if (detail.includes('Network Error') || detail.includes('ECONNREFUSED') || detail.includes('timeout')) {
      return "We couldn't connect right now. Please check your connection and try again.";
    }
    if (detail.includes('Invalid credentials') || detail.includes('Invalid email or password')) {
      return "Email or password is incorrect. Please try again.";
    }
    return detail;
  };

  const handleSuccessfulLogin = (user: any, token: string, refreshToken: string) => {
    setErrorMessage('');
    loginState(user, token, refreshToken);
  };

  const handleCredentialsLogin = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email: cleanEmail, password });
      handleSuccessfulLogin(res.data.user, res.data.access_token, res.data.refresh_token);
    } catch (err: any) {
      setErrorMessage(formatErrorMessage(err, 'Email or password is incorrect. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setErrorMessage('');
    if (!regName.trim() || !regEmail.trim() || !regPassword || !regPhone.trim()) {
      setErrorMessage('Please fill in all required registration fields.');
      return;
    }
    if (regRole === 'doctor') {
      if (!regHospital) {
        setErrorMessage('Please select your affiliated hospital.');
        return;
      }
      if (!regSpeciality) {
        setErrorMessage('Please select your medical specialty.');
        return;
      }
      if (!regMedRegNum.trim()) {
        setErrorMessage('Please enter your Medical Registration Number.');
        return;
      }
    }
    if (regRole === 'lab' && !regHospital) {
      setErrorMessage('Please select your hospital.');
      return;
    }
    if (regRole === 'asha' && !regVillage) {
      setErrorMessage('Please select your assigned village.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email: regEmail.trim(),
        password: regPassword,
        name: regName.trim(),
        mobile: regPhone.trim(),
        role: regRole,
        language: 'en',
        district: 'Chennai',
        hospital: (regRole === 'doctor' || regRole === 'lab') ? regHospital : null,
        village: regRole === 'asha' ? regVillage : null,
        speciality: regRole === 'doctor' ? regSpeciality : null,
        medical_registration_number: regRole === 'doctor' ? regMedRegNum.trim() : null,
        medical_council: regRole === 'doctor' ? regMedCouncil : null,
        qualification: regRole === 'doctor' ? regQualification : null
      };
      const res = await api.post('/auth/register', payload);
      handleSuccessfulLogin(res.data.user, res.data.access_token, res.data.refresh_token);
    } catch (err: any) {
      setErrorMessage(formatErrorMessage(err, 'Registration could not be completed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const triggerSendOTP = async (identifier: string, isEmail = false) => {
    setErrorMessage('');
    setLoading(true);
    try {
      const payload = isEmail ? { email: identifier } : { mobile: identifier };
      const res = await api.post('/auth/send-otp', payload);
      Alert.alert('Verification Code Sent', res.data.message || 'Check your inbox for your 6-digit code.');
      setStep(2);
    } catch (err: any) {
      setErrorMessage(formatErrorMessage(err, 'Failed to send verification code. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSendOTP = async () => {
    if (loginMethod === 'email-otp') {
      if (!emailOTP.trim()) {
        setErrorMessage('Please enter a valid email address.');
        return;
      }
      await triggerSendOTP(emailOTP.trim(), true);
    } else {
      if (!phone.trim()) {
        setErrorMessage('Please enter a valid mobile number.');
        return;
      }
      const formattedPhone = phone.startsWith('+') ? phone : `+91${phone.trim()}`;
      await triggerSendOTP(formattedPhone, false);
    }
  };

  const handleVerifyOTP = async () => {
    setErrorMessage('');
    const otpString = otpArray.join('');
    if (otpString.length < 6) {
      setErrorMessage('Please enter the complete 6-digit code.');
      return;
    }
    setLoading(true);
    try {
      let payload;
      if (loginMethod === 'email-otp') {
        payload = { email: emailOTP.trim(), otp: otpString, language: 'en' };
      } else {
        const formattedPhone = phone.startsWith('+') ? phone : `+91${phone.trim()}`;
        payload = { mobile: formattedPhone, otp: otpString, language: 'en' };
      }
      
      const res = await api.post('/auth/verify-otp', payload);
      api.defaults.headers.common['Authorization'] = `Bearer ${res.data.access_token}`;

      if (res.data.needs_registration) {
        setErrorMessage('Phone verification successful. Complete your profile on the web application.');
      } else {
        handleSuccessfulLogin(res.data.user, res.data.access_token, res.data.refresh_token);
      }
    } catch (err: any) {
      setErrorMessage(formatErrorMessage(err, 'Invalid verification code. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMessage('');
    if (!forgotEmail.trim()) {
      setErrorMessage('Please enter your account email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/forgot-password', { email: forgotEmail.trim() });
      let message = res.data.message || 'Password reset code sent!';
      if (res.data.reset_code) message += ` Code: ${res.data.reset_code}`;
      Alert.alert('Reset Code Sent', message);
      setStep(4);
    } catch (err: any) {
      setErrorMessage(formatErrorMessage(err, 'Unable to send reset request. Please check your email and try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setErrorMessage('');
    if (!resetCode.trim() || !newPassword) {
      setErrorMessage('Please provide both reset code and new password.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/reset-password', {
        email: forgotEmail.trim(),
        code: resetCode.trim(),
        new_password: newPassword
      });
      Alert.alert('Password Updated', res.data.message || 'Your password has been reset successfully.');
      setEmail(forgotEmail);
      setStep(1);
      setActiveTab('login');
      setLoginMethod('password');
    } catch (err: any) {
      setErrorMessage(formatErrorMessage(err, 'Failed to reset password. Please verify your code and try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    const newOtp = [...otpArray];
    newOtp[index] = value;
    setOtpArray(newOtp);
    if (value && index < 5) {
      otpInputs.current[index + 1]?.focus();
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} className="flex-1 bg-white">
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        className="flex-1"
      >
        <ScrollView 
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20 }}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {/* Top Branding Section */}
          <View className="items-center mt-2 mb-7">
            <View className="w-14 h-14 bg-[#1B6CA8] rounded-2xl items-center justify-center mb-3 shadow-md">
              <ShieldCheck size={28} color="#FFFFFF" strokeWidth={2.2} />
            </View>
            <Text className="text-2xl font-extrabold text-slate-900 tracking-tight">Ayu Disha</Text>
            <Text className="text-slate-500 text-xs mt-1 font-medium">Digital Healthcare & Clinical Portal</Text>
          </View>

          {/* Inline Error Banner */}
          {!!errorMessage && (
            <View className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl flex-row items-center">
              <Text className="text-red-700 text-xs font-semibold flex-1 leading-5">
                {errorMessage}
              </Text>
            </View>
          )}

          {/* Step 1: Sign In / Register Main Form */}
          {step === 1 && (
            <View className="w-full">
              {/* Segmented Control Switch: Sign In vs Register */}
              <View className="flex-row bg-slate-100 p-1.5 rounded-2xl mb-6 border border-slate-200">
                <TouchableOpacity 
                  className={`flex-1 py-3 items-center rounded-xl min-h-[44px] justify-center ${activeTab === 'login' ? 'bg-white shadow-xs' : ''}`}
                  onPress={() => {
                    setActiveTab('login');
                    setErrorMessage('');
                  }}
                  activeOpacity={0.7}
                >
                  <Text className={`text-xs font-bold ${activeTab === 'login' ? 'text-[#1B6CA8]' : 'text-slate-500'}`}>
                    Sign In
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  className={`flex-1 py-3 items-center rounded-xl min-h-[44px] justify-center ${activeTab === 'register' ? 'bg-white shadow-xs' : ''}`}
                  onPress={() => {
                    setActiveTab('register');
                    setErrorMessage('');
                  }}
                  activeOpacity={0.7}
                >
                  <Text className={`text-xs font-bold ${activeTab === 'register' ? 'text-[#1B6CA8]' : 'text-slate-500'}`}>
                    Create Account
                  </Text>
                </TouchableOpacity>
              </View>

              {activeTab === 'login' ? (
                <View className="space-y-4">
                  {/* Method Toggle: Password vs Email OTP */}
                  <View className="flex-row gap-2 mb-1">
                    <TouchableOpacity 
                      onPress={() => {
                        setLoginMethod('password');
                        setErrorMessage('');
                      }}
                      className={`px-3 py-1.5 rounded-full border ${loginMethod === 'password' ? 'bg-blue-50 border-[#1B6CA8]' : 'bg-slate-50 border-slate-200'}`}
                    >
                      <Text className={`text-xs font-semibold ${loginMethod === 'password' ? 'text-[#1B6CA8] font-bold' : 'text-slate-600'}`}>
                        Password Sign In
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      onPress={() => {
                        setLoginMethod('email-otp');
                        setErrorMessage('');
                      }}
                      className={`px-3 py-1.5 rounded-full border ${loginMethod === 'email-otp' ? 'bg-blue-50 border-[#1B6CA8]' : 'bg-slate-50 border-slate-200'}`}
                    >
                      <Text className={`text-xs font-semibold ${loginMethod === 'email-otp' ? 'text-[#1B6CA8] font-bold' : 'text-slate-600'}`}>
                        Email OTP Code
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {loginMethod === 'password' ? (
                    <>
                      {/* Email Field */}
                      <View className="space-y-1.5 mt-2">
                        <Text className="text-slate-700 text-xs font-bold uppercase tracking-wider">Email Address</Text>
                        <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12 ">
                          <Mail color="#64748B" size={18} />
                          <TextInput
                            className="flex-1 ml-2.5 text-slate-800 text-sm font-medium"
                            style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                            placeholder="name@example.com"
                            placeholderTextColor="#94A3B8"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                          />
                        </View>
                      </View>

                      {/* Password Field with Show/Hide Toggle */}
                      <View className="space-y-1.5 mt-3">
                        <Text className="text-slate-700 text-xs font-bold uppercase tracking-wider">Password</Text>
                        <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                          <Lock color="#64748B" size={18} />
                          <TextInput
                            className="flex-1 ml-2.5 text-slate-800 text-sm"
                            style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                            placeholder="Enter password"
                            placeholderTextColor="#94A3B8"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry={!showPassword}
                            autoCapitalize="none"
                            autoCorrect={false}
                            textContentType="password"
                            autoComplete="current-password"
                          />
                          <TouchableOpacity 
                            onPress={() => setShowPassword(!showPassword)}
                            className="p-2 justify-center items-center"
                            activeOpacity={0.7}
                          >
                            {showPassword ? (
                              <EyeOff color="#64748B" size={18} />
                            ) : (
                              <Eye color="#64748B" size={18} />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Forgot Password Link */}
                      <TouchableOpacity 
                        onPress={() => {
                          setStep(3);
                          setErrorMessage('');
                        }} 
                        className="self-end mt-1 mb-2"
                      >
                        <Text className="text-xs text-[#1B6CA8] font-semibold">Forgot Password?</Text>
                      </TouchableOpacity>

                      {/* Primary Sign In Button */}
                      <TouchableOpacity 
                        className={`bg-[#1B6CA8] h-12 rounded-xl items-center justify-center mt-2 shadow-xs ${loading ? 'opacity-70' : 'active:bg-[#155A8A]'}`}
                        onPress={handleCredentialsLogin}
                        disabled={loading}
                        activeOpacity={0.8}
                      >
                        {loading ? (
                          <View className="flex-row items-center gap-2">
                            <ActivityIndicator color="white" size="small" />
                            <Text className="text-white font-bold text-sm">Signing in...</Text>
                          </View>
                        ) : (
                          <Text className="text-white font-bold text-sm">Sign In</Text>
                        )}
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      {/* Email OTP Field */}
                      <View className="space-y-1 mt-2">
                        <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Email Address</Text>
                        <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                          <Mail color="#64748B" size={18} />
                          <TextInput
                            className="flex-1 ml-2.5 text-slate-800 text-sm"
                            style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                            placeholder="name@example.com"
                            placeholderTextColor="#94A3B8"
                            value={emailOTP}
                            onChangeText={setEmailOTP}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                          />
                        </View>
                      </View>

                      <TouchableOpacity 
                        className={`bg-[#1B6CA8] h-12 rounded-xl items-center justify-center mt-4 ${loading ? 'opacity-70' : 'active:bg-[#155A8A]'}`}
                        onPress={handleSendOTP}
                        disabled={loading}
                        activeOpacity={0.8}
                      >
                        {loading ? (
                          <View className="flex-row items-center gap-2">
                            <ActivityIndicator color="white" size="small" />
                            <Text className="text-white font-bold text-sm">Sending code...</Text>
                          </View>
                        ) : (
                          <Text className="text-white font-bold text-sm">Send OTP Code</Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : (
                /* Registration View */
                <View className="space-y-3.5">
                  <View className="space-y-1">
                    <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Full Name</Text>
                    <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                      <UserIcon color="#64748B" size={18} />
                      <TextInput
                      style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                        className="flex-1 ml-2.5 text-slate-800 text-sm"
                        placeholder="Dr. Rajesh Kumar"
                        placeholderTextColor="#94A3B8"
                        value={regName}
                        onChangeText={setRegName}
                      />
                    </View>
                  </View>

                  <View className="space-y-1">
                    <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Email Address</Text>
                    <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                      <Mail color="#64748B" size={18} />
                      <TextInput
                      style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                        className="flex-1 ml-2.5 text-slate-800 text-sm"
                        placeholder="name@example.com"
                        placeholderTextColor="#94A3B8"
                        value={regEmail}
                        onChangeText={setRegEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                      />
                    </View>
                  </View>

                  <View className="space-y-1">
                    <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Password</Text>
                    <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                      <Lock color="#64748B" size={18} />
                      <TextInput
                        className="flex-1 ml-2.5 text-slate-800 text-sm"
                        style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                        placeholder="Create password"
                        placeholderTextColor="#94A3B8"
                        value={regPassword}
                        onChangeText={setRegPassword}
                        secureTextEntry={!showRegPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="newPassword"
                        autoComplete="new-password"
                      />
                      <TouchableOpacity 
                        onPress={() => setShowRegPassword(!showRegPassword)}
                        className="p-2 justify-center items-center"
                        activeOpacity={0.7}
                      >
                        {showRegPassword ? <EyeOff color="#64748B" size={18} /> : <Eye color="#64748B" size={18} />}
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View className="space-y-1">
                    <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Mobile Number</Text>
                    <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                      <Text className="text-slate-500 font-semibold mr-1.5">+91</Text>
                      <TextInput
                      style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                        className="flex-1 text-slate-800 text-sm"
                        placeholder="9876543210"
                        placeholderTextColor="#94A3B8"
                        value={regPhone}
                        onChangeText={setRegPhone}
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>

                  {/* Role Selector */}
                  <View className="mt-1">
                    <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider mb-2">Select Healthcare Role</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {ROLES.map((r) => (
                        <TouchableOpacity
                          key={r.id}
                          onPress={() => setRegRole(r.id)}
                          className={`px-3.5 py-2 rounded-xl border ${regRole === r.id ? 'bg-blue-50 border-[#1B6CA8]' : 'bg-white border-slate-200'}`}
                          activeOpacity={0.7}
                        >
                          <Text className={`text-xs ${regRole === r.id ? 'text-[#1B6CA8] font-bold' : 'text-slate-600 font-medium'}`}>
                            {r.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Doctor / Lab Hospital Selector */}
                  {(regRole === 'doctor' || regRole === 'lab') && (
                    <View className="mt-2 space-y-1">
                      <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider mb-1.5">Select Affiliated Hospital</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                        {hospitals.map((h, i) => (
                          <TouchableOpacity 
                            key={i} 
                            onPress={() => setRegHospital(h.name)} 
                            className={`mr-2 px-3.5 py-2 rounded-xl border ${regHospital === h.name ? 'bg-blue-50 border-[#1B6CA8]' : 'bg-white border-slate-200'}`}
                          >
                            <Text className={`text-xs ${regHospital === h.name ? 'text-[#1B6CA8] font-bold' : 'text-slate-600'}`}>{h.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* ASHA Village Selector */}
                  {regRole === 'asha' && (
                    <View className="mt-2 space-y-1">
                      <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider mb-1.5">Select Assigned Village</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                        {(villages.length > 0 ? villages : [{ name: 'Velachery' }, { name: 'Kanchipuram North' }, { name: 'Pondicherry East' }]).map((v, i) => (
                          <TouchableOpacity 
                            key={i} 
                            onPress={() => setRegVillage(v.name)} 
                            className={`mr-2 px-3.5 py-2 rounded-xl border ${regVillage === v.name ? 'bg-blue-50 border-[#1B6CA8]' : 'bg-white border-slate-200'}`}
                          >
                            <Text className={`text-xs ${regVillage === v.name ? 'text-[#1B6CA8] font-bold' : 'text-slate-600'}`}>{v.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Doctor Medical License Number */}
                  {regRole === 'doctor' && (
                    <>
                      <View className="mt-2 space-y-1">
                        <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider mb-1.5">Medical Specialty</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                          {SPECIALITIES.map((s, i) => (
                            <TouchableOpacity 
                              key={i} 
                              onPress={() => setRegSpeciality(s)} 
                              className={`mr-2 px-3.5 py-2 rounded-xl border ${regSpeciality === s ? 'bg-blue-50 border-[#1B6CA8]' : 'bg-white border-slate-200'}`}
                            >
                              <Text className={`text-xs ${regSpeciality === s ? 'text-[#1B6CA8] font-bold' : 'text-slate-600'}`}>{s}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>

                      <View className="space-y-1 mt-2">
                        <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Medical Registration Number</Text>
                        <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                          <Stethoscope color="#64748B" size={18} />
                          <TextInput
                          style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                            className="flex-1 ml-2.5 text-slate-800 text-sm"
                            placeholder="e.g. TNMC-84920"
                            placeholderTextColor="#94A3B8"
                            value={regMedRegNum}
                            onChangeText={setRegMedRegNum}
                          />
                        </View>
                      </View>
                    </>
                  )}

                  <TouchableOpacity 
                    className={`bg-[#1B6CA8] h-12 rounded-xl items-center justify-center mt-4 ${loading ? 'opacity-70' : 'active:bg-[#155A8A]'}`}
                    onPress={handleRegister}
                    disabled={loading}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <View className="flex-row items-center gap-2">
                        <ActivityIndicator color="white" size="small" />
                        <Text className="text-white font-bold text-sm">Registering account...</Text>
                      </View>
                    ) : (
                      <Text className="text-white font-bold text-sm">Create Account</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Step 2: OTP Entry Step */}
          {step === 2 && (
            <View className="w-full space-y-5">
              <TouchableOpacity 
                onPress={() => setStep(1)} 
                className="flex-row items-center gap-1.5 mb-2 self-start"
              >
                <ArrowLeft size={18} color="#1B6CA8" />
                <Text className="text-xs text-[#1B6CA8] font-bold">Back to Sign In</Text>
              </TouchableOpacity>

              <View>
                <Text className="text-xl font-bold text-slate-900">Enter Verification Code</Text>
                <Text className="text-slate-500 text-xs mt-1 leading-5">
                  We sent a 6-digit code to <Text className="font-semibold text-slate-800">{loginMethod === 'email-otp' ? emailOTP : phone}</Text>
                </Text>
              </View>

              <View className="flex-row justify-between my-4">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <TextInput
                    key={index}
                    ref={(ref) => { otpInputs.current[index] = ref; }}
                    className="w-12 h-14 bg-slate-50 border border-slate-200 rounded-xl text-center text-xl font-bold text-slate-900 focus:border-[#1B6CA8]"
                    maxLength={1}
                    keyboardType="number-pad"
                    value={otpArray[index]}
                    onChangeText={(v) => handleOtpChange(v, index)}
                  />
                ))}
              </View>

              <TouchableOpacity 
                className={`bg-[#1B6CA8] h-12 rounded-xl items-center justify-center mt-2 ${loading ? 'opacity-70' : 'active:bg-[#155A8A]'}`}
                onPress={handleVerifyOTP}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator color="white" size="small" />
                    <Text className="text-white font-bold text-sm">Verifying code...</Text>
                  </View>
                ) : (
                  <Text className="text-white font-bold text-sm">Verify & Continue</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 3: Forgot Password Request */}
          {step === 3 && (
            <View className="w-full space-y-4">
              <TouchableOpacity 
                onPress={() => setStep(1)} 
                className="flex-row items-center gap-1.5 mb-2 self-start"
              >
                <ArrowLeft size={18} color="#1B6CA8" />
                <Text className="text-xs text-[#1B6CA8] font-bold">Back to Sign In</Text>
              </TouchableOpacity>

              <View>
                <Text className="text-xl font-bold text-slate-900">Reset Your Password</Text>
                <Text className="text-slate-500 text-xs mt-1">
                  Enter your registered email address and we'll send you a password reset code.
                </Text>
              </View>

              <View className="space-y-1 mt-2">
                <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Email Address</Text>
                <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                  <Mail color="#64748B" size={18} />
                  <TextInput
                  style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                    className="flex-1 ml-2.5 text-slate-800 text-sm"
                    placeholder="name@example.com"
                    placeholderTextColor="#94A3B8"
                    value={forgotEmail}
                    onChangeText={setForgotEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>
              </View>

              <TouchableOpacity 
                className={`bg-[#1B6CA8] h-12 rounded-xl items-center justify-center mt-3 ${loading ? 'opacity-70' : 'active:bg-[#155A8A]'}`}
                onPress={handleForgotPassword}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator color="white" size="small" />
                    <Text className="text-white font-bold text-sm">Sending reset code...</Text>
                  </View>
                ) : (
                  <Text className="text-white font-bold text-sm">Send Reset Code</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 4: Enter Reset Code & New Password */}
          {step === 4 && (
            <View className="w-full space-y-4">
              <TouchableOpacity 
                onPress={() => setStep(1)} 
                className="flex-row items-center gap-1.5 mb-2 self-start"
              >
                <ArrowLeft size={18} color="#1B6CA8" />
                <Text className="text-xs text-[#1B6CA8] font-bold">Back to Sign In</Text>
              </TouchableOpacity>

              <View>
                <Text className="text-xl font-bold text-slate-900">Set New Password</Text>
                <Text className="text-slate-500 text-xs mt-1">
                  Enter the reset code sent to your email and your new password.
                </Text>
              </View>

              <View className="space-y-1 mt-2">
                <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">Reset Code</Text>
                <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                  <Key color="#64748B" size={18} />
                  <TextInput
                  style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                    className="flex-1 ml-2.5 text-slate-800 text-sm font-semibold"
                    placeholder="Enter 6-digit reset code"
                    placeholderTextColor="#94A3B8"
                    value={resetCode}
                    onChangeText={setResetCode}
                  />
                </View>
              </View>

              <View className="space-y-1">
                <Text className="text-slate-700 text-xs font-semibold uppercase tracking-wider">New Password</Text>
                <View className="border border-slate-200 bg-white rounded-xl flex-row items-center px-3.5 h-12">
                  <Lock color="#64748B" size={18} />
                  <TextInput
                    className="flex-1 ml-2.5 text-slate-800 text-sm"
                    style={{ flex: 1, height: 48, color: '#1e293b', fontSize: 14 }}
                    placeholder="Enter new password"
                    placeholderTextColor="#94A3B8"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showNewPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    autoComplete="new-password"
                  />
                  <TouchableOpacity 
                    onPress={() => setShowNewPassword(!showNewPassword)}
                    className="p-2 justify-center items-center"
                    activeOpacity={0.7}
                  >
                    {showNewPassword ? <EyeOff color="#64748B" size={18} /> : <Eye color="#64748B" size={18} />}
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity 
                className={`bg-[#1B6CA8] h-12 rounded-xl items-center justify-center mt-3 ${loading ? 'opacity-70' : 'active:bg-[#155A8A]'}`}
                onPress={handleResetPassword}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator color="white" size="small" />
                    <Text className="text-white font-bold text-sm">Updating password...</Text>
                  </View>
                ) : (
                  <Text className="text-white font-bold text-sm">Update Password & Sign In</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Footer note */}
          <View className="mt-auto pt-8 items-center">
            <Text className="text-slate-400 text-[11px]">Protected by Ayu Disha Health Security System</Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

