// 设置 /settings —— 乐器音色参数与键盘映射
import { useEffect, useState } from 'react';
import type { AppSettings, Instrument } from '../types';
import { useSettings } from '../settingsContext';
import { currentInstruments, isCustomized, parseSynthInput, synthLimit } from '../lib/synth';
import { saveSettings } from '../lib/storage';

/** 单个音色输入：本地草稿 + 就地校验；非法只提示不写入，失焦回退到已存值 */
function SynthCell({
  inst,
  field,
  value,
  step,
  onCommit,
}: {
  inst: Instrument;
  field: 'baseHz' | 'decay';
  value: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const limit = synthLimit(inst, field);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);

  // 外部值变化（恢复出厂、全部恢复）时同步；正在编辑不打断输入
  useEffect(() => {
    if (!focused) setDraft(String(value));
    // 错误信息在输入时即时维护，这里不覆盖（避免焦点未更新时清错）
  }, [value, focused]);

  const onChange = (raw: string) => {
    setDraft(raw);
    const r = parseSynthInput(raw, limit, field);
    setError(r.ok ? '' : r.error);
    if (r.ok) onCommit(r.value); // 合法值立即写入设置并落盘；非法只提示
  };

  return (
    <div className="synth-cell">
      <input
        type="text"
        inputMode="decimal"
        className={error ? 'synth-input invalid' : 'synth-input'}
        data-testid={`${field}-${inst.id}`}
        aria-invalid={error ? true : undefined}
        value={draft}
        step={step}
        title={`允许范围 ${limit.min}–${limit.max} ${field === 'baseHz' ? 'Hz' : 's'}`}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (error) {
            // 失焦时若仍非法，就地回退到最近一次已存值（先清错，避免 effect 用过期焦点态）
            setError('');
            setDraft(String(value));
          }
        }}
      />
      {error && (
        <span className="synth-error" data-testid={`${field}-${inst.id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Settings() {
  const { s, replaceSettings, setShowHighlight, setStretch, setSynthValue, resetSynth, resetAllSynth } = useSettings();
  const [waiting, setWaiting] = useState<string | null>(null); // 等待按键的 binding key
  const [msg, setMsg] = useState('');

  const instruments = currentInstruments(s.synthOverrides);
  const customCount = instruments.filter((i) => isCustomized(i.id, s.synthOverrides)).length;

  const rebind = (e: KeyboardEvent) => {
    e.preventDefault();
    if (!waiting) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      setWaiting(null);
      return;
    }
    // 防冲突：一个键只映射一个字；移动而非复制 —— 移除目标键与新键的旧绑定
    const keyMap = s.keyMap.filter((b) => b.key !== key && b.key !== waiting);
    const target = s.keyMap.find((b) => b.key === waiting);
    if (target) keyMap.push({ ...target, key });
    const next: AppSettings = { ...s, keyMap };
    replaceSettings(next);
    saveSettings(next).then(() => {
      setWaiting(null);
      setMsg(`已绑定 ${key}`);
    });
  };

  useEffect(() => {
    if (waiting) {
      window.addEventListener('keydown', rebind, { once: false });
      return () => window.removeEventListener('keydown', rebind);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, s]);

  return (
    <div className="page" data-testid="settings-page">
      <h1>设置</h1>

      <h2>试听</h2>
      <label className="dim block">
        <input type="checkbox" data-testid="chk-show-highlight" checked={s.showHighlight} onChange={(e) => setShowHighlight(e.target.checked)} />
        试听时高亮当前拍
      </label>
      <label className="dim block">
        散板近似伸缩 {s.currentBeatStretch.toFixed(2)}×
        <input
          type="range"
          data-testid="rng-stretch"
          min={0.5}
          max={2}
          step={0.05}
          value={s.currentBeatStretch}
          onChange={(e) => setStretch(Number(e.target.value))}
        />
      </label>

      <h2>键盘映射（字母 → 拟音字）</h2>
      <p className="dim">点击「改」后按下新键；Esc 取消。同一键只能映射一个字。</p>
      <table className="list" data-testid="keymap-table">
        <thead>
          <tr>
            <th>按键</th>
            <th>乐器</th>
            <th>拟音字</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {s.keyMap.map((b) => {
            const inst = instruments.find((i) => i.id === b.instrumentId);
            const glyph = inst?.glyphs[b.glyphIndex] ?? '—';
            return (
              <tr key={`${b.instrumentId}-${b.glyphIndex}`} className={waiting === b.key ? 'waiting' : ''}>
                <td>
                  <kbd>{b.key}</kbd>
                </td>
                <td>{inst?.name ?? b.instrumentId}</td>
                <td>{glyph}</td>
                <td>
                  <button className="mini" data-testid={`rebind-${b.key}`} onClick={() => setWaiting(b.key)}>
                    改
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {msg && <p className="dim" data-testid="rebind-msg">{msg}</p>}

      <h2>乐器音色（合成参数）</h2>
      <p className="dim">
        改动即时存入本浏览器并用于之后新建/载入的曲目；已存在的曲目需在编辑器里点「套用当前音色」才会更新。
      </p>
      <table className="list" data-testid="synth-table">
        <thead>
          <tr>
            <th>乐器</th>
            <th>类型</th>
            <th>基频 Hz</th>
            <th>衰减 s</th>
            <th>噪声</th>
            <th className="synth-actions-col">
              出厂值
              <button
                className="mini"
                data-testid="reset-all-synth"
                disabled={customCount === 0}
                onClick={() => {
                  resetAllSynth();
                  setMsg('全部乐器音色已恢复出厂值');
                }}
              >
                全部恢复
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {instruments.map((inst) => {
            const customized = isCustomized(inst.id, s.synthOverrides);
            return (
              <tr key={inst.id} data-testid={`synth-row-${inst.id}`}>
                <td style={{ color: inst.color, fontWeight: 700 }}>
                  {inst.name}
                  {customized && (
                    <span className="custom-badge" data-testid={`custom-${inst.id}`} title="已偏离出厂值">
                      自定义
                    </span>
                  )}
                </td>
                <td>{inst.synth.type}</td>
                <td>
                  <SynthCell
                    inst={inst}
                    field="baseHz"
                    value={inst.synth.baseHz}
                    step={1}
                    onCommit={(v) => setSynthValue(inst.id, 'baseHz', v)}
                  />
                </td>
                <td>
                  <SynthCell
                    inst={inst}
                    field="decay"
                    value={inst.synth.decay}
                    step={0.01}
                    onCommit={(v) => setSynthValue(inst.id, 'decay', v)}
                  />
                </td>
                <td>{inst.synth.noise ? '有' : '无'}</td>
                <td>
                  <button
                    className="mini danger"
                    data-testid={`reset-synth-${inst.id}`}
                    disabled={!customized}
                    title="把这件乐器的基频与衰减恢复成出厂值"
                    onClick={() => {
                      resetSynth(inst.id);
                      setMsg(`「${inst.name}」音色已恢复出厂值`);
                    }}
                  >
                    恢复
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
