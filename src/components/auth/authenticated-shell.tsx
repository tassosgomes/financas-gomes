import Link from "next/link";
import {
  ArrowLeftRight,
  CalendarRange,
  Database,
  LayoutDashboard,
  Tags,
  WalletCards,
  WalletMinimal,
} from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { AUTHENTICATED_ROUTE } from "@/modules/auth/routes";
import {
  ACCOUNTS_ROUTE,
  CATEGORIES_SETTINGS_ROUTE,
} from "@/modules/accounts-categories/routes";
import {
  TRANSACTION_IMPORT_ROUTE,
  TRANSACTIONS_ROUTE,
} from "@/modules/transactions/routes";
import { CREDIT_CARD_ROUTES } from "@/components/credit-cards/ui-contracts";
import { FORECAST_ROUTE } from "@/modules/forecast/routes";
import {
  EXPORT_SETTINGS_NAV_LABEL,
  EXPORT_SETTINGS_ROUTE,
} from "@/modules/export/routes";

export interface AuthenticatedShellUser {
  name: string;
  email: string;
}

export interface AuthenticatedShellProps {
  children: React.ReactNode;
  householdName: string;
  user: AuthenticatedShellUser;
}

/**
 * Small desktop-oriented frame for private routes. Future private features
 * can add navigation items here without changing the server-side context
 * boundary in `src/app/app/layout.tsx`.
 */
export function AuthenticatedShell({
  children,
  householdName,
  user,
}: AuthenticatedShellProps) {
  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="border-b bg-card">
        <div className="container flex min-h-20 max-w-7xl items-center justify-between gap-6 py-4">
          <Link
            aria-label="Ir para o início do espaço financeiro"
            className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={AUTHENTICATED_ROUTE}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <WalletCards aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-wide text-foreground">
                Finanças Gomes
              </span>
              <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">
                {householdName}
              </span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-4">
            <div
              aria-label="Usuário conectado"
              className="hidden text-right sm:block"
            >
              <p className="max-w-44 truncate text-sm font-medium">
                {user.name}
              </p>
              <p className="max-w-52 truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="container grid max-w-7xl gap-6 py-6 md:grid-cols-[13rem_minmax(0,1fr)] md:py-8">
        <nav
          aria-label="Navegação rápida"
          className="flex gap-2 overflow-x-auto md:hidden"
        >
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={AUTHENTICATED_ROUTE}
          >
            Visão geral
          </Link>
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={ACCOUNTS_ROUTE}
          >
            Contas
          </Link>
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={TRANSACTIONS_ROUTE}
          >
            Lançamentos
          </Link>
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={CREDIT_CARD_ROUTES.collection}
          >
            Cartões
          </Link>
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={FORECAST_ROUTE}
          >
            Fluxo futuro
          </Link>
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={TRANSACTION_IMPORT_ROUTE}
          >
            Importar CSV
          </Link>
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={CATEGORIES_SETTINGS_ROUTE}
            prefetch={false}
          >
            Categorias
          </Link>
          <Link
            className="shrink-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={EXPORT_SETTINGS_ROUTE}
            prefetch={false}
          >
            {EXPORT_SETTINGS_NAV_LABEL}
          </Link>
        </nav>
        <aside className="hidden md:block">
          <nav aria-label="Navegação do espaço financeiro">
            <div className="space-y-1">
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={AUTHENTICATED_ROUTE}
              >
                <LayoutDashboard aria-hidden="true" className="size-4" />
                Visão geral
              </Link>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={ACCOUNTS_ROUTE}
              >
                <WalletMinimal aria-hidden="true" className="size-4" />
                Contas
              </Link>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={TRANSACTIONS_ROUTE}
              >
                <ArrowLeftRight aria-hidden="true" className="size-4" />
                Lançamentos
              </Link>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={CREDIT_CARD_ROUTES.collection}
              >
                <WalletCards aria-hidden="true" className="size-4" />
                Cartões
              </Link>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={FORECAST_ROUTE}
              >
                <CalendarRange aria-hidden="true" className="size-4" />
                Fluxo futuro
              </Link>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={TRANSACTION_IMPORT_ROUTE}
              >
                <ArrowLeftRight aria-hidden="true" className="size-4" />
                Importar CSV
              </Link>
            </div>

            <div className="mt-7 space-y-1">
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Configurações
              </p>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={CATEGORIES_SETTINGS_ROUTE}
                prefetch={false}
              >
                <Tags aria-hidden="true" className="size-4" />
                Categorias
              </Link>
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={EXPORT_SETTINGS_ROUTE}
                prefetch={false}
              >
                <Database aria-hidden="true" className="size-4" />
                {EXPORT_SETTINGS_NAV_LABEL}
              </Link>
            </div>
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
