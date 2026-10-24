// Creates a user, or resets the password of an existing one.
//
//   APP_SCOPE=phantom npm run create-user
//
// Optional environment variables:
//   ADMIN_USERNAME   user name (default: Admin)
//   ADMIN_PASSWORD   password (default: a random one, shown once at the end)
//   APP_SCOPE        phantom, detori or default
require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("./model/user");

const mongoUri = process.env.MONGODB_URI;
const USERNAME = process.env.ADMIN_USERNAME || "Admin";
const APP_SCOPE = process.env.APP_SCOPE || "default";

// 16 characters from letters and digits, without look-alikes (0/O, 1/l/I)
function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(16), byte => alphabet[byte % alphabet.length]).join("");
}

const generated = !process.env.ADMIN_PASSWORD;
const PASSWORD = process.env.ADMIN_PASSWORD || randomPassword();

async function upsertUser() {
  try {
    if (!mongoUri) {
      throw new Error("MONGODB_URI is not set in backend/.env");
    }
    if (PASSWORD.length < 6) {
      throw new Error("The password must be at least 6 characters long");
    }

    await mongoose.connect(mongoUri);
    console.log(`Connected to database '${mongoose.connection.name}'`);

    const existingUser = await User.findOne({ username: USERNAME.toLowerCase() });

    if (existingUser) {
      existingUser.password = PASSWORD;
      existingUser.appScope = APP_SCOPE;
      await existingUser.save();
      console.log(`User '${USERNAME}' updated (scope: ${APP_SCOPE}); the password was reset.`);
    } else {
      const newUser = new User({
        username: USERNAME,
        password: PASSWORD,
        appScope: APP_SCOPE,
      });

      await newUser.save();
      console.log(`User '${USERNAME}' created (scope: ${APP_SCOPE}).`);
    }

    if (generated) {
      console.log(`Password: ${PASSWORD}`);
      console.log("Write it down now, it is not shown again. Change it in the Password tab after logging in.");
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error upserting user:", error.message);
    process.exit(1);
  }
}

upsertUser();
