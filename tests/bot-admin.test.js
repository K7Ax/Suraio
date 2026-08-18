// Bot authorization: only configured ADMIN_IDS may run write commands.
// Loads bot.js with a known ADMIN_IDS env so the gate is deterministic.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test";
process.env.ADMIN_IDS = "111,222";
// Force a fresh parse so the module reads the ADMIN_IDS set above, regardless of
// whether another test file already imported bot.js.
delete require.cache[require.resolve("../bot.js")];
const { isAdmin } = require("../bot.js");

test("configured admin ids are allowed (number or string)", () => {
  assert.equal(isAdmin("111"), true);
  assert.equal(isAdmin(222), true); // coerced to string internally
});

test("non-admins are rejected", () => {
  assert.equal(isAdmin("999"), false);
  assert.equal(isAdmin(undefined), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin(""), false);
});
