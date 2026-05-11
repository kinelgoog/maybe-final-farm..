const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || '';
let db = null;

async function connectDB() {
  if (!MONGO_URI) { console.warn('No MONGO_URI, using memory only'); return; }
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('idler');
    console.log('MongoDB connected');
  } catch (e) {
    console.error('MongoDB connect error:', e.message);
  }
}

async function getAccount(login) {
  if (!db) return null;
  return db.collection('accounts').findOne({ login });
}

async function saveAccount(login, data) {
  if (!db) return;
  await db.collection('accounts').updateOne(
    { login },
    { $set: { login, ...data } },
    { upsert: true }
  );
}

async function getAllAccounts() {
  if (!db) return [];
  return db.collection('accounts').find({}).toArray();
}

async function deleteAccount(login) {
  if (!db) return;
  await db.collection('accounts').deleteOne({ login });
}

module.exports = { connectDB, getAccount, saveAccount, getAllAccounts, deleteAccount };
