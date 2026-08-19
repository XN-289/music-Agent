// 临时调试脚本：绕过 Next 直接测试 pi 的 DeepSeek 模型流，观察真实错误。
// 用法: node scripts/debug-pi-model.mjs
import { ModelRuntime, resolveCliModel } from '@earendil-works/pi-coding-agent';
import path from 'node:path';

const rt = await ModelRuntime.create({
  authPath: path.join(process.cwd(), 'data', 'pi-agent', 'auth.json'),
  modelsPath: null,
  allowModelNetwork: false,
  refreshOnCreate: false,
});

const r = resolveCliModel({
  cliProvider: 'deepseek',
  cliModel: 'deepseek-v4-flash',
  modelRuntime: rt,
});
console.log('model:', r.model?.provider, r.model?.id, '| fallback:', r.fallbackMessage);

const auth = await rt.getAuth(r.model);
console.log('auth resolved:', !!auth, '| auth keys:', auth ? Object.keys(auth).join(',') : '-');

try {
  const stream = rt.stream(
    r.model,
    {
      systemPrompt: 'You are a music producer assistant.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi, 写一首关于夏天的歌' }] }],
    },
    { auth },
  );
  for await (const ev of stream) {
    if (ev.type === 'text_delta') process.stdout.write(ev.delta);
    else if (ev.type === 'done' || ev.type === 'error') {
      const finalMsg = ev.type === 'done' ? ev.message : ev.error;
      console.log(`\n[${ev.type}]`, JSON.stringify(finalMsg ?? null, null, 1).slice(0, 800));
    } else if (ev.type === 'thinking_delta') {
      process.stdout.write('.');
    } else {
      console.log('\n[event]', ev.type);
    }
  }
  console.log('\nstream ended');
} catch (e) {
  console.error('\nSTREAM THREW:', e);
}
