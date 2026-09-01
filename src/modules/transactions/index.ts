export * from "./contracts";
export * from "./domain";
export * from "./ids";
export * from "./references";
export * from "./reads";
export * from "./review-contracts";
export * from "./review-reads";
export * from "./routes";
export * from "./use-cases";
export * from "./validation";

// Both S03 and S05 expose result helpers with the same names. Keep the
// established S03 helpers as the unqualified barrel exports; consumers that
// need the S05-specific error type/result can import `review-contracts`
// directly. Explicit exports resolve the two star-export collisions for
// TypeScript without changing either module's public contract.
export { errorResult, failure, ok, success } from "./contracts";
