// 音色设置用例 —— 范围校验、覆盖值合并、恢复出厂、向旧曲套用
import { describe, expect, it } from 'vitest';
import {
  applyCurrentSynth,
  currentInstruments,
  isCustomized,
  parseSynthInput,
  synthDiffers,
  synthLimit,
  withSynthValue,
  withoutSynthOverride,
} from '../src/lib/synth';
import { DEFAULT_INSTRUMENTS, newEmptyScore, scoreFromPattern, PATTERNS, defaultSettings } from '../src/lib/factory';
import type { Instrument, SynthOverrides } from '../src/types';

const gu = DEFAULT_INSTRUMENTS.find((i) => i.id === 'gu')!;
const guHz = synthLimit(gu, 'baseHz');
const guDecay = synthLimit(gu, 'decay');

describe('允许范围', () => {
  it('内置出厂值全部落在各自乐器允许范围内', () => {
    for (const inst of DEFAULT_INSTRUMENTS) {
      const hz = synthLimit(inst, 'baseHz');
      const dec = synthLimit(inst, 'decay');
      expect(inst.synth.baseHz).toBeGreaterThanOrEqual(hz.min);
      expect(inst.synth.baseHz).toBeLessThanOrEqual(hz.max);
      expect(inst.synth.decay).toBeGreaterThanOrEqual(dec.min);
      expect(inst.synth.decay).toBeLessThanOrEqual(dec.max);
    }
  });

  it('未知乐器按合成类型给兜底范围', () => {
    const alien: Instrument = {
      id: 'alien',
      name: '未知',
      glyphs: ['x'],
      synth: { type: 'wood', baseHz: 500, decay: 0.1, noise: false },
    };
    expect(synthLimit(alien, 'baseHz').max).toBe(synthLimit('wood', 'baseHz').max);
    expect(synthLimit(alien, 'decay').min).toBe(synthLimit('wood', 'decay').min);
  });
});

describe('parseSynthInput 就地校验', () => {
  it('合法数字通过', () => {
    expect(parseSynthInput('120', guHz, 'baseHz')).toEqual({ ok: true, value: 120 });
    expect(parseSynthInput('0.5', guDecay, 'decay')).toEqual({ ok: true, value: 0.5 });
    expect(parseSynthInput(' 90 ', guHz, 'baseHz')).toEqual({ ok: true, value: 90 });
  });

  it('字母/非数字判非法', () => {
    const r = parseSynthInput('abc', guHz, 'baseHz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('数字');
    expect(parseSynthInput('12a', guHz, 'baseHz').ok).toBe(false);
  });

  it('空值判非法', () => {
    const r = parseSynthInput('   ', guHz, 'baseHz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('不能为空');
  });

  it('负数与零判非法（就地提示，不写入由调用方保证）', () => {
    const neg = parseSynthInput('-20', guHz, 'baseHz');
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.error).toContain('大于 0');
    const zero = parseSynthInput('0', guHz, 'baseHz');
    expect(zero.ok).toBe(false);
  });

  it('超出乐器允许范围判非法并带范围提示', () => {
    const tooLow = parseSynthInput('10', guHz, 'baseHz'); // 鼓下限 30
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.error).toContain('允许范围');
    const tooHigh = parseSynthInput('99999', guHz, 'baseHz');
    expect(tooHigh.ok).toBe(false);
  });

  it('同一数值对不同乐器范围不同（梆子里 880 合法、鼓非法）', () => {
    const bangzi = DEFAULT_INSTRUMENTS.find((i) => i.id === 'bangzi')!;
    expect(parseSynthInput('880', synthLimit(bangzi, 'baseHz'), 'baseHz').ok).toBe(true);
    expect(parseSynthInput('880', guHz, 'baseHz').ok).toBe(false);
  });
});

describe('覆盖值合并与恢复出厂', () => {
  it('无覆盖时 currentInstruments 等于出厂深拷贝', () => {
    const list = currentInstruments({});
    expect(list.length).toBe(DEFAULT_INSTRUMENTS.length);
    expect(list.find((i) => i.id === 'gu')!.synth.baseHz).toBe(gu.synth.baseHz);
    // 深拷贝：改结果不影响内置数据
    list[0].synth.baseHz = 1;
    expect(DEFAULT_INSTRUMENTS[0].synth.baseHz).not.toBe(1);
  });

  it('只覆盖被改过的字段，其余取出厂值', () => {
    const ov: SynthOverrides = { gu: { baseHz: 110 } };
    const list = currentInstruments(ov);
    const g = list.find((i) => i.id === 'gu')!;
    expect(g.synth.baseHz).toBe(110);
    expect(g.synth.decay).toBe(gu.synth.decay);
    expect(g.synth.type).toBe(gu.synth.type);
  });

  it('withSynthValue 同乐器两字段可累积', () => {
    let ov = withSynthValue({}, 'gu', 'baseHz', 100);
    ov = withSynthValue(ov, 'gu', 'decay', 0.5);
    expect(ov.gu).toEqual({ baseHz: 100, decay: 0.5 });
    expect(isCustomized('gu', ov)).toBe(true);
    expect(isCustomized('daluo', ov)).toBe(false);
  });

  it('withoutSynthOverride 恢复单件乐器出厂；删不存在的键返回原对象', () => {
    const ov: SynthOverrides = { gu: { baseHz: 100 }, bo: { decay: 1 } };
    const next = withoutSynthOverride(ov, 'gu');
    expect(next.gu).toBeUndefined();
    expect(next.bo).toEqual({ decay: 1 });
    expect(withoutSynthOverride(ov, 'ling')).toBe(ov);
  });

  it('defaultSettings 初始无任何音色覆盖', () => {
    expect(defaultSettings().synthOverrides).toEqual({});
  });
});

describe('新曲携带当前音色', () => {
  it('newEmptyScore / scoreFromPattern 拿到的是覆盖后的独立快照', () => {
    const ov: SynthOverrides = { gu: { baseHz: 111, decay: 0.33 } };
    const instruments = currentInstruments(ov);
    const empty = newEmptyScore('t', 4, 1, instruments);
    const pat = scoreFromPattern(PATTERNS[0], instruments);
    expect(empty.instruments.find((i) => i.id === 'gu')!.synth).toMatchObject({ baseHz: 111, decay: 0.33 });
    expect(pat.instruments.find((i) => i.id === 'gu')!.synth).toMatchObject({ baseHz: 111, decay: 0.33 });
  });
});

describe('旧曲逐条套用 / 保留', () => {
  it('不套用时曲目保留自己的音色', () => {
    const score = scoreFromPattern(PATTERNS[0]); // 出厂快照
    const origGu = score.instruments.find((i) => i.id === 'gu')!.synth.baseHz;
    const next = applyCurrentSynth(score, { daluo: { baseHz: 300 } }); // 只动大锣
    expect(next.instruments.find((i) => i.id === 'gu')!.synth.baseHz).toBe(origGu);
    expect(next.instruments.find((i) => i.id === 'daluo')!.synth.baseHz).toBe(300);
    expect(next.id).toBe(score.id); // 不改曲目身份
  });

  it('指定单件乐器只套用该件，其余保留', () => {
    const score = scoreFromPattern(PATTERNS[0]);
    const beforeDaluo = score.instruments.find((i) => i.id === 'daluo')!.synth.baseHz;
    const next = applyCurrentSynth(score, { gu: { baseHz: 120 }, daluo: { baseHz: 300 } }, ['gu']);
    expect(next.instruments.find((i) => i.id === 'gu')!.synth.baseHz).toBe(120);
    expect(next.instruments.find((i) => i.id === 'daluo')!.synth.baseHz).toBe(beforeDaluo);
  });

  it('空 instIds = 全部套用；只搬 baseHz/decay，type/noise 保留曲目自己的', () => {
    const score = scoreFromPattern(PATTERNS[0]);
    const guInst = score.instruments.find((i) => i.id === 'gu')!;
    const origType = guInst.synth.type;
    const origNoise = guInst.synth.noise;
    const next = applyCurrentSynth(score, { gu: { baseHz: 95, decay: 0.41 } });
    const g = next.instruments.find((i) => i.id === 'gu')!.synth;
    expect(g.baseHz).toBe(95);
    expect(g.decay).toBe(0.41);
    expect(g.type).toBe(origType);
    expect(g.noise).toBe(origNoise);
  });

  it('synthDiffers 正确反映曲目与当前设置的差异', () => {
    const score = scoreFromPattern(PATTERNS[0]);
    const guInst = score.instruments.find((i) => i.id === 'gu')!;
    expect(synthDiffers(guInst, {})).toBe(false); // 出厂 vs 出厂
    expect(synthDiffers(guInst, { gu: { baseHz: 77 } })).toBe(true);
    const applied = applyCurrentSynth(score, { gu: { baseHz: 77 } });
    expect(synthDiffers(applied.instruments.find((i) => i.id === 'gu')!, { gu: { baseHz: 77 } })).toBe(false);
  });

  it('曲目自带的未知乐器：套用跳过、differs 为 false', () => {
    const score = scoreFromPattern(PATTERNS[0]);
    const alien: Instrument = {
      id: 'alien',
      name: '外',
      glyphs: ['x'],
      synth: { type: 'wood', baseHz: 4321, decay: 0.19, noise: false },
    };
    score.instruments.push(alien);
    const next = applyCurrentSynth(score, { alien: { baseHz: 1 } });
    expect(next.instruments.find((i) => i.id === 'alien')!.synth.baseHz).toBe(4321);
    expect(synthDiffers(alien, { alien: { baseHz: 1 } })).toBe(false);
  });
});
