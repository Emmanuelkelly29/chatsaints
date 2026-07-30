-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'missionary', 'pending_approval', 'suspended', 'released_missionary');

-- CreateEnum
CREATE TYPE "leadership_role" AS ENUM ('ysa_member', 'ysa_rep', 'ysa_adviser', 'ysa_couple_adviser', 'bishop', 'district_presidency', 'stake_presidency', 'coordinating_council', 'area_authority', 'area_presidency', 'general_authority', 'apostle', 'first_presidency', 'mission_president', 'mission_president_wife', 'missionary', 'it_support');

-- CreateEnum
CREATE TYPE "message_type" AS ENUM ('text', 'image', 'video', 'audio', 'file', 'document', 'voice_note');

-- CreateEnum
CREATE TYPE "call_type" AS ENUM ('voice', 'video');

-- CreateEnum
CREATE TYPE "call_status" AS ENUM ('initiated', 'answered', 'declined', 'missed', 'ended');

-- CreateEnum
CREATE TYPE "status_visibility" AS ENUM ('everyone', 'contacts_only', 'selected', 'except');

-- CreateEnum
CREATE TYPE "status_media_type" AS ENUM ('image', 'video', 'voice', 'text');

-- CreateEnum
CREATE TYPE "meeting_status" AS ENUM ('waiting', 'active', 'ended');

-- CreateEnum
CREATE TYPE "meeting_role" AS ENUM ('host', 'co_host', 'presenter', 'attendee');

-- CreateEnum
CREATE TYPE "join_req_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "contact_request_preference" AS ENUM ('approved_pool', 'same_stake', 'nobody');

-- CreateEnum
CREATE TYPE "contact_request_status" AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "announcement_scope" AS ENUM ('global', 'area', 'mission', 'stake', 'district');

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "continent" VARCHAR(80),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coordinating_councils" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "area_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coordinating_councils_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stakes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "country" VARCHAR(80),
    "continent" VARCHAR(100),
    "coordinating_council_id" UUID,
    "ysa_pool_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "country" VARCHAR(80),
    "continent" VARCHAR(100),
    "coordinating_council_id" UUID,
    "ysa_pool_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wards" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "stake_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "stake_id" UUID,
    "district_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "area_id" UUID,
    "country" VARCHAR(80),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "email" VARCHAR(150),
    "full_name" VARCHAR(120) NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(10),
    "is_single" BOOLEAN NOT NULL DEFAULT true,
    "profile_photo_url" TEXT,
    "bio" TEXT,
    "password_hash" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "role" "leadership_role" NOT NULL DEFAULT 'ysa_member',
    "status" "user_status" NOT NULL DEFAULT 'pending_approval',
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "stake_id" UUID,
    "district_id" UUID,
    "ward_id" UUID,
    "branch_id" UUID,
    "mission_id" UUID,
    "missionary_start_date" DATE,
    "missionary_end_date" TIMESTAMPTZ,
    "missionary_mode_active" BOOLEAN NOT NULL DEFAULT false,
    "mission_president_mission_id" UUID,
    "maas360_enrolled" BOOLEAN NOT NULL DEFAULT false,
    "maas360_device_id" VARCHAR(200),
    "spouse_id" UUID,
    "profile_hidden" BOOLEAN NOT NULL DEFAULT false,
    "directory_visible" BOOLEAN NOT NULL DEFAULT true,
    "contact_request_preference" "contact_request_preference" NOT NULL DEFAULT 'approved_pool',
    "stealth_status_view" BOOLEAN NOT NULL DEFAULT false,
    "status_visibility_default" "status_visibility" NOT NULL DEFAULT 'contacts_only',
    "fcm_token" TEXT,
    "apns_token" TEXT,
    "last_seen" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stake_pool_members" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stake_id" UUID,
    "district_id" UUID,
    "added_by" UUID,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stake_pool_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200),
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "photo_url" TEXT,
    "max_members" INTEGER NOT NULL DEFAULT 1000,
    "only_admins_can_message" BOOLEAN NOT NULL DEFAULT false,
    "only_admins_can_edit" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "mission_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pinned_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "pinned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "type" "message_type" NOT NULL DEFAULT 'text',
    "content" TEXT,
    "media_url" TEXT,
    "media_size_bytes" BIGINT,
    "media_duration_secs" INTEGER,
    "reply_to_message_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reads" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "conversation_id" UUID,
    "initiated_by" UUID,
    "type" "call_type" NOT NULL,
    "status" "call_status" NOT NULL DEFAULT 'initiated',
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_participants" (
    "id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,

    CONSTRAINT "call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_rooms" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "room_name" VARCHAR(200) NOT NULL,
    "created_by" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_participants" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "video_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_room_participants" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,

    CONSTRAINT "video_room_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statuses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "media_url" TEXT,
    "media_type" "status_media_type" NOT NULL DEFAULT 'image',
    "caption" TEXT,
    "text_content" TEXT,
    "background_color" VARCHAR(20) NOT NULL DEFAULT '#0A1628',
    "duration_secs" INTEGER NOT NULL DEFAULT 5,
    "visibility" "status_visibility" NOT NULL DEFAULT 'contacts_only',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_visibility_users" (
    "id" UUID NOT NULL,
    "status_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "status_visibility_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_views" (
    "id" UUID NOT NULL,
    "status_id" UUID NOT NULL,
    "viewer_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_stealth" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "status_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leader_approvals" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "declared_role" "leadership_role" NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,

    CONSTRAINT "leader_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "sender_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "scope" "announcement_scope" NOT NULL DEFAULT 'global',
    "scope_id" UUID,
    "audience" TEXT[] DEFAULT ARRAY['all']::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_recipients" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "announcement_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "host_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meeting_code" VARCHAR(12) NOT NULL,
    "join_key" VARCHAR(100),
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "allow_link_join" BOOLEAN NOT NULL DEFAULT true,
    "max_participants" INTEGER NOT NULL DEFAULT 1000,
    "status" "meeting_status" NOT NULL DEFAULT 'waiting',
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "meeting_role" NOT NULL DEFAULT 'attendee',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,
    "is_muted" BOOLEAN NOT NULL DEFAULT false,
    "hand_raised" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_join_requests" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "join_req_status" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "meeting_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "intro_message" TEXT,
    "status" "contact_request_status" NOT NULL DEFAULT 'pending',
    "conversation_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ,

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_connections" (
    "id" UUID NOT NULL,
    "user_low_id" UUID NOT NULL,
    "user_high_id" UUID NOT NULL,
    "request_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255),
    "body" TEXT,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scriptures" (
    "id" UUID NOT NULL,
    "book" VARCHAR(80) NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "volume" VARCHAR(60),
    "reference" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scriptures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e2ee_identity_keys" (
    "user_id" UUID NOT NULL,
    "registration_id" INTEGER NOT NULL,
    "identity_key_public" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "e2ee_identity_keys_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "e2ee_signed_prekeys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key_id" INTEGER NOT NULL,
    "public_key" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "e2ee_signed_prekeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e2ee_one_time_prekeys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key_id" INTEGER NOT NULL,
    "public_key" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "e2ee_one_time_prekeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e2ee_message_queue" (
    "id" UUID NOT NULL,
    "sender_id" UUID,
    "recipient_id" UUID NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "e2ee_message_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coordinating_councils_area_id_idx" ON "coordinating_councils"("area_id");

-- CreateIndex
CREATE INDEX "stakes_coordinating_council_id_idx" ON "stakes"("coordinating_council_id");

-- CreateIndex
CREATE INDEX "districts_coordinating_council_id_idx" ON "districts"("coordinating_council_id");

-- CreateIndex
CREATE INDEX "wards_stake_id_idx" ON "wards"("stake_id");

-- CreateIndex
CREATE INDEX "branches_stake_id_idx" ON "branches"("stake_id");

-- CreateIndex
CREATE INDEX "branches_district_id_idx" ON "branches"("district_id");

-- CreateIndex
CREATE INDEX "missions_area_id_idx" ON "missions"("area_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_stake_id_idx" ON "users"("stake_id");

-- CreateIndex
CREATE INDEX "users_district_id_idx" ON "users"("district_id");

-- CreateIndex
CREATE INDEX "users_mission_id_idx" ON "users"("mission_id");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "stake_pool_members_stake_id_idx" ON "stake_pool_members"("stake_id");

-- CreateIndex
CREATE INDEX "stake_pool_members_district_id_idx" ON "stake_pool_members"("district_id");

-- CreateIndex
CREATE UNIQUE INDEX "stake_pool_members_user_id_stake_id_key" ON "stake_pool_members"("user_id", "stake_id");

-- CreateIndex
CREATE UNIQUE INDEX "stake_pool_members_user_id_district_id_key" ON "stake_pool_members"("user_id", "district_id");

-- CreateIndex
CREATE INDEX "conversations_mission_id_idx" ON "conversations"("mission_id");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "conversation_members"("conversation_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pinned_conversations_user_id_conversation_id_key" ON "pinned_conversations"("user_id", "conversation_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reads_message_id_user_id_key" ON "message_reads"("message_id", "user_id");

-- CreateIndex
CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");

-- CreateIndex
CREATE INDEX "message_reactions_user_id_idx" ON "message_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "calls_conversation_id_idx" ON "calls"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_participants_call_id_user_id_key" ON "call_participants"("call_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_rooms_room_name_key" ON "video_rooms"("room_name");

-- CreateIndex
CREATE INDEX "video_rooms_conversation_id_idx" ON "video_rooms"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_room_participants_room_id_user_id_key" ON "video_room_participants"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "statuses_user_id_idx" ON "statuses"("user_id");

-- CreateIndex
CREATE INDEX "statuses_expires_at_idx" ON "statuses"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "status_visibility_users_status_id_user_id_key" ON "status_visibility_users"("status_id", "user_id");

-- CreateIndex
CREATE INDEX "status_views_status_id_idx" ON "status_views"("status_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_views_status_id_viewer_id_key" ON "status_views"("status_id", "viewer_id");

-- CreateIndex
CREATE INDEX "leader_approvals_applicant_id_idx" ON "leader_approvals"("applicant_id");

-- CreateIndex
CREATE INDEX "leader_approvals_status_idx" ON "leader_approvals"("status");

-- CreateIndex
CREATE INDEX "announcements_sender_id_created_at_idx" ON "announcements"("sender_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "announcement_recipients_user_id_announcement_id_idx" ON "announcement_recipients"("user_id", "announcement_id");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_recipients_announcement_id_user_id_key" ON "announcement_recipients"("announcement_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_meeting_code_key" ON "meetings"("meeting_code");

-- CreateIndex
CREATE INDEX "meetings_host_id_idx" ON "meetings"("host_id");

-- CreateIndex
CREATE INDEX "meetings_status_idx" ON "meetings"("status");

-- CreateIndex
CREATE INDEX "meeting_participants_meeting_id_idx" ON "meeting_participants"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_participants_user_id_idx" ON "meeting_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meeting_id_user_id_key" ON "meeting_participants"("meeting_id", "user_id");

-- CreateIndex
CREATE INDEX "meeting_join_requests_meeting_id_status_idx" ON "meeting_join_requests"("meeting_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_join_requests_meeting_id_user_id_key" ON "meeting_join_requests"("meeting_id", "user_id");

-- CreateIndex
CREATE INDEX "contact_requests_sender_id_status_created_at_idx" ON "contact_requests"("sender_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contact_requests_recipient_id_status_created_at_idx" ON "contact_requests"("recipient_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contact_requests_sender_id_recipient_id_key" ON "contact_requests"("sender_id", "recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_connections_user_low_id_user_high_id_key" ON "contact_connections"("user_low_id", "user_high_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "scriptures_volume_idx" ON "scriptures"("volume");

-- CreateIndex
CREATE UNIQUE INDEX "scriptures_book_chapter_verse_key" ON "scriptures"("book", "chapter", "verse");

-- CreateIndex
CREATE INDEX "e2ee_signed_prekeys_user_id_idx" ON "e2ee_signed_prekeys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "e2ee_signed_prekeys_user_id_key_id_key" ON "e2ee_signed_prekeys"("user_id", "key_id");

-- CreateIndex
CREATE INDEX "e2ee_one_time_prekeys_user_id_used_idx" ON "e2ee_one_time_prekeys"("user_id", "used");

-- CreateIndex
CREATE UNIQUE INDEX "e2ee_one_time_prekeys_user_id_key_id_key" ON "e2ee_one_time_prekeys"("user_id", "key_id");

-- CreateIndex
CREATE INDEX "e2ee_message_queue_recipient_id_idx" ON "e2ee_message_queue"("recipient_id");

-- AddForeignKey
ALTER TABLE "coordinating_councils" ADD CONSTRAINT "coordinating_councils_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stakes" ADD CONSTRAINT "stakes_coordinating_council_id_fkey" FOREIGN KEY ("coordinating_council_id") REFERENCES "coordinating_councils"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_coordinating_council_id_fkey" FOREIGN KEY ("coordinating_council_id") REFERENCES "coordinating_councils"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_stake_id_fkey" FOREIGN KEY ("stake_id") REFERENCES "stakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_stake_id_fkey" FOREIGN KEY ("stake_id") REFERENCES "stakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_stake_id_fkey" FOREIGN KEY ("stake_id") REFERENCES "stakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_mission_president_mission_id_fkey" FOREIGN KEY ("mission_president_mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_spouse_id_fkey" FOREIGN KEY ("spouse_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stake_pool_members" ADD CONSTRAINT "stake_pool_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stake_pool_members" ADD CONSTRAINT "stake_pool_members_stake_id_fkey" FOREIGN KEY ("stake_id") REFERENCES "stakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stake_pool_members" ADD CONSTRAINT "stake_pool_members_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stake_pool_members" ADD CONSTRAINT "stake_pool_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_conversations" ADD CONSTRAINT "pinned_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_conversations" ADD CONSTRAINT "pinned_conversations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_rooms" ADD CONSTRAINT "video_rooms_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_rooms" ADD CONSTRAINT "video_rooms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_room_participants" ADD CONSTRAINT "video_room_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "video_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_room_participants" ADD CONSTRAINT "video_room_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_visibility_users" ADD CONSTRAINT "status_visibility_users_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_visibility_users" ADD CONSTRAINT "status_visibility_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_views" ADD CONSTRAINT "status_views_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_views" ADD CONSTRAINT "status_views_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leader_approvals" ADD CONSTRAINT "leader_approvals_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leader_approvals" ADD CONSTRAINT "leader_approvals_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_join_requests" ADD CONSTRAINT "meeting_join_requests_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_join_requests" ADD CONSTRAINT "meeting_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_connections" ADD CONSTRAINT "contact_connections_user_low_id_fkey" FOREIGN KEY ("user_low_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_connections" ADD CONSTRAINT "contact_connections_user_high_id_fkey" FOREIGN KEY ("user_high_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_connections" ADD CONSTRAINT "contact_connections_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "contact_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e2ee_identity_keys" ADD CONSTRAINT "e2ee_identity_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e2ee_signed_prekeys" ADD CONSTRAINT "e2ee_signed_prekeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e2ee_one_time_prekeys" ADD CONSTRAINT "e2ee_one_time_prekeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e2ee_message_queue" ADD CONSTRAINT "e2ee_message_queue_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e2ee_message_queue" ADD CONSTRAINT "e2ee_message_queue_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Constraints the Prisma schema language cannot express, added by hand before
-- this migration was ever applied. Both are documented in schema.prisma.
-- ─────────────────────────────────────────────────────────────────────────────

-- A pool membership belongs to exactly one unit: a stake or a district, never
-- both and never neither. The old schema had a single stake_id column with a
-- foreign key to stakes that the code also filled with district ids, so
-- district pools could never actually gain members.
ALTER TABLE "stake_pool_members"
  ADD CONSTRAINT "stake_pool_members_one_unit_only"
  CHECK (("stake_id" IS NOT NULL) <> ("district_id" IS NOT NULL));

-- One row per pair of connected users. Ordering the ids makes the unique
-- constraint on (user_low_id, user_high_id) actually mean "this pair", rather
-- than depending on callers to sort correctly before inserting.
ALTER TABLE "contact_connections"
  ADD CONSTRAINT "contact_connections_ordered_pair"
  CHECK ("user_low_id" < "user_high_id");
