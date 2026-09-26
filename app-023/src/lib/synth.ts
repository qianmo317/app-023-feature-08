// 乐器音色（基频/衰减）：允许范围、输入校验、出厂值与用户覆盖值的合并/套用
// 覆盖值只存用户改过的 baseHz/decay；未改的乐器始终取内置出厂值，恢复出厂即删掉覆盖项。
import type { Instrument, Score, Synth, SynthOverrides, SynthType } from '../types';
import { DEFAULT_INSTRUMENTS } from './factory';

export interface SynthLimit {
  baseHz: { min: number; max: number };
  decay: { min: number; max: number };
}

/** 各乐器允许的合成参数范围（按乐器 id 给出） */
const LIMITS_BY_ID: Record<string, SynthLimit> = {
  gu: { baseHz: { min: 30, max: 200 }, decay: { min: 0.05, max: 1.5 } }, // 鼓：低频、短衰减
  daluo: { baseHz: { min: 80, max: 600 }, decay: { min: 0.3, max: 3 } }, // 大锣：长余音
  xiaoluo: { baseHz: { min: 200, max: 1000 }, decay: { min: 0.1, max: 1.5 } }, // 小锣
  bo: { baseHz: { min: 150, max: 800 }, decay: { min: 0.2, max: 2.5 } }, // 钹
  bangzi: { baseHz: { min: 400, max: 2000 }, decay: { min: 0.02, max: 0.5 } }, // 梆子：高频、极短
  ban: { baseHz: { min: 300, max: 1600 }, decay: { min: 0.02, max: 0.6 } }, // 板
  ling: { baseHz: { min: 600, max: 2400 }, decay: { min: 0.1, max: 2 } }, // 铃
};

/** 未知乐器（曲目数据里多出来的）按合成类型给兜底范围 */
const LIMITS_BY_TYPE: Record<SynthType, SynthLimit> = {
  drum: { baseHz: { min: 30, max: 300 }, decay: { min: 0.03, max: 2 } },
  metal: { baseHz: { min: 60, max: 2400 }, decay: { min: 0.05, max: 3 } },
  wood: { baseHz: { min: 200, max: 2400 }, decay: { min: 0.02, max: 1 } },
};

/** 取某乐器某字段允许范围：优先按 id，未知乐器按合成类型兜底 */
export function synthLimit(inst: Instrument | SynthType, field: 'baseHz' | 'decay'): { min: number; max: number } {
  const id = typeof inst === 'string' ? undefined : inst.id;
  const type = typeof inst === 'string' ? inst : inst.synth.type;
  const limit = (id && LIMITS_BY_ID[id]) || LIMITS_BY_TYPE[type];
  return limit[field];
}

/**
 * 校验一处音色输入（就地提示用）。
 * 空值、字母等非数字、负数/零、超出该乐器允许范围都判非法；通过则返回数值。
 */
export function parseSynthInput(raw: string, limit: { min: number; max: number }, field: 'baseHz' | 'decay'):
  | { ok: true; value: number }
  | { ok: false; error: string } {
  const text = raw.trim();
  const label = field === 'baseHz' ? '基频' : '衰减';
  const unit = field === 'baseHz' ? 'Hz' : 's';
  if (text === '') return { ok: false, error: `${label}不能为空` };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { ok: false, error: `${label}必须是数字` };
  const v = Number(text);
  if (!Number.isFinite(v)) return { ok: false, error: `${label}必须是数字` };
  if (v <= 0) return { ok: false, error: `${label}必须大于 0` };
  if (v < limit.min || v > limit.max) {
    return { ok: false, error: `${label}允许范围 ${limit.min}–${limit.max} ${unit}` };
  }
  return { ok: true, value: v };
}

/** 出厂乐器 + 用户覆盖 → 生效乐器（深拷贝，改它不会动内置数据） */
export function currentInstruments(overrides: SynthOverrides): Instrument[] {
  return DEFAULT_INSTRUMENTS.map((def) => {
    const ov = overrides[def.id];
    if (!ov) return structuredClone(def);
    return { ...structuredClone(def), synth: { ...def.synth, ...ov } };
  });
}

/** 该乐器是否有用户自定义音色 */
export function isCustomized(instId: string, overrides: SynthOverrides): boolean {
  const ov = overrides[instId];
  return !!ov && Object.keys(ov).length > 0;
}

/** 单字段写入覆盖值（调用方已保证 value 通过范围校验） */
export function withSynthValue(
  overrides: SynthOverrides,
  instId: string,
  field: 'baseHz' | 'decay',
  value: number,
): SynthOverrides {
  return { ...overrides, [instId]: { ...overrides[instId], [field]: value } };
}

/** 某乐器恢复出厂：清掉该乐器的覆盖项 */
export function withoutSynthOverride(overrides: SynthOverrides, instId: string): SynthOverrides {
  if (!(instId in overrides)) return overrides;
  const next = { ...overrides };
  delete next[instId];
  return next;
}

/**
 * 把当前设置音色套用到曲目（旧曲可选「套用当前/保留自己」的底层实现）。
 * 只搬 baseHz/decay；type/noise 等其余字段保留曲目自己的。
 * instIds 给空数组 = 全部乐器。
 */
export function applyCurrentSynth(score: Score, overrides: SynthOverrides, instIds: string[] = []): Score {
  const only = new Set(instIds);
  const instruments = score.instruments.map((inst) => {
    if (only.size > 0 && !only.has(inst.id)) return inst;
    const def = DEFAULT_INSTRUMENTS.find((d) => d.id === inst.id);
    if (!def) return inst; // 曲目自带的未知乐器：保留原样
    const synth: Synth = { ...def.synth, ...overrides[inst.id] };
    return { ...inst, synth: { ...inst.synth, baseHz: synth.baseHz, decay: synth.decay } };
  });
  return { ...score, instruments };
}

/** 曲目该乐器的音色是否与当前设置一致（决定编辑器「套用」按钮是否可用） */
export function synthDiffers(inst: Instrument, overrides: SynthOverrides): boolean {
  const def = DEFAULT_INSTRUMENTS.find((d) => d.id === inst.id);
  if (!def) return false;
  const cur = { ...def.synth, ...overrides[inst.id] };
  return inst.synth.baseHz !== cur.baseHz || inst.synth.decay !== cur.decay;
}
