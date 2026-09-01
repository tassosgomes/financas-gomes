import type { Metadata } from "next";

import { InviteAcceptanceScreen } from "@/components/households/invite-acceptance-screen";

export const metadata: Metadata = {
  title: "Aceitar convite · Finanças Gomes",
  description: "Aceite um convite para participar de um espaço financeiro compartilhado.",
};

export default function InvitePage() {
  return <InviteAcceptanceScreen />;
}
