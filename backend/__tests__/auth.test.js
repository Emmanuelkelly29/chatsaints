'use strict';

// Set env vars BEFORE any requires
process.env.JWT_SECRET = 'test-secret-key-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.NODE_ENV = 'test';

jest.mock('../src/config/database', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }),
  keys: { userOnline: (id) => `online:${id}`, scriptureCurrent: () => 'scripture:current' },
}));

const request = require('supertest');
const { query } = require('../src/config/database');
const app = require('../src/app');

beforeEach(() => jest.clearAllMocks());

describe('POST /api/auth/register', () => {
  test('registers a YSA member successfully', async () => {
    query.mockResolvedValueOnce({ rows: [] });           // phone uniqueness check
    query.mockResolvedValueOnce({ rows: [{             // user insert
      id: 'uuid-001', full_name: 'Tunde Okafor',
      phone_number: '+2348012345678', role: 'ysa_member',
      status: 'active', is_approved: true,
    }]});
    query.mockResolvedValueOnce({ rows: [] });           // stake pool insert

    const res = await request(app).post('/api/auth/register').send({
      phone_number: '+2348012345678', full_name: 'Tunde Okafor',
      date_of_birth: '2000-03-15', password: 'SecurePass123',
      role: 'ysa_member', stake_id: 'stake-001',
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.role).toBe('ysa_member');
    expect(res.body.user.is_approved).toBe(true);
    expect(res.body.message).toContain('successfully');
  });

  test('registers a bishop — pending approval', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{
      id: 'uuid-002', full_name: 'Emeka Nwosu',
      phone_number: '+2348087654321', role: 'bishop',
      status: 'active', is_approved: false,
    }]});
    query.mockResolvedValueOnce({ rows: [] }); // leader_approvals

    const res = await request(app).post('/api/auth/register').send({
      phone_number: '+2348087654321', full_name: 'Emeka Nwosu',
      date_of_birth: '1980-01-10', password: 'SecurePass123', role: 'bishop',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.is_approved).toBe(false);
    expect(res.body.message).toContain('approval');
  });

  test('rejects duplicate phone number', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

    const res = await request(app).post('/api/auth/register').send({
      phone_number: '+2348012345678', full_name: 'Dup User',
      date_of_birth: '1995-06-20', password: 'pass1234', role: 'ysa_member',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already registered');
  });

  test('rejects missing required fields', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ phone_number: '+2348012345678' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  test('logs in with correct credentials', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correctpassword', 1);

    query.mockResolvedValueOnce({ rows: [{
      id: 'uuid-001', full_name: 'Tunde Okafor',
      phone_number: '+2348012345678', email: null,
      role: 'ysa_member', status: 'active', is_approved: true,
      stake_id: 'stake-001', mission_id: null,
      missionary_mode_active: false, profile_hidden: false,
      password_hash: hash,
    }]});
    query.mockResolvedValueOnce({ rows: [] }); // last_seen update

    const res = await request(app).post('/api/auth/login')
      .send({ phone_number: '+2348012345678', password: 'correctpassword' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.full_name).toBe('Tunde Okafor');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  test('rejects wrong password', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('actualpassword', 1);
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', status: 'active', password_hash: hash }] });

    const res = await request(app).post('/api/auth/login')
      .send({ phone_number: '+2348012345678', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('rejects suspended account', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', status: 'suspended', password_hash: 'x' }] });
    const res = await request(app).post('/api/auth/login')
      .send({ phone_number: '+234xxx', password: 'pass' });
    expect(res.status).toBe(403);
  });

  test('rejects missing password', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone_number: '+234xxx' });
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Unknown routes', () => {
  test('returns 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});
