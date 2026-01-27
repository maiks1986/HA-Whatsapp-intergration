import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "../db/database";

class AiService {
    private genAI: GoogleGenerativeAI | null = null;

    private async getClient() {
        console.log('TRACE [AiService]: getClient() called');
        if (this.genAI) return this.genAI;
        
        const db = getDb();
        const apiKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini_api_key') as any;
        if (!apiKey?.value) {
            console.warn("TRACE [AiService]: No Gemini API Key found in settings.");
            return null;
        }
        
        this.genAI = new GoogleGenerativeAI(apiKey.value);
        return this.genAI;
    }

    async analyzeIntent(messages: any[]) {
        console.log(`TRACE [AiService]: analyzeIntent() called with ${messages.length} messages`);
        const client = await this.getClient();
        if (!client) return "API Key Missing";

        const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
        
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
        } catch (e) {
            console.error('TRACE [AiService]: analyzeIntent error:', e);
            return "Analysis Error";
        }
    }

    async generateDraft(messages: any[], steer: string) {
        console.log(`TRACE [AiService]: generateDraft() called with ${messages.length} messages. Steer: ${steer}`);
        const client = await this.getClient();
        if (!client) return "API Key Missing";

        const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
        
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
        } catch (e) {
            console.error('TRACE [AiService]: generateDraft error:', e);
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
