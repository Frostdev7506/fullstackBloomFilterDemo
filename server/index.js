const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { z } = require('zod');
const { BloomFilter } = require('bloomfilter');
const {
  normalizeEmail, countUsers, getAllEmails, findUserByEmail, createUser, seedIfEmpty
} = require('./db');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

seedIfEmpty();

/**
 * Bloom filter parameters
 */
function computeBloomParams(n, p) {
  const m = Math.ceil((-(n * Math.log(p))) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  const roundedM = Math.ceil(m / 32) * 32;
  return { m: roundedM, k };
}

let bloom;
let bloomConfig;

function rebuildBloom() {
  const total = countUsers();
  const expected = Math.max(total * 2, 1000);
  const p = 0.01;
  const { m, k } = computeBloomParams(expected, p);

  bloom = new BloomFilter(m, k);
  for (const email of getAllEmails()) {
    bloom.add(normalizeEmail(email));
  }
  bloomConfig = { expectedCapacity: expected, targetFPP: p, bits: m, hashes: k, currentItems: total };
  console.log('[Bloom] rebuilt', bloomConfig);
}
rebuildBloom();

const EmailSchema = z.object({
  email: z.string().email().transform((e) => normalizeEmail(e)),
});
const RegisterSchema = EmailSchema.extend({
  name: z.string().min(2).max(100),
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'fullstack-bloom-demo', bloom: bloomConfig });
});

app.post('/api/auth/check-email', (req, res) => {
  const parsed = EmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email' });

  const email = parsed.data.email;
  const maybePresent = bloom.test(email);
  res.json({
    email,
    maybePresent,
    meaning: maybePresent
      ? 'This email MAY be registered (Bloom hit). Will double-check on submit.'
      : 'This email is definitely not registered (Bloom miss).'
  });
});

app.post('/api/auth/register', (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid name or email' });

  const { name, email } = parsed.data;

  if (!bloom.test(email)) {
    try {
      const user = createUser({ email, name });
      bloom.add(email);
      bloomConfig.currentItems += 1;
      return res.status(201).json({ user, created: true, via: 'fast-path' });
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Email already registered', race: true });
      }
      return res.status(500).json({ error: 'Server error' });
    }
  }

  const existing = findUserByEmail(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  try {
    const user = createUser({ email, name });
    bloom.add(email);
    bloomConfig.currentItems += 1;
    return res.status(201).json({ user, created: true, via: 'false-positive-path' });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/_stats', (_req, res) => {
  res.json({ ...bloomConfig });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
