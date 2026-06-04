const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8:53', '8.8.4.4:53']);
require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Atlas connected'))
  .catch(err => { console.error('MongoDB error:', err.message); process.exit(1); });

const loginSchema = new mongoose.Schema({
  userId    : String,
  name      : String,
  email     : String,
  sessionId : String,
  loginTime : { type: Date, default: Date.now },
  ip        : String,
  location  : {
    city    : String,
    region  : String,
    country : String,
    isp     : String,
    lat     : Number,
    lon     : Number,
  },
  browser   : String,
  userAgent : String,
});

const querySchema = new mongoose.Schema({
  userId    : String,
  email     : String,
  sessionId : String,
  chatId    : String,
  queryText : String,
  language  : String,
  timestamp : { type: Date, default: Date.now },
});

const LoginEvent = mongoose.model('LoginEvent', loginSchema);
const QueryEvent = mongoose.model('QueryEvent', querySchema);

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

async function geolocate(ip) {
  const locals = ['::1', '127.0.0.1', 'unknown'];
  if (locals.includes(ip) || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { city: 'Localhost', region: 'Dev', country: 'Local', isp: 'Local', lat: 0, lon: 0 };
  }
  try {
    const r = await fetch('http://ip-api.com/json/' + ip + '?fields=status,country,regionName,city,lat,lon,isp');
    const d = await r.json();
    if (d.status === 'success') {
      return { city: d.city, region: d.regionName, country: d.country, isp: d.isp, lat: d.lat, lon: d.lon };
    }
  } catch (e) {}
  return { city: 'Unknown', region: 'Unknown', country: 'Unknown', isp: 'Unknown', lat: 0, lon: 0 };
}

function parseBrowser(ua) {
  ua = ua || '';
  if (ua.indexOf('Edg')     > -1) return 'Edge';
  if (ua.indexOf('OPR')     > -1) return 'Opera';
  if (ua.indexOf('Chrome')  > -1) return 'Chrome';
  if (ua.indexOf('Firefox') > -1) return 'Firefox';
  if (ua.indexOf('Safari')  > -1) return 'Safari';
  return 'Other';
}

app.post('/api/track/login', async function(req, res) {
  try {
    const userId    = req.body.userId;
    const name      = req.body.name;
    const email     = req.body.email;
    const sessionId = req.body.sessionId;
    const userAgent = req.body.userAgent;
    const ip        = getClientIP(req);
    const location  = await geolocate(ip);
    await LoginEvent.create({ userId, name, email, sessionId, ip, location, browser: parseBrowser(userAgent), userAgent: userAgent || '' });
    console.log('Login tracked: ' + email + ' from ' + location.city + ', ' + location.country);
    res.json({ ok: true });
  } catch (err) {
    console.error('Login track error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/track/query', async function(req, res) {
  try {
    const userId    = req.body.userId;
    const email     = req.body.email;
    const sessionId = req.body.sessionId;
    const chatId    = req.body.chatId;
    const queryText = req.body.queryText;
    const language  = req.body.language;
    await QueryEvent.create({ userId, email, sessionId, chatId, queryText, language });
    console.log('Query tracked: ' + email + ': ' + queryText.slice(0, 60));
    res.json({ ok: true });
  } catch (err) {
    console.error('Query track error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', async function(req, res) {
  try {
    const totalLogins   = await LoginEvent.countDocuments();
    const totalQueries  = await QueryEvent.countDocuments();
    const emails        = await LoginEvent.distinct('email');
    const uniqueUsers   = emails.length;
    const recentLogins  = await LoginEvent.find().sort({ loginTime: -1 }).limit(20).lean();
    const recentQueries = await QueryEvent.find().sort({ timestamp: -1 }).limit(20).lean();
    const byCountry     = await LoginEvent.aggregate([
      { $group: { _id: '$location.country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ totalLogins, totalQueries, uniqueUsers, recentLogins, recentQueries, byCountry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', function(req, res) {
  res.json({ status: 'Law Tracker API running' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('Server running: http://localhost:' + PORT);
  console.log('Stats page:     http://localhost:' + PORT + '/api/admin/stats');
});