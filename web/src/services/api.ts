import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return `http://${host}:8000/api`;
    }
  }
  return 'https://ayu-disha.onrender.com/api';
};

const API_URL = getApiUrl();

console.log('API Configuration:', { API_URL, env: import.meta.env.MODE });

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isAuthEndpoint = error.config?.url?.includes('/auth/login') ||
                           error.config?.url?.includes('/auth/send-otp') ||
                           error.config?.url?.includes('/auth/verify-otp');

    if (error.response?.status === 401 && !isAuthEndpoint) {
      console.warn('Authentication token invalid or expired. Logging out.');
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined') {
        const isAlreadyAtLogin = window.location.pathname.includes('/login') || window.location.hash.includes('/login');
        if (!isAlreadyAtLogin) {
          window.location.href = '/#/login';
        }
      }
    }
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.error('Backend timeout - translate to user friendly message');
      if (error.config?.url?.includes('/voice') || error.config?.url?.includes('/audio')) {
        error.message = "We're taking longer than expected to process the recording. Please try again.";
      } else {
        error.message = "The request took longer than expected to respond. Please try again.";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
