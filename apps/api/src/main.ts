import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });

    app.use(helmet());
    app.enableCors({ origin: true, credentials: true });

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        })
    );

    const port = process.env.API_PORT ? Number(process.env.API_PORT) : 4000;
    await app.listen(port);
    // eslint-disable-next-line no-console
    console.log(`API running on http://localhost:${port}`);
}

bootstrap().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});