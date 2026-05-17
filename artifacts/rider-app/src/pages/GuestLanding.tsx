import { useState } from "react";
import { useLocation } from "wouter";
import { useLanguage } from "../lib/useLanguage";
import type { Language } from "@workspace/i18n";

const LANG_LABELS: Record<Language, string> = {
  en: "English",
  ur: "اردو",
  roman: "Roman Urdu",
  en_roman: "Eng + Roman",
  en_ur: "Eng + اردو",
};

const LANG_OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ur", label: "اردو" },
  { value: "roman", label: "Roman Urdu" },
];

const CONTENT = {
  en: {
    appName: "AJKMart Rider",
    tagline: "Earn More. Ride Free.",
    heroTitle: "Your City. Your Earnings.",
    heroSubtitle:
      "Join thousands of riders across AJK delivering food, parcels, and rides — on your own schedule.",
    ctaLogin: "Login",
    ctaRegister: "Join as Rider",
    services: [
      { icon: "🛵", title: "Food Delivery", desc: "Deliver from local restaurants & eateries" },
      { icon: "🚗", title: "Ride Hailing", desc: "Pick up passengers and earn per trip" },
      { icon: "📦", title: "Parcel Delivery", desc: "Deliver packages across the city" },
      { icon: "🚐", title: "Van Service", desc: "Drive inter-city van routes" },
    ],
    howTitle: "How It Works",
    steps: [
      { n: "1", title: "Register", desc: "Sign up with your phone and submit your documents" },
      { n: "2", title: "Get Approved", desc: "Our team reviews your application within 24 hours" },
      { n: "3", title: "Start Earning", desc: "Accept orders, complete deliveries, get paid" },
    ],
    benefitsTitle: "Why Riders Choose Us",
    benefits: ["Instant earnings to your wallet", "GPS navigation built in", "24/7 support", "Flexible working hours"],
    footerCta: "Ready to start earning?",
    footerBtn: "Create Rider Account",
  },
  ur: {
    appName: "اے جے کے مارٹ رائیڈر",
    tagline: "زیادہ کمائیں۔ آزاد رہیں۔",
    heroTitle: "آپ کا شہر۔ آپ کی کمائی۔",
    heroSubtitle:
      "ہزاروں رائیڈرز کے ساتھ شامل ہوں اور اپنے وقت پر کھانا، پارسل اور سواری پہنچائیں۔",
    ctaLogin: "لاگ ان",
    ctaRegister: "رائیڈر بنیں",
    services: [
      { icon: "🛵", title: "فوڈ ڈیلیوری", desc: "مقامی ریستورانوں سے ڈیلیوری کریں" },
      { icon: "🚗", title: "رائیڈ ہیلنگ", desc: "مسافروں کو اٹھائیں اور فی سفر کمائیں" },
      { icon: "📦", title: "پارسل ڈیلیوری", desc: "شہر بھر میں پیکجز پہنچائیں" },
      { icon: "🚐", title: "وین سروس", desc: "بین شہری وین روٹس چلائیں" },
    ],
    howTitle: "یہ کیسے کام کرتا ہے",
    steps: [
      { n: "۱", title: "رجسٹر کریں", desc: "اپنے فون سے سائن اپ کریں اور دستاویزات جمع کریں" },
      { n: "۲", title: "منظوری حاصل کریں", desc: "ہماری ٹیم ۲۴ گھنٹوں میں آپ کی درخواست دیکھے گی" },
      { n: "۳", title: "کمانا شروع کریں", desc: "آرڈر قبول کریں، ڈیلیوری کریں، ادائیگی پائیں" },
    ],
    benefitsTitle: "رائیڈرز ہمیں کیوں پسند کرتے ہیں",
    benefits: ["فوری کمائی آپ کے والیٹ میں", "GPS نیویگیشن شامل ہے", "۲۴/۷ سپورٹ", "لچکدار کام کے اوقات"],
    footerCta: "کمانا شروع کرنے کے لیے تیار ہیں؟",
    footerBtn: "رائیڈر اکاؤنٹ بنائیں",
  },
  roman: {
    appName: "AJKMart Rider",
    tagline: "Zyada Kamayen. Azad Rahen.",
    heroTitle: "Aapka Shehar. Aapki Kamaai.",
    heroSubtitle:
      "Hazaron riders ke sath shamil hon aur apne waqt par khana, parcel aur sawari pohanchayein.",
    ctaLogin: "Login Karein",
    ctaRegister: "Rider Banein",
    services: [
      { icon: "🛵", title: "Food Delivery", desc: "Local restaurants se delivery karein" },
      { icon: "🚗", title: "Ride Hailing", desc: "Musafiron ko uthayein, har safar par kamaayein" },
      { icon: "📦", title: "Parcel Delivery", desc: "Shehar bhar mein packages pohanchayein" },
      { icon: "🚐", title: "Van Service", desc: "Bayn-shehari van routes chalayein" },
    ],
    howTitle: "Yeh Kaise Kaam Karta Hai",
    steps: [
      { n: "1", title: "Register Karein", desc: "Apne phone se sign up karein aur documents jama karein" },
      { n: "2", title: "Manzoori Haasil Karein", desc: "Hamari team 24 ghanton mein aapki darkhwast dekhe gi" },
      { n: "3", title: "Kamaana Shuru Karein", desc: "Order qabool karein, delivery karein, payment payein" },
    ],
    benefitsTitle: "Riders Hamein Kyun Pasand Karte Hain",
    benefits: ["Fori kamaai aapke wallet mein", "GPS navigation shamil hai", "24/7 support", "Lachakdar kaam ke auqaat"],
    footerCta: "Kamaana shuru karne ke liye tayyar hain?",
    footerBtn: "Rider Account Banayein",
  },
  en_roman: {
    appName: "AJKMart Rider",
    tagline: "Earn More. Ride Free.",
    heroTitle: "Your City. Your Earnings.",
    heroSubtitle:
      "Join thousands of riders across AJK delivering food, parcels, and rides — on your own schedule.",
    ctaLogin: "Login",
    ctaRegister: "Join as Rider",
    services: [
      { icon: "🛵", title: "Food Delivery", desc: "Deliver from local restaurants & eateries" },
      { icon: "🚗", title: "Ride Hailing", desc: "Pick up passengers and earn per trip" },
      { icon: "📦", title: "Parcel Delivery", desc: "Deliver packages across the city" },
      { icon: "🚐", title: "Van Service", desc: "Drive inter-city van routes" },
    ],
    howTitle: "How It Works",
    steps: [
      { n: "1", title: "Register", desc: "Sign up with your phone and submit your documents" },
      { n: "2", title: "Get Approved", desc: "Our team reviews your application within 24 hours" },
      { n: "3", title: "Start Earning", desc: "Accept orders, complete deliveries, get paid" },
    ],
    benefitsTitle: "Why Riders Choose Us",
    benefits: ["Instant earnings to your wallet", "GPS navigation built in", "24/7 support", "Flexible working hours"],
    footerCta: "Ready to start earning?",
    footerBtn: "Create Rider Account",
  },
  en_ur: {
    appName: "AJKMart Rider",
    tagline: "Earn More. Ride Free.",
    heroTitle: "Your City. Your Earnings.",
    heroSubtitle:
      "Join thousands of riders across AJK delivering food, parcels, and rides — on your own schedule.",
    ctaLogin: "Login",
    ctaRegister: "Join as Rider",
    services: [
      { icon: "🛵", title: "Food Delivery", desc: "Deliver from local restaurants & eateries" },
      { icon: "🚗", title: "Ride Hailing", desc: "Pick up passengers and earn per trip" },
      { icon: "📦", title: "Parcel Delivery", desc: "Deliver packages across the city" },
      { icon: "🚐", title: "Van Service", desc: "Drive inter-city van routes" },
    ],
    howTitle: "How It Works",
    steps: [
      { n: "1", title: "Register", desc: "Sign up with your phone and submit your documents" },
      { n: "2", title: "Get Approved", desc: "Our team reviews your application within 24 hours" },
      { n: "3", title: "Start Earning", desc: "Accept orders, complete deliveries, get paid" },
    ],
    benefitsTitle: "Why Riders Choose Us",
    benefits: ["Instant earnings to your wallet", "GPS navigation built in", "24/7 support", "Flexible working hours"],
    footerCta: "Ready to start earning?",
    footerBtn: "Create Rider Account",
  },
};

export function GuestLanding() {
  const [, navigate] = useLocation();
  const { language, setLanguage } = useLanguage();
  const [langOpen, setLangOpen] = useState(false);

  const C = CONTENT[language] ?? CONTENT.en;
  const isRTL = language === "ur";

  return (
    <div
      className="min-h-screen bg-gray-50 overflow-x-hidden"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-lg flex-shrink-0 shadow">
              🏍️
            </div>
            <span className="font-extrabold text-emerald-700 text-base leading-tight truncate">
              {C.appName}
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Language switcher */}
            <div className="relative">
              <button
                onClick={() => setLangOpen((v) => !v)}
                className="flex items-center gap-1 h-9 px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors"
              >
                🌐 {LANG_LABELS[language]}
                <svg className={`w-3 h-3 transition-transform ${langOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {langOpen && (
                <div className="absolute top-11 end-0 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
                  {LANG_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setLanguage(opt.value);
                        setLangOpen(false);
                      }}
                      className={`w-full text-start px-4 py-3 text-sm font-medium transition-colors ${
                        language === opt.value
                          ? "bg-emerald-50 text-emerald-700 font-bold"
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
              className="h-9 px-4 rounded-xl border border-emerald-300 text-emerald-700 text-xs font-bold hover:bg-emerald-50 transition-colors"
            >
              {C.ctaLogin}
            </button>
            <button
              onClick={() => navigate("/register")}
              className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors shadow-md"
            >
              {C.ctaRegister}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-green-600 to-teal-700 text-white">
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
            <p className="text-emerald-100 text-base md:text-lg leading-relaxed mb-8 max-w-md">
              {C.heroSubtitle}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <button
                onClick={() => navigate("/register")}
                className="h-12 px-8 rounded-2xl bg-white text-emerald-700 font-extrabold text-sm shadow-xl hover:bg-emerald-50 transition-colors"
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
          <div className="text-8xl md:text-9xl select-none drop-shadow-2xl">🏍️</div>
        </div>
      </section>

      {/* ── Services ── */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {C.services.map((svc) => (
            <div
              key={svc.title}
              className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 text-center hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group"
            >
              <div className="text-4xl mb-3 group-hover:scale-110 transition-transform duration-200">
                {svc.icon}
              </div>
              <h3 className="font-extrabold text-gray-800 text-sm mb-1">{svc.title}</h3>
              <p className="text-gray-500 text-xs leading-relaxed">{svc.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-gradient-to-br from-emerald-50 to-green-50 py-14">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-800 text-center mb-10">
            {C.howTitle}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {C.steps.map((step) => (
              <div key={step.n} className="bg-white rounded-3xl p-6 shadow-sm border border-emerald-100 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-600 text-white font-extrabold text-lg flex items-center justify-center mx-auto mb-4 shadow-md">
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
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              </div>
              <span className="text-gray-700 text-xs font-semibold leading-snug">{b}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="bg-gradient-to-br from-emerald-700 to-green-800 text-white py-16">
        <div className="max-w-lg mx-auto px-6 text-center">
          <div className="text-5xl mb-4">💰</div>
          <h2 className="text-2xl md:text-3xl font-extrabold mb-4">{C.footerCta}</h2>
          <button
            onClick={() => navigate("/register")}
            className="h-14 px-10 rounded-2xl bg-white text-emerald-700 font-extrabold text-base shadow-xl hover:bg-emerald-50 transition-colors"
          >
            {C.footerBtn}
          </button>
        </div>
      </section>

      <footer className="bg-gray-900 text-gray-400 text-center text-xs py-6 px-4">
        © {new Date().getFullYear()} AJKMart · Rider Platform
      </footer>
    </div>
  );
}

export default GuestLanding;
