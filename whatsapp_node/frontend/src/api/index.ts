import axios from 'axios';
import { 
  Instance, 
  Chat, 
  Contact, 
  Message, 
  StatusUpdate,
  AuthStatusResponse, 
  LoginResponse 
} from '../types';

// Determine Base Path
const getBaseUrl = () => {
  if (window.location.pathname.includes('hassio_ingress')) {
    return 'api'; // Relative for Ingress
  }
  return '/api/whatsapp_proxy'; // Proxy for Native Component
};

const BASE = getBaseUrl();

export const updateAxiosAuth = (token: string | null) => {
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common['Authorization'];
  }
};

export const api = {
  // Auth
  getStatus: () => axios.get<AuthStatusResponse>(`${BASE}/auth/status`),
  login: (password: string) => axios.post<LoginResponse>(`${BASE}/auth/login`, { password }),
  haLogin: (haUrl: string, haToken: string) => axios.post<LoginResponse>(`${BASE}/auth/ha_login`, { haUrl, haToken }),

  // Instances
  getInstances: () => axios.get<Instance[]>(`${BASE}/instances`),
  createInstance: (name: string) => axios.post(`${BASE}/instances`, { name }),
  deleteInstance: (id: number) => axios.delete(`${BASE}/instances/${id}`),
  reconnect: (id: number) => axios.post(`${BASE}/instances/${id}/reconnect`),
  setPresence: (id: number, presence: 'available' | 'unavailable') => axios.post(`${BASE}/instances/${id}/presence`, { presence }),

  // Chats & Contacts
  getChats: (instanceId: number) => axios.get<Chat[]>(`${BASE}/chats/${instanceId}`),
  getContacts: (instanceId: number) => axios.get<Contact[]>(`${BASE}/contacts/${instanceId}`),
  modifyChat: (instanceId: number, jid: string, action: 'archive' | 'pin' | 'delete') => 
    axios.post(`${BASE}/chats/${instanceId}/${jid}/modify`, { action }),
  
  toggleEphemeral: (instanceId: number, jid: string, enabled: boolean, timer: number = 60) =>
    axios.post(`${BASE}/chats/${instanceId}/${jid}/ephemeral`, { enabled, timer }),

  // Messages
  getMessages: (instanceId: number, jid: string) => axios.get<Message[]>(`${BASE}/messages/${instanceId}/${jid}`),
  sendMessage: (instanceId: number, jid: string, message: string) => 
    axios.post(`${BASE}/send_message`, { instanceId, contact: jid, message }),
  searchMessages: (instanceId: number, query: string, jid?: string) => {
    let url = `${BASE}/messages/${instanceId}/search?query=${query}`;
    if (jid) url += `&jid=${jid}`;
    return axios.get<Message[]>(url);
  },

  // Groups
  createGroup: (instanceId: number, title: string, participants: string[]) => 
    axios.post(`${BASE}/groups/${instanceId}`, { title, participants }),

  // Status
  getStatuses: (instanceId: number) => axios.get<StatusUpdate[]>(`${BASE}/status/${instanceId}`),

  // Settings
  getSetting: (key: string, instanceId: number = 0) => axios.get<{ value: string }>(`${BASE}/settings/${key}?instanceId=${instanceId}`),
  saveSetting: (key: string, value: string, instanceId: number = 0) => axios.post(`${BASE}/settings`, { key, value, instanceId }),
  resetSystem: () => axios.post(`${BASE}/system/reset`),

  // Stealth Scheduler
  getStealthSchedules: (instanceId: number) => axios.get(`${BASE}/stealth/schedules/${instanceId}`),
  createStealthSchedule: (data: any) => axios.post(`${BASE}/stealth/schedules`, data),
  deleteStealthSchedule: (id: number) => axios.delete(`${BASE}/stealth/schedules/${id}`),

  // Social Sensors
  getTrackedContacts: (instanceId: number) => axios.get(`${BASE}/social/tracked/${instanceId}`),
  trackContact: (instanceId: number, jid: string) => axios.post(`${BASE}/social/tracked`, { instanceId, jid }),
  untrackContact: (instanceId: number, jid: string) => axios.delete(`${BASE}/social/tracked/${instanceId}/${jid}`)
};
