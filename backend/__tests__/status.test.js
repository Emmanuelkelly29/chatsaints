process.env.JWT_SECRET = 'test-secret-key-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.NODE_ENV = 'test';
'use strict';
/**
 * STATUS CONTROLLER — Unit Tests
 * Tests visibility logic and stealth mode for the 24-hour status feature.
 */

// Mock DB and Redis
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }),
  keys: { scriptureCurrent: () => 'scripture:current' },
}));
jest.mock('../src/utils/accessControl', () => ({
  isMissionaryLocked: jest.fn().mockReturnValue(false),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-secret-key-for-jest-tests-only';

const { query } = require('../src/config/database');
const app = require('../src/app');

// Helper: generate a valid JWT for a test user
const makeToken = (user = {}) => jwt.sign(
  { userId: user.id || 'test-user-id' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

const mockUser = {
  id: 'test-user-id',
  full_name: 'Test User',
  phone_number: '+2348000000001',
  email: null,
  role: 'ysa_member',
  status: 'active',
  stake_id: 'stake-001',
  mission_id: null,
  mission_president_mission_id: null,
  missionary_mode_active: false,
  profile_hidden: false,
  is_approved: true,
  stealth_status_view: false,
  status_visibility_default: 'contacts_only',
  fcm_token: null,
  apns_token: null,
};

beforeEach(() => jest.clearAllMocks());

describe('POST /api/statuses', () => {
  test('creates a status successfully', async () => {
    // authenticate middleware query
    query.mockResolvedValueOnce({ rows: [mockUser] });
    // insert status
    query.mockResolvedValueOnce({ rows: [] });

    const token = makeToken(mockUser);
    const res = await request(app)
      .post('/api/statuses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        media_url: '/uploads/test-image.jpg',
        media_type: 'image',
        caption: 'Hello from Abeokuta!',
        visibility: 'contacts_only',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status_id');
    expect(res.body).toHaveProperty('expires_at');
  });

  test('rejects status without media_url', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] });

    const token = makeToken(mockUser);
    const res = await request(app)
      .post('/api/statuses')
      .set('Authorization', `Bearer ${token}`)
      .send({ caption: 'No media attached', visibility: 'contacts_only' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('media_url');
  });

  test('rejects invalid visibility value', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] });

    const token = makeToken(mockUser);
    const res = await request(app)
      .post('/api/statuses')
      .set('Authorization', `Bearer ${token}`)
      .send({ media_url: '/uploads/x.jpg', visibility: 'invalid_option' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('visibility');
  });

  test('rejects status from unauthenticated user', async () => {
    const res = await request(app)
      .post('/api/statuses')
      .send({ media_url: '/uploads/x.jpg' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/statuses/mine', () => {
  test('returns own statuses with viewer info', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] }); // auth
    // own statuses
    query.mockResolvedValueOnce({
      rows: [{
        id: 'status-001',
        media_url: '/uploads/img.jpg',
        media_type: 'image',
        caption: 'Test status',
        visibility: 'contacts_only',
        duration_secs: 5,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: new Date().toISOString(),
      }],
    });
    // viewers for status-001 (non-stealth)
    query.mockResolvedValueOnce({ rows: [{ viewer_id: 'v1', viewed_at: new Date().toISOString(), full_name: 'Viewer One', profile_photo_url: null }] });
    // stealth count
    query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const token = makeToken(mockUser);
    const res = await request(app)
      .get('/api/statuses/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('viewers');
    expect(res.body[0].stealth_view_count).toBe(2);
    expect(res.body[0].view_count).toBe(1);
  });
});

describe('PATCH /api/statuses/settings', () => {
  test('updates stealth setting', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] }); // auth
    query.mockResolvedValueOnce({ rows: [] }); // update

    const token = makeToken(mockUser);
    const res = await request(app)
      .patch('/api/statuses/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ stealth_status_view: true, status_visibility_default: 'contacts_only' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('updated');
  });

  test('rejects invalid default visibility', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] }); // auth

    const token = makeToken(mockUser);
    const res = await request(app)
      .patch('/api/statuses/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ status_visibility_default: 'nobody' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/statuses/:id', () => {
  test('owner can delete their own status', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] }); // auth
    query.mockResolvedValueOnce({ rows: [{ id: 'status-001' }] }); // delete returns row

    const token = makeToken(mockUser);
    const res = await request(app)
      .delete('/api/statuses/status-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Status deleted');
  });

  test('returns 404 when deleting non-existent or others status', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] }); // auth
    query.mockResolvedValueOnce({ rows: [] }); // delete returns nothing

    const token = makeToken(mockUser);
    const res = await request(app)
      .delete('/api/statuses/not-mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
