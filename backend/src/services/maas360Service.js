'use strict';
/**
 * MAAS360 MDM SERVICE (IBM Mobile Device Management)
 * Controls missionary device restrictions.
 *
 * Prerequisites:
 *  1. Your church must have an IBM MaaS360 enterprise account
 *  2. You need your Tenant ID, credentials, and App keys from IBM
 *  3. Fill in the MAAS360_* values in your .env file
 *
 * What this does:
 *  - When a missionary is activated: enrolls their device and applies
 *    a strict policy profile (blocks YSA pool, restricts to mission-only chat)
 *  - When a missionary returns: removes the policy profile and unenrolls
 *
 * IBM MaaS360 API docs: https://www.ibm.com/docs/en/maas360
 */

const fetch = require('node-fetch');
const { query } = require('../config/database');

const MAAS360_BASE = 'https://services.fiberlink.com';

// ── Authentication ────────────────────────────────────────────────

let _authToken = null;
let _tokenExpiry = 0;

const getAuthToken = async () => {
  if (_authToken && Date.now() < _tokenExpiry) return _authToken;

  const {
    MAAS360_TENANT_ID,
    MAAS360_USERNAME,
    MAAS360_PASSWORD,
    MAAS360_APP_ID,
    MAAS360_APP_VERSION,
    MAAS360_APP_ACCESS_KEY,
    MAAS360_PLATFORM_ID,
  } = process.env;

  // Skip if not configured (development mode)
  if (!MAAS360_TENANT_ID) {
    console.warn('MaaS360: not configured (MAAS360_TENANT_ID missing). Skipping MDM enrollment.');
    return null;
  }

  try {
    const res = await fetch(
      `${MAAS360_BASE}/auth-apis/auth/1.0/authenticate/customer/${MAAS360_TENANT_ID}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          authRequest: {
            maaS360AdminAuth: {
              platformID: MAAS360_PLATFORM_ID || '3',
              adminUserName: MAAS360_USERNAME,
              password: MAAS360_PASSWORD,
              appID: MAAS360_APP_ID,
              appVersion: MAAS360_APP_VERSION || '1.0',
              appAccessKey: MAAS360_APP_ACCESS_KEY,
            },
          },
        }),
      }
    );
    const json = await res.json();
    _authToken = json?.authResponse?.authToken;
    _tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 minutes
    return _authToken;
  } catch (err) {
    console.error('MaaS360 auth error:', err.message);
    return null;
  }
};

// ── Policy helpers ───────────────────────────────────────────────

/**
 * The missionary MDM policy profile name in your MaaS360 tenant.
 * Create this profile in the MaaS360 console before using this service.
 * It should restrict: browser, app installs, and enforce app whitelist.
 */
const MISSIONARY_POLICY_NAME = 'LDS_Missionary_Restricted_Policy';

// ── Device enrollment ────────────────────────────────────────────

/**
 * Send an MDM enrollment invitation to the missionary's device.
 * In production this sends an SMS/email with an enrollment link.
 */
const enrollMissionaryDevice = async (userId, phoneNumber, fullName) => {
  const token = await getAuthToken();
  if (!token) {
    // Development fallback — just mark as enrolled in DB
    await query(
      'UPDATE users SET maas360_enrolled = true, maas360_device_id = $1 WHERE id = $2',
      [`DEV-MOCK-${userId.substring(0, 8)}`, userId]
    );
    console.log(`MaaS360 (mock): enrolled missionary ${fullName}`);
    return { success: true, mock: true };
  }

  try {
    const tenantId = process.env.MAAS360_TENANT_ID;

    // Send enrollment invitation
    const res = await fetch(
      `${MAAS360_BASE}/device-apis/devices/2.0/sendEnrollmentInvitation/customer/${tenantId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: token,
        },
        body: JSON.stringify({
          enrollmentRequest: {
            deviceOwnership: 'Corporate',
            phoneNumber,
            userName: fullName,
            emailAddress: `${userId}@ldsmissionary.internal`,
            devicePlatform: 'iOS', // or Android — detect from device registration
            policyName: MISSIONARY_POLICY_NAME,
          },
        }),
      }
    );

    const json = await res.json();
    const deviceId = json?.enrollmentResponse?.deviceId || `MAAS-${Date.now()}`;

    await query(
      'UPDATE users SET maas360_enrolled = true, maas360_device_id = $1 WHERE id = $2',
      [deviceId, userId]
    );

    console.log(`MaaS360: enrolled missionary ${fullName}, device ${deviceId}`);
    return { success: true, deviceId };
  } catch (err) {
    console.error('MaaS360 enroll error:', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Remove the MDM policy when a missionary returns home.
 * This restores the device to a normal personal device.
 */
const unenrollMissionaryDevice = async (userId) => {
  const token = await getAuthToken();

  // Get the stored device ID
  const result = await query(
    'SELECT maas360_device_id, full_name FROM users WHERE id = $1',
    [userId]
  );
  if (!result.rows.length) return;

  const { maas360_device_id: deviceId, full_name: fullName } = result.rows[0];

  if (!token || !deviceId || deviceId.startsWith('DEV-MOCK')) {
    await query(
      'UPDATE users SET maas360_enrolled = false, maas360_device_id = NULL WHERE id = $1',
      [userId]
    );
    console.log(`MaaS360 (mock): unenrolled missionary ${fullName}`);
    return { success: true, mock: true };
  }

  try {
    const tenantId = process.env.MAAS360_TENANT_ID;

    await fetch(
      `${MAAS360_BASE}/device-apis/devices/2.0/wipeDevice/customer/${tenantId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: token,
        },
        body: JSON.stringify({
          wipeRequest: {
            deviceId,
            wipeType: 'selective', // selective = remove only corporate data, not personal
          },
        }),
      }
    );

    await query(
      'UPDATE users SET maas360_enrolled = false, maas360_device_id = NULL WHERE id = $1',
      [userId]
    );

    console.log(`MaaS360: unenrolled missionary ${fullName}, device ${deviceId}`);
    return { success: true };
  } catch (err) {
    console.error('MaaS360 unenroll error:', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Apply a specific policy to a device (e.g. tighten restrictions temporarily).
 */
const applyPolicy = async (deviceId, policyName) => {
  const token = await getAuthToken();
  if (!token) return;

  try {
    const tenantId = process.env.MAAS360_TENANT_ID;
    await fetch(
      `${MAAS360_BASE}/device-apis/devices/2.0/applyPolicy/customer/${tenantId}`,
      {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyRequest: { deviceId, policyName } }),
      }
    );
    console.log(`MaaS360: applied policy ${policyName} to device ${deviceId}`);
  } catch (err) {
    console.error('MaaS360 applyPolicy error:', err.message);
  }
};

module.exports = { enrollMissionaryDevice, unenrollMissionaryDevice, applyPolicy };
