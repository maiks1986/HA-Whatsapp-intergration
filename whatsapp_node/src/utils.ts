export function normalizeJid(jid: string): string {
    if (!jid) return jid;
    // user:1@s.whatsapp.net -> user@s.whatsapp.net
    // user:1@lid -> user@lid
    if (jid.includes(':')) {
        return jid.replace(/:[0-9]+@/, '@');
    }
    return jid;
}

export function isJidValid(jid: string): boolean {
    return !!(jid && !jid.includes('@broadcast') && jid !== 'status@broadcast');
}
