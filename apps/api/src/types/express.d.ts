declare namespace Express {
    export interface Request {
        tenantId?: string;
        user?: {
            sub: string;
            email: string;
        };
    }
}