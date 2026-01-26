import db from '../db/database';
import { WhatsAppInstance } from './WhatsAppInstance';

class EngineManager {
    private instances: Map<number, WhatsAppInstance> = new Map();

    async init() {
        // Load all instances from DB
        const rows = db.prepare('SELECT id, name FROM instances').all() as any[];
        for (const row of rows) {
            await this.startInstance(row.id, row.name);
        }
        console.log(`Engine Manager initialized with ${this.instances.size} instances.`);
    }

    async startInstance(id: number, name: string) {
        if (this.instances.has(id)) return this.instances.get(id);
        
        const instance = new WhatsAppInstance(id, name);
        await instance.init();
        this.instances.set(id, instance);
        return instance;
    }

    getInstance(id: number) {
        return this.instances.get(id);
    }

    getAllInstances() {
        return Array.from(this.instances.values());
    }

    async stopInstance(id: number) {
        const instance = this.instances.get(id);
        if (instance) {
            await instance.close();
            this.instances.delete(id);
        }
    }
}

export const engineManager = new EngineManager();
