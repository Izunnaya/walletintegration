import bcrypt from "bcrypt";

// Password hashing, which is a library's job and never ours.
//
// bcrypt is deliberately slow, and the cost factor is what makes it slow. 12 is roughly
// 250ms per hash on current hardware: unnoticeable on one login, and expensive enough that
// guessing a stolen hash offline is not worth starting. Raising it later is safe - the cost
// is stored inside each hash, so old hashes keep verifying with the cost they were made at.
const COST_FACTOR = 12;

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, COST_FACTOR);
}

export function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
