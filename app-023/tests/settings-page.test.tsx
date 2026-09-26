// 设置页组件用例（jsdom）—— 接线到真实 SettingsProvider + fake-indexeddb：
// 改值落盘、非法输入不写入、恢复出厂；覆盖「输入即存」的整条交互链路
// 让 React 18 的 act() 在 jsdom 下生效
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Settings } from '../src/pages/Settings';
import { SettingsProvider } from '../src/settingsContext';
import { loadSettings } from '../src/lib/storage';

let container: HTMLDivElement;
let root: Root;

async function renderSettings() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SettingsProvider>
        <Settings />
      </SettingsProvider>,
    );
  });
  // 等 IndexedDB 初始加载完成（无记录 → 保持默认）
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  const dbs = await indexedDB.databases();
  for (const d of dbs) {
    if (d.name) indexedDB.deleteDatabase(d.name);
  }
});

function input(testid: string): HTMLInputElement {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing ${testid}`);
  return el as HTMLInputElement;
}

function button(testid: string): HTMLButtonElement {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing ${testid}`);
  return el as HTMLButtonElement;
}

/** 模拟用户在输入框里输入（React 18 + jsdom 需用原生 setter，否则 onChange 不触发） */
const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    el.focus();
    inputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function blur(el: HTMLInputElement) {
  await act(async () => {
    el.blur(); // 真正改变 focus 状态，React 才会触发 onBlur
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('设置页·乐器音色', () => {
  beforeEach(renderSettings);

  it('出厂值渲染且无自定义标记、恢复入口禁用', () => {
    expect(input('baseHz-gu').value).toBe('82');
    expect(container.querySelector('[data-testid="custom-gu"]')).toBeNull();
    expect(button('reset-synth-gu').disabled).toBe(true);
    expect(button('reset-all-synth').disabled).toBe(true);
  });

  it('合法值立即写入 IndexedDB 并出现自定义标记；刷新（重读）后保留', async () => {
    await typeInto(input('baseHz-gu'), '150');
    await typeInto(input('decay-gu'), '0.66');
    expect(container.querySelector('[data-testid="custom-gu"]')).not.toBeNull();
    expect(button('reset-synth-gu').disabled).toBe(false);
    expect(button('reset-all-synth').disabled).toBe(false);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30)); // 等落盘
    });
    let s = await loadSettings();
    expect(s?.synthOverrides).toEqual({ gu: { baseHz: 150, decay: 0.66 } });

    // 卸载再挂载 ≈ 离开设置页再回来
    await act(async () => root.unmount());
    await renderSettings();
    expect(input('baseHz-gu').value).toBe('150');
    expect(input('decay-gu').value).toBe('0.66');
    s = await loadSettings();
    expect(s?.synthOverrides.gu).toEqual({ baseHz: 150, decay: 0.66 });
  });

  it('字母：就地提示且不写入 IndexedDB，失焦回退出厂值', async () => {
    const hz = input('baseHz-gu');
    await typeInto(hz, 'abc');
    const err = container.querySelector('[data-testid="baseHz-gu-error"]');
    expect(err?.textContent).toContain('数字');
    expect(hz.classList.contains('invalid')).toBe(true);
    await blur(hz);
    expect(hz.value).toBe('82');
    expect(container.querySelector('[data-testid="baseHz-gu-error"]')).toBeNull();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect((await loadSettings())?.synthOverrides ?? {}).toEqual({});
  });

  it('负数/零：就地提示且不写入', async () => {
    const hz = input('baseHz-gu');
    await typeInto(hz, '-50');
    expect(container.querySelector('[data-testid="baseHz-gu-error"]')?.textContent).toContain('大于 0');
    await typeInto(hz, '0');
    expect(container.querySelector('[data-testid="baseHz-gu-error"]')?.textContent).toContain('大于 0');
    expect(hz.classList.contains('invalid')).toBe(true);
    expect((await loadSettings())?.synthOverrides ?? {}).toEqual({});
  });

  it('超出乐器允许范围：提示带范围且不写入', async () => {
    const hz = input('baseHz-gu'); // 鼓 30–200
    await typeInto(hz, '999');
    expect(container.querySelector('[data-testid="baseHz-gu-error"]')?.textContent).toContain('允许范围');
    const dec = input('decay-gu'); // 鼓 0.05–1.5
    await typeInto(dec, '5');
    expect(container.querySelector('[data-testid="decay-gu-error"]')?.textContent).toContain('允许范围');
    expect((await loadSettings())?.synthOverrides ?? {}).toEqual({});
  });

  it('非法后改回合法：错误消失并写入', async () => {
    const hz = input('baseHz-gu');
    await typeInto(hz, 'abc');
    expect(container.querySelector('[data-testid="baseHz-gu-error"]')).not.toBeNull();
    await typeInto(hz, '120');
    expect(container.querySelector('[data-testid="baseHz-gu-error"]')).toBeNull();
    expect(hz.classList.contains('invalid')).toBe(false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect((await loadSettings())?.synthOverrides).toEqual({ gu: { baseHz: 120 } });
  });

  it('单件恢复出厂：覆盖清除、输入框回出厂值', async () => {
    await typeInto(input('baseHz-gu'), '120');
    await typeInto(input('baseHz-daluo'), '300');
    await blur(input('baseHz-daluo')); // 点击前先失焦（模拟真实鼠标点击）
    await act(async () => button('reset-synth-gu').click());
    expect(input('baseHz-gu').value).toBe('82');
    expect(input('baseHz-daluo').value).toBe('300'); // 大锣不受影响
    expect(container.querySelector('[data-testid="custom-gu"]')).toBeNull();
    expect(container.querySelector('[data-testid="custom-daluo"]')).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect((await loadSettings())?.synthOverrides).toEqual({ daluo: { baseHz: 300 } });
  });

  it('全部恢复出厂：清空所有覆盖', async () => {
    await typeInto(input('baseHz-gu'), '120');
    await typeInto(input('decay-bangzi'), '0.2'); // 出厂 0.07
    // 真实浏览器点击按钮会先让输入框失焦（jsdom 的 button.click() 不会）
    await blur(input('decay-bangzi'));
    await act(async () => button('reset-all-synth').click());
    expect(input('baseHz-gu').value).toBe('82');
    expect(input('decay-bangzi').value).toBe('0.07');
    expect(container.querySelectorAll('[data-testid^="custom-"]').length).toBe(0);
    expect(button('reset-all-synth').disabled).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect((await loadSettings())?.synthOverrides).toEqual({});
  });
});
