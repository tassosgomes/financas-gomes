export {
  authClient,
  logout,
  signInWithGoogle,
  signOut,
  useAuthSession,
} from "@/modules/auth/client";

export { toAuthClientError } from "@/modules/auth/contracts";

export type { AuthClient } from "@/modules/auth/client";
export type {
  AuthClientError,
  AuthClientStatus,
  AuthClientViewState,
} from "@/modules/auth/contracts";
