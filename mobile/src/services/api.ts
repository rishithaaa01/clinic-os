import axios from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

const getBackendUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // Extract host IP dynamically from Expo dev server
  const hostUri = Constants.expoConfig?.hostUri || Constants.experienceUrl || '';
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:8000/api`;
    }
  }

  // Fallback for local emulator or active machine IP (Wi-Fi IPv4)
  return 'http://10.230.234.66:8000/api';
};

const API_URL = getBackendUrl();
console.log('📡 [Mobile API] Target Backend URL:', API_URL);

const api = axios.create({
  baseURL: API_URL,
  timeout: 35000, // 35 second timeout for AI pipeline on local CPU
  headers: {
    'Content-Type': 'application/json',
    'x-client-type': 'mobile'
  },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn('Mobile API Authentication token invalid or expired. Logging out.');
      useAuthStore.getState().logout();
    }
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.error('Backend timeout - please check server connection.');
    }
    return Promise.reject(error);
  }
);

export default api;
