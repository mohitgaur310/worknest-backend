const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

let dummyHashPromise;

function dummyPasswordHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash('worknest-dummy-password', SALT_ROUNDS);
  }
  return dummyHashPromise;
}

function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function passwordMatches(password, passwordHash) {
  const hash = passwordHash || (await dummyPasswordHash());
  return bcrypt.compare(password, hash);
}

module.exports = {
  hashPassword,
  passwordMatches,
};
