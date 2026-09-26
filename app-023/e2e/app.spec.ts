// E2E —— 模拟真实用户点击：建谱 → 录入 → 试听 → 调速 → 持久化 → 打印 → 性能
import { expect, test, type Page } from '@playwright/test';

/** 读 IndexedDB 里的应用设置（音色覆盖等） */
async function readSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('app023-percussion');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readonly');
          tx.objectStore('settings').get('app').onsuccess = function (this: IDBRequest) {
            resolve((this.result ?? {}) as Record<string, unknown>);
            db.close();
          };
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

/** 读 IndexedDB 里某曲目 */
async function readScore(page: Page, id: string): Promise<Record<string, unknown>> {
  return page.evaluate(
    (sid) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('app023-percussion');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('scores', 'readonly');
          tx.objectStore('scores').get(sid).onsuccess = function (this: IDBRequest) {
            resolve((this.result ?? {}) as Record<string, unknown>);
            db.close();
          };
        };
        req.onerror = () => reject(req.error);
      }),
    id,
  );
}

async function createEmptyScore(page: Page, title: string) {
  await page.goto('#/');
  await page.getByTestId('new-title').fill(title);
  await page.getByTestId('btn-create').click();
  await expect(page.getByTestId('editor-page')).toBeVisible();
}

test.describe('曲目列表', () => {
  test('新建空白谱进入编辑器', async ({ page }) => {
    await createEmptyScore(page, 'E2E 开道锣');
    await expect(page.getByTestId('score-title')).toHaveValue('E2E 开道锣');
    await expect(page.getByTestId('grid')).toBeVisible();
  });
});

test.describe('录入与齐奏', () => {
  test('点击格子 + 键盘落字 + 数字换时值 + 休止', async ({ page }) => {
    await createEmptyScore(page, 'E2E 录入');
    // 选中 0 小节 0 格，按 z → 鼓·咚（整拍）
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('z');
    await expect(page.getByTestId('grid-glyph-0-0-gu')).toBeVisible();
    // 光标自动前进到 4 格；按 2 切半拍，再按 a → 小锣·才 落在 4 格处
    await page.keyboard.press('2');
    await page.keyboard.type('a');
    await expect(page.getByTestId('grid-glyph-0-4-xiaoluo')).toBeVisible();
    // 0 休止
    await page.keyboard.press('0');
    await page.waitForTimeout(100);
    // 齐奏：回到 0 格，v → 大锣·哐 与 咚 同列
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('v');
    await expect(page.getByTestId('grid-glyph-0-0-daluo')).toBeVisible();
  });

  test('验收：齐奏多乐器落在同一列（x 坐标相同）', async ({ page }) => {
    await createEmptyScore(page, 'E2E 齐奏');
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('z'); // 鼓
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('v'); // 大锣
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('f'); // 钹
    const xs = await page.evaluate(() => {
      const out: number[] = [];
      for (const id of ['gu', 'daluo', 'bo']) {
        const el = document.querySelector(`[data-testid="grid-glyph-0-0-${id}"] text`) as SVGTextElement | null;
        const g = el?.closest('g') as SVGGElement | null;
        if (el) {
          const bb = (g ?? el).getBoundingClientRect();
          out.push(bb.x + bb.width / 2);
        }
      }
      return out;
    });
    expect(xs.length).toBe(3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1); // 同一列
  });
});

test.describe('曲牌库', () => {
  test('一键载入急急风并显示齐奏列', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await expect(page.getByTestId('score-title')).toHaveValue('急急风');
    await expect(page.getByTestId('grid-glyph-0-0-daluo')).toBeVisible(); // 哐
    await expect(page.getByTestId('grid-glyph-0-0-xiaoluo')).toBeVisible(); // 才
    await expect(page.getByTestId('grid-glyph-0-0-bo')).toBeVisible(); // 七
    await expect(page.locator('[data-testid="grid-bar-0"]')).toBeVisible();
  });

  test('载入收头（跨小节切分）后小节铺满', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-shutou').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    const bars = await page.locator('[data-testid^="grid-bar-"]').count();
    expect(bars).toBe(2);
  });
});

test.describe('试听', () => {
  test('播放 → 当前拍高亮 → 停止；+/− 调 BPM', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('btn-play').click();
    await expect(page.getByTestId('grid-highlight')).toBeVisible({ timeout: 3000 });
    await page.getByTestId('btn-play').click(); // 停止
    await expect(page.getByTestId('grid-highlight')).toHaveCount(0);

    const bpm0 = await page.getByTestId('bpm-value').textContent();
    await page.getByTestId('bpm-up').click();
    await page.getByTestId('bpm-up').click();
    const bpm1 = Number(await page.getByTestId('bpm-value').textContent());
    expect(bpm1).toBe(Number(bpm0) + 4);
    await page.getByTestId('bpm-down').click();
    expect(Number(await page.getByTestId('bpm-value').textContent())).toBe(Number(bpm0) + 2);
  });

  test('验收：调度时刻偏差 < 10ms（读取 __scheduled 钩子）', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('btn-play').click();
    // 等待调度器排入足够事件（ctx resume 完成后 lookahead 持续填窗）
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as { __scheduled?: () => { time: number }[] }).__scheduled?.().length ?? 0,
          ),
        { timeout: 8000, intervals: [200] },
      )
      .toBeGreaterThan(10);
    const deltas = await page.evaluate(() => {
      const evs = (window as unknown as { __scheduled?: () => { time: number }[] }).__scheduled?.() ?? [];
      const uniq = [...new Set(evs.map((e) => e.time))].sort((a, b) => a - b);
      const per = 60 / 152 / 4; // 急急风 BPM 152 每格秒数
      const errs: number[] = [];
      for (let i = 1; i < uniq.length; i++) {
        const n = Math.round((uniq[i] - uniq[i - 1]) / per);
        errs.push(Math.abs(uniq[i] - uniq[i - 1] - n * per));
      }
      return errs;
    });
    expect(deltas.length).toBeGreaterThan(3);
    for (const e of deltas) expect(e).toBeLessThan(0.01); // < 10ms
    await page.getByTestId('btn-play').click();
  });

  test('独奏/静音切换', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('solo-daluo').click();
    await expect(page.getByTestId('solo-daluo')).toHaveClass(/on/);
    await page.getByTestId('mute-gu').click();
    await expect(page.getByTestId('mute-gu')).toHaveClass(/on/);
  });
});

test.describe('持久化', () => {
  test('刷新后曲目与谱面不丢（IndexedDB）', async ({ page }) => {
    await createEmptyScore(page, 'E2E 持久化');
    await page.getByTestId('grid-cell-0-0').click();
    await page.keyboard.type('z');
    await expect(page.getByTestId('grid-glyph-0-0-gu')).toBeVisible();
    await page.waitForTimeout(800); // 等自动保存
    await page.reload();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await expect(page.getByTestId('score-title')).toHaveValue('E2E 持久化');
    await expect(page.getByTestId('grid-glyph-0-0-gu')).toBeVisible();
  });

  test('曲目列表展示与删除', async ({ page }) => {
    await createEmptyScore(page, 'E2E 待删除');
    await page.goto('#/');
    const row = page.locator('tr', { hasText: 'E2E 待删除' });
    await expect(row).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await row.getByTestId(/del-sc_/).click();
    await expect(page.locator('tr', { hasText: 'E2E 待删除' })).toHaveCount(0);
  });
});

test.describe('打印', () => {
  test('打印视图：A4 横排、简谱对照开关、打印/PNG 按钮', async ({ page }) => {
    await page.goto('#/library');
    await page.getByTestId('load-jijifeng').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    await page.getByTestId('btn-print').click();
    await expect(page.getByTestId('print-page')).toBeVisible();
    const bars = await page.locator('[data-testid^="print-bar-"]').count();
    expect(bars).toBe(4);
    // 4 个小节一行放下（SVG 宽度 ≤ A4 内容宽 1047 + 行标）
    const w = await page.evaluate(() => (document.querySelector('[data-testid="print"]') as SVGSVGElement).width.baseVal.value);
    expect(w).toBeLessThanOrEqual(1047 + 64 + 2);
    // 简谱对照
    await page.getByTestId('chk-jianpu').check();
    await expect(page.locator('[data-testid^="print-jianpu-"]').first()).toBeVisible();
    // window.print 被调用
    await page.evaluate(() => {
      (window as unknown as { print: () => void }).print = () => {
        (window as unknown as { __printed?: boolean }).__printed = true;
      };
    });
    await page.getByTestId('btn-do-print').click();
    expect(await page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed)).toBe(true);
  });
});

test.describe('设置', () => {
  test('改键位并持久化', async ({ page }) => {
    await page.goto('#/settings');
    await page.getByTestId('rebind-z').click(); // 把 z（鼓·咚）改绑到 p
    await page.keyboard.press('p');
    await expect(page.getByTestId('rebind-msg')).toContainText('已绑定 p');
    await page.waitForTimeout(300); // 等 IndexedDB 落盘
    await page.reload();
    const row = page.locator('tr', { hasText: '咚' });
    await expect(row).toContainText('p');
  });

  test('改基频/衰减：落盘、刷新保留、新曲携带、旧曲不被动', async ({ page }) => {
    // 先建一支旧曲（出厂音色）
    await createEmptyScore(page, 'E2E 旧曲音色');
    const oldId = page.url().split('/score/')[1];

    // 设置页改鼓的基频与衰减（鼓范围 30–200Hz / 0.05–1.5s）
    await page.goto('#/settings');
    await page.getByTestId('baseHz-gu').fill('150');
    await page.getByTestId('decay-gu').fill('0.66');
    await expect(page.getByTestId('custom-gu')).toBeVisible();
    await page.waitForTimeout(300);
    let settings = await readSettings(page);
    expect(settings.synthOverrides).toEqual({ gu: { baseHz: 150, decay: 0.66 } });

    // 刷新后仍是改过的值
    await page.reload();
    await expect(page.getByTestId('baseHz-gu')).toHaveValue('150');
    await expect(page.getByTestId('decay-gu')).toHaveValue('0.66');

    // 旧曲保持出厂音色（未套用不动）
    const oldScore = (await readScore(page, oldId)) as {
      instruments: { id: string; synth: { baseHz: number; decay: number } }[];
    };
    const oldGu = oldScore.instruments.find((i) => i.id === 'gu')!;
    expect(oldGu.synth.baseHz).not.toBe(150);
    expect(oldGu.synth.decay).not.toBe(0.66);

    // 新曲携带改过的音色
    await page.goto('#/');
    await page.getByTestId('new-title').fill('E2E 新曲音色');
    await page.getByTestId('btn-create').click();
    await expect(page.getByTestId('editor-page')).toBeVisible();
    const newId = page.url().split('/score/')[1];
    await page.waitForTimeout(600); // 等自动保存
    const newScore = (await readScore(page, newId)) as {
      instruments: { id: string; synth: { baseHz: number; decay: number } }[];
    };
    const newGu = newScore.instruments.find((i) => i.id === 'gu')!;
    expect(newGu.synth.baseHz).toBe(150);
    expect(newGu.synth.decay).toBe(0.66);
  });

  test('非法输入（字母/负数/超范围）就地提示且不写入', async ({ page }) => {
    await page.goto('#/settings');
    const hz = page.getByTestId('baseHz-gu');

    await hz.fill('abc');
    await expect(page.getByTestId('baseHz-gu-error')).toContainText('数字');
    await page.keyboard.press('Tab'); // 失焦：非法值回退
    await expect(hz).toHaveValue('82'); // 出厂值

    await hz.fill('-50');
    await expect(page.getByTestId('baseHz-gu-error')).toContainText('大于 0');
    await page.keyboard.press('Tab');
    await expect(hz).toHaveValue('82');

    await hz.fill('999'); // 鼓上限 200
    await expect(page.getByTestId('baseHz-gu-error')).toContainText('允许范围');
    await page.keyboard.press('Tab');
    await expect(hz).toHaveValue('82');

    await page.waitForTimeout(200);
    const settings = await readSettings(page);
    expect(settings.synthOverrides ?? {}).toEqual({}); // 全程没写入
  });

  test('旧曲逐条套用 / 全部套用 / 恢复出厂', async ({ page }) => {
    await createEmptyScore(page, 'E2E 套用音色');
    const id = page.url().split('/score/')[1];

    // 出厂音色下，编辑器套用按钮不可用
    await expect(page.getByTestId('apply-synth-gu')).toBeDisabled();
    await expect(page.getByTestId('apply-synth-all')).toBeDisabled();

    // 改两件乐器
    await page.goto('#/settings');
    await page.getByTestId('baseHz-gu').fill('132');
    await page.getByTestId('baseHz-daluo').fill('300');
    await page.waitForTimeout(300);

    // 回旧曲：逐条只套鼓，大锣保留自己的
    await page.goto(`#/score/${id}`);
    await expect(page.getByTestId('apply-synth-gu')).toBeEnabled();
    await expect(page.getByTestId('apply-synth-daluo')).toBeEnabled();
    await page.getByTestId('apply-synth-gu').click();
    await expect(page.getByTestId('apply-synth-gu')).toBeDisabled();
    await expect(page.getByTestId('apply-synth-daluo')).toBeEnabled(); // 大锣仍未套
    await page.waitForTimeout(600);
    let score = (await readScore(page, id)) as {
      instruments: { id: string; synth: { baseHz: number } }[];
    };
    expect(score.instruments.find((i) => i.id === 'gu')!.synth.baseHz).toBe(132);
    expect(score.instruments.find((i) => i.id === 'daluo')!.synth.baseHz).not.toBe(300);

    // 全部套用：大锣也更新
    await page.getByTestId('apply-synth-all').click();
    await expect(page.getByTestId('apply-synth-daluo')).toBeDisabled();
    await page.waitForTimeout(600);
    score = (await readScore(page, id)) as { instruments: { id: string; synth: { baseHz: number } }[] };
    expect(score.instruments.find((i) => i.id === 'daluo')!.synth.baseHz).toBe(300);

    // 单件恢复出厂：鼓的覆盖清掉，鼓行恢复按钮变灰；已套用到旧曲的值不回改
    await page.goto('#/settings');
    await expect(page.getByTestId('reset-synth-gu')).toBeEnabled();
    await page.getByTestId('reset-synth-gu').click();
    await expect(page.getByTestId('reset-synth-gu')).toBeDisabled();
    await expect(page.getByTestId('baseHz-gu')).toHaveValue('82');
    await expect(page.getByTestId('custom-gu')).toHaveCount(0);

    // 全部恢复：清空剩余覆盖（大锣）
    await expect(page.getByTestId('reset-all-synth')).toBeEnabled();
    await page.getByTestId('reset-all-synth').click();
    await expect(page.getByTestId('reset-all-synth')).toBeDisabled();
    await expect(page.getByTestId('baseHz-daluo')).toHaveValue('196');
    const settings = await readSettings(page);
    expect(settings.synthOverrides ?? {}).toEqual({});
  });
});

test.describe('性能', () => {
  test('验收：100 小节谱面滚动 ≥ 50fps', async ({ page }) => {
    await createEmptyScore(page, 'E2E 百小节');
    for (let i = 0; i < 24; i++) await page.getByRole('button', { name: '+4 小节' }).click(); // 4+96=100
    const bars = await page.locator('[data-testid^="grid-bar-"]').count();
    expect(bars).toBe(100);
    const fps = await page.evaluate(async () => {
      const scroller = document.querySelector('[data-testid="score-scroll"]') as HTMLElement;
      scroller.scrollLeft = 0;
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames += 1;
        scroller.scrollLeft = ((performance.now() - start) / 2000) * (scroller.scrollWidth - scroller.clientWidth);
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, 2100));
      return (frames / 2) * 1; // 帧/秒
    });
    console.log('滚动 fps =', fps);
    expect(fps).toBeGreaterThanOrEqual(50);
  });
});
