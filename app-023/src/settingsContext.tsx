// 全局设置上下文：加载 IndexedDB（或默认），所有写操作同步持久化
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppSettings } from './types';
import { defaultSettings, sanitizeSynths } from './lib/factory';
import { loadSettings, saveSettings } from './lib/storage';

interface Ctx {
  s: AppSettings;
  setShowHighlight: (v: boolean) => void;
  setStretch: (v: number) => void;
  replaceSettings: (s: AppSettings) => void;
  /** 写入单件乐器的基频/衰减覆盖 */
  setSynth: (id: string, patch: { baseHz: number; decay: number }) => void;
  /** 该乐器恢复出厂音色（移除覆盖） */
  resetSynth: (id: string) => void;
}

const SettingsCtx = createContext<Ctx>({
  s: defaultSettings(),
  setShowHighlight: () => {},
  setStretch: () => {},
  replaceSettings: () => {},
  setSynth: () => {},
  resetSynth: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AppSettings>(defaultSettings());
  useEffect(() => {
    loadSettings().then((loaded) => {
      if (loaded) setS({ ...defaultSettings(), ...loaded, synths: sanitizeSynths(loaded.synths) });
    });
  }, []);
  const persist = (next: AppSettings) => {
    setS(next);
    void saveSettings(next);
  };
  return (
    <SettingsCtx.Provider
      value={{
        s,
        setShowHighlight: (v) => persist({ ...s, showHighlight: v }),
        setStretch: (v) => persist({ ...s, currentBeatStretch: v }),
        replaceSettings: (next) => persist(next),
        setSynth: (id, patch) =>
          persist({ ...s, synths: { ...sanitizeSynths(s.synths), [id]: { ...patch } } }),
        resetSynth: (id) => {
          const synths = { ...sanitizeSynths(s.synths) };
          delete synths[id];
          persist({ ...s, synths });
        },
      }}
    >
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings(): Ctx {
  return useContext(SettingsCtx);
}
