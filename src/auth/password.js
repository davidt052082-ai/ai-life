import bcrypt from "bcryptjs";

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("密码至少需要 8 位。");
  }

  return bcrypt.hash(password, 12);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
