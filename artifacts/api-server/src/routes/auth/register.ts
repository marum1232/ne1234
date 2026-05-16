import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import crypto, { randomBytes, createHash, randomInt } from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable, refreshTokensTable, magicLinkTokensTable, rateLimitsTable, pendingOtpsTable, userSessionsTable, loginHistoryTable, vendorProfilesTable, riderProfilesTable, totpRecoveryCodesTable, userTotpSetupTable } from "@workspace/db/schema";
import { eq, and, sql, lt, or, desc, ilike, isNull } from "drizzle-orm";
import { generateId } from "../../lib/id.js";
import { getPlatformSettings } from "../admin.js";
import { emitWebhookEvent } from "../../lib/webhook-emitter.js";
import { fireAndForget } from "../../lib/fireAndForget.js";
import { checkLockout, recordFailedAttempt, resetAttempts, addAuditEntry, addSecurityEvent, getClientIp, getCachedSettings, signUserJwt, signAccessToken, sign2faChallengeToken, verify2faChallengeToken, generateRefreshToken, hashRefreshToken, isRefreshTokenValid, revokeRefreshToken, revokeAllUserRefreshTokens, verifyUserJwt, blacklistJti, writeAuthAuditLog, getRefreshTokenTtlDays, getAccessTokenTtlSec, verifyCaptcha, checkAvailableRateLimit } from "../../middleware/security.js";
import { sendOtpSMS, isSMSProviderConfigured, isSMSConsoleActive } from "../../services/sms.js";
import { sendOtpWithFailover, getWhitelistBypass } from "../../services/smsGateway.js";
import { sendWhatsAppOTP, isWhatsAppProviderConfigured } from "../../services/whatsapp.js";
import { hashPassword, verifyPassword, validatePasswordStrength, generateSecureOtp } from "../../services/password.js";
import { generateTotpSecret, verifyTotpToken, generateQRCodeDataURL, getTotpUri, encryptTotpSecret, decryptTotpSecret } from "../../services/totp.js";
import { sendVerificationEmail, sendPasswordResetEmail, sendMagicLinkEmail, alertNewVendor, isEmailProviderConfigured } from "../../services/email.js";
import { getUserLanguage, getPlatformDefaultLanguage } from "../../lib/getUserLanguage.js";
import { t } from "@workspace/i18n";
import { logger } from "../../lib/logger.js";
import { sendError, sendErrorWithData, sendUnauthorized, sendForbidden, sendNotFound, sendInternalError, sendTooManyRequests, sendSuccess, sendCreated } from "../../lib/response.js";
import { clearSpoofHits } from "../rider/index.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { isAuthMethodEnabled, isAuthMethodEnabledStrict } from "@workspace/auth-utils/server";
import { validateBody as sharedValidateBody } from "../../middleware/validate.js";
import { authLimiter, loginLimiter, otpLimiter } from "../../middleware/rate-limit.js";
import { hashOtp, isValidCanonicalPhone, normalizeVehicleTypeForStorage, generateVerificationToken, hashVerificationToken, tryEncrypt, decryptPii, setRiderRefreshCookie, clearRiderRefreshCookie, setVendorRefreshCookie, clearVendorRefreshCookie, RIDER_REFRESH_COOKIE, RIDER_REFRESH_COOKIE_PATH, VENDOR_REFRESH_COOKIE, VENDOR_REFRESH_COOKIE_PATH } from "./helpers.js";
import { rotateRefreshToken, invalidateTokenFamily } from "../../services/auth/tokenRotation.js";
import {
  AUTH_OTP_TTL_MS,
  CNIC_REGEX,
  PHONE_REGEX,
  forgotPasswordSchema,
  registerSchema,
  refreshTokenSchema,
  checkIdentifierSchema,
  sendOtpSchema,
  verifyOtpSchema,
  loginSchema,
  VendorRegisterSchema,
  CompleteProfileSchema,
  EmailRegisterSchema,
  extractAuthUser,
} from "./helpers.js";

const router: IRouter = Router();

router.post("/vendor-register", sharedValidateBody(VendorRegisterSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) {
    sendUnauthorized(res, "Authentication required. Please verify your phone via OTP first.");
    return;
  }

  const { storeName, storeCategory, name, cnic, address, city, bankName, bankAccount, bankAccountTitle, username, acceptedTermsVersion } = req.body;
  if (!storeName) {
    sendError(res, "Store name is required", 400);
    return;
  }

  if (username) {
    const normalizedUsername = String(username).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (normalizedUsername.length < 3) {
      sendError(res, "Username must be at least 3 characters", 400);
      return;
    }
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(sql`lower(${usersTable.username}) = ${normalizedUsername} AND ${usersTable.id} != ${auth.userId}`)
      .limit(1);
    if (existing) {
      sendError(res, "Username is already taken", 409);
      return;
    }
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) {
    sendNotFound(res, "User not found.");
    return;
  }

  if (!user.phoneVerified) {
    sendForbidden(res, "Phone number not verified. Please verify OTP first.");
    return;
  }

  const existingRoles = (user.roles || "").split(",").map((r: string) => r.trim()).filter(Boolean);
  if (existingRoles.includes("vendor")) {
    if (user.approvalStatus === "pending") {
      sendSuccess(res, { success: true, status: "pending", message: "Your vendor application is already pending admin approval." });
      return;
    }
    if (user.approvalStatus === "approved") {
      sendSuccess(res, { success: true, status: "approved", message: "You are already approved as a vendor." });
      return;
    }
  }

  const newRoles = existingRoles.includes("vendor") ? existingRoles : [...existingRoles, "vendor"];
  const settings = await getCachedSettings();
  const autoApprove = (settings["vendor_auto_approve"] ?? "off") === "on";

  await db.update(usersTable).set({
    roles: newRoles.join(","),
    name: name || user.name,
    username: username ? String(username).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) : user.username || null,
    cnic: cnic || user.cnic || null,
    address: address || user.address || null,
    city: city || user.city || null,
    bankName: bankName || user.bankName || null,
    bankAccount: bankAccount || user.bankAccount || null,
    bankAccountTitle: bankAccountTitle || user.bankAccountTitle || null,
    approvalStatus: autoApprove ? "approved" : "pending",
    isActive: autoApprove ? true : false,
    ...(acceptedTermsVersion ? { acceptedTermsVersion: String(acceptedTermsVersion) } : {}),
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  await db.insert(vendorProfilesTable).values({
    userId: user.id,
    storeName,
    storeCategory: storeCategory || null,
  }).onConflictDoUpdate({
    target: vendorProfilesTable.userId,
    set: { storeName, storeCategory: storeCategory || null },
  });

  if (acceptedTermsVersion) {
    try {
      const ip = getClientIp(req);
      await db.execute(sql`
        INSERT INTO consent_log (id, user_id, consent_type, consent_version, ip_address, created_at)
        VALUES (${generateId()}, ${user.id}, 'terms_acceptance', ${String(acceptedTermsVersion)}, ${ip}, NOW())
      `);
    } catch (err) { /* intentional: non-fatal guard */ void err; }
  }

  await db.insert(notificationsTable).values({
    id: generateId(),
    userId: user.id,
    title: autoApprove ? "Welcome, Vendor! 🎉" : "Application Submitted ⏳",
    body: autoApprove
      ? "Your vendor account is approved! Start adding products and manage your store."
      : "Your vendor registration is pending admin approval. We'll notify you once approved.",
    type: "system",
    icon: autoApprove ? "checkmark-circle-outline" : "time-outline",
  }).catch((err: unknown) => {
    logger.warn({ message: "[auth] vendor-registration notification insert failed", error: err instanceof Error ? err.message : String(err), code: "AUTH_VENDOR_NOTIF_FAILED", correlationId: null, timestamp: new Date().toISOString(), userId: user.id }, "[auth] vendor-registration notification insert failed");
  });

  if (!autoApprove) {
    const admins = await db.select({ id: usersTable.id }).from(usersTable)
      .where(ilike(usersTable.roles, "%admin%"));
    const adminNotifs = admins.map(a => ({
      id: generateId(),
      userId: a.id,
      title: "New Vendor Application 📋",
      body: `${name || user.name || user.phone} has applied to become a vendor with store "${storeName}". Review and approve in the admin panel.`,
      type: "system" as const,
      icon: "storefront-outline",
    }));
    if (adminNotifs.length) {
      fireAndForget(
        db.insert(notificationsTable).values(adminNotifs),
        "auth:vendor-application-admin-notifs",
        logger,
        { userId: user.id, code: "AUTH_ADMIN_NOTIF_FAILED" },
      );
    }
  }

  if (!autoApprove) {
    fireAndForget(
      alertNewVendor(name || user.name || user.phone || "Unknown", user.phone || "N/A", storeName, settings),
      "auth:alert-new-vendor",
      logger,
      { userId: user.id, code: "AUTH_ALERT_VENDOR_FAILED" },
    );
  }

  sendSuccess(res, {
    success: true,
    status: autoApprove ? "approved" : "pending",
    message: autoApprove
      ? "Your vendor account is approved! You can now log in."
      : "Your application has been submitted. Admin will review and approve your account.",
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/validate-token
   Client can use this to check if their token is still valid.
───────────────────────────────────────────────────────────── */

router.post("/complete-profile", sharedValidateBody(CompleteProfileSchema), async (req, res) => {
  try {
  /* Accept token from body OR Authorization: Bearer header */
  const authHeader = req.headers["authorization"] as string | undefined;
  const rawToken = req.body?.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const { name, email, username, password, currentPassword, cnic, address, city, area, latitude, longitude, acceptedTermsVersion } = req.body;
  if (!rawToken) { sendUnauthorized(res, "Token required"); return; }

  /* Verify JWT to get userId */
  const payload = verifyUserJwt(rawToken);
  if (!payload) { sendUnauthorized(res, "Invalid or expired token. Please log in again."); return; }
  const userId = payload.userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user)         { sendNotFound(res, "User not found"); return; }
  if (user.isBanned) { sendForbidden(res, "Account suspended. Contact support."); return; }
  if (!user.isActive && user.approvalStatus !== "pending") {
    sendForbidden(res, "Account inactive. Contact support."); return;
  }

  const updates: Record<string, any> = { updatedAt: new Date() };

  if (name && name.trim().length > 1) {
    updates.name = name.trim();
  }

  if (email && email.includes("@")) {
    const normalized = email.toLowerCase().trim();
    /* Check email uniqueness (skip if it's already this user's email) */
    if (normalized !== user.email) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
      if (existing && existing.id !== userId) {
        sendError(res, "Is email se pehle se ek account bana hua hai", 409); return;
      }
    }
    updates.email = normalized;
  }

  if (username && username.length > 2) {
    const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, "").trim();
    if (clean.length < 3) { sendError(res, "Username must be at least 3 characters (letters, numbers, underscore only)", 400); return; }
    if (clean !== user.username) {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${clean}`).limit(1);
      if (existing && existing.id !== userId) {
        sendError(res, "Yeh username pehle se liya hua hai", 409); return;
      }
    }
    updates.username = clean;
  }

  if (cnic && cnic.trim()) {
    const cnicClean = cnic.trim();
    if (CNIC_REGEX.test(cnicClean)) {
      updates.cnic = cnicClean;
      updates.nationalId = cnicClean;
    }
  }

  if (address && typeof address === "string" && address.trim()) {
    updates.address = address.trim();
  }
  if (city && typeof city === "string" && city.trim()) {
    updates.city = city.trim();
  }
  if (area && typeof area === "string" && area.trim()) {
    updates.area = area.trim();
  }
  if (latitude && typeof latitude === "string") {
    updates.latitude = latitude;
  }
  if (longitude && typeof longitude === "string") {
    updates.longitude = longitude;
  }

  if (password && password.length >= 8) {
    if (user.passwordHash) {
      if (!currentPassword) {
        sendError(res, "Current password required to change password", 400); return;
      }
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        sendUnauthorized(res, "Current password galat hai"); return;
      }
    }
    const check = validatePasswordStrength(password);
    if (!check.ok) { sendError(res, check.message, 400); return; }
    updates.passwordHash = hashPassword(password);
  }

  const hasName = updates.name || user.name;
  const hasEmail = updates.email || user.email;
  const hasAddress = updates.address || user.address;
  const hasCity = updates.city || user.city;
  const hasCnic = updates.cnic || user.cnic;
  const hasPassword = updates.passwordHash || user.passwordHash;
  const filledCount = [hasName, hasEmail, hasAddress, hasCity, hasCnic, hasPassword].filter(Boolean).length;
  let newLevel = "bronze";
  if (filledCount >= 5 && hasCnic) newLevel = "gold";
  else if (filledCount >= 3) newLevel = "silver";
  updates.accountLevel = newLevel;

  if (acceptedTermsVersion && typeof acceptedTermsVersion === "string") {
    updates.acceptedTermsVersion = acceptedTermsVersion;
  } else {
    /* Auto-assign current termsVersion if not provided and this is first profile completion */
    try {
      const s = await getCachedSettings();
      const currentTermsVer = s["terms_version"] ?? "";
      if (currentTermsVer && !user.acceptedTermsVersion) {
        updates.acceptedTermsVersion = currentTermsVer;
      }
    } catch (err) { /* intentional: non-fatal guard */ void err; }
  }

  if (Object.keys(updates).length === 1) {
    sendError(res, "Koi update nahi kiya — name, email, username ya password provide karein", 400); return;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();

  if (updates.acceptedTermsVersion) {
    try {
      const ip = getClientIp(req);
      await db.execute(sql`
        INSERT INTO consent_log (id, user_id, consent_type, consent_version, ip_address, created_at)
        VALUES (${generateId()}, ${userId}, 'terms_acceptance', ${updates.acceptedTermsVersion as string}, ${ip}, NOW())
      `);
    } catch (err) { /* intentional: non-fatal guard */ void err; }
  }

  const accessToken = signAccessToken(updated!.id, updated!.phone ?? "", updated!.roles ?? "customer", updated!.roles ?? "customer", updated!.tokenVersion ?? 0);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({
    id:        generateId(),
    userId:    updated!.id,
    tokenHash: refreshHash,
    authMethod: "password",
    expiresAt: refreshExpiresAt,
  });

  fireAndForget(
    db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, updated!.id), lt(refreshTokensTable.expiresAt, new Date()))),
    "auth:expired-token-cleanup:profile_update",
    logger,
    { userId: updated!.id, code: "DB_CLEANUP" },
  );

  setRiderRefreshCookie(req, res, refreshRaw, updated);
  setVendorRefreshCookie(req, res, refreshRaw, updated);

  sendSuccess(res, {
    success: true,
    message: "Profile update ho gaya",
    token: accessToken,
    refreshToken: refreshRaw,
    user: { id: updated!.id, phone: updated!.phone, name: updated!.name, email: updated!.email, username: updated!.username, role: updated!.roles, roles: updated!.roles, avatar: updated!.avatar, cnic: updated!.cnic, city: updated!.city, area: updated!.area, address: updated!.address, latitude: updated!.latitude, longitude: updated!.longitude, kycStatus: updated!.kycStatus, accountLevel: updated!.accountLevel, totpEnabled: updated!.totpEnabled ?? false, emailVerified: updated!.emailVerified, phoneVerified: updated!.phoneVerified, walletBalance: parseFloat(updated!.walletBalance ?? "0"), isActive: updated!.isActive, createdAt: updated!.createdAt.toISOString() },
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/set-password
   Set or change password. Body: { token, password, currentPassword? }
══════════════════════════════════════════════════════════════ */

router.post("/register", verifyCaptcha, sharedValidateBody(registerSchema), async (req, res) => {
  try {
  const { phone, password, name, role, cnic, nationalId, email, username,
          vehicleType, vehicleRegNo, drivingLicense,
          address, city, emergencyContact, vehiclePlate, vehiclePhoto, documents,
          businessName, businessType, storeAddress, ntn, storeName } = req.body;

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const userRole = (role === "rider" || role === "vendor") ? role : "customer";

  if (settings["feature_new_users"] === "off") {
    sendForbidden(res, "New user registration is currently disabled.");
    return;
  }

  /* Per-role registration kill-switch (admin panel: Vendor Registration / Rider Registration).
     When the admin sets vendor_registration or rider_registration to "off",
     the corresponding role cannot complete signup even if phone OTP is on. */
  if (userRole === "vendor" && (settings["vendor_registration"] ?? "on") === "off") {
    sendForbidden(res, "Vendor registration is currently closed by the administrator.");
    return;
  }
  if (userRole === "rider" && (settings["rider_registration"] ?? "on") === "off") {
    sendForbidden(res, "Rider registration is currently closed by the administrator.");
    return;
  }

  /* ── Determine which OTP delivery channels are enabled for this role ── */
  const phoneOtpEnabledForRole = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", userRole);
  const emailOtpEnabledForRole = isAuthMethodEnabled(settings, "auth_email_otp_enabled", userRole);

  /* When BOTH phone OTP and email OTP are disabled for this role, skip OTP verification
     entirely rather than hard-failing — the account is created as verified (same as
     the global OTP bypass, but scoped to the role config). */
  const otpMethodsDisabled = !phoneOtpEnabledForRole && !emailOtpEnabledForRole;

  /* Phone submitted but phone OTP is disabled for this role — reject with GATEWAY_DISABLED.
     Frontend should not send a phone field when phoneEnabled is false (platform-flag-driven UI).
     Exception: when both methods are disabled (otpMethodsDisabled), we skip OTP entirely. */
  if (phone && !phoneOtpEnabledForRole && !otpMethodsDisabled) {
    sendErrorWithData(res, "Phone OTP registration is currently disabled for your account type.", { code: "GATEWAY_DISABLED" }, 400);
    return;
  }

  /* Phone OTP is off but email OTP is on — require an email address. */
  if (!phoneOtpEnabledForRole && !otpMethodsDisabled && !email) {
    sendErrorWithData(res, "Phone OTP is disabled. Please register with an email address for verification.", { code: "GATEWAY_DISABLED" }, 400);
    return;
  }

  /* Phone is required only when phone OTP is the active channel.
     In email-only mode (phoneOtpEnabled=false, emailOtpEnabled=true)
     phone is optional — riders register via email verification. */
  if (!phone && phoneOtpEnabledForRole) {
    sendError(res, "Phone number is required", 400);
    return;
  }
  const cleanedPhone = phone ? phone.replace(/[\s\-()]/g, "") : "";
  if (cleanedPhone && !PHONE_REGEX.test(cleanedPhone)) {
    sendError(res, "Invalid phone number. Use format: 03XXXXXXXXX", 400);
    return;
  }

  if (!password) {
    sendError(res, "Password is required", 400);
    return;
  }
  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.ok) {
    sendError(res, pwCheck.message, 400);
    return;
  }

  const cnicValue = cnic || nationalId;
  if (cnicValue && !CNIC_REGEX.test(cnicValue)) {
    sendError(res, "CNIC format must be XXXXX-XXXXXXX-X", 400);
    return;
  }

  if (userRole === "rider") {
    if (!cnicValue) { sendError(res, "CNIC is required for rider registration", 400); return; }
    if (!vehicleType) { sendError(res, "Vehicle type is required for rider registration", 400); return; }
  }

  if (userRole === "vendor") {
    if (!businessName && !storeName) { sendError(res, "Business/store name is required for vendor registration", 400); return; }
  }

  /* In email-only mode phone may be absent — canonicalize only when present. */
  const normalizedPhone = phone ? canonicalizePhone(phone) : "";
  if (normalizedPhone) {
    const [existingReg] = await db.select().from(usersTable).where(and(eq(usersTable.phone, normalizedPhone), isNull(usersTable.deletedAt))).limit(1);
    if (existingReg) {
      /* Allow re-registration only if the account is pending approval AND phone was never OTP-verified.
         This covers the case where a rider went back during registration and is retrying with the same number. */
      const canOverwrite = existingReg.approvalStatus === "pending" && !existingReg.phoneVerified;
      if (!canOverwrite) {
        /* Verified or approved account — guide user to login instead */
        const friendly = existingReg.phoneVerified
          ? "An account with this phone number already exists. Please log in instead."
          : "An account with this phone number is already pending approval. Please log in to check your status.";
        sendErrorWithData(res, friendly, { existingAccount: true }, 409);
        return;
      }
      /* Stale unverified pending record — soft-delete and allow fresh registration */
      await db.update(usersTable).set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() }).where(eq(usersTable.id, existingReg.id));
    }
  }

  if (email) {
    const normalizedEmail = email.toLowerCase().trim();
    const [existingEmail] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
    if (existingEmail) {
      sendError(res, "An account with this email already exists", 409);
      return;
    }
  }

  let cleanUsername: string | null = null;
  if (username) {
    cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (cleanUsername !== null && cleanUsername.length >= 3) {
      const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${cleanUsername}`).limit(1);
      if (existingUsername) {
        sendError(res, "This username is already taken", 409);
        return;
      }
    } else {
      cleanUsername = null;
    }
  }

  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const autoApproveRider = userRole === "rider" && settings["rider_auto_approve"] === "on";
  const autoApproveVendor = userRole === "vendor" && settings["vendor_auto_approve"] === "on";
  const needsApproval = requireApproval && !autoApproveRider && !autoApproveVendor;

  /* ── OTP bypass detection — mirrors send-otp bypass logic ──────────────── */
  const otpGlobalBypass = settings["security_otp_bypass"] === "on";
  const otpGlobalDisabledUntilStr = settings["otp_global_disabled_until"];
  const otpTimedBypass = otpGlobalDisabledUntilStr
    ? new Date(otpGlobalDisabledUntilStr) > new Date()
    : false;
  const otpBypassed = otpGlobalBypass || otpTimedBypass;

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + AUTH_OTP_TTL_MS);
  const userId = generateId();

  const ajkChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ajkId = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    ajkId = "AJK-";
    for (let i = 0; i < 6; i++) ajkId += ajkChars.charAt(randomInt(0, ajkChars.length));
    const [dup] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.ajkId, ajkId)).limit(1);
    if (!dup) break;
    if (attempt === 9) throw new Error("Failed to generate unique AJK ID after 10 attempts");
  }

  const emailForInsert = email ? email.toLowerCase().trim() : null;
  await db.insert(usersTable).values({
    id: userId,
    phone: normalizedPhone || null,
    encryptedPhone: normalizedPhone ? tryEncrypt(normalizedPhone) : null,
    name: name?.trim() || null,
    email: emailForInsert,
    encryptedEmail: tryEncrypt(emailForInsert),
    username: cleanUsername,

    roles: userRole,
    passwordHash: hashPassword(password),
    otpCode: hashOtp(otp),
    otpExpiry,
    otpUsed: false,
    /* Mark phone as verified immediately when OTP is globally bypassed OR when
       both phone+email OTP are disabled for this role (config-driven skip). */
    phoneVerified: otpBypassed || otpMethodsDisabled,
    walletBalance: "0",
    isActive: !needsApproval,
    approvalStatus: needsApproval ? "pending" : "approved",
    ajkId,
    cnic: cnicValue || null,
    nationalId: cnicValue || null,
    address: address || null,
    city: city || null,
    emergencyContact: emergencyContact || null,
  });

  if (userRole === "rider") {
    await db.insert(riderProfilesTable).values({
      userId,
      vehicleType: vehicleType ? normalizeVehicleTypeForStorage(vehicleType) : null,
      vehicleRegNo: vehicleRegNo || null,
      vehiclePlate: vehiclePlate || vehicleRegNo || null,
      drivingLicense: drivingLicense || null,
      vehiclePhoto: vehiclePhoto || null,
      documents: documents || null,
    });
  }

  if (userRole === "vendor") {
    await db.insert(vendorProfilesTable).values({
      userId,
      businessName: businessName || storeName || null,
      storeName: storeName || businessName || null,
      businessType: businessType || null,
      storeAddress: storeAddress || null,
      ntn: ntn || null,
    });
  }

  writeAuthAuditLog("register", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone: normalizedPhone, role: userRole } });
  fireAndForget(
    emitWebhookEvent("user_registered", { userId, phone: normalizedPhone, role: userRole, method: "username_password" }),
    "auth:webhook:user_registered:username_password",
    logger,
    { userId, code: "WEBHOOK_EMIT" },
  );

  /* ── OTP bypass: skip delivery; issue tokens when account is immediately active ── */
  if (otpBypassed) {
    writeAuthAuditLog("register_otp_bypassed", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone: normalizedPhone, role: userRole } });
    if (!needsApproval) {
      /* Account auto-approved and active — issue access + refresh tokens now */
      const accessToken = signAccessToken(userId, normalizedPhone, userRole, userRole, 0);
      const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
      await db.insert(refreshTokensTable).values({
        id: generateId(), userId, tokenHash: refreshHash, authMethod: "register_otp_bypass",
        expiresAt: new Date(Date.now() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000),
      });
      setRiderRefreshCookie(req, res, refreshRaw, { roles: userRole });
      setVendorRefreshCookie(req, res, refreshRaw, { roles: userRole });
      sendSuccess(res, {
        message: "Registration successful.",
        userId, role: userRole,
        pendingApproval: false,
        otpRequired: false,
        otpSkipped: true,
        channel: "bypass",
        token: accessToken,
        refreshToken: refreshRaw,
        expiresAt: new Date(Date.now() + getAccessTokenTtlSec() * 1000).toISOString(),
      }, undefined, 201);
    } else {
      /* Needs approval — no token yet, flag as pending */
      sendSuccess(res, {
        message: "Registration submitted. Your account is pending admin approval.",
        userId, role: userRole,
        pendingApproval: true,
        otpRequired: false,
        otpSkipped: true,
        channel: "bypass",
      }, undefined, 201);
    }
    return;
  }

  /* ── Both OTP channels disabled for this role: skip OTP, return otpSkipped ──
     otpMethodsDisabled was computed above (both phoneOtpEnabledForRole and
     emailOtpEnabledForRole are false). phoneVerified was already set to true
     in the insert. Issue tokens and return early. */
  if (otpMethodsDisabled) {
    writeAuthAuditLog("register_otp_skipped", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone: normalizedPhone, role: userRole, reason: "otp_disabled_for_role" } });
    if (!needsApproval) {
      const accessToken = signAccessToken(userId, normalizedPhone, userRole, userRole, 0);
      const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
      await db.insert(refreshTokensTable).values({
        id: generateId(), userId, tokenHash: refreshHash, authMethod: "register_otp_skipped",
        expiresAt: new Date(Date.now() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000),
      });
      setRiderRefreshCookie(req, res, refreshRaw, { roles: userRole });
      setVendorRefreshCookie(req, res, refreshRaw, { roles: userRole });
      sendSuccess(res, {
        message: "Registration successful.",
        userId, role: userRole,
        pendingApproval: false,
        otpRequired: false,
        otpSkipped: true,
        channel: "skipped",
        token: accessToken,
        refreshToken: refreshRaw,
        expiresAt: new Date(Date.now() + getAccessTokenTtlSec() * 1000).toISOString(),
      }, undefined, 201);
    } else {
      sendSuccess(res, {
        message: "Registration submitted. Your account is pending admin approval.",
        userId, role: userRole,
        pendingApproval: true,
        otpRequired: false,
        otpSkipped: true,
        channel: "skipped",
      }, undefined, 201);
    }
    return;
  }

  const registerLang = await getUserLanguage(userId);
  const smsResult = await sendOtpSMS(normalizedPhone, otp, settings, registerLang);
  if (settings["integration_whatsapp"] === "on") {
    sendWhatsAppOTP(normalizedPhone, otp, settings, registerLang).catch(err =>
      logger.warn({ err: err.message }, "WhatsApp OTP send failed (non-fatal)")
    );
  }

  const isDev = process.env.NODE_ENV !== "production";
  const isConsoleDelivery = smsResult.provider === "console" || !smsResult.sent;
  sendSuccess(res, {
    message: "Registration successful. Please verify your phone with the OTP sent.",
    userId,
    pendingApproval: needsApproval,
    otpRequired: true,
    channel: smsResult.sent ? smsResult.provider : "console",
    ...(isDev && isConsoleDelivery ? { otp } : {}),
  }, undefined, 201);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});


router.post("/email-register", verifyCaptcha, sharedValidateBody(EmailRegisterSchema), async (req, res) => {
  try {
  const { email, password, name, role, phone, username, cnic, vehicleType, vehicleRegNo, vehicleRegistration, drivingLicense,
          address, city, emergencyContact, vehiclePlate, vehiclePhoto, documents } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const userRole = (role === "rider" || role === "vendor") ? role : "customer";

  if (!isAuthMethodEnabled(settings, "auth_email_register_enabled", userRole)) {
    sendForbidden(res, "Email registration is currently disabled");
    return;
  }

  if (settings["feature_new_users"] === "off") {
    sendForbidden(res, "New user registration is currently disabled.");
    return;
  }

  if (!email || !email.includes("@")) {
    sendError(res, "Valid email address is required", 400);
    return;
  }
  if (!password) {
    sendError(res, "Password is required", 400);
    return;
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.ok) {
    sendError(res, pwCheck.message, 400);
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    sendError(res, "An account with this email already exists", 409);
    return;
  }

  let cleanUsername: string | null = null;
  if (username) {
    cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (cleanUsername !== null && cleanUsername.length >= 3) {
      const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${cleanUsername}`).limit(1);
      if (existingUsername) {
        sendError(res, "This username is already taken", 409);
        return;
      }
    } else {
      cleanUsername = null;
    }
  }

  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const userId = generateId();
  const tempPhone = `email_${Date.now()}_${randomBytes(3).toString("hex")}`;

  const rawToken = generateVerificationToken();
  const tokenHash = hashVerificationToken(rawToken);
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const resolvedPhone = phone?.trim() || tempPhone;
  const resolvedVehicleRegNo = vehicleRegNo || vehicleRegistration || null;

  await db.insert(usersTable).values({
    id: userId,
    phone: resolvedPhone,
    encryptedPhone: tryEncrypt(phone?.trim() || null),
    name: name?.trim() || null,
    email: normalizedEmail,
    encryptedEmail: tryEncrypt(normalizedEmail),
    username: cleanUsername,

    roles: userRole,
    passwordHash: hashPassword(password),
    walletBalance: "0",
    isActive: !requireApproval,
    approvalStatus: requireApproval ? "pending" : "approved",
    emailVerified: false,
    emailOtpCode: tokenHash,
    emailOtpExpiry: verificationExpiry,
    ...(cnic ? { cnic: cnic.trim() } : {}),
    ...(address ? { address: address.trim() } : {}),
    ...(city ? { city: city.trim() } : {}),
    ...(emergencyContact ? { emergencyContact: emergencyContact.trim() } : {}),
  });

  if (userRole === "rider" && (vehicleType || resolvedVehicleRegNo || drivingLicense || vehiclePlate || vehiclePhoto || documents)) {
    await db.insert(riderProfilesTable).values({
      userId,
      vehicleType: vehicleType ? normalizeVehicleTypeForStorage(vehicleType) : null,
      vehicleRegNo: resolvedVehicleRegNo ? resolvedVehicleRegNo.trim() : null,
      vehiclePlate: vehiclePlate ? vehiclePlate.trim() : null,
      drivingLicense: drivingLicense ? drivingLicense.trim() : null,
      vehiclePhoto: vehiclePhoto || null,
      documents: documents || null,
    });
  }

  const domain = process.env["REPLIT_DEV_DOMAIN"] || process.env["APP_DOMAIN"] || "localhost";
  const verificationLink = `https://${domain}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(normalizedEmail)}`;

  const verifyLang = await getUserLanguage(userId);
  const emailResult = await sendVerificationEmail(normalizedEmail, verificationLink, name, verifyLang);

  writeAuthAuditLog("email_register", { userId, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { email: normalizedEmail, role: userRole, emailSent: emailResult.sent } });
  fireAndForget(
    emitWebhookEvent("user_registered", { userId, email: normalizedEmail, role: userRole, method: "email" }),
    "auth:webhook:user_registered:email",
    logger,
    { userId, code: "WEBHOOK_EMIT" },
  );

  const isDevTokenLog = process.env.NODE_ENV === "development" && process.env["LOG_OTP"] === "1";
  if (isDevTokenLog) {
    logger.info({ email: normalizedEmail, emailSent: emailResult.sent }, "Email verification token generated");
  }

  sendCreated(res, {
    userId,
    pendingApproval: requireApproval,
    emailSent: emailResult.sent,
    verificationLink: isDevTokenLog ? verificationLink : undefined,
    ...(isDevTokenLog ? { verificationToken: rawToken } : {}),
  }, emailResult.sent
    ? "Registration successful. Please check your email to verify your account."
    : "Registration successful. Please check your email to verify your account. (Email delivery pending — contact support if not received.)");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});


router.get("/verify-email", async (req, res) => {
  try {
  const { token, email } = req.query as { token?: string; email?: string };
  const ip = getClientIp(req);

  if (!token || !email) {
    sendError(res, "Invalid verification link", 400);
    return;
  }

  const normalizedEmail = decodeURIComponent(email).toLowerCase().trim();
  const verifyKey = `email_verify:${normalizedEmail}`;

  const lockout = await checkLockout(verifyKey, 5, 15);
  if (lockout.locked) {
    sendTooManyRequests(res, `Too many verification attempts. Try again in ${lockout.minutesLeft} minute(s).`);
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);

  if (!user) {
    await recordFailedAttempt(verifyKey, 5, 15);
    sendError(res, "Invalid or expired verification link", 400);
    return;
  }

  if (user.emailVerified) {
    sendSuccess(res, undefined, "Email already verified. You can log in.");
    return;
  }

  if (user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
    sendUnauthorized(res, "Verification link has expired. Please register again.");
    return;
  }

  const incomingHash = hashVerificationToken(decodeURIComponent(token));
  if (!user.emailOtpCode || user.emailOtpCode !== incomingHash) {
    await recordFailedAttempt(verifyKey, 5, 15);
    addAuditEntry({ action: "email_verify_failed", ip, details: `Invalid verification token for ${normalizedEmail}`, result: "fail" });
    sendUnauthorized(res, "Invalid or expired verification link");
    return;
  }

  await db.update(usersTable).set({
    emailVerified: true,
    emailOtpCode: null,
    emailOtpExpiry: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  await resetAttempts(verifyKey);
  writeAuthAuditLog("email_verified", { userId: user.id, ip });

  sendSuccess(res, undefined, "Email verified successfully. You can now log in.");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   HELPER: Extract authenticated user from JWT (Authorization header)
══════════════════════════════════════════════════════════════ */

export default router;