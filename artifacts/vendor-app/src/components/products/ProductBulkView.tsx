import React from "react";
import { type TranslationKey } from "@workspace/i18n";
import { CARD, BTN_PRIMARY, BTN_SECONDARY, LABEL } from "../../lib/ui";

type BulkRow = { name: string; price: string; description: string; image: string; category: string; unit: string; stock: string; type: string };
type ImportResult = { name: string; status: "pending" | "success" | "error"; message?: string };

export interface ProductBulkViewProps {
  validRows: BulkRow[];
  bulkRows: BulkRow[];
  setBulkRows: React.Dispatch<React.SetStateAction<BulkRow[]>>;
  bulkCat: string;
  setBulkCat: (v: string) => void;
  catList: string[];
  currencySymbol: string;
  parseErrors: string[];
  setParseErrors: (v: string[]) => void;
  duplicateWarning: string[];
  setDuplicateWarning: (v: string[]) => void;
  bulkImportResults: ImportResult[] | null;
  setBulkImportResults: React.Dispatch<React.SetStateAction<ImportResult[] | null>>;
  bulkImporting: boolean;
  bulkImportProgress: { done: number; total: number } | null;
  setBulkImportProgress: React.Dispatch<React.SetStateAction<{ done: number; total: number } | null>>;
  allDataLoading: boolean;
  runBulkImport: () => void;
  setView: (v: "list" | "bulk") => void;
  pasteText: string;
  setPasteText: (v: string) => void;
  showPaste: boolean;
  setShowPaste: (v: boolean) => void;
  parsePaste: () => void;
  csvInputRef: React.RefObject<HTMLInputElement>;
  downloadSampleCsv: () => void;
  handleCsvImport: (file: File) => void;
  EMPTY_ROW: BulkRow;
  TYPES: string[];
  T: (key: TranslationKey) => string;
  Toast: React.ReactNode;
  PageHeader: React.ComponentType<{ title: string; subtitle?: string; actions?: React.ReactNode }>;
}

export function ProductBulkView({
  validRows, bulkRows, setBulkRows, bulkCat, setBulkCat, catList, currencySymbol,
  parseErrors, setParseErrors, duplicateWarning, setDuplicateWarning,
  bulkImportResults, setBulkImportResults, bulkImporting, bulkImportProgress, setBulkImportProgress,
  allDataLoading, runBulkImport, setView,
  pasteText, setPasteText, showPaste, setShowPaste, parsePaste,
  csvInputRef, downloadSampleCsv, handleCsvImport,
  EMPTY_ROW, TYPES, T, Toast, PageHeader,
}: ProductBulkViewProps) {
  const B_INPUT = "w-full h-9 px-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 text-xs";

  return (
    <div className="bg-gray-50 md:bg-transparent">
      <PageHeader title={T("bulkAdd")} subtitle={`${validRows.length} ${T("readyToAdd")}`}
        actions={
          <div className="flex gap-2">
            <button onClick={downloadSampleCsv} className="h-10 px-3 bg-white/20 md:bg-blue-50 md:text-blue-600 text-white font-bold rounded-xl text-xs android-press min-h-0">⬇ Sample CSV</button>
            <button onClick={() => setView("list")} className="h-10 px-4 bg-white/20 md:bg-gray-100 md:text-gray-700 text-white font-bold rounded-xl text-sm android-press min-h-0">← Back</button>
          </div>
        }
      />
      <div className="px-4 py-4 space-y-4 md:px-0 md:py-4">
        <div className={`${CARD} p-4`}>
          <div className="md:grid md:grid-cols-3 md:gap-4 space-y-3 md:space-y-0">
            <div>
              <label className={LABEL}>Default Category (for all rows)</label>
              <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400">
                <option value="">— applies per row if set —</option>
                {catList.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
            </div>
            <div className="flex gap-2 items-end">
              <button onClick={() => setBulkRows(r => [...r, {...EMPTY_ROW}])} className="flex-1 h-10 border-2 border-dashed border-orange-300 text-orange-500 font-bold rounded-xl text-sm android-press">+ Add Row</button>
              <button onClick={() => setBulkRows(r => [...r, {...EMPTY_ROW},{...EMPTY_ROW},{...EMPTY_ROW},{...EMPTY_ROW},{...EMPTY_ROW}])} className="flex-1 h-10 border-2 border-dashed border-gray-200 text-gray-500 font-bold rounded-xl text-sm android-press">+5 Rows</button>
            </div>
            <div className="flex gap-2 items-end">
              <button onClick={() => setShowPaste(!showPaste)} className="flex-1 h-10 bg-blue-50 text-blue-600 font-bold rounded-xl text-sm android-press">📋 Paste Data</button>
              <label className="flex-1 h-10 bg-green-50 text-green-700 font-bold rounded-xl text-sm android-press flex items-center justify-center cursor-pointer">
                📂 Import CSV
                <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) handleCsvImport(file); e.target.value = ""; }}/>
              </label>
              <button onClick={() => setBulkRows([{...EMPTY_ROW},{...EMPTY_ROW},{...EMPTY_ROW}])} className="h-10 px-3 bg-red-50 text-red-500 font-bold rounded-xl text-sm android-press">Clear</button>
            </div>
          </div>
          {showPaste && (
            <div className="mt-4 p-4 bg-blue-50 rounded-2xl space-y-3">
              <div>
                <p className="text-sm font-bold text-blue-800 mb-1">📋 Paste from Spreadsheet</p>
                <p className="text-xs text-blue-600 mb-2">Format: <span className="font-mono bg-white px-1 rounded">Name | Price | Description | Image URL | Category | Unit | Stock</span> (tab or comma separated)</p>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4} placeholder={"Chicken Biryani\t350\tDelicious rice dish\t\tfood\tpcs\t50\nVegetable Pulao\t280\t\t\tfood"} className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl text-xs font-mono focus:outline-none focus:border-blue-400 resize-none"/>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowPaste(false)} className="flex-1 h-9 border border-blue-200 text-blue-500 font-bold rounded-xl text-sm android-press min-h-0">Cancel</button>
                <button onClick={parsePaste} disabled={!pasteText.trim()} className="flex-1 h-9 bg-blue-500 text-white font-bold rounded-xl text-sm android-press min-h-0">Parse & Import</button>
              </div>
            </div>
          )}
          <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-2">
            <span className="text-base flex-shrink-0">ℹ️</span>
            <p className="text-xs text-blue-700">
              <span className="font-bold">CSV limit: 500 rows per file.</span> Uploads are automatically sent to the server in batches — no manual splitting needed. Sample CSV columns: <span className="font-mono bg-white px-1 rounded">name, price, stock, category, description, unit, type, image</span>.
            </p>
          </div>
          {duplicateWarning.length > 0 && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold text-amber-800">⚠️ {duplicateWarning.length} product name{duplicateWarning.length !== 1 ? "s" : ""} already exist in your catalogue</p>
                <button onClick={() => setDuplicateWarning([])} className="text-xs text-amber-500 hover:underline font-medium">Dismiss</button>
              </div>
              <ul className="space-y-0.5 mb-2 max-h-24 overflow-y-auto">{duplicateWarning.map((n, i) => <li key={i} className="text-xs text-amber-700 font-mono">• {n}</li>)}</ul>
              <p className="text-xs text-amber-600">Importing will create additional listings with these names.</p>
            </div>
          )}
          {parseErrors.length > 0 && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-bold text-red-700">⚠️ {parseErrors.length} row{parseErrors.length !== 1 ? "s" : ""} skipped — fix and re-upload to include them</p>
                <button onClick={() => setParseErrors([])} className="text-xs text-red-400 hover:underline">Dismiss</button>
              </div>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">{parseErrors.map((e, i) => <li key={i} className="text-xs text-red-600 font-mono">{e}</li>)}</ul>
            </div>
          )}
        </div>

        <div className={`${CARD} hidden md:block`}>
          <div className="text-[10px] text-gray-400 font-medium px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center gap-1"><span>↔</span><span>Scroll horizontally if columns are too narrow</span></div>
          <div className="overflow-x-auto">
            <div style={{ minWidth: "900px" }}>
              <div className="grid gap-1 px-3 py-2.5 bg-gray-50 border-b border-gray-100" style={{ gridTemplateColumns: "minmax(140px,2fr) minmax(80px,1fr) minmax(140px,2fr) minmax(120px,1.5fr) minmax(90px,1fr) minmax(60px,0.7fr) minmax(60px,0.7fr) minmax(60px,0.7fr) 32px" }}>
                {["Name *","Price *","Short Description","Image URL","Category","Unit","Stock","Type",""].map((h,i) => <p key={i} className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">{h}</p>)}
              </div>
              {bulkRows.map((row, i) => (
                <div key={i} className={`grid gap-1 px-2 py-1.5 border-b border-gray-50 last:border-0 ${!!(bulkRows[i]?.name && !bulkRows[i]?.price) ? "bg-red-50/30" : ""}`} style={{ gridTemplateColumns: "minmax(140px,2fr) minmax(80px,1fr) minmax(140px,2fr) minmax(120px,1.5fr) minmax(90px,1fr) minmax(60px,0.7fr) minmax(60px,0.7fr) minmax(60px,0.7fr) 32px" }}>
                  <input className={`${B_INPUT} ${!row.name && row.price ? "border-red-300 bg-red-50" : ""}`} value={row.name} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,name:e.target.value} : x))} placeholder="Product name *"/>
                  <input className={`${B_INPUT} ${row.name && !row.price ? "border-red-300 bg-red-50" : ""}`} type="number" inputMode="numeric" value={row.price} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,price:e.target.value} : x))} placeholder={`${currencySymbol} *`}/>
                  <input className={B_INPUT} value={row.description} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,description:e.target.value} : x))} placeholder="Short description"/>
                  <input className={B_INPUT} type="url" value={row.image} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,image:e.target.value} : x))} placeholder="https://img.url"/>
                  <select className={`${B_INPUT} appearance-none`} value={row.category} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,category:e.target.value} : x))}>
                    <option value="">{bulkCat || "category"}</option>
                    {catList.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className={B_INPUT} value={row.unit} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,unit:e.target.value} : x))} placeholder="kg/pcs"/>
                  <input className={B_INPUT} type="number" inputMode="numeric" value={row.stock} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,stock:e.target.value} : x))} placeholder="qty"/>
                  <select className={`${B_INPUT} appearance-none`} value={row.type || "mart"} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,type:e.target.value} : x))}>
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button onClick={() => setBulkRows(r => r.filter((_,j) => j!==i))} className="w-8 h-9 text-red-400 hover:text-red-600 font-bold flex items-center justify-center text-base min-h-0">✕</button>
                </div>
              ))}
              {bulkRows.length === 0 && <div className="px-4 py-8 text-center text-gray-400 text-sm">No rows yet — add rows or paste data above</div>}
            </div>
          </div>
        </div>

        <div className="md:hidden space-y-3">
          {bulkRows.map((row, i) => (
            <div key={i} className={`${CARD} p-4 space-y-2.5 border-2 ${row.name && row.price ? "border-orange-100" : "border-gray-100"}`}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Row {i+1} {row.name && row.price ? "✓" : ""}</p>
                <button onClick={() => setBulkRows(r => r.filter((_,j) => j!==i))} className="w-7 h-7 bg-red-50 text-red-500 rounded-lg font-bold text-sm min-h-0">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2"><p className="text-[10px] font-bold text-gray-400 mb-1">NAME *</p><input className={`${B_INPUT} h-10`} value={row.name} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,name:e.target.value} : x))} placeholder="Product name"/></div>
                <div><p className="text-[10px] font-bold text-gray-400 mb-1">PRICE ({currencySymbol}) *</p><input className={`${B_INPUT} h-10`} type="number" inputMode="numeric" value={row.price} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,price:e.target.value} : x))} placeholder="0"/></div>
                <div><p className="text-[10px] font-bold text-gray-400 mb-1">CATEGORY</p><select className={`${B_INPUT} h-10 appearance-none`} value={row.category} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,category:e.target.value} : x))}><option value="">{bulkCat || "select"}</option>{catList.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                <div className="col-span-2"><p className="text-[10px] font-bold text-gray-400 mb-1">SHORT DESCRIPTION</p><input className={`${B_INPUT} h-10`} value={row.description} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,description:e.target.value} : x))} placeholder="Brief product description"/></div>
                <div><p className="text-[10px] font-bold text-gray-400 mb-1">UNIT</p><input className={`${B_INPUT} h-10`} value={row.unit} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,unit:e.target.value} : x))} placeholder="kg/pcs/ltr"/></div>
                <div><p className="text-[10px] font-bold text-gray-400 mb-1">STOCK</p><input className={`${B_INPUT} h-10`} type="number" inputMode="numeric" value={row.stock} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,stock:e.target.value} : x))} placeholder="qty"/></div>
                <div className="col-span-2"><p className="text-[10px] font-bold text-gray-400 mb-1">TYPE</p><select className={`${B_INPUT} h-10 appearance-none`} value={row.type || "mart"} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,type:e.target.value} : x))}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div className="col-span-2"><p className="text-[10px] font-bold text-gray-400 mb-1">IMAGE URL</p><input className={`${B_INPUT} h-10`} type="url" value={row.image} onChange={e => setBulkRows(r => r.map((x,j) => j===i ? {...x,image:e.target.value} : x))} placeholder="https://"/></div>
              </div>
            </div>
          ))}
          {bulkRows.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">No rows yet — tap + Add Row or import CSV</div>}
        </div>

        {bulkImportResults ? (
          <div className={`${CARD} p-4 space-y-3`}>
            <p className="text-sm font-extrabold text-gray-800">Import Progress</p>
            {bulkImportProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{bulkImporting ? "Importing..." : "Complete"}</p>
                  <p className="text-sm font-extrabold text-orange-600 tabular-nums">{bulkImportProgress.done} / {bulkImportProgress.total}</p>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-400 rounded-full transition-all duration-300" style={{ width: `${(bulkImportProgress.done / bulkImportProgress.total) * 100}%` }}/>
                </div>
                {!bulkImporting && (() => {
                  const added = bulkImportResults.filter(r => r.status === "success").length;
                  const failed = bulkImportResults.filter(r => r.status === "error").length;
                  return <div className="flex gap-3 mt-2"><span className="text-xs font-bold text-green-600">✅ {added} added</span>{failed > 0 && <span className="text-xs font-bold text-red-500">❌ {failed} failed</span>}</div>;
                })()}
              </div>
            )}
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Row details</p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {bulkImportResults.map((r, i) => (
                <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm ${r.status === "success" ? "bg-green-50" : r.status === "error" ? "bg-red-50" : "bg-gray-50"}`}>
                  <span className="text-base flex-shrink-0">{r.status === "success" ? "✅" : r.status === "error" ? "❌" : <span className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin inline-block"/>}</span>
                  <span className="flex-1 font-medium text-gray-800 truncate">{r.name}</span>
                  {r.status === "error" && r.message && <span className="text-xs text-red-500 truncate max-w-[140px]" title={r.message}>{r.message}</span>}
                  {r.status === "success" && <span className="text-xs text-green-600 font-bold">Added</span>}
                  {r.status === "pending" && <span className="text-xs text-gray-400">Waiting…</span>}
                </div>
              ))}
            </div>
            {!bulkImporting && (
              <button onClick={() => { setBulkImportResults(null); setBulkImportProgress(null); setView("list"); setBulkRows([{...EMPTY_ROW},{...EMPTY_ROW},{...EMPTY_ROW}]); setBulkCat(""); }} className={`mt-3 ${BTN_PRIMARY}`}>
                ✓ Done — View Products
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={() => setView("list")} className={BTN_SECONDARY}>Cancel</button>
            <button onClick={runBulkImport} disabled={bulkImporting || validRows.length === 0 || allDataLoading} className={BTN_PRIMARY}>
              {allDataLoading ? "Checking limit..." : bulkImporting ? "Adding..." : `➕ Add ${validRows.length} Products`}
            </button>
          </div>
        )}
      </div>
      {Toast}
    </div>
  );
}
