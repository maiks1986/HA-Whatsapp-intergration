import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { AuthUser } from '../../types';
import { getDb } from '../../db/database';

// Removed in-memory Map. Using DB 'sessions' table instead.

export const authRouter = (getAddonConfig: () => any) => {
    const router = Router();

    router.get('/status', (req, res) => {
        const user = (req as any).haUser as AuthUser | null;
        let newToken: string | undefined;

        // Auto-create session for Ingress users if they don't have a token
        if (user && user.source === 'ingress') {
            const db = getDb();
            // Check if we already have a session for this user (optional optimization, but simplified for now: just create a new one if requested)
            // Actually, we want to give the frontend a token so it can persist it.
            newToken = uuidv4();
            try {
                db.prepare('INSERT INTO sessions (token, user_id, is_admin) VALUES (?, ?, ?)').run(
                    newToken,
                    user.id,
                    user.isAdmin ? 1 : 0
                );
                // Set cookie for convenience
                res.cookie('direct_token', newToken, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false });
            } catch (e) {
                console.error("Failed to persist auto-session", e);
            }
        }

        res.json({ 
            authenticated: !!user,
            source: user?.source || null,
            isAdmin: user?.isAdmin || false,
            needsPassword: !user && getAddonConfig().password !== "",
            token: newToken // Return the token so frontend can save it
        });
    });

    router.post('/login', (req, res) => {
        const { password } = req.body;
        const config = getAddonConfig();
        if (config.password && password === config.password) {
            const token = uuidv4();
            const db = getDb();
            db.prepare('INSERT INTO sessions (token, user_id, is_admin) VALUES (?, ?, ?)').run(
                token, 
                'direct_admin', 
                1
            );
            res.cookie('direct_token', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false });
            return res.json({ success: true, token });
        }
        res.status(401).json({ error: "Invalid password" });
    });

    router.post('/ha_login', async (req, res) => {
        const { haUrl, haToken } = req.body;
        try {
            const response = await axios.get(`${haUrl}/api/config`, {
                headers: { 'Authorization': `Bearer ${haToken}` }
            });
            if (response.data && response.data.version) {
                const token = uuidv4();
                const db = getDb();
                db.prepare('INSERT INTO sessions (token, user_id, is_admin) VALUES (?, ?, ?)').run(
                    token, 
                    `ha_${response.data.location_name || 'user'}`, 
                    1
                );
                res.cookie('direct_token', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false });
                return res.json({ success: true, token });
            }
        } catch (e) {}
        res.status(401).json({ error: "Invalid HA Credentials" });
    });

    return router;
};
