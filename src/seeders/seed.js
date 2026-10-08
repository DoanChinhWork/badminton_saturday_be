/**
 * Seed script - Create admin account
 * Run: npm run seed
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const config = require('../config');

const seedAdmin = async () => {
  try {
    console.log('🌱 Starting seed...');
    console.log('📡 Connecting to MongoDB...');

    await mongoose.connect(config.MONGODB_URI);
    console.log('✅ MongoDB connected');

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ username: 'chinhdd' });
    if (existingAdmin) {
      console.log('⚠️ Admin account "chinhdd" already exists. Updating password...');
      existingAdmin.password = await bcrypt.hash('210203', 12);
      existingAdmin.name = 'Đoàn Duy Chính';
      existingAdmin.role = 'admin';
      await existingAdmin.save();
      console.log('✅ Admin password updated');
    } else {
      const hashedPassword = await bcrypt.hash('210203', 12);
      await Admin.create({
        username: 'chinhdd',
        password: hashedPassword,
        name: 'Đoàn Duy Chính',
        role: 'admin'
      });
      console.log('✅ Admin account created:');
      console.log('   Username: chinhdd');
      console.log('   Password: 210203');
    }

    // Check if scorer account "admin" exists
    const existingScorer = await Admin.findOne({ username: 'admin' });
    const scorerPassword = await bcrypt.hash('12345678', 12);
    if (existingScorer) {
      console.log('⚠️ Scorer account "admin" already exists. Updating password & role...');
      existingScorer.password = scorerPassword;
      existingScorer.name = 'Trọng Tài Tỉ Số';
      existingScorer.role = 'scorer';
      await existingScorer.save();
      console.log('✅ Scorer account "admin" updated');
    } else {
      await Admin.create({
        username: 'admin',
        password: scorerPassword,
        name: 'Trọng Tài Tỉ Số',
        role: 'scorer'
      });
      console.log('✅ Scorer account created:');
      console.log('   Username: admin');
      console.log('   Password: 12345678');
      console.log('   Role: scorer (Chỉ nhập tỉ số)');
    }

    console.log('🌱 Seed completed!');
  } catch (error) {
    console.error('❌ Seed error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
    process.exit(0);
  }
};

seedAdmin();
