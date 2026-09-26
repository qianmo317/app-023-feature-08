// 曲目列表 /
import { useEffect, useState } from 'react';
import type { Score } from '../types';
import { deleteScore, listScores, saveScore } from '../lib/storage';
import { applySynthsToScore, currentInstruments, newEmptyScore, PATTERNS } from '../lib/factory';
import { useSettings } from '../settingsContext';

export function ScoreList() {
  const { s } = useSettings();
  const [scores, setScores] = useState<Score[]>([]);
  const [title, setTitle] = useState('');
  const [bpb, setBpb] = useState(4);
  const [free, setFree] = useState(false);
  const [toast, setToast] = useState('');

  const refresh = () => listScores().then(setScores);
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    // 新曲携带设置页当前音色（未改过的乐器仍是出厂值）
    const score = newEmptyScore(title.trim() || '未命名锣鼓段', bpb, 4, currentInstruments(s));
    if (free) score.freeMeter = true;
    await saveScore(score);
    setTitle('');
    window.location.hash = `#/score/${score.id}`;
  };

  /** 已有曲目逐条套用当前音色；不套用则保留曲目自身音色 */
  const applySynths = async (score: Score) => {
    await saveScore(applySynthsToScore(score, s));
    await refresh();
    setToast(`「${score.title}」已套用当前音色`);
    window.setTimeout(() => setToast(''), 2500);
  };

  return (
    <div className="page" data-testid="score-list">
      <h1>曲目</h1>
      <div className="create-box">
        <input data-testid="new-title" placeholder="曲目名，如：开道锣" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select data-testid="new-bpb" value={bpb} onChange={(e) => setBpb(Number(e.target.value))}>
          <option value={2}>2/4</option>
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
        </select>
        <label className="dim">
          <input type="checkbox" data-testid="new-free" checked={free} onChange={(e) => setFree(e.target.checked)} />
          散板
        </label>
        <button className="btn primary" data-testid="btn-create" onClick={create}>
          新建空白谱
        </button>
        <button
          className="btn"
          data-testid="btn-from-library"
          onClick={() => (window.location.hash = '#/library')}
        >
          从曲牌库创建
        </button>
      </div>

      {toast && (
        <p className="toast" data-testid="apply-toast">
          {toast}
        </p>
      )}

      {scores.length === 0 ? (
        <p className="dim">还没有曲目。可新建空白谱，或从曲牌库载入「急急风」「四击头」等骨架再改。</p>
      ) : (
        <table className="list" data-testid="score-table">
          <thead>
            <tr>
              <th>曲名</th>
              <th>流派</th>
              <th>拍号</th>
              <th>小节</th>
              <th>BPM</th>
              <th>更新</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scores.map((sc) => (
              <tr key={sc.id} data-testid={`score-row-${sc.id}`}>
                <td>
                  <a href={`#/score/${sc.id}`} className="score-link">
                    {sc.title}
                  </a>
                </td>
                <td className="dim">{sc.style ?? '—'}</td>
                <td>{sc.freeMeter ? '散板' : `${sc.bars[0]?.beatsPerBar ?? 4}/4`}</td>
                <td>{sc.bars.length}</td>
                <td>{sc.bpm}</td>
                <td className="dim">{new Date(sc.updatedAt).toLocaleString('zh-CN')}</td>
                <td>
                  <button
                    className="mini"
                    data-testid={`apply-synths-${sc.id}`}
                    title="把设置页当前的基频/衰减套用到此曲"
                    onClick={() => applySynths(sc)}
                  >
                    套用当前音色
                  </button>
                  <a className="row-link" href={`#/score/${sc.id}/print`}>
                    打印
                  </a>
                  <button
                    className="mini danger"
                    data-testid={`del-${sc.id}`}
                    onClick={async () => {
                      if (confirm(`删除「${sc.title}」？`)) {
                        await deleteScore(sc.id);
                        void refresh();
                      }
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="dim">已有曲目保留各自音色，可逐条「套用当前音色」；新曲目自动携带设置页当前音色。内置曲牌：{PATTERNS.map((p) => p.name).join(' / ')}</p>
    </div>
  );
}
