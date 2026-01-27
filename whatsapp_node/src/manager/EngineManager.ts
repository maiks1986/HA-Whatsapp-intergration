import { getDb } from '../db/database';
import { WhatsAppInstance } from './WhatsAppInstance';

class EngineManager {
    private instances: Map<number, WhatsAppInstance> = new Map();
    private debugEnabled: boolean = false;

    async init(debugEnabled: boolean = false) {
        console.log('TRACE [EngineManager]: init() called');
        this.debugEnabled = debugEnabled;
        const db = getDb();
        // Load all instances from DB
        const rows = db.prepare('SELECT id, name FROM instances').all() as any[];
        for (const row of rows) {
            await this.startInstance(row.id, row.name);
        }
        console.log(`TRACE [EngineManager]: initialized with ${this.instances.size} instances.`);
    }

    async startInstance(id: number, name: string) {
        console.log(`TRACE [EngineManager]: startInstance(${id}, ${name}) called`);
        if (this.instances.has(id)) {
            console.log(`TRACE [EngineManager]: Instance ${id} already exists.`);
            return this.instances.get(id);
        }
        
        const instance = new WhatsAppInstance(id, name, this.debugEnabled);
        await instance.init();
        this.instances.set(id, instance);
        return instance;
    }

    getInstance(id: number) {
        console.log(`TRACE [EngineManager]: getInstance(${id}) called`);
        return this.instances.get(id);
    }

    getAllInstances() {
        console.log('TRACE [EngineManager]: getAllInstances() called');
        return Array.from(this.instances.values());
    }

    async stopInstance(id: number) {
        console.log(`TRACE [EngineManager]: stopInstance(${id}) called`);
        const instance = this.instances.get(id);
        if (instance) {
            await instance.close();
            this.instances.delete(id);
        }
    }
}

export const engineManager = new EngineManager();
