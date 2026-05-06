require("dotenv").config({ path: ".env.test" });

const { createClient } = require("@supabase/supabase-js");

if (process.env.BOT_MODE !== "test") {
  throw new Error("Safety stop: BOT_MODE must be test.");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testConnection() {
  console.log("BOT_MODE:", process.env.BOT_MODE);
  console.log("SUPABASE_URL:", process.env.SUPABASE_URL);

  const testUser = {
    discord_user_id: "TEST_USER_123",
    username: "TestUser",
    ink_balance: 500
  };

  const { data, error } = await supabase
    .from("users")
    .upsert(testUser)
    .select();

  if (error) {
    console.error("Supabase insert error:", error.message);
    return;
  }

  console.log("Test user inserted successfully.");
  console.log(data);
}

testConnection();