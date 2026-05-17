import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useLanguage } from "../lib/useLanguage";
import type { Language } from "@workspace/i18n";

const LANG_CYCLE: Language[] = ["en", "ur", "roman"];
const LANG_LABELS: Record<string, string> = { en: "EN", ur: "اردو", roman: "RM" };

function cycleLang(current: Language): Language {
  const idx = LANG_CYCLE.indexOf(current);
  return LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
}

const STATS = {
  en:     [{ v: "₨ 2,400", l: "Avg daily earnings" }, { v: "12,000+", l: "Active riders" }, { v: "18", l: "Cities covered" }],
  ur:     [{ v: "₨ 2,400", l: "اوسط یومیہ کمائی" }, { v: "12,000+", l: "فعال رائیڈرز" }, { v: "18", l: "شہر" }],
  roman:  [{ v: "₨ 2,400", l: "Roz ki avsatan kamaai" }, { v: "12,000+", l: "Active riders" }, { v: "18", l: "Shehar" }],
};

const FEATURES = {
  en: [
    { icon: "⚡", title: "Instant Payouts", desc: "Earnings hit your wallet the moment a delivery is complete — no weekly waits." },
    { icon: "🗺️", title: "Live Navigation", desc: "Built-in GPS routing shows the fastest route in real time, even on slow data." },
    { icon: "🕐", title: "Flexible Hours", desc: "Go online when it suits you. No fixed shifts, no penalties for logging off." },
  ],
  ur: [
    { icon: "⚡", title: "فوری ادائیگی", desc: "ڈیلیوری مکمل ہوتے ہی کمائی آپ کے والیٹ میں پہنچ جاتی ہے۔" },
    { icon: "🗺️", title: "لائیو نیویگیشن", desc: "بلٹ ان GPS روٹنگ سست ڈیٹا پر بھی تیز ترین راستہ دکھاتی ہے۔" },
    { icon: "🕐", title: "لچکدار اوقات", desc: "جب چاہیں آن لائن ہوں۔ کوئی مقررہ شفٹ نہیں، کوئی جرمانہ نہیں۔" },
  ],
  roman: [
    { icon: "⚡", title: "Fori Payment", desc: "Delivery mukammal hote hi kamaai aapke wallet mein pohonch jaati hai." },
    { icon: "🗺️", title: "Live Navigation", desc: "Built-in GPS routing sust data par bhi tez tareen raasta dikhati hai." },
    { icon: "🕐", title: "Lachakdar Auqaat", desc: "Jab chahein online hon. Koi muqarrar shift nahin, koi jurmana nahin." },
  ],
};

const CONTENT = {
  en: {
    appName: "AJKMart Rider",
    tagline: "Earn on your schedule",
    heroTitle: "Your City.\nYour Earnings.",
    heroSub: "Join thousands of riders across AJK and earn delivering food, parcels, and rides — whenever you want.",
    ctaLogin: "Login",
    ctaRegister: "Join as Rider",
    featuresTitle: "Everything you need to earn",
    footerCta: "Start earning today.",
    footerBtn: "Create Rider Account",
    footer: "© 2026 AJKMart · Rider Platform",
  },
  ur: {
    appName: "اے جے کے مارٹ رائیڈر",
    tagline: "اپنے وقت پر کمائیں",
    heroTitle: "آپ کا شہر۔\nآپ کی کمائی۔",
    heroSub: "ہزاروں رائیڈرز کے ساتھ شامل ہوں اور جب چاہیں کھانا، پارسل اور سواری پہنچا کر کمائیں۔",
    ctaLogin: "لاگ ان",
    ctaRegister: "رائیڈر بنیں",
    featuresTitle: "کمائی کے لیے سب کچھ موجود",
    footerCta: "آج کمانا شروع کریں۔",
    footerBtn: "رائیڈر اکاؤنٹ بنائیں",
    footer: "© 2026 اے جے کے مارٹ · رائیڈر پلیٹ فارم",
  },
  roman: {
    appName: "AJKMart Rider",
    tagline: "Apne waqt par kamayein",
    heroTitle: "Aapka Shehar.\nAapki Kamaai.",
    heroSub: "Hazaron riders ke sath shamil hon aur jab chahen khana, parcel aur sawari pohoncha kar kamayein.",
    ctaLogin: "Login Karein",
    ctaRegister: "Rider Banein",
    featuresTitle: "Kamaai ke liye sab kuch maujood",
    footerCta: "Aaj kamaana shuru karein.",
    footerBtn: "Rider Account Banayein",
    footer: "© 2026 AJKMart · Rider Platform",
  },
};

export function GuestLanding() {
  const [, navigate] = useLocation();
  const { language, setLanguage } = useLanguage();
  const [scrolled, setScrolled] = useState(false);
  const isRTL = language === "ur";

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const C = CONTENT[language as keyof typeof CONTENT] ?? CONTENT.en;
  const stats = STATS[language as keyof typeof STATS] ?? STATS.en;
  const features = FEATURES[language as keyof typeof FEATURES] ?? FEATURES.en;

  return (
    <div
      className="dark"
      style={{ minHeight: "100vh", backgroundColor: "var(--login-hero-from)", color: "var(--color-foreground)", overflowX: "hidden" }}
      dir={isRTL ? "rtl" : "ltr"}
    >

      {/* ── Sticky Header ── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        backgroundColor: "rgba(11,14,17,0.95)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--color-border)",
        height: scrolled ? 52 : 64,
        transition: "height 0.2s ease",
      }}>
        <div style={{
          maxWidth: 960, margin: "0 auto", padding: `0 ${scrolled ? "0.75rem" : "1rem"}`,
          height: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          transition: "padding 0.2s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{
              width: scrolled ? 28 : 36, height: scrolled ? 28 : 36, borderRadius: 10,
              backgroundColor: "var(--login-brand)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: scrolled ? 14 : 18, flexShrink: 0, transition: "all 0.2s ease",
            }}>
              🏍️
            </div>
            {!scrolled && (
              <span style={{ fontWeight: 800, color: "var(--login-brand)", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {C.appName}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setLanguage(cycleLang(language))}
              style={{
                height: scrolled ? 28 : 34, padding: "0 12px", borderRadius: 99,
                backgroundColor: "var(--login-otp-filled-bg)", border: "1px solid var(--login-brand-border)",
                color: "var(--login-brand)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                transition: "height 0.2s ease",
              }}
            >
              🌐 {LANG_LABELS[language] ?? "EN"}
            </button>

            <button
              onClick={() => navigate("/login")}
              style={{
                height: scrolled ? 28 : 34, padding: "0 14px", borderRadius: 10,
                border: "1px solid var(--login-brand-border)", backgroundColor: "transparent",
                color: "var(--login-brand)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                transition: "height 0.2s ease",
              }}
            >
              {C.ctaLogin}
            </button>
            <button
              onClick={() => navigate("/register")}
              style={{
                height: scrolled ? 28 : 34, padding: "0 14px", borderRadius: 10,
                backgroundColor: "var(--login-brand)", border: "none",
                color: "var(--login-hero-from)", fontSize: 12, fontWeight: 800, cursor: "pointer",
                boxShadow: "0 0 12px var(--login-brand-glow-sm)",
                transition: "height 0.2s ease",
              }}
            >
              {C.ctaRegister}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section style={{
        position: "relative", overflow: "hidden",
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, var(--login-otp-filled-bg) 0%, transparent 70%), var(--login-hero-from)",
        padding: "80px 24px 64px",
        textAlign: "center",
      }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 600, height: 300, borderRadius: "50%", background: "var(--login-brand-glow-blob)", filter: "blur(60px)" }} />
        </div>

        <div style={{ maxWidth: 640, margin: "0 auto", position: "relative" }}>
          <div style={{
            display: "inline-block", borderRadius: 99, padding: "6px 16px",
            backgroundColor: "var(--login-otp-filled-bg)", border: "1px solid var(--login-brand-border)",
            color: "var(--login-brand)", fontSize: 12, fontWeight: 700, marginBottom: 24, letterSpacing: "0.05em",
          }}>
            ✨ {C.tagline}
          </div>

          <h1 style={{ fontSize: "clamp(2rem, 6vw, 3.5rem)", fontWeight: 900, color: "var(--color-foreground)", lineHeight: 1.1, marginBottom: 20, whiteSpace: "pre-line" }}>
            {C.heroTitle}
          </h1>
          <p style={{ fontSize: 17, color: "var(--color-muted-foreground)", lineHeight: 1.7, maxWidth: 500, margin: "0 auto 36px" }}>
            {C.heroSub}
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/register")}
              style={{
                height: 52, padding: "0 32px", borderRadius: 12,
                backgroundColor: "var(--login-brand)", border: "none", color: "var(--login-hero-from)",
                fontSize: 15, fontWeight: 800, cursor: "pointer",
                boxShadow: "0 4px 24px var(--login-brand-glow-md)",
              }}
            >
              {C.ctaRegister} →
            </button>
            <button
              onClick={() => navigate("/login")}
              style={{
                height: 52, padding: "0 32px", borderRadius: 12,
                backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)",
                color: "var(--color-foreground)", fontSize: 15, fontWeight: 700, cursor: "pointer",
              }}
            >
              {C.ctaLogin}
            </button>
          </div>
        </div>
      </section>

      {/* ── Stats Strip ── */}
      <section style={{ backgroundColor: "var(--color-card)", borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "stretch" }}>
          {stats.map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: "28px 16px", textAlign: "center",
              borderRight: i < stats.length - 1 ? "1px solid var(--color-border)" : "none",
            }}>
              <div style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 900, color: "var(--login-brand)", marginBottom: 4 }}>
                {s.v}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-muted-foreground)", fontWeight: 500 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature Cards ── */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "64px 24px" }}>
        <h2 style={{ textAlign: "center", fontSize: "clamp(1.3rem, 3vw, 1.8rem)", fontWeight: 800, color: "var(--color-foreground)", marginBottom: 40 }}>
          {C.featuresTitle}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          {features.map((f) => (
            <div
              key={f.title}
              style={{
                backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)",
                borderRadius: 20, padding: "28px 24px",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "var(--login-brand-border)";
                (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 1px var(--login-brand-border)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)";
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                backgroundColor: "var(--login-otp-filled-bg)", border: "1px solid var(--login-brand-border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, marginBottom: 16,
              }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--color-foreground)", marginBottom: 8 }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: "var(--color-muted-foreground)", lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section style={{
        background: "linear-gradient(135deg, var(--login-hero-via) 0%, var(--color-card) 100%)",
        border: "1px solid var(--color-border)",
        margin: "0 24px 48px", borderRadius: 24,
        padding: "56px 24px", textAlign: "center",
        maxWidth: 720, marginLeft: "auto", marginRight: "auto",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 400, height: 200, background: "var(--login-brand-glow-blob)", borderRadius: "50%", filter: "blur(40px)", pointerEvents: "none" }} />
        <div style={{ fontSize: 48, marginBottom: 16 }}>💰</div>
        <h2 style={{ fontSize: "clamp(1.3rem, 3vw, 1.8rem)", fontWeight: 900, color: "var(--color-foreground)", marginBottom: 24 }}>
          {C.footerCta}
        </h2>
        <button
          onClick={() => navigate("/register")}
          style={{
            height: 54, padding: "0 40px", borderRadius: 14,
            backgroundColor: "var(--login-brand)", border: "none", color: "var(--login-hero-from)",
            fontSize: 15, fontWeight: 800, cursor: "pointer",
            boxShadow: "0 4px 24px var(--login-brand-glow-md)",
          }}
        >
          {C.footerBtn}
        </button>
      </section>

      <footer style={{ textAlign: "center", fontSize: 12, color: "var(--color-muted-foreground)", padding: "24px 16px 40px" }}>
        {C.footer}
      </footer>
    </div>
  );
}

export default GuestLanding;
