import { useRef } from "react";
import { Camera, Upload, X, CheckCircle2, Image, FileText, Loader2 } from "lucide-react";
import { SafeImage } from "../../components/ui/SafeImage";
import { useLanguage } from "../../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

export interface UploadedDoc {
  label: string;
  url: string;
  preview: string;
}

function FileUploadBox({
  label, icon, value, onChange, required,
  optimising, uploading, error, onRetry,
}: {
  label: string;
  icon: React.ReactNode;
  value: UploadedDoc | null;
  onChange: (file: File) => void;
  required?: boolean;
  optimising?: boolean;
  uploading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const busy = optimising || uploading;

  return (
    <div>
      <div className={`border-2 border-dashed rounded-xl p-3 transition-all ${
        error ? "border-red-400 bg-red-50/50"
        : value ? "border-green-300 bg-green-50/50"
        : "border-gray-200 bg-gray-50/50 hover:border-gray-400"
      }`}>
        <input
          ref={inputRef} type="file" accept="image/*" capture="environment"
          className="hidden"
          onChange={e => { if (e.target.files?.[0]) onChange(e.target.files[0]); }}
        />
        {value && !busy ? (
          <div className="flex items-center gap-3">
            <SafeImage src={value.preview} alt={label} className="w-14 h-14 rounded-lg object-cover border border-green-200" loading="eager" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-green-700 flex items-center gap-1">
                <CheckCircle2 size={12} /> {label}
              </p>
              <p className="text-[10px] text-green-600 truncate">
                {value.url ? T("photoUploaded") : T("photoReady2")}
              </p>
            </div>
            <button
              onClick={() => inputRef.current?.click()}
              className="text-[10px] text-gray-600 font-bold hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100"
            >
              {T("changePhoto")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-full flex flex-col items-center gap-1.5 py-2 disabled:opacity-50"
          >
            <Loader2 size={20} className={`animate-spin ${busy ? "text-gray-500" : "hidden"}`} />
            {!busy && icon}
            <span className={`text-xs font-semibold ${error ? "text-red-600" : "text-gray-600"}`}>
              {label} {required && <span className="text-red-500">*</span>}
            </span>
            {optimising && <span className="text-[10px] text-amber-600 font-semibold">Optimising…</span>}
            {!busy && <span className="text-[10px] text-gray-400">{T("tapCaptureUpload")}</span>}
          </button>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-2 mt-1">
          <p className="text-[10px] text-red-500 font-medium flex-1">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[10px] font-bold text-red-600 hover:text-red-800 px-2 py-0.5 border border-red-200 rounded-lg bg-red-50 hover:bg-red-100"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface RegisterStepDocumentsProps {
  vehiclePhoto: UploadedDoc | null;
  setVehiclePhoto: (d: UploadedDoc) => void;
  cnicPhoto: UploadedDoc | null;
  setCnicPhoto: (d: UploadedDoc) => void;
  cnicBackPhoto: UploadedDoc | null;
  setCnicBackPhoto: (d: UploadedDoc) => void;
  licensePhoto: UploadedDoc | null;
  setLicensePhoto: (d: UploadedDoc) => void;
  handleFileUpload: (file: File, field: string, setter: (d: UploadedDoc) => void) => Promise<void>;
  uploadErrors: Record<string, string>;
  lastFiles: Record<string, File>;
  optimisingField: string;
  uploadingField: string;
}

export function RegisterStepDocuments({
  vehiclePhoto, setVehiclePhoto,
  cnicPhoto, setCnicPhoto,
  cnicBackPhoto, setCnicBackPhoto,
  licensePhoto, setLicensePhoto,
  handleFileUpload, uploadErrors, lastFiles,
  optimisingField, uploadingField,
}: RegisterStepDocumentsProps) {
  return (
    <div className="space-y-2">
      <FileUploadBox
        label="Vehicle Photo"
        icon={<Image size={20} className="text-gray-500" />}
        value={vehiclePhoto}
        onChange={f => handleFileUpload(f, "vehicle", setVehiclePhoto)}
        required
        optimising={optimisingField === "vehicle"}
        uploading={uploadingField === "vehicle"}
        error={uploadErrors["vehicle"]}
        onRetry={uploadErrors["vehicle"] && lastFiles["vehicle"]
          ? () => handleFileUpload(lastFiles["vehicle"], "vehicle", setVehiclePhoto)
          : undefined}
      />
      <FileUploadBox
        label="CNIC Front"
        icon={<FileText size={20} className="text-blue-500" />}
        value={cnicPhoto}
        onChange={f => handleFileUpload(f, "cnic", setCnicPhoto)}
        required
        optimising={optimisingField === "cnic"}
        uploading={uploadingField === "cnic"}
        error={uploadErrors["cnic"]}
        onRetry={uploadErrors["cnic"] && lastFiles["cnic"]
          ? () => handleFileUpload(lastFiles["cnic"], "cnic", setCnicPhoto)
          : undefined}
      />
      <FileUploadBox
        label="CNIC Back"
        icon={<FileText size={20} className="text-blue-400" />}
        value={cnicBackPhoto}
        onChange={f => handleFileUpload(f, "cnicBack", setCnicBackPhoto)}
        required
        optimising={optimisingField === "cnicBack"}
        uploading={uploadingField === "cnicBack"}
        error={uploadErrors["cnicBack"]}
        onRetry={uploadErrors["cnicBack"] && lastFiles["cnicBack"]
          ? () => handleFileUpload(lastFiles["cnicBack"], "cnicBack", setCnicBackPhoto)
          : undefined}
      />
      <FileUploadBox
        label="Driving License Photo"
        icon={<FileText size={20} className="text-purple-500" />}
        value={licensePhoto}
        onChange={f => handleFileUpload(f, "license", setLicensePhoto)}
        required
        optimising={optimisingField === "license"}
        uploading={uploadingField === "license"}
        error={uploadErrors["license"]}
        onRetry={uploadErrors["license"] && lastFiles["license"]
          ? () => handleFileUpload(lastFiles["license"], "license", setLicensePhoto)
          : undefined}
      />
    </div>
  );
}
