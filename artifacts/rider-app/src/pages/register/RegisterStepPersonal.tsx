import { FileText, Car } from "lucide-react";
import { type TranslationKey } from "@workspace/i18n";
import { RegisterStepDocuments, type UploadedDoc, type RegisterStepDocumentsProps } from "./RegisterStepDocuments";

const INPUT = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all";
const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 appearance-none transition-all";

export const VEHICLE_TYPES = [
  { value: "bike", labelKey: "bikeMotorcycle" as TranslationKey },
  { value: "car", labelKey: "carVehicle" as TranslationKey },
  { value: "rickshaw", labelKey: "rickshawVan" as TranslationKey },
  { value: "van", labelKey: "vanVehicle" as TranslationKey },
];

function formatCnic(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

export interface RegisterStepPersonalProps extends RegisterStepDocumentsProps {
  cnic: string;
  setCnic: (v: string) => void;
  vehicleType: string;
  setVehicleType: (v: string) => void;
  vehicleReg: string;
  setVehicleReg: (v: string) => void;
  drivingLicense: string;
  setDrivingLicense: (v: string) => void;
  registrationNote: string;
  setRegistrationNote: (v: string) => void;
  T: (key: TranslationKey) => string;
}

export function RegisterStepPersonal({
  cnic, setCnic,
  vehicleType, setVehicleType,
  vehicleReg, setVehicleReg,
  drivingLicense, setDrivingLicense,
  registrationNote, setRegistrationNote,
  T,
  /* document upload props forwarded to RegisterStepDocuments */
  vehiclePhoto, setVehiclePhoto,
  cnicPhoto, setCnicPhoto,
  cnicBackPhoto, setCnicBackPhoto,
  licensePhoto, setLicensePhoto,
  handleFileUpload, uploadErrors, lastFiles,
  optimisingField, uploadingField,
}: RegisterStepPersonalProps) {
  return (
    <div className="space-y-3">

      {/* ── CNIC ── */}
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <FileText size={11} /> {T("cnicRequired")}
        </label>
        <input
          value={cnic}
          onChange={e => setCnic(formatCnic(e.target.value))}
          placeholder="00000-0000000-0"
          className={INPUT}
          inputMode="numeric"
          autoFocus
        />
        <p className="text-[10px] text-gray-400 mt-1">{T("cnicFormat")}</p>
      </div>

      {/* ── Vehicle type ── */}
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <Car size={11} /> {T("vehicleTypeRequired")}
        </label>
        <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className={SELECT}>
          <option value="">{T("selectVehicleType")}</option>
          {VEHICLE_TYPES.map(v => (
            <option key={v.value} value={v.value}>{T(v.labelKey)}</option>
          ))}
        </select>
      </div>

      {/* ── Vehicle registration ── */}
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <Car size={11} /> Registration / Plate # <span className="text-red-500">*</span>
        </label>
        <input
          value={vehicleReg}
          onChange={e => setVehicleReg(e.target.value.toUpperCase())}
          placeholder="e.g. AJK 1234"
          className={`${INPUT} uppercase`}
        />
      </div>

      {/* ── Driving license ── */}
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
          {T("drivingLicenseRequired")}
        </label>
        <input
          value={drivingLicense}
          onChange={e => setDrivingLicense(e.target.value)}
          placeholder="License number"
          className={INPUT}
        />
      </div>

      {/* ── KYC document uploads ── */}
      <div className="border-t border-gray-100 pt-3 mt-1">
        <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-1">
          KYC Documents <span className="text-red-500">*</span>
        </p>
        <RegisterStepDocuments
          vehiclePhoto={vehiclePhoto}
          setVehiclePhoto={setVehiclePhoto}
          cnicPhoto={cnicPhoto}
          setCnicPhoto={setCnicPhoto}
          cnicBackPhoto={cnicBackPhoto}
          setCnicBackPhoto={setCnicBackPhoto}
          licensePhoto={licensePhoto}
          setLicensePhoto={setLicensePhoto}
          handleFileUpload={handleFileUpload}
          uploadErrors={uploadErrors}
          lastFiles={lastFiles}
          optimisingField={optimisingField}
          uploadingField={uploadingField}
        />
      </div>

      {/* ── Additional notes ── */}
      <div className="border-t border-gray-100 pt-3 mt-1">
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <FileText size={11} /> Additional Notes (Optional)
        </label>
        <textarea
          value={registrationNote}
          onChange={e => setRegistrationNote(e.target.value)}
          placeholder="Any additional information you'd like to share with the admin (e.g., experience, availability, preferred areas...)"
          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all resize-none"
          rows={3}
          maxLength={500}
        />
        <p className="text-[10px] text-gray-400 mt-1 text-right">{registrationNote.length}/500</p>
      </div>
    </div>
  );
}
