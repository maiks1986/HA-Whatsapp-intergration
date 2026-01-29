import { useState, useEffect } from 'react';
import { api, updateAxiosAuth } from '../api';

const setCookie = (name: string, value: string) => {
  const date = new Date();
  date.setTime(date.getTime() + (30 * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/; SameSite=Strict`;
};

const getCookie = (name: string) => {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
};

export const useAuth = () => {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [password, setPassword] = useState('');
  const [haUrl, setHaUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [loginMode, setLoginMode] = useState<'direct' | 'ha'>('direct');

  const checkAuth = async (retries = 5) => {
    const localToken = getCookie('direct_token') || localStorage.getItem('direct_token');
    updateAxiosAuth(localToken);
    try {
      const res = await api.getStatus();
      if (res.data.authenticated) {
        // If the backend auto-generated a session for Ingress, save it!
        if (res.data.token) {
             setCookie('direct_token', res.data.token);
             localStorage.setItem('direct_token', res.data.token);
             updateAxiosAuth(res.data.token);
        }
        setAuthState('authenticated');
      } else if (retries > 0) {
        setTimeout(() => checkAuth(retries - 1), 2000);
      } else {
        setAuthState('unauthenticated');
      }
    } catch (e) {
      if (retries > 0) setTimeout(() => checkAuth(retries - 1), 2000);
      else setAuthState('unauthenticated');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = loginMode === 'direct' 
        ? await api.login(password)
        : await api.haLogin(haUrl, haToken);
      
      setCookie('direct_token', res.data.token);
      updateAxiosAuth(res.data.token);
      setAuthState('authenticated');
    } catch (err) {
      alert("Invalid Credentials");
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return {
    authState,
    loginMode,
    setLoginMode,
    password,
    setPassword,
    haUrl,
    setHaUrl,
    haToken,
    setHaToken,
    handleLogin
  };
};
