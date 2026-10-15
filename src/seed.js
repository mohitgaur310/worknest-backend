const Organization = require('./models/organization');
const { User } = require('./models/user');
const { hashPassword } = require('./password');

async function seedIfEmpty() {
  const userCount = await User.countDocuments();
  if (userCount > 0) {
    console.log('Database already has users; skipping admin seed.');
    return;
  }

  const email =
    typeof process.env.ADMIN_EMAIL === 'string' ? process.env.ADMIN_EMAIL.trim().toLowerCase() : '';
  const password = typeof process.env.ADMIN_PASSWORD === 'string' ? process.env.ADMIN_PASSWORD : '';

  if (!email || !password) {
    console.error(
      'No users in the database. Set ADMIN_EMAIL and ADMIN_PASSWORD to seed the first admin.',
    );
    return;
  }

  const organization = await Organization.create({ name: 'Worknest' });
  try {
    await User.create({
      name: 'Admin',
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      organizationId: organization._id,
      active: true,
    });
  } catch (error) {
    await Organization.deleteOne({ _id: organization._id });
    throw error;
  }

  console.log(`Seeded organization "Worknest" and admin ${email}`);
}

module.exports = {
  seedIfEmpty,
};
