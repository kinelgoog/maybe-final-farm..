const mongoose = require('mongoose');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  const [iv, encrypted] = text.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), Buffer.from(iv, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'hex')), decipher.final()]).toString();
}

const AccountSchema = new mongoose.Schema({
  steamId: { 
    type: String, 
    required: true, 
    unique: true,
    default: () => `acc_${Date.now()}`
  },
  login: { type: String, required: true },
  password: { type: String, required: true },
  appIds: { type: [Number], default: [730] },
  totalMinutes: { type: Number, default: 0 },
  totalCards: { type: Number, default: 0 },
  lastCardDrop: Date,
  lastActive: { type: Date, default: Date.now },
  achievements: { type: [String], default: [] }
});

AccountSchema.methods.decryptPassword = function() {
  return decrypt(this.password);
};

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/idler', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).catch(console.error);

module.exports = {
  Account: mongoose.model('Account', AccountSchema),
  encrypt,
  decrypt
};
