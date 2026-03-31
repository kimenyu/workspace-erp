import IORedis from 'ioredis';

export function createRedisConnection() {
    const redisUrl = process.env.REDIS_URL
        ?? `rediss://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_ADDR}`;

    return new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        tls: {},  // required for Upstash TLS
    });
}
// import IORedis from 'ioredis';

// export function createRedisConnection() {
//     const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
//     return new IORedis(url, { maxRetriesPerRequest: null });
// }

