import { useEffect, useRef, useCallback } from 'react';

interface FormPersistenceOptions {
  key: string;
  expirationHours?: number;
}

interface StoredFormData {
  data: any;
  timestamp: number;
}

const CLEANUP_INTERVAL = 60 * 60 * 1000;

export const useFormPersistence = <T extends Record<string, any>>(
  formData: T,
  options: FormPersistenceOptions
) => {
  const { key, expirationHours = 24 } = options;
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isRestoringRef = useRef(false);
  const lastSavedRef = useRef<string>('');

  const getStorageKey = useCallback(() => `form_${key}`, [key]);

  const isExpired = useCallback((timestamp: number): boolean => {
    const expirationMs = expirationHours * 60 * 60 * 1000;
    return Date.now() - timestamp > expirationMs;
  }, [expirationHours]);

  const cleanupExpiredData = useCallback(() => {
    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (storageKey && storageKey.startsWith('form_')) {
          try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
              const parsed: StoredFormData = JSON.parse(stored);
              if (isExpired(parsed.timestamp)) {
                keysToRemove.push(storageKey);
              }
            }
          } catch (e) {
            keysToRemove.push(storageKey);
          }
        }
      }

      keysToRemove.forEach(storageKey => {
        localStorage.removeItem(storageKey);
      });

      if (keysToRemove.length > 0) {
        console.log(`🧹 Limpieza: ${keysToRemove.length} formularios expirados eliminados`);
      }
    } catch (error) {
      console.error('Error durante limpieza de formularios:', error);
    }
  }, [isExpired]);

  const saveToStorage = useCallback((data: T) => {
    if (isRestoringRef.current) return;

    try {
      const dataString = JSON.stringify(data);

      if (dataString === lastSavedRef.current) {
        return;
      }

      const storageData: StoredFormData = {
        data,
        timestamp: Date.now(),
      };

      localStorage.setItem(getStorageKey(), JSON.stringify(storageData));
      lastSavedRef.current = dataString;
    } catch (error) {
      console.error('Error guardando formulario:', error);
    }
  }, [getStorageKey]);

  const loadFromStorage = useCallback((): T | null => {
    try {
      const stored = localStorage.getItem(getStorageKey());
      if (!stored) return null;

      const parsed: StoredFormData = JSON.parse(stored);

      if (isExpired(parsed.timestamp)) {
        localStorage.removeItem(getStorageKey());
        console.log('📅 Datos de formulario expirados, eliminados');
        return null;
      }

      console.log('✅ Formulario restaurado desde auto-guardado');
      return parsed.data;
    } catch (error) {
      console.error('Error cargando formulario:', error);
      localStorage.removeItem(getStorageKey());
      return null;
    }
  }, [getStorageKey, isExpired]);

  const clearStorage = useCallback(() => {
    try {
      localStorage.removeItem(getStorageKey());
      lastSavedRef.current = '';
    } catch (error) {
      console.error('Error limpiando formulario:', error);
    }
  }, [getStorageKey]);

  useEffect(() => {
    cleanupExpiredData();

    const cleanupInterval = setInterval(() => {
      cleanupExpiredData();
    }, CLEANUP_INTERVAL);

    return () => {
      clearInterval(cleanupInterval);
    };
  }, [cleanupExpiredData]);

  useEffect(() => {
    if (isRestoringRef.current) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveToStorage(formData);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [formData, saveToStorage]);

  return {
    loadFromStorage,
    clearStorage,
    setIsRestoring: (value: boolean) => {
      isRestoringRef.current = value;
    },
  };
};
