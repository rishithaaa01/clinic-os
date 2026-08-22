import { useState, useEffect, useCallback } from 'react';
import api from '../services/clinicianApi';

export function useDifferential(symptoms: string, patientId?: string | null) {
  const [diagnoses, setDiagnoses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDifferential = useCallback(async (syms: string, pid?: string | null) => {
    if (!syms || syms.trim().length < 3) {
      setDiagnoses([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getDifferential(syms.trim(), pid || '');
      setDiagnoses(data?.diagnoses || []);
    } catch (err: any) {
      console.error("Differential fetch error:", err);
      setError(err?.response?.data?.detail || err?.message || 'Failed to fetch differential');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!symptoms || symptoms.trim().length < 3) {
      setDiagnoses([]);
      return;
    }

    // Debounce the API call by 600ms for fast, responsive live updates
    const timer = setTimeout(() => {
      fetchDifferential(symptoms, patientId);
    }, 600);

    return () => clearTimeout(timer);
  }, [symptoms, patientId, fetchDifferential]);

  return { 
    diagnoses, 
    isLoading, 
    error,
    refetch: () => fetchDifferential(symptoms, patientId)
  };
}

