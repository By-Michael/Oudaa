'use strict';

const express = require('express');
const platformAuthRoutes = require('./platformAuthRoutes');
const platformDashboardRoutes = require('./platformDashboardRoutes');
const platformSearchRoutes = require('./platformSearchRoutes');
const platformCommunityRoutes = require('./platformCommunityRoutes');
const platformUserRoutes = require('./platformUserRoutes');
const platformSupportRoutes = require('./platformSupportRoutes');
const platformPerformanceRoutes = require('./platformPerformanceRoutes');
const platformSecurityRoutes = require('./platformSecurityRoutes');
const platformAdminManagementRoutes = require('./platformAdminManagementRoutes');
const platformFeatureFlagRoutes = require('./platformFeatureFlagRoutes');
const platformMaintenanceRoutes = require('./platformMaintenanceRoutes');
const platformAnnouncementRoutes = require('./platformAnnouncementRoutes');
const platformNotificationRoutes = require('./platformNotificationRoutes');
const platformExportRoutes = require('./platformExportRoutes');
const platformConfigRoutes = require('./platformConfigRoutes');
const platformAuditRoutes = require('./platformAuditRoutes');
const platformIntegrationRoutes = require('./platformIntegrationRoutes');

const router = express.Router();

router.use('/auth', platformAuthRoutes);
router.use('/dashboard', platformDashboardRoutes);
router.use('/search', platformSearchRoutes);
router.use('/communities', platformCommunityRoutes);
router.use('/users', platformUserRoutes);
router.use('/support', platformSupportRoutes);
router.use('/performance', platformPerformanceRoutes);
router.use('/security', platformSecurityRoutes);
router.use('/platform-admins', platformAdminManagementRoutes);
router.use('/feature-flags', platformFeatureFlagRoutes);
router.use('/maintenance', platformMaintenanceRoutes);
router.use('/announcements', platformAnnouncementRoutes);
router.use('/notifications', platformNotificationRoutes);
router.use('/exports', platformExportRoutes);
router.use('/settings', platformConfigRoutes);
router.use('/audit', platformAuditRoutes);
router.use('/integrations', platformIntegrationRoutes);

module.exports = router;
