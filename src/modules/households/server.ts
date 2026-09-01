import { createHash } from "node:crypto";

import {
  and,
  asc,
  eq,
  gt,
  isNull,
} from "drizzle-orm";

import { getDb } from "@/db";
import {
  householdInvites,
  householdMembers,
  households,
  user as localUser,
} from "@/db/schema";
import type {
  HouseholdInviteRecord,
  HouseholdMemberRecord,
  HouseholdRecord,
} from "@/db/tenancy-schema";
import {
  getServerSession,
  toLocalUserIdentity,
} from "@/modules/auth/server";
import type { LocalUserIdentity } from "@/modules/auth/contracts";
import { captureServerException } from "@/modules/observability/server";
import { generateUuidV7 } from "@/lib/uuidv7";

import type { FinancialContext } from "./contracts";

/** Name used when no first-access wizard has supplied a household name yet. */
export const DEFAULT_FIRST_ACCESS_HOUSEHOLD_NAME = "Espaço financeiro";

/** SHA-256 is stable across the invite creator and invite acceptance paths. */
export const HOUSEHOLD_INVITE_TOKEN_HASH_ALGORITHM = "sha256" as const;

export const HOUSEHOLD_PROVISIONING_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_USER",
  "INVITATION_INVALID",
  "INVITATION_EXPIRED",
  "INVITATION_ALREADY_USED",
  "HOUSEHOLD_SELECTION_REQUIRED",
  "HOUSEHOLD_MEMBERSHIP_REQUIRED",
  "PROVISIONING_FAILED",
] as const;

export type HouseholdProvisioningErrorCode =
  (typeof HOUSEHOLD_PROVISIONING_ERROR_CODES)[number];

export const HOUSEHOLD_PROVISIONING_ERROR_MESSAGES: Record<
  HouseholdProvisioningErrorCode,
  string
> = {
  UNAUTHENTICATED: "É necessário entrar para acessar seu espaço financeiro.",
  INVALID_USER: "Não foi possível identificar o usuário autenticado.",
  INVITATION_INVALID: "O convite não existe ou não é válido.",
  INVITATION_EXPIRED: "O convite expirou. Solicite um novo link.",
  INVITATION_ALREADY_USED: "O convite já foi utilizado.",
  HOUSEHOLD_SELECTION_REQUIRED:
    "Selecione um espaço financeiro para continuar.",
  HOUSEHOLD_MEMBERSHIP_REQUIRED:
    "Você não faz parte do espaço financeiro selecionado.",
  PROVISIONING_FAILED:
    "Não foi possível preparar seu espaço financeiro. Tente novamente.",
};

/** A safe, expected error that can cross a server-action/route boundary. */
export class HouseholdProvisioningError extends Error {
  readonly code: HouseholdProvisioningErrorCode;
  readonly expected = true;

  constructor(code: HouseholdProvisioningErrorCode) {
    super(HOUSEHOLD_PROVISIONING_ERROR_MESSAGES[code]);
    this.name = "HouseholdProvisioningError";
    this.code = code;
  }
}

export interface ProvisionFirstAccessCommand {
  /** Identity returned by Better Auth, normalized with `toLocalUserIdentity`. */
  user: LocalUserIdentity;
  /** Raw bearer token received from a trusted server-side invite flow. */
  inviteToken?: string | null;
  /** Optional display name for the new household; ignored for existing ones. */
  householdName?: string | null;
  /** A server-validated selection, never an authorization source by itself. */
  requestedHouseholdId?: string | null;
  /** Injectable clock for deterministic expiry tests. */
  now?: Date;
}

export interface ProvisionFirstAccessResult {
  user: LocalUserIdentity;
  household: HouseholdRecord;
  membership: HouseholdMemberRecord;
  context: FinancialContext;
  created: {
    user: boolean;
    household: boolean;
    membership: boolean;
  };
  invitationAccepted: boolean;
}

type MembershipWithHousehold = {
  membership: HouseholdMemberRecord;
  household: HouseholdRecord;
};

function normalizeInviteToken(token: string | null | undefined): string | null {
  if (token === undefined || token === null) {
    return null;
  }

  const normalized = token.trim();
  if (normalized.length === 0) {
    throw new HouseholdProvisioningError("INVITATION_INVALID");
  }

  return normalized;
}

function normalizeHouseholdName(name: string | null | undefined): string {
  const normalized = name?.trim();
  if (!normalized) {
    return DEFAULT_FIRST_ACCESS_HOUSEHOLD_NAME;
  }

  // Keep the value bounded before it reaches a not-null text column or UI.
  return normalized.slice(0, 120);
}

function assertUserIdentity(identity: LocalUserIdentity): void {
  if (
    !identity ||
    typeof identity.id !== "string" ||
    typeof identity.email !== "string" ||
    !identity.id.trim() ||
    !identity.email.trim()
  ) {
    throw new HouseholdProvisioningError("INVALID_USER");
  }
}

/** Returns the digest persisted in `household_invites.token_hash`. */
export function hashHouseholdInviteToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    throw new HouseholdProvisioningError("INVITATION_INVALID");
  }

  return createHash(HOUSEHOLD_INVITE_TOKEN_HASH_ALGORITHM)
    .update(normalized, "utf8")
    .digest("hex");
}

async function selectUserForUpdate(
  transaction: Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    tx: infer T,
  ) => Promise<unknown>
    ? T
    : never,
  userId: string,
) {
  return transaction
    .select()
    .from(localUser)
    .where(eq(localUser.id, userId))
    .limit(1)
    .for("update");
}

async function ensureLocalUser(
  transaction: Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    tx: infer T,
  ) => Promise<unknown>
    ? T
    : never,
  identity: LocalUserIdentity,
): Promise<{ row: typeof localUser.$inferSelect; created: boolean }> {
  const existing = await selectUserForUpdate(transaction, identity.id);
  if (existing[0]) {
    return { row: existing[0], created: false };
  }

  const inserted = await transaction
    .insert(localUser)
    .values({
      id: identity.id,
      name: identity.name?.trim() || "Usuário",
      email: identity.email.trim(),
      image: identity.image,
    })
    // Better Auth normally creates this row first. This fallback makes the
    // use case safe when a callback and first-access request race each other.
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { row: inserted[0], created: true };
  }

  // A conflict on the same id is fine; a conflict on another unique key is
  // not. Re-read under a row lock so the caller receives a safe domain error.
  const afterConflict = await selectUserForUpdate(transaction, identity.id);
  if (!afterConflict[0]) {
    throw new HouseholdProvisioningError("INVALID_USER");
  }

  return { row: afterConflict[0], created: false };
}

async function selectMemberships(
  transaction: Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    tx: infer T,
  ) => Promise<unknown>
    ? T
    : never,
  userId: string,
): Promise<MembershipWithHousehold[]> {
  return transaction
    .select({ membership: householdMembers, household: households })
    .from(householdMembers)
    .innerJoin(
      households,
      eq(householdMembers.householdId, households.id),
    )
    .where(eq(householdMembers.userId, userId))
    .orderBy(asc(householdMembers.createdAt), asc(householdMembers.householdId))
    // Revalidate and keep the selected membership alive until this transaction
    // commits, so a concurrent revoke cannot race the returned context.
    .for("update");
}

function selectExistingMembership(
  memberships: MembershipWithHousehold[],
  requestedHouseholdId: string | null | undefined,
): MembershipWithHousehold {
  if (requestedHouseholdId) {
    const selected = memberships.find(
      ({ membership }) => membership.householdId === requestedHouseholdId,
    );
    if (!selected) {
      throw new HouseholdProvisioningError("HOUSEHOLD_MEMBERSHIP_REQUIRED");
    }
    return selected;
  }

  if (memberships.length > 1) {
    throw new HouseholdProvisioningError("HOUSEHOLD_SELECTION_REQUIRED");
  }

  const first = memberships[0];
  if (!first) {
    throw new HouseholdProvisioningError("PROVISIONING_FAILED");
  }
  return first;
}

async function selectInviteForUpdate(
  transaction: Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    tx: infer T,
  ) => Promise<unknown>
    ? T
    : never,
  tokenHash: string,
  now: Date,
): Promise<HouseholdInviteRecord> {
  const valid = await transaction
    .select()
    .from(householdInvites)
    .where(
      and(
        eq(householdInvites.tokenHash, tokenHash),
        isNull(householdInvites.usedAt),
        gt(householdInvites.expiresAt, now),
      ),
    )
    .limit(1)
    .for("update");

  if (valid[0]) {
    return valid[0];
  }

  // Lock the candidate before classifying it. If another acceptance is
  // consuming it, this query waits and observes the committed usedAt value.
  const candidate = await transaction
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.tokenHash, tokenHash))
    .limit(1)
    .for("update");

  if (!candidate[0]) {
    throw new HouseholdProvisioningError("INVITATION_INVALID");
  }
  if (candidate[0].usedAt) {
    throw new HouseholdProvisioningError("INVITATION_ALREADY_USED");
  }
  if (candidate[0].expiresAt <= now) {
    throw new HouseholdProvisioningError("INVITATION_EXPIRED");
  }

  throw new HouseholdProvisioningError("INVITATION_INVALID");
}

async function selectMembership(
  transaction: Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    tx: infer T,
  ) => Promise<unknown>
    ? T
    : never,
  householdId: string,
  userId: string,
): Promise<MembershipWithHousehold | undefined> {
  const selected = await transaction
    .select({ membership: householdMembers, household: households })
    .from(householdMembers)
    .innerJoin(
      households,
      eq(householdMembers.householdId, households.id),
    )
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, userId),
      ),
    )
    .limit(1)
    .for("update");

  return selected[0];
}

function toResult(
  userRow: typeof localUser.$inferSelect,
  selected: MembershipWithHousehold,
  created: ProvisionFirstAccessResult["created"],
  invitationAccepted: boolean,
): ProvisionFirstAccessResult {
  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      image: userRow.image,
    },
    household: selected.household,
    membership: selected.membership,
    context: {
      userId: userRow.id,
      householdId: selected.household.id,
    },
    created,
    invitationAccepted,
  };
}

/**
 * Ensures a persisted local user has a recoverable financial context.
 *
 * The Better Auth user row is locked for the full transaction. Since every
 * concurrent first-access request for the same user must lock that existing
 * row, the membership check and household creation are serialized without a
 * new schema constraint that would break the intentional N:N model.
 */
export async function provisionFirstAccess(
  command: ProvisionFirstAccessCommand,
): Promise<ProvisionFirstAccessResult> {
  assertUserIdentity(command.user);

  const inviteToken = normalizeInviteToken(command.inviteToken);
  const now = command.now ?? new Date();

  try {
    const database = getDb();
    return await database.transaction(async (transaction) => {
      const ensuredUser = await ensureLocalUser(transaction, command.user);
      const userRow = ensuredUser.row;
      const existingMemberships = await selectMemberships(
        transaction,
        userRow.id,
      );

      if (inviteToken) {
        const invite = await selectInviteForUpdate(
          transaction,
          hashHouseholdInviteToken(inviteToken),
          now,
        );
        const existingTargetMembership = await selectMembership(
          transaction,
          invite.householdId,
          userRow.id,
        );

        let membership = existingTargetMembership?.membership;
        const household = existingTargetMembership?.household;
        let membershipCreated = false;

        if (!existingTargetMembership) {
          const insertedMembership = await transaction
            .insert(householdMembers)
            .values({
              householdId: invite.householdId,
              userId: userRow.id,
            })
            .onConflictDoNothing()
            .returning();

          membership = insertedMembership[0];
          membershipCreated = Boolean(membership);
        }

        const target =
          membership && household
            ? { membership, household }
            : await selectMembership(transaction, invite.householdId, userRow.id);

        if (!target) {
          throw new HouseholdProvisioningError("PROVISIONING_FAILED");
        }

        const consumed = await transaction
          .update(householdInvites)
          .set({ usedAt: now })
          .where(
            and(
              eq(householdInvites.id, invite.id),
              isNull(householdInvites.usedAt),
            ),
          )
          .returning({ id: householdInvites.id });

        if (consumed.length === 0) {
          throw new HouseholdProvisioningError("INVITATION_ALREADY_USED");
        }

        return toResult(
          userRow,
          target,
          {
            user: ensuredUser.created,
            household: false,
            membership: membershipCreated,
          },
          true,
        );
      }

      if (existingMemberships.length > 0) {
        return toResult(
          userRow,
          selectExistingMembership(
            existingMemberships,
            command.requestedHouseholdId,
          ),
          {
            user: ensuredUser.created,
            household: false,
            membership: false,
          },
          false,
        );
      }

      if (command.requestedHouseholdId) {
        throw new HouseholdProvisioningError("HOUSEHOLD_MEMBERSHIP_REQUIRED");
      }

      const householdId = generateUuidV7();
      const insertedHousehold = await transaction
        .insert(households)
        .values({
          id: householdId,
          name: normalizeHouseholdName(command.householdName),
        })
        .returning();
      const household = insertedHousehold[0];

      if (!household) {
        throw new HouseholdProvisioningError("PROVISIONING_FAILED");
      }

      const insertedMembership = await transaction
        .insert(householdMembers)
        .values({ householdId, userId: userRow.id })
        .onConflictDoNothing()
        .returning();
      const membership =
        insertedMembership[0] ??
        (
          await selectMembership(transaction, householdId, userRow.id)
        )?.membership;

      if (!membership) {
        throw new HouseholdProvisioningError("PROVISIONING_FAILED");
      }

      return toResult(
        userRow,
        { household, membership },
        {
          user: ensuredUser.created,
          household: true,
          membership: true,
        },
        false,
      );
    });
  } catch (error) {
    if (error instanceof HouseholdProvisioningError) {
      throw error;
    }

    // Observability is best-effort and receives only opaque IDs and a stable
    // use-case name. Never forward the command, token or driver error here.
    try {
      captureServerException(error, {
        event: "household_provisioning_error",
        useCase: "provision_first_access",
        userId: command.user.id,
      });
    } catch {
      // A missing/broken Sentry configuration must not change the failure path.
    }

    throw new HouseholdProvisioningError("PROVISIONING_FAILED");
  }
}

/** Server entrypoint that derives the identity from the Better Auth session. */
export async function provisionAuthenticatedFirstAccess(
  command: Omit<ProvisionFirstAccessCommand, "user"> & {
    requestHeaders?: HeadersInit;
  } = {},
): Promise<ProvisionFirstAccessResult> {
  const session = await getServerSession(command.requestHeaders);
  if (!session?.user) {
    throw new HouseholdProvisioningError("UNAUTHENTICATED");
  }

  return provisionFirstAccess({
    ...command,
    user: toLocalUserIdentity(session.user),
  });
}

/** Explicit alias for callers that prefer the “ensure” wording. */
export const ensureFirstAccess = provisionFirstAccess;
