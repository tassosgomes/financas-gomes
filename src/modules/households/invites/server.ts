import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  householdInvites,
  householdMembers,
  households,
} from "@/db/schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import { AuthGuardError, requireAuth } from "@/modules/auth/server";
import { captureServerException } from "@/modules/observability/server";

import { requireFinancialContext } from "../context";
import {
  FinancialContextError,
  type FinancialContext,
} from "../contracts";
import {
  HouseholdProvisioningError,
  hashHouseholdInviteToken,
  provisionFirstAccess,
} from "../server";
import {
  DEFAULT_HOUSEHOLD_INVITE_TTL_SECONDS,
  HOUSEHOLD_INVITE_ACCEPT_PATH,
  HOUSEHOLD_INVITE_ERROR_CODES,
  HOUSEHOLD_INVITE_QUERY_PARAMETER,
  HOUSEHOLD_INVITE_TOKEN_BYTES,
  type AcceptHouseholdInviteCommand,
  type AcceptedHouseholdInvite,
  type CreateHouseholdInviteCommand,
  type CreateHouseholdInviteForContextCommand,
  type HouseholdInviteErrorCode,
  type HouseholdInviteResult,
  type InviteExpirationOptions,
  HouseholdInviteError,
} from "./contracts";

const HOUSEHOLD_INVITE_TTL_ENV = "HOUSEHOLD_INVITE_TTL_SECONDS";

function hasCode(
  value: unknown,
): value is { code: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

function isHouseholdInviteErrorCode(
  value: unknown,
): value is HouseholdInviteErrorCode {
  return (
    typeof value === "string" &&
    HOUSEHOLD_INVITE_ERROR_CODES.includes(value as HouseholdInviteErrorCode)
  );
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function normalizeNow(value: Date | undefined): Date {
  const now = value === undefined ? new Date() : cloneDate(value);

  if (!isValidDate(now)) {
    throw new HouseholdInviteError("INVITE_INPUT_INVALID");
  }

  return now;
}

function readConfiguredTtl(): number | undefined {
  const raw = process.env[HOUSEHOLD_INVITE_TTL_ENV]?.trim();
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed;
  }

  // Configuration is optional. An invalid optional value falls back to the
  // documented default rather than exposing environment details to clients.
  return undefined;
}

/** Resolves the per-invite, environment, or default expiration duration. */
export function resolveHouseholdInviteTtlSeconds(
  options: InviteExpirationOptions = {},
): number {
  const requested =
    options.expiresInSeconds ?? options.expiresIn ?? options.ttlSeconds;
  const configured = requested === undefined ? readConfiguredTtl() : undefined;
  const seconds =
    requested ?? configured ?? DEFAULT_HOUSEHOLD_INVITE_TTL_SECONDS;

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new HouseholdInviteError("INVITE_INPUT_INVALID");
  }

  return seconds;
}

function normalizeContext(context: FinancialContext): FinancialContext {
  if (
    !context ||
    typeof context.userId !== "string" ||
    typeof context.householdId !== "string" ||
    !context.userId.trim() ||
    !context.householdId.trim()
  ) {
    throw new FinancialContextError("INVALID_FINANCIAL_CONTEXT");
  }

  return {
    userId: context.userId.trim(),
    householdId: context.householdId.trim(),
  };
}

function resolveInviteOrigin(baseUrl: string | undefined): string {
  const fallback =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    "http://localhost:3000";

  try {
    const parsed = new URL(baseUrl?.trim() || fallback);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported invite origin");
    }
    return parsed.origin;
  } catch {
    throw new HouseholdInviteError("INVITE_INPUT_INVALID");
  }
}

function buildInviteUrl(origin: string, token: string): string {
  const url = new URL(HOUSEHOLD_INVITE_ACCEPT_PATH, origin);
  url.searchParams.set(HOUSEHOLD_INVITE_QUERY_PARAMETER, token);
  return url.toString();
}

function newInviteToken(): string {
  // base64url avoids escaping and keeps the copied link compact. This value
  // is returned to the caller only as part of the link and is never inserted.
  return randomBytes(HOUSEHOLD_INVITE_TOKEN_BYTES).toString("base64url");
}

function mapProvisioningError(error: unknown): HouseholdInviteError | null {
  if (error instanceof HouseholdInviteError) {
    return error;
  }

  if (error instanceof AuthGuardError) {
    return new HouseholdInviteError(
      error.code === "UNAUTHENTICATED"
        ? "UNAUTHENTICATED"
        : "INVALID_FINANCIAL_CONTEXT",
    );
  }

  if (error instanceof FinancialContextError) {
    return new HouseholdInviteError(error.code);
  }

  if (error instanceof HouseholdProvisioningError) {
    if (isHouseholdInviteErrorCode(error.code)) {
      return new HouseholdInviteError(error.code);
    }
  }

  if (hasCode(error) && isHouseholdInviteErrorCode(error.code)) {
    return new HouseholdInviteError(error.code);
  }

  return null;
}

/**
 * Inserts one invite after revalidating both the household and its creator in
 * the same transaction as the insert. The raw bearer token never crosses the
 * database boundary: only its SHA-256 digest is persisted.
 */
export async function createHouseholdInviteForContext(
  command: CreateHouseholdInviteForContextCommand,
): Promise<HouseholdInviteResult> {
  const context = normalizeContext(command.context);
  const now = normalizeNow(command.now);
  const ttlSeconds = resolveHouseholdInviteTtlSeconds(command);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
  if (!isValidDate(expiresAt)) {
    throw new HouseholdInviteError("INVITE_INPUT_INVALID");
  }

  const origin = resolveInviteOrigin(command.baseUrl);
  const rawToken = newInviteToken();
  const tokenHash = hashHouseholdInviteToken(rawToken);
  const inviteId = generateUuidV7();

  try {
    const inserted = await getDb().transaction(async (transaction) => {
      // This is deliberately repeated after requireFinancialContext. A
      // membership can be revoked between the guard and this write.
      const creator = await transaction
        .select({ household: households, membership: householdMembers })
        .from(householdMembers)
        .innerJoin(
          households,
          eq(householdMembers.householdId, households.id),
        )
        .where(
          and(
            eq(householdMembers.householdId, context.householdId),
            eq(householdMembers.userId, context.userId),
          ),
        )
        .limit(1)
        .for("update");

      if (!creator[0]) {
        throw new HouseholdInviteError("HOUSEHOLD_MEMBERSHIP_REQUIRED");
      }

      const rows = await transaction
        .insert(householdInvites)
        .values({
          id: inviteId,
          householdId: context.householdId,
          tokenHash,
          expiresAt,
          createdBy: context.userId,
        })
        .returning({
          id: householdInvites.id,
          householdId: householdInvites.householdId,
          expiresAt: householdInvites.expiresAt,
          createdAt: householdInvites.createdAt,
        });

      const row = rows[0];
      if (!row) {
        throw new HouseholdInviteError("INVITE_CREATION_FAILED");
      }

      return row;
    });

    return {
      id: inserted.id,
      householdId: inserted.householdId,
      expiresAt: cloneDate(inserted.expiresAt),
      createdAt: cloneDate(inserted.createdAt),
      inviteUrl: buildInviteUrl(origin, rawToken),
    };
  } catch (error) {
    const expected = mapProvisioningError(error);
    if (expected) {
      throw expected;
    }

    // Only opaque IDs and the use-case name cross the observability boundary.
    // In particular, neither rawToken nor tokenHash is part of this context.
    try {
      captureServerException(new Error("household invite creation failed"), {
        event: "household_invite_creation_error",
        useCase: "create_household_invite",
        userId: context.userId,
        householdId: context.householdId,
        route: "/api/invites",
      });
    } catch {
      // Observability must not change the expected failure path.
    }

    throw new HouseholdInviteError("INVITE_CREATION_FAILED");
  }
}

/**
 * Authenticated creator entrypoint. `householdId` is only a selection hint;
 * requireFinancialContext resolves and validates the actual tenant server
 * side, then the transaction above checks the membership again.
 */
export async function createHouseholdInvite(
  command: CreateHouseholdInviteCommand = {},
): Promise<HouseholdInviteResult> {
  const requestedHouseholdId =
    command.requestedHouseholdId ?? command.householdId;
  const context = await requireFinancialContext({
    requestHeaders: command.requestHeaders,
    requestedHouseholdId,
  });

  return createHouseholdInviteForContext({
    ...command,
    context,
  });
}

/** Authenticated guest entrypoint; the T06 transaction consumes the invite. */
export async function acceptHouseholdInvite(
  command: AcceptHouseholdInviteCommand,
): Promise<AcceptedHouseholdInvite> {
  if (
    !command ||
    typeof command.token !== "string" ||
    command.token.trim().length === 0
  ) {
    throw new HouseholdProvisioningError("INVITATION_INVALID");
  }

  const session = await requireAuth(command.requestHeaders);
  const provisioned = await provisionFirstAccess({
    user: session.user,
    inviteToken: command.token,
    now: command.now,
  });

  if (!provisioned.invitationAccepted) {
    // A token-bearing request must always consume an invitation. This guards
    // against accidentally routing a normal first-access result here.
    throw new HouseholdProvisioningError("INVITATION_INVALID");
  }

  return {
    accepted: true,
    householdId: provisioned.household.id,
    household: {
      id: provisioned.household.id,
      name: provisioned.household.name,
    },
    membershipCreated: provisioned.created.membership,
    context: provisioned.context,
  };
}

/** Stable aliases for adapters that use shorter use-case names. */
export const createInvite = createHouseholdInvite;
export const createInviteForContext = createHouseholdInviteForContext;
export const acceptInvite = acceptHouseholdInvite;
