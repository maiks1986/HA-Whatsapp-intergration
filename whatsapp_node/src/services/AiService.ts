import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "../db/database";
import fs from 'fs';
import path from 'path';

class AiService {
    private genAI: GoogleGenerativeAI | null = null;

    private async getClient() {
        if (this.genAI) return this.genAI;
        
        // 1. Try reading from HA Options first
        let apiKey: string | null = null;
        try {
            const OPTIONS_PATH = process.env.NODE_ENV === 'development' 
                ? path.join(__dirname, '../../options.json') 
                : '/data/options.json';

            if (fs.existsSync(OPTIONS_PATH)) {
                const config = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
                apiKey = config.gemini_api_key;
                if (apiKey) console.log('TRACE [AiService]: Loaded API Key from Add-on options.');
            }
        } catch (e) {
            console.error('TRACE [AiService]: Error reading options.json:', e);
        }

        // 2. Fallback to Database if HA setting is empty
        if (!apiKey) {
            const db = getDb();
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini_api_key') as any;
            apiKey = row?.value;
            if (apiKey) console.log('TRACE [AiService]: Loaded API Key from Database.');
        }

        if (!apiKey) {
            console.warn("TRACE [AiService]: No Gemini API Key found in Add-on settings or database.");
            return null;
        }
        
        this.genAI = new GoogleGenerativeAI(apiKey);
        return this.genAI;
    }

    async analyzeIntent(messages: any[]) {
        console.log(`TRACE [AiService]: analyzeIntent() called with ${messages.length} messages`);
        const client = await this.getClient();
        if (!client) return "API Key Missing";

        const model = client.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        
        const context = messages.map(m => `${m.is_from_me ? 'Me' : 'Them'}: ${m.text}`).join('\n');
        const prompt = `
            Analyze the following WhatsApp conversation (last 20 messages).
            Identify the core "Intent" of the other person (Them).
            Return a single short phrase (3-5 words max).
            
            Conversation:
            ${context}
        `;

        try {
            const result = await model.generateContent(prompt);
            return result.response.text().trim();
        } catch (e: any) {
            console.error('TRACE [AiService]: analyzeIntent error:', e.message || e);
            if (e.message && e.message.includes('429')) return "Quota Exceeded";
            return "Analysis Error";
        }
    }

    async generateDraft(messages: any[], steer: string) {
        console.log(`TRACE [AiService]: generateDraft() called with ${messages.length} messages. Steer: ${steer}`);
        const client = await this.getClient();
        if (!client) return "API Key Missing";

        const model = client.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        
        const context = messages.map(m => `${m.is_from_me ? 'Me' : 'Them'}: ${m.text}`).join('\n');
        const prompt = `
            You are an AI helping me reply to WhatsApp messages.
            Here is the recent conversation history:
            ${context}
            
            My instructions for this reply: ${steer || "Draft a helpful and relevant reply."}            
            
            Return ONLY the text of the reply. Do not use quotes or prefixes. 
            Mimic my writing style (informal, concise).
        `;

        try {
            const result = await model.generateContent(prompt);
            return result.response.text().trim();
        } catch (e: any) {
            console.error('TRACE [AiService]: generateDraft error:', e.message || e);
            return "Draft Error";
        }
    }

    // Force re-init if key changes
    reset() {
        console.log('TRACE [AiService]: reset() called');
        this.genAI = null;
    }
}

export const aiService = new AiService();
