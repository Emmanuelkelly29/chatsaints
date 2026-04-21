'use strict';
const { query } = require('../config/database');
const { ROLE_TIER, minApproverTierFor } = require('../utils/accessControl');

// GET /api/leaders/approvals — pending approvals for this leader to review
const getPendingApprovals = async (req, res) => {
  try {
    const userTier = ROLE_TIER[req.user.role] || 0;
    if (userTier < 2) return res.status(403).json({ error: 'Not authorized' });

    // IT Support sees ALL pending approvals regardless of tier
    const isItSupport = req.user.role === 'it_support';

    const result = await query(
      `SELECT la.id, la.declared_role, la.created_at, la.status,
              u.id as applicant_id, u.full_name, u.phone_number, u.email,
              u.date_of_birth, u.stake_id, s.name as stake_name
       FROM leader_approvals la
       JOIN users u ON la.applicant_id=u.id
       LEFT JOIN stakes s ON u.stake_id=s.id
       WHERE la.status='pending'
         AND ($2::boolean OR COALESCE($1, 0) >= (
           CASE la.declared_role
             WHEN 'ysa_rep' THEN 3
             WHEN 'ysa_couple_adviser' THEN 3
             WHEN 'bishop' THEN 4
             WHEN 'stake_presidency' THEN 5
             WHEN 'mission_president' THEN 6
             ELSE 6
           END
         ))
       ORDER BY la.created_at ASC`,
      [userTier, isItSupport]
    );
    return res.json({ data: result.rows });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/leaders/approvals/:id/approve
const approveLeader = async (req, res) => {
  try {
    const { id } = req.params;
    const approvalResult = await query(
      'SELECT * FROM leader_approvals WHERE id=$1 AND status=\'pending\'', [id]);
    if (!approvalResult.rows.length) return res.status(404).json({ error: 'Approval not found' });

    const approval = approvalResult.rows[0];
    const requiredTier = minApproverTierFor(approval.declared_role);
    const approverTier = ROLE_TIER[req.user.role] || 0;

    // IT Support can approve any role
    if (approverTier < requiredTier && req.user.role !== 'it_support')
      return res.status(403).json({ error: 'Your role level cannot approve this position' });

    await query(
      `UPDATE leader_approvals SET status='approved',reviewer_id=$1,reviewed_at=NOW() WHERE id=$2`,
      [req.user.id, id]);
    await query(
      `UPDATE users SET is_approved=true,approved_by=$1,approved_at=NOW() WHERE id=$2`,
      [req.user.id, approval.applicant_id]);

    // Auto-approve stake pool membership if this user is a YSA member
    const applicantRes = await query('SELECT role, stake_id FROM users WHERE id=$1', [approval.applicant_id]);
    if (applicantRes.rows.length) {
      const { role: applicantRole, stake_id } = applicantRes.rows[0];
      if (applicantRole === 'ysa_member' && stake_id) {
        await query(
          `UPDATE stake_pool_members SET approved=true, approved_at=NOW(), added_by=$1
           WHERE user_id=$2 AND stake_id=$3`,
          [req.user.id, approval.applicant_id, stake_id]
        );
      }
    }

    return res.json({ message: 'Leader account approved' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/leaders/approvals/:id/reject
const rejectLeader = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    await query(
      `UPDATE leader_approvals SET status='rejected',reviewer_id=$1,reviewed_at=NOW(),notes=$2 WHERE id=$3`,
      [req.user.id, notes||null, id]);
    return res.json({ message: 'Application rejected' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

// POST /api/leaders/stake-pool/approve/:userId — YSA rep approves pool member
const approveStakePoolMember = async (req, res) => {
  try {
    const allowedRoles = ['ysa_rep','bishop','stake_presidency','it_support'];
    if (!allowedRoles.includes(req.user.role))
      return res.status(403).json({ error: 'Only YSA Rep or above can approve pool members' });

    await query(
      `UPDATE stake_pool_members SET approved=true,approved_at=NOW(),added_by=$1
       WHERE user_id=$2 AND stake_id=$3`,
      [req.user.id, req.params.userId, req.user.stake_id]);
    return res.json({ message: 'Member approved for stake pool' });
  } catch (err) { return res.status(500).json({ error: 'Failed' }); }
};

module.exports = { getPendingApprovals, approveLeader, rejectLeader, approveStakePoolMember };
