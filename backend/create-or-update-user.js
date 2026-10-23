require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./model/user");

const mongoUri = process.env.MONGODB_URI;
const USERNAME = "Admin";
const PASSWORD = "admin123@";
const APP_SCOPE = process.env.APP_SCOPE || 'default';
async function upsertUser() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    // Check if user exists
    const existingUser = await User.findOne({ username: USERNAME });

    if (existingUser) {
      // Update existing user
      existingUser.password = PASSWORD;
      existingUser.appScope = APP_SCOPE;
      await existingUser.save();
      console.log(`User '${USERNAME}' updated with new password`);
    } else {
      // Create new user
      const newUser = new User({
        username: USERNAME,
        password: PASSWORD,
        appScope: APP_SCOPE,
      });

      await newUser.save();
      console.log(`New user '${USERNAME}' created successfully`);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error upserting user:", error);
    process.exit(1);
  }
}

upsertUser();
