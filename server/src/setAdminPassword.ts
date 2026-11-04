import "dotenv/config";

const ADMIN_EMAIL = "admin@wallet.internal";
const MINIMUM_LENGTH = 12;

const run = async () => {
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    console.error(
      "SEED_ADMIN_PASSWORD is not set. Set it in the environment and run this again.",
    );
    process.exitCode = 1;
    return;
  }

  if (password.trim().length < MINIMUM_LENGTH) {
    console.error(
      `SEED_ADMIN_PASSWORD must be at least ${MINIMUM_LENGTH} characters that are not surrounding whitespace.`,
    );
    process.exitCode = 1;
    return;
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    // bcrypt reads at most 72 UTF-8 bytes; reject longer passwords before hashing.
    console.error("SEED_ADMIN_PASSWORD must be at most 72 UTF-8 bytes, which is all bcrypt reads.");
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import("./models/db.ts");
  const { hashPassword, verifyPassword } = await import("./models/password.ts");

  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

    if (!admin) {
      console.error(`No ${ADMIN_EMAIL} account exists. Run npm run seed first.`);
      process.exitCode = 1;
      return;
    }

    if (admin.role !== "admin") {
      // Refuses to touch a customer row, however it came to hold that address.
      console.error(`${ADMIN_EMAIL} is not an admin account. Refusing to change it.`);
      process.exitCode = 1;
      return;
    }

    const unchanged = await verifyPassword(password, admin.passwordHash);
    if (unchanged) {
      console.log("The admin password already matches SEED_ADMIN_PASSWORD. Nothing to do.");
      return;
    }

    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(password), updatedAt: new Date() },
    });

    // Confirmed by reading it back and verifying, rather than trusting the write.
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    const works = await verifyPassword(password, updated.passwordHash);

    if (!works) {
      console.error("The password hash was written but does not verify. The admin account may be unusable. Re-run this command.");
      process.exitCode = 1;
      return;
    }

    console.log(`Admin password updated for ${ADMIN_EMAIL}.`);
    console.log("Share it privately with reviewers. Do not put it in the README.");
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
