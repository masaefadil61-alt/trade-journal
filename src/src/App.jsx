import React, { useState, useEffect, useMemo, useRef } from 'react';
import { get, set } from 'idb-keyval';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import {
  Plus, X, TrendingUp, TrendingDown, Search, Camera, Trash2, Pencil,
  LayoutDashboard, List as ListIcon, Tag as TagIcon, ChevronDown,
  ArrowUpRight, ArrowDownRight, Loader2, ImageOff
} from 'lucide-react';

/* ---------------------------------------------------------------- */
/* Design tokens                                                     */
/* ---------------------------------------------------------------- */
const C = {
  bg: '#FFFFFF',
  surface: '#E8F8ED',
  surface2: '#DDF3E4',
  surface3: '#F2FBF5',
  border: '#B7E4C4',
  borderLight: '#8FD4A3',
  text: '#111111',
  textDim: '#33402F',
  textFaint: '#6B7B6E',
  profit: '#16A34A',
  profitDim: '#D1F2DC',
  loss: '#DC2626',
  lossDim: '#FBDCDC',
  amber: '#22A559',
  amberDim: '#D6F3E1',
};

const MARKETS = ['หุ้น', 'ฟอเร็กซ์', 'คริปโต', 'ฟิวเจอร์ส', 'ออปชัน', 'อื่นๆ'];
const EMOTIONS = ['สงบ', 'มั่นใจ', 'มีวินัย', 'กลัวตกรถ (FOMO)', 'กลัว', 'โลภ', 'ใจร้อน', 'ลังเล', 'แก้แค้นตลาด', 'มั่นใจเกินไป'];
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function calcPnl(t) {
  if (t.exitPrice === '' || t.exitPrice === null || t.exitPrice === undefined) return null;
  const dir = t.direction === 'short' ? -1 : 1;
  const entry = parseFloat(t.entryPrice) || 0;
  const exit = parseFloat(t.exitPrice) || 0;
  const qty = parseFloat(t.quantity) || 0;
  const fees = parseFloat(t.fees) || 0;
  return (exit - entry) * qty * dir - fees;
}

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return `${dt.getDate()} ${THAI_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const maxW = 900;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.62));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------------- */
/* Storage — IndexedDB ผ่าน idb-keyval (รันนอก claude.ai ได้)          */
/* ---------------------------------------------------------------- */
const STORAGE_KEY = 'journal-trades';

async function loadTrades() {
  try {
    const data = await get(STORAGE_KEY);
    return data || [];
  } catch (e) {
    console.error('โหลดข้อมูลไม่สำเร็จ', e);
    return [];
  }
}

async function saveTrades(trades) {
  try {
    await set(STORAGE_KEY, trades);
    return true;
  } catch (e) {
    console.error('บันทึกข้อมูลไม่สำเร็จ', e);
    return false;
  }
}

/* ---------------------------------------------------------------- */
/* Small building blocks                                             */
/* ---------------------------------------------------------------- */
function Pill({ children, tone = 'neutral', small }) {
  const map = {
    neutral: { bg: C.surface3, fg: C.textDim, bd: C.border },
    profit: { bg: C.profitDim, fg: C.profit, bd: C.profitDim },
    loss: { bg: C.lossDim, fg: C.loss, bd: C.lossDim },
    amber: { bg: C.amberDim, fg: C.amber, bd: C.amberDim },
  };
  const s = map[tone];
  return (
    <span
      style={{
        background: s.bg, color: s.fg, border: `1px solid ${s.bd}`,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
      className={`inline-flex items-center rounded-full ${small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'} font-medium tracking-wide`}
    >
      {children}
    </span>
  );
}

function StatCard({ label, value, tone, sub }) {
  const color = tone === 'profit' ? C.profit : tone === 'loss' ? C.loss : C.text;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="rounded-2xl p-4 flex flex-col gap-1 min-w-0">
      <span style={{ color: C.textFaint }} className="text-[10px] uppercase tracking-[0.14em] font-semibold">{label}</span>
      <span style={{ color, fontFamily: "'IBM Plex Mono', monospace" }} className="text-xl font-semibold truncate">{value}</span>
      {sub && <span style={{ color: C.textFaint }} className="text-[11px]">{sub}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Ticker tape — signature element                                   */
/* ---------------------------------------------------------------- */
function TickerTape({ trades }) {
  const closed = trades
    .filter((t) => calcPnl(t) !== null)
    .slice()
    .sort((a, b) => new Date(b.exitDate || b.entryDate) - new Date(a.exitDate || a.entryDate))
    .slice(0, 16);

  if (closed.length === 0) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="rounded-2xl px-4 py-3 text-center">
        <span style={{ color: C.textFaint, fontFamily: "'IBM Plex Mono', monospace" }} className="text-xs tracking-wide">
          แถบข่าวยังเงียบอยู่ — บันทึกเทรดแรกเพื่อเริ่มให้มันวิ่ง
        </span>
      </div>
    );
  }

  const items = [...closed, ...closed];

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="rounded-2xl overflow-hidden relative">
      <div className="ticker-track flex items-center gap-6 py-3 whitespace-nowrap">
        {items.map((t, i) => {
          const pnl = calcPnl(t);
          const up = pnl >= 0;
          return (
            <span key={i} className="inline-flex items-center gap-1.5" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              <span style={{ color: C.text }} className="text-xs font-semibold">{t.symbol || '—'}</span>
              {up ? <ArrowUpRight size={12} color={C.profit} /> : <ArrowDownRight size={12} color={C.loss} />}
              <span style={{ color: up ? C.profit : C.loss }} className="text-xs">{fmtMoney(pnl)}</span>
              <span style={{ color: C.textFaint }} className="text-xs">·</span>
            </span>
          );
        })}
      </div>
      <style>{`
        .ticker-track { animation: tickerScroll 38s linear infinite; width: max-content; }
        @keyframes tickerScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .ticker-track { animation: none; } }
      `}</style>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Dashboard                                                          */
/* ---------------------------------------------------------------- */
function Dashboard({ trades }) {
  const closed = trades.filter((t) => calcPnl(t) !== null);
  const wins = closed.filter((t) => calcPnl(t) > 0);
  const losses = closed.filter((t) => calcPnl(t) < 0);
  const totalPnl = closed.reduce((s, t) => s + calcPnl(t), 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + calcPnl(t), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + calcPnl(t), 0) / losses.length : 0;
  const grossWin = wins.reduce((s, t) => s + calcPnl(t), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + calcPnl(t), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const openCount = trades.length - closed.length;

  const equityData = useMemo(() => {
    const sorted = closed.slice().sort((a, b) => new Date(a.exitDate || a.entryDate) - new Date(b.exitDate || b.entryDate));
    let cum = 0;
    return sorted.map((t, i) => {
      cum += calcPnl(t);
      return { i: i + 1, cum: Number(cum.toFixed(2)), label: t.symbol };
    });
  }, [closed]);

  const tagData = useMemo(() => {
    const map = {};
    closed.forEach((t) => {
      (t.strategyTags || []).forEach((tag) => {
        map[tag] = (map[tag] || 0) + calcPnl(t);
      });
    });
    return Object.entries(map)
      .map(([tag, pnl]) => ({ tag, pnl: Number(pnl.toFixed(2)) }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 8);
  }, [closed]);

  return (
    <div className="flex flex-col gap-5">
      <TickerTape trades={trades} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="กำไร/ขาดทุนรวม" value={fmtMoney(totalPnl)} tone={totalPnl >= 0 ? 'profit' : 'loss'} sub={`ปิดแล้ว ${closed.length} เทรด`} />
        <StatCard label="อัตราชนะ" value={closed.length ? `${winRate.toFixed(0)}%` : '—'} sub={`ชนะ ${wins.length} / แพ้ ${losses.length}`} />
        <StatCard label="Profit Factor" value={closed.length ? (profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)) : '—'} />
        <StatCard label="โพซิชันที่เปิดอยู่" value={openCount} tone={openCount > 0 ? 'amber' : undefined} />
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="rounded-2xl p-4">
        <h3 style={{ color: C.text }} className="text-sm font-semibold mb-3">กราฟเส้นทุน (Equity Curve)</h3>
        {equityData.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={equityData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.amber} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.border} vertical={false} />
              <XAxis dataKey="i" tick={{ fill: C.textFaint, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.textFaint, fontSize: 10 }} axisLine={false} tickLine={false} width={50} />
              <ReferenceLine y={0} stroke={C.borderLight} />
              <Tooltip
                contentStyle={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: C.textDim }}
                itemStyle={{ color: C.amber }}
                formatter={(v) => [fmtMoney(v), 'สะสม']}
                labelFormatter={(l) => `เทรดที่ #${l}`}
              />
              <Area type="monotone" dataKey="cum" stroke={C.amber} strokeWidth={2} fill="url(#eq)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: C.textFaint }} className="text-xs py-8 text-center">ปิดอย่างน้อย 2 เทรดเพื่อดูกราฟเส้นทุน</p>
        )}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="rounded-2xl p-4">
        <h3 style={{ color: C.text }} className="text-sm font-semibold mb-3">กำไร/ขาดทุนแยกตามแท็กกลยุทธ์</h3>
        {tagData.length ? (
          <ResponsiveContainer width="100%" height={Math.max(140, tagData.length * 34)}>
            <BarChart data={tagData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: C.textFaint, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis type="category" dataKey="tag" tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
              <Tooltip
                contentStyle={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }}
                formatter={(v) => [fmtMoney(v), 'กำไร/ขาดทุน']}
                cursor={{ fill: C.surface3 }}
              />
              <Bar dataKey="pnl" radius={[0, 6, 6, 0]}>
                {tagData.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? C.profit : C.loss} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: C.textFaint }} className="text-xs py-8 text-center">ใส่แท็กกลยุทธ์ให้เทรดของคุณเพื่อดูข้อมูลนี้</p>
        )}
      </div>

      {(avgWin || avgLoss) ? (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="กำไรเฉลี่ย" value={fmtMoney(avgWin)} tone="profit" />
          <StatCard label="ขาดทุนเฉลี่ย" value={fmtMoney(avgLoss)} tone="loss" />
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Trade Form                                                         */
/* ---------------------------------------------------------------- */
const emptyTrade = () => ({
  id: null,
  symbol: '',
  market: 'หุ้น',
  direction: 'long',
  entryDate: new Date().toISOString().slice(0, 10),
  entryPrice: '',
  quantity: '',
  exitDate: '',
  exitPrice: '',
  fees: '',
  strategyTags: [],
  emotionBefore: '',
  emotionAfter: '',
  notes: '',
  lesson: '',
  screenshot: null,
});

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span style={{ color: C.textFaint }} className="text-[11px] uppercase tracking-wide font-semibold">{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: C.surface3,
  border: `1px solid ${C.border}`,
  color: C.text,
  fontFamily: "'IBM Plex Mono', monospace",
};

function TradeFormModal({ initial, allTags, onSave, onClose }) {
  const [t, setT] = useState(initial);
  const [tagInput, setTagInput] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  const fileRef = useRef(null);

  const set = (k, v) => setT((p) => ({ ...p, [k]: v }));

  const addTag = (raw) => {
    const tag = raw.trim();
    if (!tag) return;
    if (!t.strategyTags.includes(tag)) set('strategyTags', [...t.strategyTags, tag]);
    setTagInput('');
  };
  const removeTag = (tag) => set('strategyTags', t.strategyTags.filter((x) => x !== tag));

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgBusy(true);
    try {
      const dataUrl = await compressImage(file);
      set('screenshot', dataUrl);
    } catch (err) {
      // silently ignore bad image
    }
    setImgBusy(false);
  };

  const canSave = t.symbol.trim() && t.entryDate && t.entryPrice !== '' && t.quantity !== '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(4,5,8,0.7)' }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 style={{ color: C.text }} className="text-lg font-semibold">{t.id ? 'แก้ไขเทรด' : 'เพิ่มเทรดใหม่'}</h2>
          <button onClick={onClose} style={{ color: C.textFaint }} className="p-1"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="สัญลักษณ์">
            <input value={t.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())}
              placeholder="AAPL" style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none" />
          </Field>
          <Field label="ตลาด">
            <select value={t.market} onChange={(e) => set('market', e.target.value)} style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none">
              {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>

        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: C.border }}>
          {['long', 'short'].map((d) => (
            <button key={d} onClick={() => set('direction', d)}
              style={{
                background: t.direction === d ? (d === 'long' ? C.profitDim : C.lossDim) : C.surface3,
                color: t.direction === d ? (d === 'long' ? C.profit : C.loss) : C.textFaint,
              }}
              className="flex-1 py-2 text-sm font-semibold uppercase tracking-wide">{d === 'long' ? 'ซื้อ (Long)' : 'ขาย (Short)'}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="วันที่เข้า">
            <input type="date" value={t.entryDate} onChange={(e) => set('entryDate', e.target.value)} style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none" />
          </Field>
          <Field label="ราคาเข้า">
            <input type="number" step="any" value={t.entryPrice} onChange={(e) => set('entryPrice', e.target.value)} placeholder="0.00" style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none" />
          </Field>
          <Field label="จำนวน">
            <input type="number" step="any" value={t.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="0" style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none" />
          </Field>
          <Field label="ค่าธรรมเนียม">
            <input type="number" step="any" value={t.fees} onChange={(e) => set('fees', e.target.value)} placeholder="0.00" style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none" />
          </Field>
          <Field label="วันที่ออก">
            <input type="date" value={t.exitDate} onChange={(e) => set('exitDate', e.target.value)} style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none" />
          </Field>
          <Field label="ราคาออก">
            <input type="number" step="any" value={t.exitPrice} onChange={(e) => set('exitPrice', e.target.value)} placeholder="เว้นว่างถ้ายังไม่ปิด" style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none" />
          </Field>
        </div>

        <Field label="แท็กกลยุทธ์">
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {t.strategyTags.map((tag) => (
              <button key={tag} onClick={() => removeTag(tag)} className="inline-flex items-center gap-1">
                <Pill tone="amber" small>{tag} <X size={10} className="ml-0.5" /></Pill>
              </button>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); } }}
            placeholder="พิมพ์แท็กแล้วกด Enter (เช่น breakout, ตาม EMA)"
            style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none w-full"
          />
          {allTags.filter((tag) => !t.strategyTags.includes(tag)).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {allTags.filter((tag) => !t.strategyTags.includes(tag)).slice(0, 10).map((tag) => (
                <button key={tag} onClick={() => addTag(tag)} style={{ color: C.textFaint, border: `1px dashed ${C.border}` }} className="text-[11px] px-2 py-0.5 rounded-full">+ {tag}</button>
              ))}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="สภาพจิตใจก่อนเทรด">
            <select value={t.emotionBefore} onChange={(e) => set('emotionBefore', e.target.value)} style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none">
              <option value="">—</option>
              {EMOTIONS.map((em) => <option key={em} value={em}>{em}</option>)}
            </select>
          </Field>
          <Field label="สภาพจิตใจหลังเทรด">
            <select value={t.emotionAfter} onChange={(e) => set('emotionAfter', e.target.value)} style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none">
              <option value="">—</option>
              {EMOTIONS.map((em) => <option key={em} value={em}>{em}</option>)}
            </select>
          </Field>
        </div>

        <Field label="เหตุผลการเข้าเทรด">
          <textarea value={t.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="ทำไมถึงเข้าเทรดนี้?" style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none resize-none" />
        </Field>
        <Field label="บทเรียน / ทบทวน">
          <textarea value={t.lesson} onChange={(e) => set('lesson', e.target.value)} rows={2} placeholder="ครั้งหน้าจะทำอะไรต่างไปจากเดิม?" style={inputStyle} className="rounded-lg px-3 py-2 text-sm outline-none resize-none" />
        </Field>

        <Field label="สกรีนช็อต">
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          {t.screenshot ? (
            <div className="relative">
              <img src={t.screenshot} alt="chart" className="rounded-lg w-full max-h-48 object-cover" style={{ border: `1px solid ${C.border}` }} />
              <button onClick={() => set('screenshot', null)} style={{ background: C.bg, color: C.text }} className="absolute top-2 right-2 rounded-full p-1"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} style={{ border: `1px dashed ${C.border}`, color: C.textFaint }} className="rounded-lg py-6 flex flex-col items-center gap-1 text-xs">
              {imgBusy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              {imgBusy ? 'กำลังประมวลผล…' : 'แนบสกรีนช็อตกราฟ'}
            </button>
          )}
        </Field>

        <div className="flex gap-2 pt-1 sticky bottom-0" style={{ background: C.surface }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.border}`, color: C.textDim }} className="flex-1 rounded-xl py-2.5 text-sm font-semibold">ยกเลิก</button>
          <button
            disabled={!canSave}
            onClick={() => onSave({ ...t, id: t.id || uid() })}
            style={{ background: canSave ? C.amber : C.surface3, color: canSave ? C.bg : C.textFaint }}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
          >
            บันทึกเทรด
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Trade detail                                                       */
/* ---------------------------------------------------------------- */
function TradeDetailModal({ trade, onClose, onEdit, onDelete }) {
  const pnl = calcPnl(trade);
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(4,5,8,0.7)' }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace" }} className="text-xl font-semibold">{trade.symbol}</h2>
              <Pill tone={trade.direction === 'long' ? 'profit' : 'loss'} small>{trade.direction === 'long' ? 'ซื้อ' : 'ขาย'}</Pill>
            </div>
            <span style={{ color: C.textFaint }} className="text-xs">{trade.market} · {fmtDate(trade.entryDate)}{trade.exitDate ? ` → ${fmtDate(trade.exitDate)}` : ' · ยังเปิดอยู่'}</span>
          </div>
          <button onClick={onClose} style={{ color: C.textFaint }}><X size={20} /></button>
        </div>

        <div style={{ background: C.surface3, border: `1px solid ${C.border}` }} className="rounded-2xl p-4 flex items-center justify-between">
          <span style={{ color: C.textFaint }} className="text-xs uppercase tracking-wide">ผลลัพธ์</span>
          <span style={{ color: pnl === null ? C.textFaint : pnl >= 0 ? C.profit : C.loss, fontFamily: "'IBM Plex Mono', monospace" }} className="text-lg font-semibold">
            {pnl === null ? 'ยังเปิดโพซิชันอยู่' : fmtMoney(pnl)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span style={{ color: C.textFaint }} className="text-[11px] block uppercase">ราคาเข้า</span><span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}>{trade.entryPrice}</span></div>
          <div><span style={{ color: C.textFaint }} className="text-[11px] block uppercase">ราคาออก</span><span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}>{trade.exitPrice || '—'}</span></div>
          <div><span style={{ color: C.textFaint }} className="text-[11px] block uppercase">จำนวน</span><span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}>{trade.quantity}</span></div>
          <div><span style={{ color: C.textFaint }} className="text-[11px] block uppercase">ค่าธรรมเนียม</span><span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}>{trade.fees || 0}</span></div>
        </div>

        {trade.strategyTags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {trade.strategyTags.map((tag) => <Pill key={tag} tone="amber" small><TagIcon size={9} className="mr-1 inline" />{tag}</Pill>)}
          </div>
        )}

        {(trade.emotionBefore || trade.emotionAfter) && (
          <div className="flex gap-4 text-xs">
            {trade.emotionBefore && <span style={{ color: C.textDim }}>ก่อนเทรด: <b style={{ color: C.text }}>{trade.emotionBefore}</b></span>}
            {trade.emotionAfter && <span style={{ color: C.textDim }}>หลังเทรด: <b style={{ color: C.text }}>{trade.emotionAfter}</b></span>}
          </div>
        )}

        {trade.notes && (
          <div>
            <span style={{ color: C.textFaint }} className="text-[11px] uppercase block mb-1">เหตุผลการเข้าเทรด</span>
            <p style={{ color: C.textDim }} className="text-sm leading-relaxed">{trade.notes}</p>
          </div>
        )}
        {trade.lesson && (
          <div>
            <span style={{ color: C.textFaint }} className="text-[11px] uppercase block mb-1">บทเรียน / ทบทวน</span>
            <p style={{ color: C.textDim }} className="text-sm leading-relaxed">{trade.lesson}</p>
          </div>
        )}

        {trade.screenshot ? (
          <img src={trade.screenshot} alt="chart" className="rounded-xl w-full" style={{ border: `1px solid ${C.border}` }} />
        ) : (
          <div style={{ border: `1px dashed ${C.border}`, color: C.textFaint }} className="rounded-xl py-6 flex flex-col items-center gap-1 text-xs"><ImageOff size={16} /> ไม่มีสกรีนช็อตแนบมา</div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={() => onEdit(trade)} style={{ border: `1px solid ${C.border}`, color: C.textDim }} className="flex-1 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5"><Pencil size={14} /> แก้ไข</button>
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)} style={{ border: `1px solid ${C.lossDim}`, color: C.loss }} className="flex-1 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5"><Trash2 size={14} /> ลบ</button>
          ) : (
            <button onClick={() => onDelete(trade.id)} style={{ background: C.loss, color: C.bg }} className="flex-1 rounded-xl py-2.5 text-sm font-semibold">ยืนยันการลบ</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Trade log list                                                     */
/* ---------------------------------------------------------------- */
function TradeRow({ trade, onClick }) {
  const pnl = calcPnl(trade);
  return (
    <button onClick={onClick} style={{ background: C.surface, border: `1px solid ${C.border}` }} className="w-full text-left rounded-2xl p-3.5 flex items-center gap-3 active:scale-[0.99] transition-transform">
      <div style={{ background: pnl === null ? C.surface3 : pnl >= 0 ? C.profitDim : C.lossDim }} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
        {pnl === null ? <span style={{ color: C.amber }} className="text-[10px] font-bold">เปิด</span> : pnl >= 0 ? <TrendingUp size={18} color={C.profit} /> : <TrendingDown size={18} color={C.loss} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace" }} className="font-semibold text-sm">{trade.symbol}</span>
          <span style={{ color: C.textFaint }} className="text-[11px]">{trade.market}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
          <span style={{ color: C.textFaint }} className="text-[11px] shrink-0">{fmtDate(trade.entryDate)}</span>
          {trade.strategyTags?.slice(0, 2).map((tag) => (
            <span key={tag} style={{ color: C.textFaint }} className="text-[11px] truncate">#{tag}</span>
          ))}
        </div>
      </div>
      <span style={{ color: pnl === null ? C.textFaint : pnl >= 0 ? C.profit : C.loss, fontFamily: "'IBM Plex Mono', monospace" }} className="text-sm font-semibold shrink-0">
        {pnl === null ? '—' : fmtMoney(pnl)}
      </span>
    </button>
  );
}

function TradeLog({ trades, onOpen }) {
  const [search, setSearch] = useState('');
  const [market, setMarket] = useState('All');
  const [status, setStatus] = useState('All');
  const [showFilters, setShowFilters] = useState(false);

  const filtered = trades
    .filter((t) => t.symbol.toLowerCase().includes(search.toLowerCase()))
    .filter((t) => market === 'All' || t.market === market)
    .filter((t) => status === 'All' || (status === 'Open' ? calcPnl(t) === null : calcPnl(t) !== null))
    .sort((a, b) => new Date(b.entryDate) - new Date(a.entryDate));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div style={{ background: C.surface, border: `1px solid ${C.border}` }} className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2.5">
          <Search size={15} color={C.textFaint} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาสัญลักษณ์…" style={{ color: C.text, fontFamily: "'IBM Plex Mono', monospace" }} className="bg-transparent outline-none text-sm flex-1" />
        </div>
        <button onClick={() => setShowFilters((s) => !s)} style={{ background: showFilters ? C.amberDim : C.surface, border: `1px solid ${showFilters ? C.amber : C.border}`, color: showFilters ? C.amber : C.textDim }} className="rounded-xl px-3.5 flex items-center gap-1.5 text-sm">
          <ChevronDown size={15} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['All', ...MARKETS].map((m) => (
              <button key={m} onClick={() => setMarket(m)} style={{ background: market === m ? C.amber : C.surface3, color: market === m ? C.bg : C.textDim }} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0">{m === 'All' ? 'ทั้งหมด' : m}</button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {[{ v: 'All', l: 'ทั้งหมด' }, { v: 'Open', l: 'เปิดอยู่' }, { v: 'Closed', l: 'ปิดแล้ว' }].map(({ v, l }) => (
              <button key={v} onClick={() => setStatus(v)} style={{ background: status === v ? C.amber : C.surface3, color: status === v ? C.bg : C.textDim }} className="px-3 py-1.5 rounded-full text-xs font-medium">{l}</button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ border: `1px dashed ${C.border}`, color: C.textFaint }} className="rounded-2xl py-14 text-center text-sm">
          {trades.length === 0 ? 'ยังไม่มีเทรดที่บันทึกไว้ กดปุ่ม + เพื่อเพิ่มเทรดแรกของคุณ' : 'ไม่มีเทรดที่ตรงกับตัวกรอง'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((t) => <TradeRow key={t.id} trade={t} onClick={() => onOpen(t)} />)}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* App                                                                 */
/* ---------------------------------------------------------------- */
export default function App() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [formTrade, setFormTrade] = useState(null);
  const [detailTrade, setDetailTrade] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await loadTrades();
      setTrades(data);
      setLoading(false);
    })();
  }, []);

  const persist = async (next) => {
    setTrades(next);
    setSaving(true);
    await saveTrades(next);
    setSaving(false);
  };

  const allTags = useMemo(() => {
    const s = new Set();
    trades.forEach((t) => (t.strategyTags || []).forEach((tag) => s.add(tag)));
    return Array.from(s);
  }, [trades]);

  const handleSaveTrade = (trade) => {
    const exists = trades.some((t) => t.id === trade.id);
    const next = exists ? trades.map((t) => (t.id === trade.id ? trade : t)) : [trade, ...trades];
    persist(next);
    setFormTrade(null);
    setDetailTrade(null);
  };

  const handleDelete = (id) => {
    persist(trades.filter((t) => t.id !== id));
    setDetailTrade(null);
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif" }} className="pb-24">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
      `}</style>

      <header className="px-4 pt-6 pb-4 sticky top-0 z-30" style={{ background: `linear-gradient(${C.bg}, ${C.bg}ee 80%, transparent)` }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }} className="text-2xl font-bold tracking-tight">บันทึกเทรด</h1>
            <span style={{ color: C.textFaint }} className="text-xs">ทุกการเทรด ทุกเหตุผล ทุกบทเรียน</span>
          </div>
          {saving && <Loader2 size={16} className="animate-spin" color={C.textFaint} />}
        </div>

        <div style={{ background: C.surface2, border: `1px solid ${C.border}` }} className="flex rounded-xl p-1 gap-1">
          {[
            { key: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
            { key: 'log', label: 'รายการเทรด', icon: ListIcon },
          ].map(({ key, label, icon: Icon }) =
            { key: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
            { key: 'log', label: 'รายการเทรด', icon: ListIcon },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setView(key)}
              style={{ background: view === key ? C.amber : 'transparent', color: view === key ? C.bg : C.textDim }}
              className="flex-1 rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors">
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </header>

      <main className="px-4">
        {loading ? (
          <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin" color={C.textFaint} /></div>
        ) : view === 'dashboard' ? (
          <Dashboard trades={trades} />
        ) : (
          <TradeLog trades={trades} onOpen={setDetailTrade} />
        )}
      </main>

      <button
        onClick={() => setFormTrade(emptyTrade())}
        style={{ background: C.amber, color: C.bg }}
        className="fixed bottom-6 right-5 rounded-full w-14 h-14 flex items-center justify-center shadow-lg z-40"
      >
        <Plus size={26} />
      </button>

      {formTrade && (
        <TradeFormModal
          initial={formTrade}
          allTags={allTags}
          onClose={() => setFormTrade(null)}
          onSave={handleSaveTrade}
        />
      )}

      {detailTrade && !formTrade && (
        <TradeDetailModal
          trade={detailTrade}
          onClose={() => setDetailTrade(null)}
          onEdit={(t) => { setFormTrade(t); }}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
          }
