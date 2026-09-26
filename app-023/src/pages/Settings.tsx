// 设置 /settings —— 乐器音色参数与键盘映射
import { useEffect, useMemo, useState } from 'react';
import type { AppSettings } from '../types';
import { SYNTH_LIMITS } from '../types';
import { currentInstruments, parseSynthField } from '../lib/factory';
import { saveSettings } from '../lib/storage';
import { useSettings } from '../settingsContext';

/** 单个基频/衰减输入：非法输入就地提示且不写入，失焦回退到已保存值 */
function SynthField({
  instId,
  field,
  value,
  onCommit,
}: {
  instId: string;
  field: 'baseHz' | 'decay';
  value: number;
  onCommit: (v: number) => void;
}) {
  const fmt = (n: number) => (field === 'decay' ? String(n) : String(Math.round(n)));
  const [draft, setDraft] = useState(fmt(value));
  const [err, setErr] = useState('');

  // 已保存值在外部变化（恢复内置、跨标签页等）时同步输入框
  useEffect(() => {
    setDraft((d) => (parseSynthField(field, d) === value ? d : fmt(value)));
    setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const { min, max } = SYNTH_LIMITS[field];

  const commit = (raw: string) => {
    const v = parseSynthField(field, raw);
    if (v == null) {
      setErr(`需为 ${min}–${max} 的正数`);
      return false;
    }
    setErr('');
    onCommit(v);
    return true;
  };

  return (
    <span className="synth-field">
      <input
        type="text"
        inputMode="decimal"
        className={err ? 'invalid' : ''}
        aria-invalid={err ? true : undefined}
        data-testid={`${field}-${instId}`}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          commit(raw);
        }}
        onBlur={() => {
          // 非法输入不保留：失焦回退到已保存值并清除提示
          if (!commit(draft)) {
            setDraft(fmt(value));
            setErr('');
          }
        }}
      />
      {err && (
        <span className="field-err" data-testid={`${field}-${instId}-err`}>
          {err}
        </span>
      )}
    </span>
  );
}

export function Settings() {
  const { s, replaceSettings, setShowHighlight, setStretch, setSynth, resetSynth } = useSettings();
  const [waiting, setWaiting] = useState<string | null>(null); // 等待按键的 binding key
  const [msg, setMsg] = useState('');

  // 音色表 = 内置乐器 + 当前设置覆盖（离开再回来仍是改过的值）
  const instruments = useMemo(() => currentInstruments(s), [s]);
  const isCustom = (id: string) => !!s.synths?.[id];

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
        改动自动存入本浏览器并用于之后新建/载入的曲目；已存在曲目可在曲目列表或编辑器里逐条套用当前音色。
        基频 {SYNTH_LIMITS.baseHz.min}–{SYNTH_LIMITS.baseHz.max}Hz、衰减 {SYNTH_LIMITS.decay.min}–{SYNTH_LIMITS.decay.max}s，非法输入不保存。
      </p>
      <table className="list" data-testid="synth-table">
        <thead>
          <tr>
            <th>乐器</th>
            <th>类型</th>
            <th>基频 Hz</th>
            <th>衰减 s</th>
            <th>噪声</th>
            <th>音色</th>
          </tr>
        </thead>
        <tbody>
          {instruments.map((inst) => (
            <tr key={inst.id} data-testid={`synth-row-${inst.id}`}>
              <td style={{ color: inst.color, fontWeight: 700 }}>
                {inst.name}
                {isCustom(inst.id) && (
                  <i className="dim" data-testid={`custom-flag-${inst.id}`}> 已改</i>
                )}
              </td>
              <td>{inst.synth.type}</td>
              <td>
                <SynthField
                  instId={inst.id}
                  field="baseHz"
                  value={inst.synth.baseHz}
                  onCommit={(v) => setSynth(inst.id, { baseHz: v, decay: inst.synth.decay })}
                />
              </td>
              <td>
                <SynthField
                  instId={inst.id}
                  field="decay"
                  value={inst.synth.decay}
                  onCommit={(v) => setSynth(inst.id, { baseHz: inst.synth.baseHz, decay: v })}
                />
              </td>
              <td>{inst.synth.noise ? '有' : '无'}</td>
              <td>
                <button
                  className="mini"
                  data-testid={`reset-synth-${inst.id}`}
                  disabled={!isCustom(inst.id)}
                  title="恢复出厂音色"
                  onClick={() => {
                    resetSynth(inst.id);
                    setMsg(`「${inst.name}」已恢复内置音色`);
                  }}
                >
                  恢复内置
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
