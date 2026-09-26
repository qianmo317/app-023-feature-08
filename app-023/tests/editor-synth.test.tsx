// 编辑器组件用例（jsdom）—— 旧曲对「当前音色」的逐条/全部套用与保留
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '../src/pages/Editor';
import { SettingsProvider } from '../src/settingsContext';
import { defaultSettings } from '../src/lib/factory';
import { getScore, saveScore, saveSettings } from '../src/lib/storage';
import { newEmptyScore } from '../src/lib/factory';

let container: HTMLDivElement;
let root: Root;

async function clearDB() {
  const dbs = await indexedDB.databases();
  for (const d of dbs) {
    if (d.name) indexedDB.deleteDatabase(d.name);
  }
}

async function renderEditor(scoreId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SettingsProvider>
        <Editor scoreId={scoreId} onNavigate={() => {}} />
      </SettingsProvider>,
    );
  });
  // 等曲目与设置从 IndexedDB 加载
  for (let i = 0; i < 20; i++) {
    if (container.querySelector('[data-testid="editor-page"]')) break;
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await clearDB();
});

function el(testid: string): HTMLElement {
  const e = container.querySelector(`[data-testid="${testid}"]`);
  if (!e) throw new Error(`missing ${testid}`);
  return e as HTMLElement;
}
function btn(testid: string): HTMLButtonElement {
  return el(testid) as HTMLButtonElement;
}
async function waitSaved(ms = 700) {
  await act(async () => new Promise((r) => setTimeout(r, ms))); // 过 400ms 防抖自动保存
}

describe('编辑器·套用当前音色到旧曲', () => {
  beforeEach(clearDB);

  it('出厂音色下套用按钮禁用', async () => {
    const score = newEmptyScore('旧曲');
    await saveScore(score);
    await saveSettings(defaultSettings());
    await renderEditor(score.id);
    expect(btn('apply-synth-gu').disabled).toBe(true);
    expect(btn('apply-synth-all').disabled).toBe(true);
  });

  it('逐条套用：只更新所选乐器，未套的保留旧值', async () => {
    const score = newEmptyScore('旧曲'); // 出厂音色
    const beforeGu = score.instruments.find((i) => i.id === 'gu')!.synth.baseHz;
    const beforeDaluo = score.instruments.find((i) => i.id === 'daluo')!.synth.baseHz;
    await saveScore(score);
    const st = defaultSettings();
    st.synthOverrides = { gu: { baseHz: 132 }, daluo: { baseHz: 300 } };
    await saveSettings(st);

    await renderEditor(score.id);
    expect(btn('apply-synth-gu').disabled).toBe(false);
    expect(btn('apply-synth-daluo').disabled).toBe(false);

    await act(async () => btn('apply-synth-gu').click());
    expect(btn('apply-synth-gu').disabled).toBe(true); // 套完即一致
    expect(btn('apply-synth-daluo').disabled).toBe(false); // 大锣仍不同

    await waitSaved();
    const saved = await getScore(score.id);
    const gu = saved!.instruments.find((i) => i.id === 'gu')!.synth;
    const daluo = saved!.instruments.find((i) => i.id === 'daluo')!.synth;
    expect(gu.baseHz).toBe(132);
    expect(gu.decay).toBe(score.instruments.find((i) => i.id === 'gu')!.synth.decay); // 只改基频
    expect(daluo.baseHz).toBe(beforeDaluo);
    expect(beforeDaluo).not.toBe(300);
    expect(beforeGu).not.toBe(132);
  });

  it('全部套用：所有不同的乐器更新，一致后入口禁用', async () => {
    const score = newEmptyScore('旧曲');
    await saveScore(score);
    const st = defaultSettings();
    st.synthOverrides = { gu: { baseHz: 95, decay: 0.41 }, bangzi: { baseHz: 1000 } };
    await saveSettings(st);

    await renderEditor(score.id);
    expect(btn('apply-synth-all').disabled).toBe(false);
    await act(async () => btn('apply-synth-all').click());
    expect(btn('apply-synth-all').disabled).toBe(true);
    expect(btn('apply-synth-gu').disabled).toBe(true);
    expect(btn('apply-synth-bangzi').disabled).toBe(true);

    await waitSaved();
    const saved = await getScore(score.id);
    expect(saved!.instruments.find((i) => i.id === 'gu')!.synth).toMatchObject({ baseHz: 95, decay: 0.41 });
    expect(saved!.instruments.find((i) => i.id === 'bangzi')!.synth.baseHz).toBe(1000);
    // type/noise 等曲目自身字段保留
    expect(saved!.instruments.find((i) => i.id === 'gu')!.synth.type).toBe('drum');
  });
});
