import { Request, Response, NextFunction } from 'express';
import { AuthUser } from '../types';
import { getDb } from '../db/database';
import fs from 'fs';

const getOptions = () => {
    try {
        if (fs.existsSync('/data/options.json')) return JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    } catch (e) {}
    return {};
};

export const identityResolver = (req: Request, res: Response, next: NextFunction) => {
    // 0. Check Disable Auth Setting (Nuclear Option)
    const options = getOptions();
    if (options.disable_auth === true) {
        (req as any).haUser = { id: 'admin', isAdmin: true, source: 'config_bypass' } as AuthUser;
        return next();
    }

    // 1. API Key Auth (Native Integration)
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey && options.internal_api_key && apiKey === options.internal_api_key) {
        (req as any).haUser = { id: 'ha_component', isAdmin: true, source: 'api_key' } as AuthUser;
        return next();
    }

    const userId = req.headers['x-hass-user-id'] as string;
    const ingressPath = req.headers['x-ingress-path'] as string;
    const isAdmin = req.headers['x-hass-is-admin'] === '1' || req.headers['x-hass-is-admin'] === 'true';
    
    // Debug Ingress Headers
    if (userId || ingressPath) {
        // console.log(`[Auth] Ingress request. User: ${userId}, Path: ${ingressPath}`);
    }

    // 0. Dev Token Bypass
    if (process.env.DEV_TOKEN && (req.headers['x-dev-token'] === process.env.DEV_TOKEN || req.query.dev_token === process.env.DEV_TOKEN)) {
        console.log('[Auth] Dev Token used');
        (req as any).haUser = { id: 'dev_user', isAdmin: true, source: 'dev' } as AuthUser;
        return next();
    }

    // 1. Check for Ingress Headers (Auto-Login)
    if (userId || ingressPath) {
        // If userId is missing but we have ingressPath, it's still a valid Ingress request.
        (req as any).haUser = { id: userId || 'ingress_user', isAdmin: userId ? isAdmin : true, source: 'ingress' } as AuthUser;
        return next();
    }

    // 2. Check for Session Cookie
    const cookieToken = req.headers.cookie?.split('; ').find(row => row.startsWith('direct_token='))?.split('=')[1];
    
    // 3. Check for Auth Header (Backwards compatibility)
    const authHeader = req.headers['authorization'];
    const token = cookieToken || authHeader?.split(' ')[1];

    if (token) {
        try {
            const db = getDb();
            const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;
            if (session) {
                (req as any).haUser = { id: session.user_id, isAdmin: !!session.is_admin, source: 'direct' } as AuthUser;
                return next();
            }
        } catch (e) {
            console.error('[Auth] DB Error during session check:', e);
        }
    }

    (req as any).haUser = null;
    next();
};

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).haUser) return res.status(401).json({ error: "Unauthorized" });
    next();
};
