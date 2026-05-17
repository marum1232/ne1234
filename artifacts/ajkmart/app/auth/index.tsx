/**
 * app/auth/index.tsx — ajkmart (Expo / React Native)
 *
 * Thin wrapper that re-exports the unified auth LoginScreen from
 * lib/auth/LoginScreen.tsx so all auth logic lives in one place.
 */
import { LoginScreen } from "@/lib/auth/LoginScreen";
export default function AuthScreen() {
  return <LoginScreen />;
}
