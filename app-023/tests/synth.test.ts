// 乐器音色：解析/拦截、当前乐器合成、向已有曲目套用
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTRUMENTS,
  applySynthsToScore,
  currentInstruments,
  defaultSettings,
  newEmptyScore,
  parseSynthField,
  sanitizeSynths,
  scoreFromPattern,
  PATTERNS,
} from '../src/lib/factory';

describe('parseSynthField 非法输入就地拦截', () => {
  it('合法正数（含小数）通过', () => {
    expect(parseSynthField('baseHz', '100')).toBe(100);
    expect(parseSynthField('decay', '0.5')).toBe(0.5);
    expect(parseSynthField('baseHz', ' 82 ')).toBe(82);
  });
  it('字母/空串/负数/科学计数法全部拒绝', () => {
    expect(parseSynthField('baseHz', 'abc')).toBeNull();
    expect(parseSynthField('baseHz', '')).toBeNull();
    expect(parseSynthField('baseHz', '-5')).toBeNull();
    expect(parseSynthField('baseHz', '1e3')).toBeNull();
    expect(parseSynthField('decay', '-0.1')).toBeNull();
    expect(parseSynthField('decay', '0')).toBeNull();
  });
  it('超范围拒绝（基频 40–2400，衰减 0.03–3）', () => {
    expect(parseSynthField('baseHz', '39')).toBeNull();
    expect(parseSynthField('baseHz', '2401')).toBeNull();
    expect(parseSynthField('baseHz', '40')).toBe(40);
    expect(parseSynthField('baseHz', '2400')).toBe(2400);
    expect(parseSynthField('decay', '0.02')).toBeNull();
    expect(parseSynthField('decay', '3.5')).toBeNull();
    expect(parseSynthField('decay', '0.03')).toBe(0.03);
    expect(parseSynthField('decay', '3')).toBe(3);
  });
});

describe('sanitizeSynths 兜底', () => {
  it('丢弃越界与残缺，保留合法覆盖', () => {
    expect(
      sanitizeSynths({
        gu: { baseHz: 100, decay: 0.3 },
        bad: { baseHz: 5, decay: 0.22 }, // 基频越界
        bad2: { baseHz: 100, decay: 9 }, // 衰减越界
      }),
    ).toEqual({ gu: { baseHz: 100, decay: 0.3 } });
    expect(sanitizeSynths(undefined)).toEqual({});
  });
});

describe('currentInstruments 设置覆盖', () => {
  it('只改覆盖项，其余保持出厂', () => {
    const s = defaultSettings();
    const defGu = DEFAULT_INSTRUMENTS.find((i) => i.id === 'gu')!;
    s.synths = { gu: { baseHz: 101, decay: 0.33 } };
    const list = currentInstruments(s);
    const gu = list.find((i) => i.id === 'gu')!;
    expect(gu.synth.baseHz).toBe(101);
    expect(gu.synth.decay).toBe(0.33);
    expect(gu.synth.type).toBe(defGu.synth.type); // 未覆盖字段不变
    expect(gu.synth.noise).toBe(defGu.synth.noise);
    // 别的乐器保持内置
    const bo = list.find((i) => i.id === 'bo')!;
    const defBo = DEFAULT_INSTRUMENTS.find((i) => i.id === 'bo')!;
    expect(bo.synth).toEqual(defBo.synth);
  });
});

describe('新曲携带当前音色', () => {
  it('空白谱与曲牌载入均带改过的音色', () => {
    const s = defaultSettings();
    s.synths = { gu: { baseHz: 120, decay: 0.5 } };
    const empty = newEmptyScore('t', 4, 4, currentInstruments(s));
    expect(empty.instruments.find((i) => i.id === 'gu')!.synth.baseHz).toBe(120);
    const pat = scoreFromPattern(PATTERNS[0], currentInstruments(s));
    expect(pat.instruments.find((i) => i.id === 'gu')!.synth.decay).toBe(0.5);
  });
});

describe('applySynthsToScore 已有曲目逐条套用', () => {
  it('只覆盖设置中改过的乐器，其余曲目音色保留', () => {
    const score = scoreFromPattern(PATTERNS[0]);
    const origBo = score.instruments.find((i) => i.id === 'bo')!.synth;
    // 曲目自身的鼓被改过（模拟旧值）
    score.instruments = score.instruments.map((i) =>
      i.id === 'gu' ? { ...i, synth: { ...i.synth, baseHz: 70, decay: 0.1 } } : i,
    );
    const s = defaultSettings();
    s.synths = { gu: { baseHz: 150, decay: 0.4 } }; // 当前设置只改了鼓
    const next = applySynthsToScore(score, s);
    expect(next.instruments.find((i) => i.id === 'gu')!.synth.baseHz).toBe(150);
    expect(next.instruments.find((i) => i.id === 'gu')!.synth.decay).toBe(0.4);
    expect(next.instruments.find((i) => i.id === 'bo')!.synth).toEqual(origBo); // 保留
    expect(next.id).toBe(score.id);
    expect(next.bars).toBe(score.bars); // 谱面不动
  });

  it('原曲目不被就地修改', () => {
    const score = newEmptyScore('t');
    const s = defaultSettings();
    s.synths = { gu: { baseHz: 150, decay: 0.4 } };
    applySynthsToScore(score, s);
    expect(score.instruments.find((i) => i.id === 'gu')!.synth.baseHz).toBe(
      DEFAULT_INSTRUMENTS.find((i) => i.id === 'gu')!.synth.baseHz,
    );
  });

  it('设置里无任何覆盖时，曲目音色原样保留', () => {
    const score = scoreFromPattern(PATTERNS[0]);
    const before = JSON.stringify(score.instruments);
    const next = applySynthsToScore(score, defaultSettings());
    expect(JSON.stringify(next.instruments)).toBe(before);
  });
});
