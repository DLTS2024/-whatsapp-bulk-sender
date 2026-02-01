-- WhatsApp Bulk Sender - Database Schema
-- Run this in phpMyAdmin

CREATE DATABASE IF NOT EXISTS whatsapp_automation;
USE whatsapp_automation;

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    is_admin BOOLEAN DEFAULT FALSE,
    license_key VARCHAR(50) NULL,
    license_expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Licenses Table
CREATE TABLE IF NOT EXISTS licenses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    license_key VARCHAR(50) UNIQUE NOT NULL,
    user_id INT NULL,
    plan_name VARCHAR(50) DEFAULT '2 Year Plan',
    price INT DEFAULT 999,
    duration_days INT DEFAULT 730,
    activated_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    status ENUM('unused', 'active', 'expired') DEFAULT 'unused',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Templates Table (with user_id)
CREATE TABLE IF NOT EXISTS templates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    name VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Message Logs Table (with user_id)
CREATE TABLE IF NOT EXISTS message_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    phone_number VARCHAR(20) NOT NULL,
    template_id INT NULL,
    message_text TEXT,
    status ENUM('sent', 'failed', 'pending') DEFAULT 'pending',
    error_message TEXT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
);

-- Create default admin user (password: admin123)
INSERT INTO users (email, password_hash, name, is_admin) VALUES 
('admin@whatsapp.com', '$2b$10$rQZ6vWwJqGHgUAX9VPgQxeJhJQZKvHGQUVYFNx0GnH8CwVPUHqYHe', 'Admin', TRUE)
ON DUPLICATE KEY UPDATE email=email;

-- Create some sample license keys
INSERT INTO licenses (license_key, plan_name, price, duration_days, status) VALUES
('WA-2024-SAMPLE-001', '2 Year Plan', 999, 730, 'unused'),
('WA-2024-SAMPLE-002', '2 Year Plan', 999, 730, 'unused'),
('WA-2024-SAMPLE-003', '2 Year Plan', 999, 730, 'unused')
ON DUPLICATE KEY UPDATE license_key=license_key;

-- Settings Table (for admin configurations)
CREATE TABLE IF NOT EXISTS settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO settings (setting_key, setting_value) VALUES
('upi_id', 'your-upi-id@bank'),
('upi_name', 'Your Business Name'),
('whatsapp_number', '919876543210'),
('license_price', '999'),
('license_duration', '2 Years')
ON DUPLICATE KEY UPDATE setting_key=setting_key;
