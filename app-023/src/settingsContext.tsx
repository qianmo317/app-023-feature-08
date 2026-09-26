// 全局设置上下文：加载 IndexedDB（或默认），所有改动同步持久化
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSettings } from './types';
import { defaultSettings } from './lib/factory';
import { loadSettings, saveSettings } from './lib/storage';
import { withSynthValue, withoutSynthOverride } from './lib/synth';

interface Ctx {
  s: AppSettings;
  setShowHighlight: (v: boolean) => void;
  setStretch: (v: number) => void;
  replaceSettings: (s: AppSettings) => void;
  /** 改某乐器的基频/衰减（调用方保证 value 已通过范围校验），立即落盘 */
  setSynthValue: (instrumentId: string, field: 'baseHz' | 'decay', value: number) => void;
  /** 某乐器音色恢复出厂 */
  resetSynth: (instrumentId: string) => void;
  /** 全部乐器音色恢复出厂 */
  resetAllSynth: () => void;
}

const SettingsCtx = createContext<Ctx>({
  s: defaultSettings(),
  setShowHighlight: () => {},
  setStretch: () => {},
  replaceSettings: () => {},
  setSynthValue: () => {},
  resetSynth: () => {},
  resetAllSynth: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AppSettings>(defaultSettings());
  const ref = useRef(s);
  ref.current = s;

  useEffect(() => {
    loadSettings().then((loaded) => {
      if (loaded) {
        const merged: AppSettings = { ...defaultSettings(), ...loaded, synthOverrides: loaded.synthOverrides ?? {} };
        ref.current = merged;
        setS(merged);
      }
    });
  }, []);

  const commit = (next: AppSettings) => {
    ref.current = next;
    setS(next);
    void saveSettings(next);
  };
  const patch = (fn: (cur: AppSettings) => AppSettings) => commit(fn(ref.current));

  const setSynthValue = (instrumentId: string, field: 'baseHz' | 'decay', value: number) =>
    patch((cur) => ({ ...cur, synthOverrides: withSynthValue(cur.synthOverrides, instrumentId, field, value) }));
  const resetSynth = (instrumentId: string) =>
    patch((cur) => ({ ...cur, synthOverrides: withoutSynthOverride(cur.synthOverrides, instrumentId) }));
  const resetAllSynth = () => patch((cur) => ({ ...cur, synthOverrides: {} }));

  return (
    <SettingsCtx.Provider
      value={{
        s,
        setShowHighlight: (v) => patch((cur) => ({ ...cur, showHighlight: v })),
        setStretch: (v) => patch((cur) => ({ ...cur, currentBeatStretch: v })),
        replaceSettings: (next) => commit(next),
        setSynthValue,
        resetSynth,
        resetAllSynth,
      }}
    >
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings(): Ctx {
  return useContext(SettingsCtx);
}
