import type { FinancialContext } from "@/modules/households/contracts";

/**
 * Deterministic reference fixtures for the incremental T13 suites.
 *
 * The suffix range is reserved for T13 so this data can be seeded and
 * removed safely from a shared disposable PostgreSQL database later. The
 * database uses ARCHIVED as the inactive state for accounts/categories.
 */
export const S03_FIXTURES = {
  users: {
    a: {
      id: "00000000-0000-7000-8000-000000131101",
      name: "T13 Owner A",
      email: "t13-owner-a@example.test",
    },
    b: {
      id: "00000000-0000-7000-8000-000000131102",
      name: "T13 Owner B",
      email: "t13-owner-b@example.test",
    },
  },
  households: {
    a: "00000000-0000-7000-8000-000000132101",
    b: "00000000-0000-7000-8000-000000132102",
  },
  accounts: {
    activeA: {
      id: "00000000-0000-7000-8000-000000133101",
      householdId: "00000000-0000-7000-8000-000000132101",
      name: "T13 Account A",
      status: "ACTIVE" as const,
      trackingStartedOn: "2026-08-20",
    },
    archivedA: {
      id: "00000000-0000-7000-8000-000000133102",
      householdId: "00000000-0000-7000-8000-000000132101",
      name: "T13 Archived Account A",
      status: "ARCHIVED" as const,
      trackingStartedOn: null,
    },
    beforeTrackingA: {
      id: "00000000-0000-7000-8000-000000133103",
      householdId: "00000000-0000-7000-8000-000000132101",
      name: "T13 Account Before Tracking A",
      status: "ACTIVE" as const,
      trackingStartedOn: "2026-08-20",
    },
    activeB: {
      id: "00000000-0000-7000-8000-000000133104",
      householdId: "00000000-0000-7000-8000-000000132102",
      name: "T13 Account B",
      status: "ACTIVE" as const,
      trackingStartedOn: null,
    },
  },
  categories: {
    expenseA: {
      id: "00000000-0000-7000-8000-000000134101",
      householdId: "00000000-0000-7000-8000-000000132101",
      name: "T13 Expense A",
      status: "ACTIVE" as const,
      kind: "EXPENSE" as const,
    },
    incomeA: {
      id: "00000000-0000-7000-8000-000000134102",
      householdId: "00000000-0000-7000-8000-000000132101",
      name: "T13 Income A",
      status: "ACTIVE" as const,
      kind: "INCOME" as const,
    },
    archivedA: {
      id: "00000000-0000-7000-8000-000000134103",
      householdId: "00000000-0000-7000-8000-000000132101",
      name: "T13 Archived Expense A",
      status: "ARCHIVED" as const,
      kind: "EXPENSE" as const,
    },
    expenseB: {
      id: "00000000-0000-7000-8000-000000134104",
      householdId: "00000000-0000-7000-8000-000000132102",
      name: "T13 Expense B",
      status: "ACTIVE" as const,
      kind: "EXPENSE" as const,
    },
  },
} as const;

export const S03_CONTEXTS = {
  a: {
    userId: S03_FIXTURES.users.a.id,
    householdId: S03_FIXTURES.households.a,
  },
  b: {
    userId: S03_FIXTURES.users.b.id,
    householdId: S03_FIXTURES.households.b,
  },
} as const satisfies Record<"a" | "b", FinancialContext>;

export const S03_HOUSEHOLD_IDS = [
  S03_FIXTURES.households.a,
  S03_FIXTURES.households.b,
] as const;

export const S03_USER_IDS = [
  S03_FIXTURES.users.a.id,
  S03_FIXTURES.users.b.id,
] as const;

