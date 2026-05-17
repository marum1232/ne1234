import { PhoneInput } from "@workspace/auth-react";
import { User, Phone, Mail, MapPin } from "lucide-react";
import { type TranslationKey } from "@workspace/i18n";

const INPUT = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all";
const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 appearance-none transition-all";

export const AJK_CITIES = [
  "Muzaffarabad", "Mirpur", "Rawalakot", "Bagh", "Kotli",
  "Bhimber", "Pallandri", "Hajira", "Athmuqam", "Hattian Bala",
  "Neelum", "Haveli", "Jhelum Valley", "Other",
];

export interface RegisterStepPhoneProps {
  name: string;
  setName: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  setPhoneE164: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  customCity: string;
  setCustomCity: (v: string) => void;
  emergencyContact: string;
  setEmergencyContact: (v: string) => void;
  username: string;
  setUsername: (v: string) => void;
  usernameStatus: "idle" | "checking" | "available" | "taken";
  availabilityStatus: "idle" | "checking" | "available" | "taken";
  loading: boolean;
  phoneEnabled: boolean;
  emailEnabled: boolean;
  googleEnabled: boolean;
  facebookEnabled: boolean;
  googleClientId?: string;
  facebookAppId?: string;
  handleSocialAutofill: (provider: "google" | "facebook") => void;
  T: (key: TranslationKey) => string;
}

export function RegisterStepPhone({
  name, setName,
  phone, setPhone, setPhoneE164,
  email, setEmail,
  address, setAddress,
  city, setCity, customCity, setCustomCity,
  emergencyContact, setEmergencyContact,
  username, setUsername, usernameStatus,
  availabilityStatus,
  loading,
  phoneEnabled, emailEnabled,
  googleEnabled, facebookEnabled,
  googleClientId, facebookAppId,
  handleSocialAutofill,
  T,
}: RegisterStepPhoneProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <User size={11} /> {T("nameRequired")}
        </label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={T("fullName")} className={INPUT} autoFocus />
      </div>

      {phoneEnabled && (
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
            <Phone size={11} /> {T("phoneRequired")}
          </label>
          <PhoneInput
            value={phone}
            defaultCountryCode="PK"
            placeholder="300 1234567"
            onChange={(e164, local) => {
              setPhoneE164(e164);
              setPhone(local);
            }}
          />
        </div>
      )}

      {emailEnabled && (
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
            <Mail size={11} /> {T("emailRequired")}
          </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" className={INPUT} />
        </div>
      )}

      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <MapPin size={11} /> Home Address <span className="text-red-500">*</span>
        </label>
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Full home address" className={INPUT} />
      </div>

      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <MapPin size={11} /> City <span className="text-red-500">*</span>
        </label>
        <select value={city} onChange={e => setCity(e.target.value)} className={SELECT}>
          <option value="">Select your city</option>
          {AJK_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {city === "Other" && (
          <input value={customCity} onChange={e => setCustomCity(e.target.value)}
            placeholder="Enter your city name" className={`${INPUT} mt-2`} />
        )}
      </div>

      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <Phone size={11} /> Emergency Contact <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-medium text-gray-600">+92</div>
          <input type="tel" value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)}
            placeholder="Family member / friend" className={`flex-1 ${INPUT}`} />
        </div>
        <p className="text-[10px] text-gray-400 mt-1">In case of emergency during delivery</p>
      </div>

      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
          <User size={11} /> Username *
        </label>
        <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          placeholder="e.g. rider_ali" className={INPUT} maxLength={20} />
        {usernameStatus !== "idle" && (
          <p className={`text-[10px] mt-1 font-medium ${
            usernameStatus === "checking" ? "text-gray-400" :
            usernameStatus === "available" ? "text-green-600" : "text-red-500"
          }`}>
            {usernameStatus === "checking" ? T("checkingAvailability") :
             usernameStatus === "available" ? T("usernameAvailable") : T("usernameTakenShort")}
          </p>
        )}
        <p className="text-[10px] text-gray-400 mt-0.5">You can use this to log in with username + password later</p>
      </div>

      {availabilityStatus !== "idle" && (
        <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
          availabilityStatus === "checking" ? "bg-gray-50 text-gray-500" :
          availabilityStatus === "available" ? "bg-green-50 text-green-700" :
          "bg-red-50 text-red-600"
        }`}>
          {availabilityStatus === "checking" ? T("checkingAvailability") :
           availabilityStatus === "available" ? T("phoneEmailAvailable") :
           T("alreadyRegistered")}
        </div>
      )}

      {(googleEnabled || facebookEnabled) && (
        <div className="pt-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">{T("orContinueWith")}</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <div className="space-y-2">
            {googleEnabled && (
              <button onClick={() => handleSocialAutofill("google")} disabled={loading}
                className="w-full h-11 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 relative">
                {T("signInWithGoogle")}
                {!googleClientId && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200">
                    {T("socialLoginComingSoon")}
                  </span>
                )}
              </button>
            )}
            {facebookEnabled && (
              <button onClick={() => handleSocialAutofill("facebook")} disabled={loading}
                className="w-full h-11 bg-[#1877F2] rounded-xl text-sm font-semibold text-white hover:bg-[#166FE5] transition-colors flex items-center justify-center gap-2 disabled:opacity-60 relative">
                {T("signInWithFacebook")}
                {!facebookAppId && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/20 text-white border border-white/30">
                    {T("socialLoginComingSoon")}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
