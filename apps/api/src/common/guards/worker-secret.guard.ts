import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class WorkerSecretGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const provided = req.headers['x-worker-secret'];

        const expected = process.env.WORKER_SECRET;
        if (!expected) throw new Error('WORKER_SECRET is not set');

        if (!provided || typeof provided !== 'string' || provided !== expected) {
            throw new UnauthorizedException('Invalid worker secret');
        }
        return true;
    }
}