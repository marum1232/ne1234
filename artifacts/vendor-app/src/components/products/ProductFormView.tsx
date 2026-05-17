import { type TranslationKey } from "@workspace/i18n";
import { ImageUploader } from "../ImageUploader";
import { CARD, INPUT, SELECT, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, LABEL } from "../../lib/ui";

interface FormState {
  name: string; description: string; price: string; originalPrice: string;
  category: string; unit: string; stock: string; image: string;
  type: string; videoUrl: string; tags: string; isHidden: boolean;
}

interface ProductFormViewProps {
  editProd: Record<string, unknown> | null;
  form: FormState;
  f: (k: string, v: unknown) => void;
  formErrors: { name?: string; price?: string; category?: string };
  validateForm: () => boolean;
  catList: string[];
  config: { uploads?: { allowedVideoFormats?: string[]; maxVideoMb?: number; maxVideoDurationSec?: number } };
  videoUploading: boolean;
  handleVideoUpload: (file: File) => void;
  allowedVideoFormats: string[];
  maxVideoMb: number;
  maxVideoDurationSec: number;
  editThreshold: string;
  setEditThreshold: (v: string) => void;
  lowStockThreshold: number;
  createMut: { mutate: () => void; isPending: boolean };
  updateMut: { mutate: () => void; isPending: boolean };
  closeForm: () => void;
  Toast: React.ReactNode;
  T: (key: TranslationKey) => string;
  PageHeader: React.ComponentType<{ title: string; subtitle?: string; actions?: React.ReactNode }>;
  TYPES: string[];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={LABEL}>{label}</label>{children}</div>;
}

export function ProductFormView({
  editProd, form, f, formErrors, validateForm, catList, config,
  videoUploading, handleVideoUpload, allowedVideoFormats, maxVideoMb, maxVideoDurationSec,
  editThreshold, setEditThreshold, lowStockThreshold,
  createMut, updateMut, closeForm, Toast, T, PageHeader, TYPES,
}: ProductFormViewProps) {
  return (
    <div className="bg-gray-50 md:bg-transparent">
      <PageHeader
        title={editProd ? T("editProduct") : T("addProduct")}
        subtitle={T("fillProductDetails")}
        actions={
          <button onClick={closeForm} className="h-10 px-4 bg-white/20 md:bg-gray-100 md:text-gray-700 text-white font-bold rounded-xl text-sm android-press min-h-0">
            ✕ {T("cancel")}
          </button>
        }
      />
      <div className="px-4 py-4 md:px-0 md:py-4">
        <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
          <div className={`${CARD} p-4 space-y-3`}>
            <Field label={T("productNameRequired")}>
              <input value={form.name} onChange={e => f("name",e.target.value)} placeholder="e.g. Chicken Biryani" className={`${INPUT}${formErrors.name ? " !border-red-400 focus:!border-red-500" : ""}`}/>
              {formErrors.name && <p className="text-xs text-red-500 mt-1 font-medium">{formErrors.name}</p>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={T("priceRequired")}>
                <input type="number" inputMode="numeric" value={form.price} onChange={e => f("price",e.target.value)} placeholder="0" className={`${INPUT}${formErrors.price ? " !border-red-400 focus:!border-red-500" : ""}`}/>
                {formErrors.price && <p className="text-xs text-red-500 mt-1 font-medium">{formErrors.price}</p>}
              </Field>
              <Field label="Sale Price (crossed-out)">
                <input type="number" inputMode="numeric" value={form.originalPrice} onChange={e => f("originalPrice",e.target.value)} placeholder="Original price" className={INPUT}/>
              </Field>
              <Field label={T("categoryLabel")}>
                <select value={form.category} onChange={e => f("category",e.target.value)} className={`${SELECT}${formErrors.category ? " !border-red-400 focus:!border-red-500" : ""}`}>
                  <option value="">Select...</option>
                  {catList.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
                {formErrors.category && <p className="text-xs text-red-500 mt-1 font-medium">{formErrors.category}</p>}
              </Field>
              <Field label={T("typeLabel")}>
                <select value={form.type} onChange={e => f("type",e.target.value)} className={SELECT}>
                  {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </Field>
              <Field label={T("unitLabel")}>
                <input value={form.unit} onChange={e => f("unit",e.target.value)} placeholder="kg / pcs / ltr" className={INPUT}/>
              </Field>
              <Field label={T("stockQtyLabel")}>
                <input type="number" inputMode="numeric" min="0" value={form.stock} onChange={e => {
                  const v = e.target.value;
                  if (v !== "" && Number(v) < 0) return;
                  f("stock", v);
                }} placeholder="Blank = unlimited" className={INPUT}/>
              </Field>
              {editProd && (
                <Field label="Low-Stock Alert Threshold">
                  <input type="number" inputMode="numeric" min="0" value={editThreshold} onChange={e => setEditThreshold(e.target.value)} placeholder={`Default: ${lowStockThreshold}`} className={INPUT}/>
                  <p className="text-[10px] text-gray-400 mt-1">Show warning badge when stock ≤ this number</p>
                </Field>
              )}
            </div>
            <Field label={T("descriptionLabel")}>
              <textarea value={form.description} onChange={e => f("description",e.target.value)} placeholder="Short description..." rows={2} className={TEXTAREA}/>
            </Field>
            <Field label="Tags (comma-separated)">
              <input value={form.tags} onChange={e => f("tags", e.target.value)} placeholder="e.g. spicy, bestseller, new" className={INPUT}/>
              <p className="text-[10px] text-gray-400 mt-1">Tags help customers discover your product</p>
            </Field>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-bold text-gray-700">Hide from customers</p>
                <p className="text-[11px] text-gray-400">Product won't appear in listings</p>
              </div>
              <button type="button" onClick={() => f("isHidden", !form.isHidden)}
                className={`w-12 h-6 rounded-full relative transition-colors ${form.isHidden ? "bg-gray-400" : "bg-green-400"}`}>
                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow transition-all ${form.isHidden ? "left-1" : "left-7"}`}/>
              </button>
            </div>
          </div>
          <div className="space-y-4">
            <div className={`${CARD} p-4`}>
              <ImageUploader value={form.image} onChange={url => f("image", url)} label={T("imageUrlLabel")} placeholder="https://..."/>
            </div>
            <div className={`${CARD} p-4 space-y-3`}>
              <label className={LABEL}>Upload Video (optional, ≤{maxVideoDurationSec}s)</label>
              {form.videoUrl ? (
                <div className="space-y-2">
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                    <video src={form.videoUrl} className="w-full h-full object-contain" controls muted playsInline/>
                  </div>
                  <div className="flex gap-2">
                    <label className="flex-1 h-9 bg-orange-50 text-orange-600 font-bold rounded-xl text-sm flex items-center justify-center gap-1.5 cursor-pointer android-press">
                      <span>🔄 Replace</span>
                      <input type="file" accept={allowedVideoFormats.join(",")} className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) handleVideoUpload(file); e.target.value = ""; }}/>
                    </label>
                    <button onClick={() => f("videoUrl", "")} className="flex-1 h-9 bg-red-50 text-red-500 font-bold rounded-xl text-sm android-press">🗑️ Remove</button>
                  </div>
                </div>
              ) : (
                <label className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${videoUploading ? "border-orange-300 bg-orange-50" : "border-gray-200 hover:border-orange-300 hover:bg-orange-50/50"}`}>
                  {videoUploading ? (
                    <><div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin"/><span className="text-sm font-semibold text-orange-600">Uploading video...</span></>
                  ) : (
                    <><span className="text-2xl">🎬</span><span className="text-sm font-semibold text-gray-600">Tap to upload a product video</span><span className="text-xs text-gray-400">{(config.uploads?.allowedVideoFormats ?? ["mp4", "mov", "webm"]).map(f => f.toUpperCase()).join(", ")} · Max {maxVideoMb}MB · ≤{maxVideoDurationSec}s</span></>
                  )}
                  <input type="file" accept={allowedVideoFormats.join(",")} className="hidden" disabled={videoUploading} onChange={e => { const file = e.target.files?.[0]; if (file) handleVideoUpload(file); e.target.value = ""; }}/>
                </label>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={closeForm} className={BTN_SECONDARY}>Cancel</button>
              <button onClick={() => { if (!validateForm()) return; editProd ? updateMut.mutate() : createMut.mutate(); }} disabled={createMut.isPending || updateMut.isPending} className={BTN_PRIMARY}>
                {createMut.isPending || updateMut.isPending ? "Saving..." : editProd ? "✓ Update Product" : "+ Add Product"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {Toast}
    </div>
  );
}
