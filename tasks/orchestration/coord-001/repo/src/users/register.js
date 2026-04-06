const { validate } = require('./validate');
const { saveUser } = require('./store');

/**
 * Registers a new user.
 * Validates the email, then saves the user to the store.
 */
async function register(email, name) {
  const validation = validate(email);
  if (validation.error) {
    return { success: false, error: validation.error };
  }
  const user = await saveUser({ email, name });
  return { success: true, user };
}

module.exports = { register };
