import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import type { Language } from "@workspace/i18n";
import { isRTL } from "@workspace/i18n";

const LS_KEY = "ajkmart_vendor_lang";
const LANG_CYCLE: Language[] = ["en", "ur", "roman"];
const LANG_LABELS: Record<string, string> = { en: "EN", ur: "اردو", roman: "RM" };

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

function cycleLang(current: Language): Language {
  const idx = LANG_CYCLE.indexOf(current);
  return LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
}

const TRUST = {
  en:    [{ v: "4,200+", l: "Active vendors" }, { v: "18", l: "Cities" }, { v: "2.1M+", l: "Orders processed" }],
  ur:    [{ v: "4,200+", l: "فعال وینڈرز" }, { v: "18", l: "شہر" }, { v: "2.1M+", l: "آرڈر مکمل" }],
  roman: [{ v: "4,200+", l: "Active vendors" }, { v: "18", l: "Shehar" }, { v: "2.1M+", l: "Orders mukammal" }],
};

const FEATURES = {
  en: [
    { icon: "📋", title: "Order Dashboard", desc: "Accept, manage, and track every order in real time — with push alerts for new arrivals." },
    { icon: "📊", title: "Sales Analytics", desc: "Revenue charts, top-selling products, and daily summaries help you make smarter decisions." },
    { icon: "📦", title: "Product Management", desc: "Upload items, set prices, manage stock levels, and run promotions — all from one screen." },
  ],
  ur: [
    { icon: "📋", title: "آرڈر ڈیش بورڈ", desc: "ہر آرڈر کو حقیقی وقت میں قبول کریں اور ٹریک کریں — نئے آرڈرز کے فوری الرٹ کے ساتھ۔" },
    { icon: "📊", title: "سیلز اینالیٹکس", desc: "آمدنی چارٹس، بہترین فروخت مصنوعات اور یومیہ خلاصہ بہتر فیصلے کرنے میں مدد دیتے ہیں۔" },
    { icon: "📦", title: "پروڈکٹ مینجمنٹ", desc: "اشیاء اپلوڈ کریں، قیمتیں سیٹ کریں، اسٹاک منیج کریں اور پروموشن چلائیں — ایک ہی اسکرین سے۔" },
  ],
  roman: [
    { icon: "📋", title: "Order Dashboard", desc: "Har order ko haqiqi waqt mein qabool karein aur track karein — nayi orders ke fori alerts ke sath." },
    { icon: "📊", title: "Sales Analytics", desc: "Amdani charts, behtareen farokht products aur yaumia khulasa behtareen faisale karne mein madadgar hain." },
    { icon: "📦", title: "Product Management", desc: "Ashiya upload karein, qeematein set karein, stock manage karein — ek hi screen se." },
  ],
};

const BENEFITS = {
  en:    ["Instant order notifications", "Real-time inventory control", "Weekly payout to wallet", "Dedicated vendor support"],
  ur:    ["فوری آرڈر اطلاعات", "حقیقی وقت انوینٹری کنٹرول", "ہفتہ وار ادائیگی والیٹ میں", "وقف وینڈر سپورٹ"],
  roman: ["Fori order ittila'aat", "Haqiqi waqt inventory control", "Hafta war payment wallet mein", "Dedicated vendor support"],
};

const CONTENT = {
  en: {
    appName: "AJKMart Vendor",
    tagline: "Sell Smart. Grow Fast.",
    heroTitle: "Your Shop,\nDigitally Supercharged.",
    heroSub: "List products, manage orders, run promotions, and grow your business — all from one powerful vendor dashboard.",
    ctaLogin: "Login",
    ctaRegister: "Open Your Shop",
    trustTitle: "Trusted by thousands of vendors",
    featuresTitle: "Everything your business needs",
    benefitsTitle: "Why vendors love AJKMart",
    footerCta: "Ready to grow your business?",
    footerBtn: "Open Your Store Today",
    footer: "© 2026 AJKMart · Vendor Platform",
  },
  ur: {
    appName: "اے جے کے مارٹ وینڈر",
    tagline: "سمارٹ بیچیں۔ تیزی سے بڑھیں۔",
    heroTitle: "آپ کی دکان،\nڈیجیٹل طاقت کے ساتھ۔",
    heroSub: "مصنوعات فہرست کریں، آرڈر منیج کریں، پروموشن چلائیں اور ایک طاقتور ڈیش بورڈ سے اپنا کاروبار بڑھائیں۔",
    ctaLogin: "لاگ ان",
    ctaRegister: "دکان کھولیں",
    trustTitle: "ہزاروں وینڈرز کا اعتماد",
    featuresTitle: "آپ کے کاروبار کے لیے سب کچھ",
    benefitsTitle: "وینڈرز اے جے کے مارٹ کو کیوں پسند کرتے ہیں",
    footerCta: "اپنا کاروبار بڑھانے کے لیے تیار ہیں؟",
    footerBtn: "آج اپنی دکان کھولیں",
    footer: "© 2026 اے جے کے مارٹ · وینڈر پلیٹ فارم",
  },
  roman: {
    appName: "AJKMart Vendor",
    tagline: "Smart Bechayn. Tezi Se Barhayn.",
    heroTitle: "Aapki Dukaan,\nDigital Taaqat Ke Sath.",
    heroSub: "Products list karein, orders manage karein, promotions chalayein — ek powerful dashboard se karobar barhaayein.",
    ctaLogin: "Login Karein",
    ctaRegister: "Dukaan Kholyein",
    trustTitle: "Hazaron vendors ka aitmaad",
    featuresTitle: "Aapke karobar ke liye sab kuch",
    benefitsTitle: "Vendors AJKMart ko kyun pasand karte hain",
    footerCta: "Apna karobar barhaane ke liye tayyar hain?",
    footerBtn: "Aaj Apni Dukaan Kholyein",
    footer: "© 2026 AJKMart · Vendor Platform",
  },
};

const ORANGE = "#f97316";
const ORANGE_DARK = "#ea580c";
const ORANGE_BG = "#fff7ed";
const ORANGE_BORDER = "#fed7aa";

export function GuestLanding() {
  const [, navigate] = useLocation();
  const [language, setLangState] = useState<Language>(readLang);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { saveLang(language); }, [language]);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  function handleLangToggle() {
    setLangState(cycleLang(language));
  }

  const C = CONTENT[language as keyof typeof CONTENT] ?? CONTENT.en;
  const trust = TRUST[language as keyof typeof TRUST] ?? TRUST.en;
  const features = FEATURES[language as keyof typeof FEATURES] ?? FEATURES.en;
  const benefits = BENEFITS[language as keyof typeof BENEFITS] ?? BENEFITS.en;
  const rtl = isRTL(language);

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden" dir={rtl ? "rtl" : "ltr"}>

      {/* ── Sticky Header ── */}
      <header
        className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-orange-100"
        style={{
          height: scrolled ? 52 : 64,
          boxShadow: scrolled ? "0 2px 8px rgba(0,0,0,0.10)" : "0 1px 2px rgba(0,0,0,0.05)",
          transition: "height 0.2s ease, box-shadow 0.2s ease",
        }}
      >
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between gap-3" style={{ height: "100%" }}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 shadow-sm"
              style={{ background: `linear-gradient(135deg, ${ORANGE}, ${ORANGE_DARK})` }}>
              🏪
            </div>
            <span className="font-extrabold text-orange-600 text-base leading-tight truncate">{C.appName}</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Language pill */}
            <button
              onClick={handleLangToggle}
              className="h-9 px-3 rounded-full text-xs font-bold cursor-pointer transition-colors"
              style={{ backgroundColor: ORANGE_BG, border: `1px solid ${ORANGE_BORDER}`, color: ORANGE_DARK }}
            >
              🌐 {LANG_LABELS[language] ?? "EN"}
            </button>

            <button
              onClick={() => navigate("/login")}
              className="h-9 px-4 rounded-xl text-xs font-bold transition-colors hover:bg-orange-50 cursor-pointer"
              style={{ border: `1px solid ${ORANGE_BORDER}`, color: ORANGE_DARK, backgroundColor: "transparent" }}
            >
              {C.ctaLogin}
            </button>
            <button
              onClick={() => navigate("/register")}
              className="h-9 px-4 rounded-xl text-xs font-bold text-white shadow-md transition-colors cursor-pointer"
              style={{ backgroundColor: ORANGE, border: "none" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = ORANGE_DARK)}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = ORANGE)}
            >
              {C.ctaRegister}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section
        className="relative overflow-hidden text-white"
        style={{ background: `linear-gradient(135deg, ${ORANGE} 0%, #f59e0b 50%, #eab308 100%)` }}
      >
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 start-0 w-80 h-80 rounded-full opacity-20 -translate-x-1/2 -translate-y-1/2"
            style={{ backgroundColor: "rgba(255,255,255,0.3)" }} />
          <div className="absolute bottom-0 end-0 w-64 h-64 rounded-full opacity-10 translate-x-1/3 translate-y-1/3"
            style={{ backgroundColor: "rgba(255,255,255,0.3)" }} />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 py-16 md:py-24 flex flex-col md:flex-row items-center gap-10">
          <div className="flex-1 text-center md:text-start">
            <div className="inline-block rounded-full px-4 py-1.5 text-xs font-bold mb-5 tracking-wide"
              style={{ backgroundColor: "rgba(255,255,255,0.20)" }}>
              ✨ {C.tagline}
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold leading-tight mb-4 whitespace-pre-line">{C.heroTitle}</h1>
            <p className="text-base md:text-lg leading-relaxed mb-8 max-w-md" style={{ color: "rgba(255,255,255,0.88)" }}>{C.heroSub}</p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <button
                onClick={() => navigate("/register")}
                className="h-12 px-8 rounded-2xl font-extrabold text-sm shadow-xl transition-colors cursor-pointer"
                style={{ backgroundColor: "white", color: ORANGE_DARK, border: "none" }}
              >
                {C.ctaRegister} →
              </button>
              <button
                onClick={() => navigate("/login")}
                className="h-12 px-8 rounded-2xl font-bold text-sm text-white transition-colors cursor-pointer"
                style={{ backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.30)" }}
              >
                {C.ctaLogin}
              </button>
            </div>
          </div>
          <div className="text-8xl md:text-9xl select-none drop-shadow-2xl">🏪</div>
        </div>
      </section>

      {/* ── Trust Strip ── */}
      <section className="bg-white border-b border-orange-100">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-center text-xs font-semibold text-orange-400 pt-6 pb-2 uppercase tracking-widest">{C.trustTitle}</p>
          <div className="flex divide-x divide-orange-100 pb-6">
            {trust.map((s, i) => (
              <div key={i} className="flex-1 text-center py-3 px-4">
                <div className="text-2xl font-extrabold mb-0.5" style={{ color: ORANGE_DARK }}>{s.v}</div>
                <div className="text-xs text-gray-500 font-medium">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature Cards ── */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <h2 className="text-2xl md:text-3xl font-extrabold text-gray-800 text-center mb-10">{C.featuresTitle}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {features.map((f) => (
            <div key={f.title}
              className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform"
                style={{ backgroundColor: ORANGE_BG }}>
                {f.icon}
              </div>
              <h3 className="font-extrabold text-gray-800 mb-2">{f.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Benefits ── */}
      <section className="py-14" style={{ backgroundColor: ORANGE_BG }}>
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-800 text-center mb-10">{C.benefitsTitle}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {benefits.map((b) => (
              <div key={b} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-4 shadow-sm border border-orange-100">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: ORANGE_BG }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={ORANGE_DARK} strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-gray-700 text-xs font-semibold leading-snug">{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="text-white py-16" style={{ background: `linear-gradient(135deg, ${ORANGE_DARK} 0%, #b45309 100%)` }}>
        <div className="max-w-lg mx-auto px-6 text-center">
          <div className="text-5xl mb-4">🚀</div>
          <h2 className="text-2xl md:text-3xl font-extrabold mb-6">{C.footerCta}</h2>
          <button
            onClick={() => navigate("/register")}
            className="h-14 px-10 rounded-2xl font-extrabold text-base shadow-xl transition-colors cursor-pointer"
            style={{ backgroundColor: "white", color: ORANGE_DARK, border: "none" }}
          >
            {C.footerBtn}
          </button>
        </div>
      </section>

      <footer className="bg-gray-900 text-gray-400 text-center text-xs py-6 px-4">{C.footer}</footer>
    </div>
  );
}

export default GuestLanding;
