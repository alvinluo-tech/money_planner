/**
 * 测试环境用的 server-only 替身。
 * server-only 包在非 RSC 环境会直接抛错，vitest 里用本文件顶替即可，
 * 这样 `src/lib/fx.ts` 等模块仍能保留「禁止客户端引入」的保护。
 */
export {};
