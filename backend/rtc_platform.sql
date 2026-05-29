CREATE DATABASE IF NOT EXISTS rtc_platform
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE rtc_platform;

CREATE TABLE IF NOT EXISTS tenants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    billing_rate_per_minute DECIMAL(10,4) DEFAULT 0.0000,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NULL,
    phone VARCHAR(50) NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(255) NULL,
    status ENUM('active', 'inactive', 'banned') DEFAULT 'active',
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_tenant_email (tenant_id, email),
    INDEX idx_users_tenant_id (tenant_id),
    CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS roles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    label VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    tenant_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    owner_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT NULL,
    profile_image VARCHAR(255) NULL,
    room_type ENUM('audio', 'video', 'group_audio', 'group_video', 'solo_live', 'pk_live') NOT NULL DEFAULT 'video',
    privacy_type ENUM('public', 'private', 'password') NOT NULL DEFAULT 'public',
    password_hash VARCHAR(255) NULL,
    max_mic_count INT DEFAULT 8,
    theme VARCHAR(100) NULL,
    chat_enabled BOOLEAN DEFAULT TRUE,
    gift_enabled BOOLEAN DEFAULT TRUE,
    screen_share_enabled BOOLEAN DEFAULT FALSE,
    ai_security_enabled BOOLEAN DEFAULT FALSE,
    status ENUM('active', 'inactive', 'ended') DEFAULT 'active',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rooms_tenant_id (tenant_id),
    INDEX idx_rooms_owner_id (owner_id),
    CONSTRAINT fk_rooms_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_rooms_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_roles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    room_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role ENUM('owner', 'admin', 'moderator') NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_room_user_role (room_id, user_id, role),
    CONSTRAINT fk_room_roles_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_room_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_bans (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    room_id BIGINT UNSIGNED NOT NULL,
    banned_user_id BIGINT UNSIGNED NOT NULL,
    banned_by BIGINT UNSIGNED NOT NULL,
    ban_type ENUM('temporary', 'permanent') DEFAULT 'temporary',
    reason TEXT NULL,
    starts_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP NULL,
    status ENUM('active', 'expired', 'revoked') DEFAULT 'active',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_room_bans_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_room_bans_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_room_bans_user FOREIGN KEY (banned_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_room_bans_by FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rtc_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    room_id BIGINT UNSIGNED NOT NULL,
    rtc_provider ENUM('native_webrtc') NOT NULL DEFAULT 'native_webrtc',
    signaling_room VARCHAR(150) NOT NULL,
    session_type ENUM('audio', 'video', 'group_audio', 'group_video', 'solo_live', 'pk_live') NOT NULL,
    started_by BIGINT UNSIGNED NOT NULL,
    started_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    status ENUM('active', 'ended') DEFAULT 'active',
    total_duration_seconds BIGINT DEFAULT 0,
    total_participant_minutes DECIMAL(12,2) DEFAULT 0.00,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rtc_sessions_room_id (room_id),
    INDEX idx_rtc_sessions_status (status),
    INDEX idx_rtc_sessions_signaling_room (signaling_room),
    CONSTRAINT fk_rtc_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_rtc_sessions_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_rtc_sessions_started_by FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rtc_session_participants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    room_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    peer_uid BIGINT UNSIGNED NOT NULL,
    role_in_room ENUM('end_user', 'owner', 'admin', 'moderator', 'speaker', 'audience') DEFAULT 'end_user',
    joined_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP NULL,
    duration_seconds BIGINT DEFAULT 0,
    mic_enabled BOOLEAN DEFAULT FALSE,
    camera_enabled BOOLEAN DEFAULT FALSE,
    screen_shared BOOLEAN DEFAULT FALSE,
    connection_status ENUM('connected', 'disconnected', 'reconnecting') DEFAULT 'connected',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_participants_session_id (session_id),
    INDEX idx_participants_room_id (room_id),
    INDEX idx_participants_user_id (user_id),
    CONSTRAINT fk_participants_session FOREIGN KEY (session_id) REFERENCES rtc_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_participants_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_participants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rtc_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    room_id BIGINT UNSIGNED NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    event_type ENUM('join', 'leave', 'mic_on', 'mic_off', 'camera_on', 'camera_off', 'screen_share_start', 'screen_share_stop', 'connection_lost', 'reconnected', 'mute_by_moderator', 'kick_by_moderator', 'ban_by_moderator') NOT NULL,
    event_data JSON NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rtc_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_rtc_events_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_rtc_events_session FOREIGN KEY (session_id) REFERENCES rtc_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_rtc_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    room_id BIGINT UNSIGNED NOT NULL,
    session_id BIGINT UNSIGNED NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    parent_message_id BIGINT UNSIGNED NULL,
    message_type ENUM('text', 'image', 'voice', 'gift', 'system') DEFAULT 'text',
    message_body TEXT NULL,
    media_url VARCHAR(255) NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    is_unsent BOOLEAN DEFAULT FALSE,
    deleted_by BIGINT UNSIGNED NULL,
    deleted_at TIMESTAMP NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_chat_room_id (room_id),
    INDEX idx_chat_sender_id (sender_id),
    CONSTRAINT fk_chat_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    room_id BIGINT UNSIGNED NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    usage_type ENUM('audio', 'video', 'screen_share') NOT NULL,
    started_at TIMESTAMP NULL,
    ended_at TIMESTAMP NULL,
    duration_seconds BIGINT DEFAULT 0,
    billable_minutes DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usage_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_usage_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT fk_usage_session FOREIGN KEY (session_id) REFERENCES rtc_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT IGNORE INTO tenants (id, name, status, billing_rate_per_minute)
VALUES (1, 'Accenture', 'active', 0.0000);

INSERT IGNORE INTO roles (id, name, label) VALUES
(1, 'end_user', 'End User'),
(2, 'room_owner', 'Room Owner'),
(3, 'moderator', 'Moderator'),
(4, 'client_admin', 'Client Admin'),
(5, 'super_admin', 'Platform Super Admin'),
(6, 'sdk_developer', 'SDK Developer');

INSERT INTO users (
    tenant_id,
    name,
    email,
    phone,
    password_hash,
    status,
    created_at,
    updated_at
)
VALUES (
    1,
    'TalkEachOther Super Admin',
    'superadmin@talkeachother.com',
    NULL,
    '$2b$10$vF8cp4MARLxJf8Y/t6Fz8.N4eMnjKHX5LNM393qVr7PJtiM9nakOG',
    'active',
    NOW(),
    NOW()
)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    password_hash = VALUES(password_hash),
    status = VALUES(status),
    updated_at = NOW();

INSERT INTO users (
    tenant_id,
    name,
    email,
    phone,
    password_hash,
    status,
    created_at,
    updated_at
)
VALUES (
    1,
    'Accenture Admin',
    'admin@accenture.com',
    NULL,
    '$2b$10$vF8cp4MARLxJf8Y/t6Fz8.N4eMnjKHX5LNM393qVr7PJtiM9nakOG',
    'active',
    NOW(),
    NOW()
)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    password_hash = VALUES(password_hash),
    status = VALUES(status),
    updated_at = NOW();

UPDATE users
SET status = 'inactive',
    updated_at = NOW()
WHERE email IN (
    'admin@rtc.com',
    'demo-host@rtc.com',
    'demo-moderator@rtc.com',
    'demo-speaker@rtc.com',
    'demo-viewer@rtc.com',
    'demo-banned@rtc.com'
);

DELETE user_roles
FROM user_roles
INNER JOIN users ON users.id = user_roles.user_id
INNER JOIN roles ON roles.id = user_roles.role_id
WHERE roles.name IN ('client_admin', 'super_admin')
AND users.email NOT IN ('superadmin@talkeachother.com', 'admin@accenture.com');

DELETE user_roles
FROM user_roles
INNER JOIN users ON users.id = user_roles.user_id
INNER JOIN roles ON roles.id = user_roles.role_id
WHERE roles.name IN ('end_user', 'client_admin', 'super_admin')
AND users.email IN ('superadmin@talkeachother.com', 'admin@accenture.com');

SET @super_admin_user_id := (
    SELECT id
    FROM users
    WHERE tenant_id = 1
    AND email = 'superadmin@talkeachother.com'
    LIMIT 1
);

INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
SELECT @super_admin_user_id, roles.id, 1, NOW()
FROM roles
WHERE roles.name IN ('end_user', 'client_admin', 'super_admin')
AND @super_admin_user_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_roles.user_id = @super_admin_user_id
    AND user_roles.role_id = roles.id
    AND user_roles.tenant_id = 1
);

SET @accenture_admin_user_id := (
    SELECT id
    FROM users
    WHERE tenant_id = 1
    AND email = 'admin@accenture.com'
    LIMIT 1
);

INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
SELECT @accenture_admin_user_id, roles.id, 1, NOW()
FROM roles
WHERE roles.name IN ('end_user', 'client_admin')
AND @accenture_admin_user_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_roles.user_id = @accenture_admin_user_id
    AND user_roles.role_id = roles.id
    AND user_roles.tenant_id = 1
);
