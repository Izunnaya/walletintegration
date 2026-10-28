import "dotenv/config";

// npm run admin:password — set the admin password deliberately.
//
// The seed writes the admin password once and never resets it, because a deployed credential
// should not change because somebody ran the seed again. That rule left a gap: once the row
// exists there was no way to change the password at all, so a database seeded before
// SEED_ADMIN_PASSWORD was set kept whatever default it was given — in this project's case,
// the one published in the README.
//
// This is the deliberate path. It is a separate command, it requires the variable to be set,
// and it refuses to write a weak value. It never runs as part of a deploy.

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
    // bcrypt ignores anything past 72 bytes, so a longer value would be silently truncated.
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
      console.error("The password was written but does not verify. Nothing has been changed.");
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
