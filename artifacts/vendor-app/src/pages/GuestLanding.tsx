import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import type { Language } from "@workspace/i18n";
import { isRTL } from "@workspace/i18n";

const LS_KEY = "ajkmart_vendor_lang";

const LANG_OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ur", label: "اردو" },
  { value: "roman", label: "Roman Urdu" },
];

function readLang(): Language {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "en" || v === "ur" || v === "roman") return v;
  } catch {}
  return "en";
}

function saveLang(lang: Language) {
  try {
    localStorage.setItem(LS_KEY, lang);
    const dir = isRTL(lang) ? "rtl" : "ltr";
    document.documentElement.setAttribute("dir", dir);
  } catch {}
}

const CONTENT = {
  en: {
    appName: "AJKMart Vendor",
    tagline: "Sell Smart. Grow Fast.",
    heroTitle: "Your Shop, Digitally Supercharged.",
    heroSubtitle:
      "List products, manage orders, run promotions, and grow your business — all from one powerful vendor dashboard.",
    ctaLogin: "Login",
    ctaRegister: "Open Your Shop",
    services: [
      { icon: "🏪", title: "Store Management", desc: "Manage your store profile, hours and inventory" },
      { icon: "📋", title: "Order Processing", desc: "Accept, track and fulfill orders in real time" },
      { icon: "📊", title: "Sales Analytics", desc: "Detailed revenue charts and sales insights" },
      { icon: "📣", title: "Promotions", desc: "Run deals, coupons and marketing campaigns" },
      { icon: "💬", title: "Customer Chat", desc: "Chat directly with customers for support" },
      { icon: "💰", title: "Wallet & Payouts", desc: "Track earnings and request withdrawals" },
    ],
    howTitle: "Start Selling in 3 Steps",
    steps: [
      { n: "1", title: "Register", desc: "Create your vendor account with business details" },
      { n: "2", title: "List Products", desc: "Upload your products with photos and prices" },
      { n: "3", title: "Start Selling", desc: "Go live and receive orders from AJKMart customers" },
    ],
    benefitsTitle: "Why Vendors Love AJKMart",
    benefits: [
      "Instant order notifications",
      "Real-time inventory control",
      "Weekly payout to your wallet",
      "Dedicated vendor support",
    ],
    footerCta: "Ready to grow your business?",
    footerBtn: "Open Your Store Today",
  },
  ur: {
    appName: "اے جے کے مارٹ وینڈر",
    tagline: "سمارٹ بیچیں۔ تیزی سے بڑھیں۔",
    heroTitle: "آپ کی دکان، ڈیجیٹل طاقت کے ساتھ۔",
    heroSubtitle:
      "مصنوعات فہرست کریں، آرڈر منیج کریں، پروموشن چلائیں اور ایک طاقتور ڈیش بورڈ سے اپنا کاروبار بڑھائیں۔",
    ctaLogin: "لاگ ان",
    ctaRegister: "دکان کھولیں",
    services: [
      { icon: "🏪", title: "اسٹور مینجمنٹ", desc: "اپنی دکان کا پروفائل، اوقات اور انوینٹری منیج کریں" },
      { icon: "📋", title: "آرڈر پروسیسنگ", desc: "حقیقی وقت میں آرڈر قبول کریں اور پورے کریں" },
      { icon: "📊", title: "سیلز اینالیٹکس", desc: "تفصیلی آمدنی چارٹس اور سیلز بصیرت" },
      { icon: "📣", title: "پروموشنز", desc: "ڈیلز، کوپن اور مارکیٹنگ مہمیں چلائیں" },
      { icon: "💬", title: "کسٹمر چیٹ", desc: "سپورٹ کے لیے کسٹمرز سے براہ راست بات کریں" },
      { icon: "💰", title: "والیٹ اور ادائیگیاں", desc: "کمائی ٹریک کریں اور ادائیگی کی درخواست کریں" },
    ],
    howTitle: "۳ آسان مراحل میں بیچنا شروع کریں",
    steps: [
      { n: "۱", title: "رجسٹر کریں", desc: "کاروباری تفصیلات کے ساتھ وینڈر اکاؤنٹ بنائیں" },
      { n: "۲", title: "مصنوعات فہرست کریں", desc: "تصاویر اور قیمتوں کے ساتھ مصنوعات اپلوڈ کریں" },
      { n: "۳", title: "بیچنا شروع کریں", desc: "لائیو ہوں اور اے جے کے مارٹ گاہکوں سے آرڈر وصول کریں" },
    ],
    benefitsTitle: "وینڈرز اے جے کے مارٹ کو کیوں پسند کرتے ہیں",
    benefits: ["فوری آرڈر اطلاعات", "حقیقی وقت انوینٹری کنٹرول", "ہفتہ وار ادائیگی والیٹ میں", "وقف وینڈر سپورٹ"],
    footerCta: "اپنا کاروبار بڑھانے کے لیے تیار ہیں؟",
    footerBtn: "آج اپنی دکان کھولیں",
  },
  roman: {
    appName: "AJKMart Vendor",
    tagline: "Smart Bechayn. Tezi Se Barhayn.",
    heroTitle: "Aapki Dukaan, Digital Taaqat Ke Sath.",
    heroSubtitle:
      "Products list karein, orders manage karein, promotions chalayein — ek powerful dashboard se apna karobar barhaayein.",
    ctaLogin: "Login Karein",
    ctaRegister: "Dukaan Kholyein",
    services: [
      { icon: "🏪", title: "Store Management", desc: "Dukaan ka profile, auqaat aur inventory manage karein" },
      { icon: "📋", title: "Order Processing", desc: "Haqiqi waqt mein orders qabool karein aur poore karein" },
      { icon: "📊", title: "Sales Analytics", desc: "Tafsili amdani charts aur sales bصیرت" },
      { icon: "📣", title: "Promotions", desc: "Deals, coupons aur marketing muheemein chalayein" },
      { icon: "💬", title: "Customer Chat", desc: "Support ke liye customers se seedha baat karein" },
      { icon: "💰", title: "Wallet & Payments", desc: "Kamaai track karein aur payment ki darkhwast karein" },
    ],
    howTitle: "3 Aasaan Marahil Mein Bechna Shuru Karein",
    steps: [
      { n: "1", title: "Register Karein", desc: "Karobaari tafseel ke sath vendor account banayein" },
      { n: "2", title: "Products List Karein", desc: "Tasaveer aur qeemton ke sath products upload karein" },
      { n: "3", title: "Bechna Shuru Karein", desc: "Live hon aur AJKMart gahkon se orders hasil karein" },
    ],
    benefitsTitle: "Vendors AJKMart Ko Kyun Pasand Karte Hain",
    benefits: ["Fori order ittala'aat", "Haqiqi waqt inventory control", "Hafta war payment wallet mein", "Dedicated vendor support"],
    footerCta: "Apna karobar barhaane ke liye tayyar hain?",
    footerBtn: "Aaj Apni Dukaan Kholyein",
  },
};

export function GuestLanding() {
  const [, navigate] = useLocation();
  const [language, setLangState] = useState<Language>(readLang);
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => {
    saveLang(language);
  }, [language]);

  const changeLang = (lang: Language) => {
    setLangState(lang);
    setLangOpen(false);
  };

  const C = CONTENT[language as "en" | "ur" | "roman"] ?? CONTENT.en;
  const rtl = isRTL(language);

  return (
    <div
      className="min-h-screen bg-gray-50 overflow-x-hidden"
      dir={rtl ? "rtl" : "ltr"}
    >
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-orange-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-lg flex-shrink-0 shadow">
              🏪
            </div>
            <span className="font-extrabold text-orange-600 text-base leading-tight truncate">
              {C.appName}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Language */}
            <div className="relative">
              <button
                onClick={() => setLangOpen((v) => !v)}
                className="flex items-center gap-1 h-9 px-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-600 text-xs font-semibold hover:bg-orange-100 transition-colors"
              >
                🌐 {LANG_OPTIONS.find((o) => o.value === language)?.label ?? "Language"}
                <svg className={`w-3 h-3 transition-transform ${langOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {langOpen && (
                <div className="absolute top-11 end-0 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
                  {LANG_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => changeLang(opt.value)}
                      className={`w-full text-start px-4 py-3 text-sm font-medium transition-colors ${
                        language === opt.value
                          ? "bg-orange-50 text-orange-600 font-bold"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => navigate("/login")}
              className="h-9 px-4 rounded-xl border border-orange-300 text-orange-600 text-xs font-bold hover:bg-orange-50 transition-colors"
            >
              {C.ctaLogin}
            </button>
            <button
              onClick={() => navigate("/register")}
              className="h-9 px-4 rounded-xl bg-orange-500 text-white text-xs font-bold hover:bg-orange-600 transition-colors shadow-md"
            >
              {C.ctaRegister}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-500 text-white">
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div className="absolute top-0 start-0 w-96 h-96 rounded-full bg-white/20 -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 end-0 w-80 h-80 rounded-full bg-white/10 translate-x-1/3 translate-y-1/3" />
        </div>
        <div className="relative max-w-5xl mx-auto px-6 py-16 md:py-24 flex flex-col md:flex-row items-center gap-10">
          <div className="flex-1 text-center md:text-start">
            <div className="inline-block bg-white/20 backdrop-blur-sm rounded-full px-4 py-1.5 text-xs font-bold mb-5 tracking-wide">
              ✨ {C.tagline}
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold leading-tight mb-4">
              {C.heroTitle}
            </h1>
            <p className="text-orange-100 text-base md:text-lg leading-relaxed mb-8 max-w-md">
              {C.heroSubtitle}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <button
                onClick={() => navigate("/register")}
                className="h-12 px-8 rounded-2xl bg-white text-orange-600 font-extrabold text-sm shadow-xl hover:bg-orange-50 transition-colors"
              >
                {C.ctaRegister} →
              </button>
              <button
                onClick={() => navigate("/login")}
                className="h-12 px-8 rounded-2xl bg-white/10 border border-white/30 text-white font-bold text-sm hover:bg-white/20 transition-colors"
              >
                {C.ctaLogin}
              </button>
            </div>
          </div>
          <div className="text-8xl md:text-9xl select-none drop-shadow-2xl">🏪</div>
        </div>
      </section>

      {/* ── Services ── */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {C.services.map((svc) => (
            <div
              key={svc.title}
              className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group"
            >
              <div className="text-3xl mb-3 group-hover:scale-110 transition-transform duration-200">
                {svc.icon}
              </div>
              <h3 className="font-extrabold text-gray-800 text-sm mb-1">{svc.title}</h3>
              <p className="text-gray-500 text-xs leading-relaxed">{svc.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-gradient-to-br from-orange-50 to-amber-50 py-14">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-800 text-center mb-10">
            {C.howTitle}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {C.steps.map((step) => (
              <div key={step.n} className="bg-white rounded-3xl p-6 shadow-sm border border-orange-100 text-center">
                <div className="w-12 h-12 rounded-full bg-orange-500 text-white font-extrabold text-lg flex items-center justify-center mx-auto mb-4 shadow-md">
                  {step.n}
                </div>
                <h3 className="font-extrabold text-gray-800 mb-2">{step.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <h2 className="text-2xl md:text-3xl font-extrabold text-gray-800 text-center mb-8">
          {C.benefitsTitle}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {C.benefits.map((b) => (
            <div key={b} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-4 shadow-sm border border-gray-100">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              </div>
              <span className="text-gray-700 text-xs font-semibold leading-snug">{b}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="bg-gradient-to-br from-orange-600 to-amber-700 text-white py-16">
        <div className="max-w-lg mx-auto px-6 text-center">
          <div className="text-5xl mb-4">🚀</div>
          <h2 className="text-2xl md:text-3xl font-extrabold mb-4">{C.footerCta}</h2>
          <button
            onClick={() => navigate("/register")}
            className="h-14 px-10 rounded-2xl bg-white text-orange-600 font-extrabold text-base shadow-xl hover:bg-orange-50 transition-colors"
          >
            {C.footerBtn}
          </button>
        </div>
      </section>

      <footer className="bg-gray-900 text-gray-400 text-center text-xs py-6 px-4">
        © {new Date().getFullYear()} AJKMart · Vendor Platform
      </footer>
    </div>
  );
}

export default GuestLanding;
