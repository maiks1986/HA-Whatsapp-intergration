export interface Instance {
    id: number;
    name: string;
    ha_user_id?: string | null;
    status: string;
    presence?: 'available' | 'unavailable';
    qr?: string | null;
    last_seen?: string | null;
}

export interface Contact {
    instance_id?: number;
    jid: string;
    name: string;
}

export interface Chat {
    instance_id?: number;
    jid: string;
    name: string;
    unread_count: number;
    last_message_text?: string | null;
    last_message_timestamp?: string | null;
    is_archived: number;
    is_pinned: number;
}

export interface Message {
    id: number;
    instance_id: number;
    whatsapp_id: string;
    chat_jid: string;
    sender_jid: string;
    sender_name: string;
    text: string;
    type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'poll' | 'reaction' | 'vcard';
    media_path?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    vcard_data?: string | null;
    status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';
    timestamp: string;
    is_from_me: number;
    parent_message_id?: string | null;
    reactions?: Array<{ sender_jid: string, emoji: string }>;
}

export interface StatusUpdate {
    id: number;
    instance_id: number;
    sender_jid: string;
    sender_name: string;
    type: string;
    text: string;
    media_path?: string | null;
    timestamp: string;
}

export interface AuthStatusResponse {
    authenticated: boolean;
    source: 'ingress' | 'direct' | null;
    isAdmin: boolean;
    needsPassword: boolean;
}

export interface LoginResponse {
    success: boolean;
    token: string;
}