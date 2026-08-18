import type { SunoProvider } from './types';
import { MockSunoProvider } from './mock';
import { SunoApiProvider } from './sunoapi';

// Provider 注册表：切换后端只改 SUNO_PROVIDER 环境变量，应用层零改动。
//   SUNO_PROVIDER=mock    本地合成演示（P0 默认）
//   SUNO_PROVIDER=sunoapi 真实生成（sunoapi.org 第三方 API，需 SUNO_API_KEY）
const providers = new Map<string, SunoProvider>([
  ['mock', new MockSunoProvider()],
  ['sunoapi', new SunoApiProvider()],
]);

export function getProvider(id?: string): SunoProvider {
  const providerId = id ?? process.env.SUNO_PROVIDER ?? 'mock';
  const provider = providers.get(providerId);
  if (!provider) throw new Error(`Unknown Suno provider: ${providerId}`);
  return provider;
}

export * from './types';
