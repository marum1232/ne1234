/**
 * app/auth/register.tsx — ajkmart (Expo / React Native)
 *
 * Thin wrapper that re-exports the unified auth RegisterWizard from
 * lib/auth/RegisterWizard.tsx so all auth logic lives in one place.
 */
import { RegisterWizard } from "@/lib/auth/RegisterWizard";
export default function RegisterScreen() {
  return <RegisterWizard />;
}
