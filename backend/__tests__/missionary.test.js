process.env.JWT_SECRET = 'test-secret-key-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.NODE_ENV = 'test';
'use strict';
/**
 * MISSIONARY MODULE — Unit Tests
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    setEx: jest.fn(), del: jest.fn(), get: jest.fn().mockResolvedValue(null),
  }),
  keys: { scriptureCurrent: () => 'k' },
}));
jest.mock('../src/services/maas360Service', () => ({
  enrollMissionaryDevice: jest.fn().mockResolvedValue({ success: true, mock: true }),
  unenrollMissionaryDevice: jest.fn().mockResolvedValue({ success: true, mock: true }),
}));
jest.mock('../src/services/notificationService', () => ({
  notifyLeaderApprovalNeeded: jest.fn().mockResolvedValue(undefined),
  notifyConversationMembers: jest.fn().mockResolvedValue(undefined),
  notifyIncomingCall: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-secret-key-for-jest-tests-only';

const { query } = require('../src/config/database');
const { enrollMissionaryDevice, unenrollMissionaryDevice } = require('../src/services/maas360Service');
const app = require('../src/app');

const makeToken = (user) => jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

const stakePresUser = {
  id: 'leader-001',
  full_name: 'Pres. Adeyemi',
  phone_number: '+2348011111111',
  email: null,
  role: 'stake_presidency',
  status: 'active',
  stake_id: 'stake-001',
  mission_id: null,
  mission_president_mission_id: null,
  missionary_mode_active: false,
  profile_hidden: false,
  is_approved: true,
  fcm_token: null,
  apns_token: null,
};

const ysaUser = {
  id: 'ysa-001',
  full_name: 'Chisom Eze',
  phone_number: '+2348022222222',
  role: 'ysa_member',
  stake_id: 'stake-001',
};

beforeEach(() => jest.clearAllMocks());

describe('POST /api/missionary/activate', () => {
  test('stake presidency can activate missionary mode', async () => {
    query.mockResolvedValueOnce({ rows: [stakePresUser] }); // auth middleware
    query.mockResolvedValueOnce({ rows: [{ phone_number: ysaUser.phone_number, full_name: ysaUser.full_name }] }); // get user
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE users
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE stake_pool_members

    const token = makeToken(stakePresUser);
    const res = await request(app)
      .post('/api/missionary/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: ysaUser.id, mission_id: 'mission-001', start_date: '2024-01-15' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('activated');
    expect(enrollMissionaryDevice).toHaveBeenCalledWith(
      ysaUser.id, ysaUser.phone_number, ysaUser.full_name
    );
  });

  test('YSA member cannot activate missionary mode for others', async () => {
    const ysaAuth = { ...stakePresUser, role: 'ysa_member', id: 'ysa-auth' };
    query.mockResolvedValueOnce({ rows: [ysaAuth] }); // auth

    const token = makeToken(ysaAuth);
    const res = await request(app)
      .post('/api/missionary/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: 'some-user', mission_id: 'mission-001' });

    expect(res.status).toBe(403);
    expect(enrollMissionaryDevice).not.toHaveBeenCalled();
  });
});

describe('POST /api/missionary/deactivate', () => {
  test('stake presidency can deactivate missionary mode', async () => {
    query.mockResolvedValueOnce({ rows: [stakePresUser] }); // auth
    query.mockResolvedValueOnce({ rows: [{ age: 24, stake_id: 'stake-001', full_name: 'Chisom Eze' }] }); // get user
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE users
    query.mockResolvedValueOnce({ rows: [] }); // re-insert stake pool

    const token = makeToken(stakePresUser);
    const res = await request(app)
      .post('/api/missionary/deactivate')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: ysaUser.id });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('returned');
    expect(unenrollMissionaryDevice).toHaveBeenCalledWith(ysaUser.id);
  });

  test('response mentions YSA restored for member under 35', async () => {
    query.mockResolvedValueOnce({ rows: [stakePresUser] });
    query.mockResolvedValueOnce({ rows: [{ age: 25, stake_id: 'stake-001', full_name: 'Young Member' }] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });

    const token = makeToken(stakePresUser);
    const res = await request(app)
      .post('/api/missionary/deactivate')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: 'young-user-id' });

    expect(res.body.message).toContain('YSA access restored');
  });
});

describe('GET /api/missionary/presidents', () => {
  test('mission president can view all mission presidents', async () => {
    const mpUser = { ...stakePresUser, role: 'mission_president', mission_president_mission_id: 'mission-001' };
    query.mockResolvedValueOnce({ rows: [mpUser] }); // auth
    query.mockResolvedValueOnce({ rows: [
      { id: 'mp1', full_name: 'Pres. Smith', role: 'mission_president', mission_name: 'Nigeria Lagos Mission' },
      { id: 'mp2', full_name: 'Pres. Brown', role: 'mission_president', mission_name: 'Ghana Accra Mission' },
    ]});

    const token = makeToken(mpUser);
    const res = await request(app)
      .get('/api/missionary/presidents')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  test('YSA member cannot view mission presidents list', async () => {
    const ysaAuth = { ...stakePresUser, role: 'ysa_member', mission_president_mission_id: null };
    query.mockResolvedValueOnce({ rows: [ysaAuth] });

    const token = makeToken(ysaAuth);
    const res = await request(app)
      .get('/api/missionary/presidents')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
