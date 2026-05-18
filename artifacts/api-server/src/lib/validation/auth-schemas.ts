/**
 * auth-schemas.ts — canonical auth validation schema module
 *
 * Single source of truth for all authentication and registration Zod schemas
 * used across auth routes (otp, register, password, social, magic-link, merge,
 * refresh, complete-profile, 2FA). All auth routes MUST import schemas from
 * this module rather than from schemas.ts directly or defining schemas inline.
 *
 * Non-auth schemas (orders, wallet, products, etc.) remain in schemas.ts.
 */

export {
  UserLoginSchema,
  SendOtpSchema,
  VerifyOtpSchema,
  SendEmailOtpSchema,
  VerifyEmailOtpSchema,
  LoginVerifyOtpSchema,
  CompleteProfileSchema,
  SetPasswordSchema,
  SocialGoogleSchema,
  SocialFacebookSchema,
  TotpCodeSchema,
  TwoFaVerifySchema,
  TwoFaRecoverySchema,
  TrustDeviceSchema,
  MagicLinkSendSchema,
  MagicLinkVerifySchema,
  VerifyResetOtpSchema,
  ResetPasswordSchema,
  EmailRegisterSchema,
  LogoutSchema,
  ValidateTokenSchema,
  CheckAvailableSchema,
  ChangePhoneRequestSchema,
  ChangePhoneConfirmSchema,
  LinkGoogleSchema,
  LinkFacebookSchema,
  FirebaseVerifySchema,
  SendMergeOtpSchema,
  MergeAccountSchema,
  VendorRegisterSchema,
} from "./schemas.js";
