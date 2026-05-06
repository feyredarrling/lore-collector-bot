require("dotenv").config({ path: ".env.test" });

if (process.env.BOT_MODE !== "test") {
  throw new Error("Safety stop: BOT_MODE must be test.");
}

const lorcana = require("./lib/lorcana");

console.log("Cards loaded:", lorcana.cards.length);
console.log("Test random card:", lorcana.getRandomCardFromSet("The First Chapter"));